package paint

const (
	// Client → Server
	EventTypeJoin        = "join"
	EventTypeDraw        = "draw"
	EventTypeChat        = "chat"
	EventTypeClear       = "clear"
	EventTypeCursorMove  = "cursor_move"
	EventTypeCursorLeave = "cursor_leave"

	// Server → Client
	EventTypeSession   = "session"
	EventTypePresence  = "presence"
	EventTypeRoomState = "room_state"
	EventTypeError     = "error"

	// Optional / system
	EventTypeUserJoined = "user_joined"
	EventTypeUserLeft   = "user_left"
	EventTypePong       = "pong"
	EventTypePing       = "ping"
)
