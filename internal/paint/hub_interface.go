package paint

type PaintHub interface {
	CreateRoom(params CreateRoomParams) CreateRoomResult
	CloseRoom(params CloseRoomParams) error
	JoinRoom(params JoinRoomParams) error
	ListRooms() ListRoomsResult
}
