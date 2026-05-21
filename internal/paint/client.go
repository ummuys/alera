package paint

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

type client struct {
	ID       string
	Nickname string
	Conn     *websocket.Conn
	RoomID   string
	Color    string

	// INFO
	logger zerolog.Logger

	// SYNC
	RouterChan chan writeMessage
	WriteChan  chan []byte
	Done       chan struct{}
	DoneOnce   sync.Once
}

func newClient(id string, conn *websocket.Conn, rc chan writeMessage, logger zerolog.Logger) *client {
	client := &client{
		ID:         id,
		Conn:       conn,
		logger:     logger,
		WriteChan:  make(chan []byte, 128),
		RouterChan: rc,
		Done:       make(chan struct{}),
	}
	go client.writePump()
	go client.readPump()
	return client
}

// Проблема: close() сам делает close(c.Done) без внутреннего sync.Once; сейчас вызовы обёрнуты DoneOnce.Do, но это хрупкий контракт.
func (c *client) close() {
	c.Conn.Close()
	close(c.Done)
}

// Отправка сообщения на websocket соединение

// Проблема: writePump читает for msg := range c.WriteChan, но WriteChan нигде не закрывается при remove/shutdown.
func (c *client) writePump() {
	for msg := range c.WriteChan {

		if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			c.logger.Error().Err(err).Str("client_id", c.ID).Str("Nickname", c.Nickname).Msg("can't read message from send chan")
			c.DoneOnce.Do(func() { c.close() })
			return
		}
	}
}

// Получение сообщения с websocket соединения
func (c *client) readPump() {

	for {
		_, msg, err := c.Conn.ReadMessage()
		if err != nil {
			c.DoneOnce.Do(func() { c.close() })
			return
		}

		var event ClientEvent
		if err := json.Unmarshal(msg, &event); err != nil {
			continue
		}

		switch event.Type {

		// Метод о рассылке ивента захода нового пользователя
		case EventTypeJoin:
			c.eventTypeJoin(event)

		// Метод для рассылки ивента об новом сообщении
		case EventTypeChat:
			c.eventTypeChat(event)

		// Метод для рассылки ивента об изменения борда
		case EventTypeDraw:
			c.eventTypeDraw(event)

		// Метод для рассылки ивента об очистке борда
		case EventTypeClear:
			c.eventTypeClear(event)

		default:
			// Если ничего не подошло
		}
	}

}

func (c *client) eventTypeJoin(event ClientEvent) {
	var joinPay JoinPayload
	if err := json.Unmarshal(event.Payload, &joinPay); err != nil {
		return
	}

	// Проблема: eventTypeJoin пишет поля клиента без clientMu, а onlineUsersLocked() читает их из других goroutine (под clientMu, но writer его не берёт).
	c.Nickname = strings.TrimSpace(joinPay.Nickname)
	c.RoomID = strings.TrimSpace(joinPay.RoomID)

	if c.Nickname == "" {
		c.Nickname = "Anonymous"
	}

	if c.RoomID == "" {
		c.RoomID = "main"
	}

	c.Color = joinPay.Color

	// 1. Личный ответ новому клиенту: session
	sessionResp, err := json.Marshal(ServerResponse{
		Type: EventTypeSession,
		Payload: SessionResponse{
			ClientID: c.ID,
			Nickname: c.Nickname,
			RoomID:   c.RoomID,
			Color:    c.Color,
		},
	})
	if err != nil {
		return
	}

	// Проблема: при заполненном RouterChan каждый event ждёт до 200ms (time.After), т.е. read loop клиента тормозит.
	msg := writeMessage{
		ClientID: c.ID,
		Event:    EventTypeSession,
		Data:     sessionResp,
	}

	select {
	case c.RouterChan <- msg:
	case <-time.After(time.Millisecond * 200):
		c.logger.Warn().Str("client_id", c.ID).Str("event", msg.Event).Msg("router queue full, drop event")
	}

	// 2. Уведомление всем остальным: user_joined
	data, err := json.Marshal(ServerResponse{
		Type:   EventTypeUserJoined,
		RoomID: c.RoomID,
		Sender: GenerateSenderFromClient(c),
		Payload: UserJoinedResponse{
			Message: c.Nickname + " подключился",
		},
	})
	if err != nil {
		return
	}

	msg = writeMessage{
		ClientID: c.ID,
		Event:    EventTypeJoin,
		Data:     data,
	}

	select {
	case c.RouterChan <- msg:
	case <-time.After(time.Millisecond * 200):
		c.logger.Warn().Str("client_id", c.ID).Str("event", msg.Event).Msg("router queue full, drop event")
	}

}

func (c *client) eventTypeChat(event ClientEvent) {
	var chatPay ChatPayload
	if err := json.Unmarshal(event.Payload, &chatPay); err != nil {
		return
	}

	data, _ := json.Marshal(
		ServerResponse{
			Type: EventTypeChat,
			Payload: ChatResponse{
				Text: chatPay.Text,
			},
			Sender: GenerateSenderFromClient(c),
			RoomID: c.RoomID,
		},
	)

	// Проблема: при заполненном RouterChan каждый event ждёт до 200ms (time.After), т.е. read loop клиента тормозит.
	msg := writeMessage{
		ClientID: c.ID,
		Event:    EventTypeChat,
		Data:     data,
	}

	select {
	case c.RouterChan <- msg:
	case <-time.After(time.Millisecond * 200):
		c.logger.Warn().Str("client_id", c.ID).Str("event", msg.Event).Msg("router queue full, drop event")
	}

}

func (c *client) eventTypeDraw(event ClientEvent) {
	var drawPay DrawPayload
	if err := json.Unmarshal(event.Payload, &drawPay); err != nil {
		return
	}

	data, _ := json.Marshal(
		ServerResponse{
			Type:    EventTypeDraw,
			Sender:  GenerateSenderFromClient(c),
			Payload: drawPay,
		},
	)

	msg := writeMessage{
		ClientID: c.ID,
		Event:    EventTypeDraw,
		DP:       &drawPay,
		Data:     data,
	}

	select {
	case c.RouterChan <- msg:
	case <-time.After(time.Millisecond * 200):
		c.logger.Warn().Str("client_id", c.ID).Str("event", msg.Event).Msg("router queue full, drop event")
	}

}

func (c *client) eventTypeClear(event ClientEvent) {
	data, _ := json.Marshal(
		ServerResponse{
			Type:   EventTypeClear,
			Sender: GenerateSenderFromClient(c),
		},
	)

	msg := writeMessage{
		ClientID: c.ID,
		Event:    EventTypeClear,
		Data:     data,
	}

	select {
	case c.RouterChan <- msg:
	case <-time.After(time.Millisecond * 200):
		c.logger.Warn().Str("client_id", c.ID).Str("event", msg.Event).Msg("router queue full, drop event")
	}

}
