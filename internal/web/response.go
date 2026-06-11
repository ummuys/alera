package web

type CreateRoomResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	UserCapacity int    `json:"user_capacity"`
	Private      bool   `json:"private"`
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
