package paint

import "github.com/gorilla/websocket"

type PaintHub interface {
	Add(conn *websocket.Conn)
	Close()
}
