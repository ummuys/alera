package paint

import "github.com/gorilla/websocket"

type PaintConn interface {
	Add(conn *websocket.Conn)
	Close()
}
