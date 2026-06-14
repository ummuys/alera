package paint

import (
	"context"
	"sync"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/ummuys/alera/internal/errs"
)

type paintHub struct {
	ctx        context.Context    // Общий контекс
	cancelFunc context.CancelFunc // Функция отмена общего контекста

	roomMu sync.RWMutex          // Мьютекс для работы с клиентами
	rooms  map[string]*paintRoom // Мапа с id клиента -> его структура

	logger zerolog.Logger // Логгер
}

func NewPaintHub(ctx context.Context, logger zerolog.Logger) PaintHub {
	return &paintHub{
		ctx:    ctx,
		rooms:  make(map[string]*paintRoom),
		logger: logger,
	}
}

func (ph *paintHub) CreateRoom(params CreateRoomParams) CreateRoomResult {

	ph.roomMu.Lock()

	rid := uuid.New().String()
	pr := NewPaintRoom(ph.ctx, params, ph.logger)
	ph.rooms[rid] = pr

	ph.roomMu.Unlock()

	return CreateRoomResult{
		ID:           rid,
		Name:         params.Name,
		UserCapacity: params.UserCapacity,
		Private:      params.Private,
	}
}

func (ph *paintHub) CloseRoom(params CloseRoomParams) error {
	ph.roomMu.Lock()
	room, ok := ph.rooms[params.RoomID]
	ph.roomMu.Unlock()

	if !ok {
		return errs.ErrRoomDoNotExists
	}

	rs := room.Close()

	ph.logger.Info().Str("room_id", params.RoomID).Int("before_online", rs.BeforeOnline).Int("after_online", rs.AfterOnline).Msg("room closed")
	return nil
}

func (ph *paintHub) JoinRoom(params JoinRoomParams) error {
	ph.roomMu.Lock()
	room, ok := ph.rooms[params.RoomID]
	ph.roomMu.Unlock()

	if !ok {
		return errs.ErrRoomDoNotExists
	}
	room.Add(params.Conn)
	return nil
}

func (ph *paintHub) ListRooms() ListRoomsResult {
	ph.roomMu.RLock()
	defer ph.roomMu.RUnlock()

	rooms := make([]Room, 0, len(ph.rooms))
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
