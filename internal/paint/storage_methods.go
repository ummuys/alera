package paint

import (
	"encoding/json"
	"sync"

	"github.com/rs/zerolog"
	"github.com/ummuys/alera/internal/errs"
)

type paintStorage struct {
	mu         sync.RWMutex
	logger     zerolog.Logger
	memHistory map[string][]json.RawMessage
}

func NewPaintStorage(logger zerolog.Logger) PaintStorage {
	return &paintStorage{
		memHistory: make(map[string][]json.RawMessage),
		logger:     logger}
}

func (ps *paintStorage) AddToHistory(params AddToHistoryParams) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.memHistory[params.RoomID] = append(ps.memHistory[params.RoomID], params.Payload)
	return nil
}

func (ps *paintStorage) GetHistory(roomID string) (GetHistoryResult, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	history, ok := ps.memHistory[roomID]
	if !ok {
		return GetHistoryResult{}, errs.ErrRoomDoNotExists
	}
	copyHis := make([]json.RawMessage, len(history))
	copy(copyHis, history)
	return GetHistoryResult{History: copyHis, CountEvents: len(copyHis)}, nil
}

func (ps *paintStorage) ClearHistory(roomID string) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	delete(ps.memHistory, roomID)
}
