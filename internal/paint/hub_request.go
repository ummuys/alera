package paint

import "github.com/gorilla/websocket"

type CreateRoomParams struct {
	Name         string
	UserCapacity int
	Private      bool
}

type CloseRoomParams struct {
	RoomID string
}

type JoinRoomParams struct {
	RoomID string
	Conn   *websocket.Conn
}
