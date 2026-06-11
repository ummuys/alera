package web

type CreateRoomRequest struct {
	Name         string `json:"name"`
	UserCapacity int    `json:"user_capacity"`
	Private      bool   `json:"private"`
}
