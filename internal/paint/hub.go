package paint

import (
	"context"
	"sync"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

type PaintHub interface {
	CreateRoom(params CreateRoomParams) CreateRoomResult
	ListRooms() ListRoomsResult
}

type paintHub struct {
	ctx        context.Context    // Общий контекс
	cancelFunc context.CancelFunc // Функция отмена общего контекста

	roomMu sync.RWMutex          // Мьютекс для работы с клиентами
	rooms  map[string]*paintRoom // Мапа с id клиента -> его структура

	logger zerolog.Logger // Логгер
}

func NewPaintHub(ctx context.Context, logger zerolog.Logger) PaintHub {
	return &paintHub{
		rooms: make(map[string]*paintRoom),
	}
}

func (ph *paintHub) CreateRoom(params CreateRoomParams) CreateRoomResult {
	ph.roomMu.Lock()

	rid := uuid.New().String()
	pr := NewPaintRoom(ph.ctx, params, ph.logger)
	ph.rooms[rid] = pr

	ph.roomMu.Unlock()

	return CreateRoomResult{
		ID:   rid,
		Name: params.Name,
	}
}

func (ph *paintHub) ListRooms() ListRoomsResult {
	ph.roomMu.RLock()
	defer ph.roomMu.RUnlock()

	rooms := make([]Room, len(ph.rooms))
	for id, v := range ph.rooms {
		rooms = append(rooms, Room{
			ID:           id,
			Name:         v.params.name,
			UserCapacity: v.params.capacity,
			Private:      v.params.private,
		})
	}
	return ListRoomsResult{Rooms: rooms}
}
