package paint

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

// paintConn реализует in-memory hub для совместной доски.
type paintConn struct {
	mu      sync.Mutex
	clients map[*Client]struct{}
	history []DrawPayload
	logger  zerolog.Logger
}

func NewPaintConn(logger zerolog.Logger) PaintConn {
	return &paintConn{
		logger:  logger,
		clients: make(map[*Client]struct{}),
	}
}

func (c *paintConn) Add(client *Client) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.clients[client] = struct{}{}
	c.logger.Info().Str("client_id", client.ID).Str("Nickname", client.Nickname).Msg("user connected")
	go client.readSendMessage(c)
	c.sendOnlineUsersLocked()
}

func (c *paintConn) Remove(client *Client) {
	c.mu.Lock()
	defer c.mu.Unlock()

	removed := c.removeLocked(client)
	if removed {
		c.logger.Info().Str("client_id", client.ID).Str("Nickname", client.Nickname).Msg("user disconnected")

		// Закрываем канал для подачи сообщений, чтобы завершить горутину
		close(client.Send)
		c.sendOnlineUsersLocked()
	}
}

func (c *paintConn) Broadcast(sender *Client, msgType int, msg []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for receiver := range c.clients {
		select {
		case receiver.Send <- msg:
			// Сообщение успешно поставлено в очередь клиента
		default:
			// Очередь клиента заполнена — пропускаем сообщение
		}
	}

}

func (c *paintConn) AddMoveToHistory(dp DrawPayload) {
	c.history = append(c.history, dp)
}

func (c *paintConn) ClearHistory() {
	c.history = make([]DrawPayload, 0)
}

// Снести мертвых пользователей
func (c *paintConn) removeLocked(client *Client) bool {
	if client.Conn != nil {
		_ = client.Conn.Close()
	}

	if _, ok := c.clients[client]; !ok {
		return false
	}

	delete(c.clients, client)
	return true
}

// Получение всех онлайн пользователей
func (c *paintConn) onlineUsersLocked() []Sender {
	users := make([]Sender, 0, len(c.clients))
	for client := range c.clients {
		users = append(users, Sender{
			ClientID: client.ID,
			Nickname: client.Nickname,
			Color:    client.Color,
		})
	}

	return users
}

// Функция для получения всех пользователей
// Она запускается каждый раз, когда кто-то заходит или выходит. Если вдуг невозможно отправить кому-либо из
// списка пользователей сообщение, то все функции снова выполняются в for пока не будет безошибочного результата.
func (c *paintConn) sendOnlineUsersLocked() {

	for {
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

		failed := make([]*Client, 0)
		for client := range c.clients {
			if err := client.Conn.WriteMessage(websocket.TextMessage, data); err != nil {
				c.logger.Warn().Err(err).Str("client_id", client.ID).Str("Nickname", client.Nickname).Msg("online users write failed")
				failed = append(failed, client)
			}
		}

		if len(failed) == 0 {
			c.logger.Info().Int("count", len(c.clients)).Msg("online users sent")
			return
		}

		for _, client := range failed {
			c.removeLocked(client)
		}

	}
}
