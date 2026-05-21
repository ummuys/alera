package paint

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
