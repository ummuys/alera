package web

const (
	InternalErrorMessage  = "something wrong with server, please try again later"
	InvalidRequestMessage = "invalid request"
	InvalidMethodMessage  = "invalid method"
)

type CreateRoomResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	UserCapacity int    `json:"user_capacity"`
	Private      bool   `json:"private"`
}

type CloseRoomResponse struct {
	ID string `json:"id"`
}

type ListRoomsResponse struct {
	Rooms []Rooms `json:"rooms"`
}

type Rooms struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	UserCapacity int    `json:"user_capacity"`
	Private      bool   `json:"private"`
}
