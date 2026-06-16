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

// (В БУДУЩЕМ ПЕРЕДЕЛАТЬ В ИНТЕРФЕЙС ЕСЛИ ЭТО БУДЕТ ЛОГИЧНО)
// Структура, отвечающая за работу с клиентом
type client struct {
	id       string          // Уникальный ID клиента, генерируется при создании в PaintHub в методе Add()
	nickname string          // Имя пользователя
	conn     *websocket.Conn // Websocket соединение
	roomID   string          // (ДОБАВИТЬ В БУДУЩЕМ) ID комнаты, где находится пользователь
	color    string          // Цвет курсора пользователя на доске

	// INFO
	logger zerolog.Logger

	// SYNC
	routerChan chan writeMessage // Канал для отправки сообщений в метод broadcast() (рассылка)
	writeChan  chan []byte       // Канал для считывания сообщений и отправки на conn

	mu     sync.Mutex
	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once
}

// Конструктор для создания объекта "клиент"
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

// Запуск двух поток на чтение новых сообщений из writeChan (readPump) и отправки новых сообщений (writePump) в routerChan
func (c *client) start() {
	go c.writePump()
	go c.readPump()
}

// Функция, если пользователь вышел или hub закрылся
func (c *client) end() {
	c.once.Do(func() {
		c.cancel()
		c.conn.Close()
	})
}

// Установка данных для клиента
func (c *client) setInfo(ci ClientInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.nickname = ci.Nickname
	c.roomID = ci.RoomID
	c.color = ci.Color
}

// Получить информацию о пользователя для составления ответов с сервера
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

// Функция преобразования данных в структуру в Sender для отправки ответа с сервера
func (c *client) sender() *Sender {
	ci := c.getInfo()
	return &Sender{
		ClientID: ci.ID,
		Nickname: ci.Nickname,
		Color:    ci.Color,
	}
}

// Функция для отправки сообщения клиенту на conn (websocket)
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

// Функция для получения сообщений клиента с conn (websocket)
func (c *client) readPump() {

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			c.end()
			return
		}

		var event ClientEvent
		if err := json.Unmarshal(msg, &event); err != nil {
			c.logger.Error().Err(err).Msg("marshal response failed")
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

		}
	}

}

// Функция ивента при появлении нового клиента в чат / комнату.
func (c *client) eventTypeJoin(event ClientEvent) {
	var joinPay JoinPayload
	if err := json.Unmarshal(event.Payload, &joinPay); err != nil { // Обязательно добавить обработчик ошибок
		c.logger.Error().Err(err).Msg("marshal response failed")
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

	msg1 := writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeSession,
		Data:     sessionResp,
	}

	c.sendMessageToRouterChan(msg1)

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

	msg2 := writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeJoin,
		Data:     data,
	}

	c.sendMessageToRouterChan(msg2)

}

// Функция ивента при отправки сообщения в чат
func (c *client) eventTypeChat(event ClientEvent) {
	var chatPay ChatPayload
	if err := json.Unmarshal(event.Payload, &chatPay); err != nil {
		c.logger.Error().Err(err).Msg("marshal response failed")
		return
	}

	ci := c.getInfo()

	data, err := json.Marshal( // Обязательно добавить обработчик ошибок
		ServerResponse{
			Type: EventTypeChat,
			Payload: ChatResponse{
				Text: chatPay.Text,
			},
			Sender: c.sender(),
			RoomID: ci.RoomID,
		},
	)

	if err != nil {
		c.logger.Error().Err(err).Msg("marshal response failed")
		return
	}

	// Проблема: при заполненном RouterChan каждый event ждёт до 200ms (time.After), т.е. read loop клиента тормозит.
	msg := writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeChat,
		Data:     data,
	}

	c.sendMessageToRouterChan(msg)

}

// Функция ивента при добавления элементов на холст (рисование)
func (c *client) eventTypeDraw(event ClientEvent) {

	ci := c.getInfo()

	data, err := json.Marshal( // Обязательно добавить обработчик ошибок
		ServerResponse{
			Type:    EventTypeDraw,
			Sender:  c.sender(),
			Payload: event.Payload,
		},
	)

	if err != nil {
		c.logger.Error().Err(err).Msg("marshal response failed")
		return
	}

	msg := writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeDraw,
		Data:     data,
		DP:       &event.Payload,
	}

	c.sendMessageToRouterChan(msg)

}

// Функция ивента при попытке очистить весь холст
func (c *client) eventTypeClear(event ClientEvent) {
	data, err := json.Marshal( // Обязательно добавить обработчик ошибок
		ServerResponse{
			Type:   EventTypeClear,
			Sender: c.sender(),
		},
	)

	if err != nil {
		c.logger.Error().Err(err).Msg("marshal response failed")
		return
	}

	ci := c.getInfo()

	msg := writeMessage{
		ClientID: ci.ID,
		Event:    EventTypeClear,
		Data:     data,
	}

	c.sendMessageToRouterChan(msg)

}

// Функция для отправки информации для рассылки с задержкой в 200мс
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

// Попытка отправить сообщение для чтения без задержки
// Если не получается, то сообщение просто не отправляется
func (c *client) sendMessageToWriteChan(msg []byte) {
	select {
	case <-c.ctx.Done():
	case c.writeChan <- msg:
	default:
		ci := c.getInfo()
		c.logger.Warn().
			Str("client_id", ci.ID).
			Msg("client write queue full, drop message")
	}
}
