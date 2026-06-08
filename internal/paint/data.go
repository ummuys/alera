package paint

type ClientInfo struct {
	ID       string
	Nickname string
	RoomID   string
	Color    string
}

type writeMessage struct {
	ClientID string
	Event    string
	Data     []byte
	DP       *DrawPayload
}

type OnlineUsers struct {
	Type  string   `json:"type"`
	Users []string `json:"users"`
}
