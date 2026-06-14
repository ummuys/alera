package paint

type PaintHub interface {
	CreateRoom(params CreateRoomParams) CreateRoomResult
	JoinRoom(params JoinRoomParams) error
	ListRooms() ListRoomsResult
}
