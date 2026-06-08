package paint

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

type client struct {
	id       string
	nickname string
	conn     *websocket.Conn
	roomID   string
	color    string

	// INFO
	logger zerolog.Logger

	// SYNC
	routerChan chan writeMessage
	writeChan  chan []byte

	mu     sync.Mutex
	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once
}

func newClient(id string, conn *websocket.Conn, rc chan writeMessage, hubctx context.Context, logger zerolog.Logger) *client {

	ctx, cancel := context.WithCancel(hubctx)

	client := &client{
		id:     id,
		conn:   conn,
		logger: logger,

		writeChan:  make(chan []byte, 128),
		routerChan: rc,
		ctx:        ctx,
		cancel:     cancel,
	}

	return client
}

func (c *client) start() {
	go c.writePump()
	go c.readPump()
}

func (c *client) end() {
	c.once.Do(func() {
		c.cancel()
		c.conn.Close()
	})
}

func (c *client) send(msg []byte) {
	select {
	case <-c.ctx.Done():
	case c.writeChan <- msg:
	default:
	}
}

func (c *client) setInfo(ci ClientInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.nickname = ci.Nickname
	c.roomID = ci.RoomID
	c.color = ci.Color
}

func (c *client) getInfo() ClientInfo {
	c.mu.Lock()
	defer c.mu.Unlock()

	return ClientInfo{
		ID:       c.id,
		RoomID:   c.roomID,
		Nickname: c.nickname,
		Color:    c.color,
	}
}

func (c *client) sender() *Sender {
	ci := c.getInfo()
	return &Sender{
		ClientID: ci.ID,
		Nickname: ci.Nickname,
		Color:    ci.Color,
	}
}

// Проблема: writePump читает for msg := range c.WriteChan, но WriteChan нигде не закрывается при remove/shutdown.
func (c *client) writePump() {

	for {
		select {
		case <-c.ctx.Done():
			return

		case msg, ok := <-c.writeChan:
			if !ok {
				ci := c.getInfo()
				c.logger.Error().Str("client_id", ci.ID).Str("Nickname", ci.Nickname).Msg("can't read message from send chan")
				c.end()
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				ci := c.getInfo()
				c.logger.Error().Err(err).Str("client_id", ci.ID).Str("Nickname", ci.Nickname).Msg("can't write message to websocket")
				c.end()
				return
			}

		}
	}

}

// Получение сообщения с websocket соединения
func (c *client) readPump() {

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			c.end()
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
	if err := json.Unmarshal(event.Payload, &joinPay); err != nil { // Обязательно добавить обработчик ошибок
		return
	}

	// Проблема: eventTypeJoin пишет поля клиента без clientMu, а onlineUsersLocked() читает их из других goroutine (под clientMu, но writer его не берёт).
	nickname := strings.TrimSpace(joinPay.Nickname)
	if nickname == "" {
		nickname = "Anonymous"
	}

	roomID := strings.TrimSpace(joinPay.RoomID)
	if roomID == "" {
		roomID = "main"
	}

	color := strings.TrimSpace(joinPay.Color)

	c.setInfo(ClientInfo{
		Nickname: nickname,
		RoomID:   roomID,
		Color:    color,
	})

	ci := c.getInfo()

	// 1. Личный ответ новому клиенту: session
	sessionResp, err := json.Marshal(ServerResponse{ // Обязательно добавить обработчик ошибок
		Type: EventTypeSession,
		Payload: SessionResponse{
			ClientID: ci.ID,
			Nickname: ci.Nickname,
			RoomID:   ci.RoomID,
			Color:    ci.Color,
		},
	})
	if err != nil {
		return
	}

	// Проблема: при заполненном RouterChan каждый event ждёт до 200ms (time.After), т.е. read loop клиента тормозит.
	msg := writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeSession,
		Data:     sessionResp,
	}

	c.sendMessageToRouterChan(msg)

	// 2. Уведомление всем остальным: user_joined
	data, err := json.Marshal(ServerResponse{ // Обязательно добавить обработчик ошибок
		Type:   EventTypeUserJoined,
		RoomID: ci.RoomID,
		Sender: c.sender(),
		Payload: UserJoinedResponse{
			Message: ci.Nickname + " подключился",
		},
	})
	if err != nil {
		return
	}

	msg = writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeJoin,
		Data:     data,
	}

	c.sendMessageToRouterChan(msg)

}

func (c *client) eventTypeChat(event ClientEvent) {
	var chatPay ChatPayload
	if err := json.Unmarshal(event.Payload, &chatPay); err != nil {
		return
	}

	ci := c.getInfo()

	data, _ := json.Marshal( // Обязательно добавить обработчик ошибок
		ServerResponse{
			Type: EventTypeChat,
			Payload: ChatResponse{
				Text: chatPay.Text,
			},
			Sender: c.sender(),
			RoomID: ci.RoomID,
		},
	)

	// Проблема: при заполненном RouterChan каждый event ждёт до 200ms (time.After), т.е. read loop клиента тормозит.
	msg := writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeChat,
		Data:     data,
	}

	c.sendMessageToRouterChan(msg)

}

func (c *client) eventTypeDraw(event ClientEvent) {
	var drawPay DrawPayload
	if err := json.Unmarshal(event.Payload, &drawPay); err != nil {
		return
	}

	ci := c.getInfo()

	data, _ := json.Marshal( // Обязательно добавить обработчик ошибок
		ServerResponse{
			Type:    EventTypeDraw,
			Sender:  c.sender(),
			Payload: drawPay,
		},
	)

	msg := writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeDraw,
		DP:       &drawPay,
		Data:     data,
	}

	c.sendMessageToRouterChan(msg)

}

func (c *client) eventTypeClear(event ClientEvent) {
	data, _ := json.Marshal( // Обязательно добавить обработчик ошибок
		ServerResponse{
			Type:   EventTypeClear,
			Sender: c.sender(),
		},
	)

	ci := c.getInfo()

	msg := writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeClear,
		Data:     data,
	}

	c.sendMessageToRouterChan(msg)

}

func (c *client) sendMessageToRouterChan(msg writeMessage) {

	select {
	case <-c.ctx.Done():
		c.logger.Warn().Msg("hab ctx is done")
	case c.routerChan <- msg:
		// send message
	case <-time.After(time.Millisecond * 200):
		ci := c.getInfo()
		c.logger.Warn().Str("client_id", ci.ID).Str("event", msg.Event).Msg("router queue full, drop event")
	}
}
