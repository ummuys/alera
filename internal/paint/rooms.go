package paint

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

// paintRoom реализует in-memory hub для совместной доски.
type paintRoom struct {
	params roomParams

	ctx        context.Context    // Общий контекс
	cancelFunc context.CancelFunc // Функция отмена общего контекста

	clientMu sync.Mutex         // Мьютекс для работы с клиентами
	clients  map[string]*client // Мапа с id клиента -> его структура

	historyMu sync.Mutex    // Мьютекст для работы с историей
	history   []DrawPayload // История

	logger zerolog.Logger // Логгер

	RouterChan chan writeMessage // Общий канал сбора сообщений для обработки в единой точке
}

type roomParams struct {
	name     string
	capacity int
	private  bool
}

func NewPaintRoom(ctx context.Context, params CreateRoomParams, logger zerolog.Logger) *paintRoom {

	ctx, cancel := context.WithCancel(ctx)
	pr := paintRoom{
		params: roomParams{
			name:     params.Name,
			capacity: params.UserCapacity,
			private:  params.Private,
		},

		ctx:        ctx,
		cancelFunc: cancel,

		logger: logger,

		clients:    make(map[string]*client),
		RouterChan: make(chan writeMessage, 1024),
	}

	go pr.broadcast()
	return &pr

}

// Добавление клиента
func (pr *paintRoom) Add(conn *websocket.Conn) {
	pr.clientMu.Lock()

	id := uuid.New().String()
	client := newClient(id, conn, pr.RouterChan, pr.ctx, pr.logger)
	pr.clients[id] = client

	ci := client.getInfo()

	pr.logger.Info().Str("client_id", ci.ID).Str("Nickname", ci.Nickname).Msg("user connected")

	pr.clientMu.Unlock()

	client.start()
	go func() {
		<-client.ctx.Done()
		pr.remove(id)
	}()
}

func (pr *paintRoom) Close() RoomStatus {
	pr.cancelFunc()

	pr.clientMu.Lock()

	// Делаем снапшот актуальных клиентов
	// В этот раз мы закрываем websockets с нашей стороны,
	// так как закрывается весь хаб
	before := len(pr.clients)
	clients := make([]*client, 0, before)
	for _, client := range pr.clients {
		clients = append(clients, client)
	}
	pr.clientMu.Unlock()

	for _, client := range clients {
		client.end()
	}

	pr.clientMu.Lock()
	after := len(pr.clients)
	pr.clientMu.Unlock()

	return RoomStatus{
		BeforeOnline: before,
		AfterOnline:  after,
	}
}

func (pr *paintRoom) remove(id string) {
	pr.clientMu.Lock()
	defer pr.clientMu.Unlock()

	client, ok := pr.clients[id]
	if !ok {
		return
	}

	ci := client.getInfo()

	delete(pr.clients, client.id)
	pr.logger.Info().Str("client_id", ci.ID).Str("Nickname", ci.Nickname).Msg("user disconnected")
	pr.sendOnlineUsers()
}

func (pr *paintRoom) broadcast() {

	for {
		select {
		case <-pr.ctx.Done():
			pr.logger.Info().Msg("paint hub stopped")
			return

		case msg, ok := <-pr.RouterChan:
			if !ok {
				pr.logger.Info().Msg("RouterChan is closed")
				return
			}

			switch msg.Event {
			// Инвент, когда клиент подключается. Нужно отосласть websocket
			// ответ о том, что соединение установлено
			case EventTypeSession:

				pr.clientMu.Lock()
				c, ok := pr.clients[msg.ClientID]
				pr.clientMu.Unlock()

				if !ok {
					continue
				}

				pr.sendOnlineUsers()
				c.sendMessageToWriteChan(msg.Data)
				continue

			case EventTypeDraw:
				pr.addMoveToHistory(*msg.DP)
			case EventTypeClear:
				pr.clearHistory()
			}

			pr.clientMu.Lock()
			clients := make([]*client, 0, len(pr.clients))
			for _, client := range pr.clients {
				clients = append(clients, client)
			}

			// Нет фильтрации по RoomID в broadcast (shared state impact между клиентами)
			pr.clientMu.Unlock()

			for _, receiver := range clients {
				receiver.sendMessageToWriteChan(msg.Data)
			}

		}
	}
}

func (pr *paintRoom) addMoveToHistory(dp DrawPayload) {
	pr.historyMu.Lock()
	defer pr.historyMu.Unlock()
	pr.history = append(pr.history, dp)
}

func (pr *paintRoom) clearHistory() {
	pr.historyMu.Lock()
	defer pr.historyMu.Unlock()
	pr.history = make([]DrawPayload, 0)
}

// Получение всех онлайн пользователей
func (pr *paintRoom) onlineUsersLocked() []Sender {
	users := make([]Sender, 0, len(pr.clients))
	for _, client := range pr.clients {
		users = append(users, *client.sender())
	}

	return users
}

// // Функция для получения всех пользователей
// // Она запускается каждый раз, когда кто-то заходит или выходит. Если вдуг невозможно отправить кому-либо из
// // списка пользователей сообщение, то все функции снова выполняются в for пока не будет безошибочного результата.
func (pr *paintRoom) sendOnlineUsers() {

	data, err := json.Marshal(
		ServerResponse{
			Type: EventTypePresence,
			Payload: PresenceResponse{
				Users: pr.onlineUsersLocked(),
			},
		},
	)

	if err != nil {
		pr.logger.Error().Err(err).Msg("cannot marshal online users")
		return
	}

	msg := writeMessage{
		ClientID: "server",
		Event:    EventTypePresence,
		Data:     data,
	}

	select {
	case pr.RouterChan <- msg:
	default:
		pr.logger.Warn().Str("client_id", "server").Str("event", msg.Event).Msg("router queue full, drop event")
	}

}
