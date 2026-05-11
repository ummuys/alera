package paint

import "github.com/gorilla/websocket"

type Client struct {
	ID       string
	Nickname string
	Conn     *websocket.Conn
	Send     chan []byte
	RoomID   string
	Color    string
}

func (c *Client) readSendMessage(pc *paintConn) {
	for msg := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			pc.logger.Error().Err(err).Str("client_id", c.ID).Str("Nickname", c.Nickname).Msg("can't read message from send chan")
			pc.Remove(c)
		}
	}
}
