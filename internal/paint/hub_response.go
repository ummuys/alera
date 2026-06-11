package paint

type CreateRoomResult struct {
	ID           string
	Name         string
	UserCapacity int
	Private      bool
}

type ListRoomsResult struct {
	Rooms []Room
}

type Room struct {
	ID           string
	Name         string
	UserCapacity int
	Private      bool
}
