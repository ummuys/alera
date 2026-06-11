package paint

type ServerResponse struct {
	Type    string  `json:"type"`
	Payload any     `json:"payload"`
	Sender  *Sender `json:"sender"`
	RoomID  string  `json:"roomId"`
}

type ChatResponse struct {
	Text string `json:"text"`
}

type UserJoinedResponse struct {
	Message string `json:"message"`
}

type SessionResponse struct {
	ClientID string `json:"clientId"`
	Nickname string `json:"nickname"`
	RoomID   string `json:"roomId"`
	Color    string `json:"color"`
}

type Sender struct {
	ClientID string `json:"clientId"`
	Nickname string `json:"nickname"`
	Color    string `json:"color"`
}

type PresenceResponse struct {
	Users []Sender `json:"users"`
}

type OnlineUsers struct {
	Type  string   `json:"type"`
	Users []string `json:"users"`
}
