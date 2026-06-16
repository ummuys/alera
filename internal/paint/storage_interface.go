package paint

type PaintStorage interface {
	AddToHistory(params AddToHistoryParams) error
	GetHistory(roomID string) (GetHistoryResult, error)
	ClearHistory(roomID string)
}
