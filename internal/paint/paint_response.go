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

// -- // -- // -- // -- // -- // -- // -- // -- // -- // -- // -- // --//
// Дальше представлены функции, помогающие сократить повторяющиеся контсрукции в коде
func GenerateSenderFromClient(client *Client) *Sender {
	return &Sender{
		ClientID: client.ID,
		Nickname: client.Nickname,
		Color:    client.Color,
	}
}
