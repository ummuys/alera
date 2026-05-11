package paint

type PaintConn interface {
	Add(client *Client)
	Remove(client *Client)
	Broadcast(sender *Client, msgType int, msg []byte)

	// SendHistory(client *Client)
	AddMoveToHistory(dp DrawPayload)
	ClearHistory()
}
