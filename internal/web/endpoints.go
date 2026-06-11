package web

const (
	api = "/api/v1"

	RoomPath = api + "/room"

	CreateRoomEndpoint = "POST " + RoomPath
	ListRoomsEndpoint  = "GET " + RoomPath
)
