package paint

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

// paintConn реализует in-memory hub для совместной доски.
type paintConn struct {
	ctx        context.Context
	cancelFunc context.CancelFunc

	clientMu sync.Mutex
	clients  map[string]*client

	historyMu sync.Mutex
	history   []DrawPayload

	logger zerolog.Logger

	RouterChan chan writeMessage
}

func NewPaintConn(logger zerolog.Logger) PaintConn {

	ctx, cancel := context.WithCancel(context.Background())
	pc := &paintConn{
		ctx:        ctx,
		cancelFunc: cancel,

		logger: logger,

		clients:    make(map[string]*client),
		RouterChan: make(chan writeMessage, 1024),
	}
	go pc.broadcast()
	return pc

}

// Добавление клиента
func (c *paintConn) Add(conn *websocket.Conn) {
	c.clientMu.Lock()
	defer c.clientMu.Unlock()

	id := uuid.New().String()
	client := newClient(id, conn, c.RouterChan, c.logger)
	c.clients[id] = client
	c.logger.Info().Str("client_id", client.ID).Str("Nickname", client.Nickname).Msg("user connected")
	c.sendOnlineUsersLocked()

	// Проблема: эта goroutine ждёт только client.Done; при глобальном shutdown без закрытия клиента может висеть.
	go func() {
		<-client.Done
		c.remove(id)
	}()
}

func (c *paintConn) Close() {
	c.cancelFunc()
	return
}

func (c *paintConn) remove(id string) {
	c.clientMu.Lock()
	defer c.clientMu.Unlock()

	client, ok := c.clients[id]
	if !ok {
		return
	}

	delete(c.clients, client.ID)
	c.logger.Info().Str("client_id", client.ID).Str("Nickname", client.Nickname).Msg("user disconnected")
	c.sendOnlineUsersLocked()
}

func (c *paintConn) broadcast() {

	for {
		select {
		case <-c.ctx.Done():
			// Реализовать закрытие всего
			return

		case msg, ok := <-c.RouterChan:
			if !ok {
				c.logger.Info().Msg("RouterChan is closed")
				return
			}

			switch msg.Event {
			case EventTypeDraw:
				c.addMoveToHistory(*msg.DP)
			case EventTypeClear:
				c.clearHistory()
			}

			c.clientMu.Lock()
			clients := make([]*client, 0, len(c.clients))
			for _, client := range c.clients {
				clients = append(clients, client)
			}
			// Нет фильтрации по RoomID в broadcast (shared state impact между клиентами)
			c.clientMu.Unlock()

			for _, receiver := range clients {
				select {
				case receiver.WriteChan <- msg.Data:
					// Отправляем пользователям
				default:
					// Очередь клиента заполнена — пропускаем сообщение
				}
			}

		}
	}
}

func (c *paintConn) addMoveToHistory(dp DrawPayload) {
	c.historyMu.Lock()
	defer c.historyMu.Unlock()
	c.history = append(c.history, dp)
}

func (c *paintConn) clearHistory() {
	c.historyMu.Lock()
	defer c.historyMu.Unlock()
	c.history = make([]DrawPayload, 0)
}

// Получение всех онлайн пользователей
func (c *paintConn) onlineUsersLocked() []Sender {
	users := make([]Sender, 0, len(c.clients))
	for _, client := range c.clients {
		users = append(users, Sender{
			ClientID: client.ID,
			Nickname: client.Nickname,
			Color:    client.Color,
		})
	}

	return users
}

// // Функция для получения всех пользователей
// // Она запускается каждый раз, когда кто-то заходит или выходит. Если вдуг невозможно отправить кому-либо из
// // списка пользователей сообщение, то все функции снова выполняются в for пока не будет безошибочного результата.
func (c *paintConn) sendOnlineUsersLocked() {

	data, err := json.Marshal(
		ServerResponse{
			Type: EventTypePresence,
			Payload: PresenceResponse{
				Users: c.onlineUsersLocked(),
			},
		},
	)

	if err != nil {
		c.logger.Error().Err(err).Msg("cannot marshal online users")
		return
	}

	msg := writeMessage{
		ClientID: "server",
		Event:    EventTypePresence,
		Data:     data,
	}

	select {
	case c.RouterChan <- msg:
	default:
		c.logger.Warn().Str("client_id", "server").Str("event", msg.Event).Msg("router queue full, drop event")
	}

}
