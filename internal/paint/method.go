package paint

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

// paintHub реализует in-memory hub для совместной доски.
type paintHub struct {
	ctx        context.Context    // Общий контекс
	cancelFunc context.CancelFunc // Функция отмена общего контекста

	clientMu sync.Mutex         // Мьютекс для работы с клиентами
	clients  map[string]*client // Мапа с id клиента -> его структура

	historyMu sync.Mutex    // Мьютекст для работы с историей
	history   []DrawPayload // История

	logger zerolog.Logger // Логгер

	RouterChan chan writeMessage // Общий канал сбора сообщений для обработки в единой точке
}

func NewPaintHub(ctx context.Context, logger zerolog.Logger) PaintHub {

	ctx, cancel := context.WithCancel(ctx)
	ph := &paintHub{
		ctx:        ctx,
		cancelFunc: cancel,

		logger: logger,

		clients:    make(map[string]*client),
		RouterChan: make(chan writeMessage, 1024),
	}

	go ph.broadcast()
	return ph

}

// Добавление клиента
func (ph *paintHub) Add(conn *websocket.Conn) {
	ph.clientMu.Lock()

	id := uuid.New().String()
	client := newClient(id, conn, ph.RouterChan, ph.ctx, ph.logger)
	ph.clients[id] = client

	ci := client.getInfo()

	ph.logger.Info().Str("client_id", ci.ID).Str("Nickname", ci.Nickname).Msg("user connected")

	ph.clientMu.Unlock()

	client.start()
	go func() {
		<-client.ctx.Done()
		ph.remove(id)
	}()
}

func (ph *paintHub) Close() {
	ph.cancelFunc()

	ph.clientMu.Lock()

	// Делаем снапшот актуальных клиентов
	// В этот раз мы закрываем websockets с нашей стороны,
	// так как закрывается весь хаб
	clients := make([]*client, 0, len(ph.clients))
	for _, client := range ph.clients {
		clients = append(clients, client)
	}
	ph.clientMu.Unlock()

	for _, client := range clients {
		client.end()
	}

	return
}

func (ph *paintHub) remove(id string) {
	ph.clientMu.Lock()
	defer ph.clientMu.Unlock()

	client, ok := ph.clients[id]
	if !ok {
		return
	}

	ci := client.getInfo()

	delete(ph.clients, client.id)
	ph.logger.Info().Str("client_id", ci.ID).Str("Nickname", ci.Nickname).Msg("user disconnected")
	ph.sendOnlineUsers()
}

func (ph *paintHub) broadcast() {

	for {
		select {
		case <-ph.ctx.Done():
			ph.logger.Info().Msg("paint hub stopped")
			return

		case msg, ok := <-ph.RouterChan:
			if !ok {
				ph.logger.Info().Msg("RouterChan is closed")
				return
			}

			switch msg.Event {
			// Инвент, когда клиент подключается. Нужно отосласть websocket
			// ответ о том, что соединение установлено
			case EventTypeSession:

				ph.clientMu.Lock()
				c, ok := ph.clients[msg.ClientID]
				if !ok {
					continue
				}
				ph.clientMu.Unlock()
				ph.sendOnlineUsers()
				c.sendMessageToWriteChan(msg.Data)
				continue

			case EventTypeDraw:
				ph.addMoveToHistory(*msg.DP)
			case EventTypeClear:
				ph.clearHistory()
			}

			ph.clientMu.Lock()
			clients := make([]*client, 0, len(ph.clients))
			for _, client := range ph.clients {
				clients = append(clients, client)
			}

			// Нет фильтрации по RoomID в broadcast (shared state impact между клиентами)
			ph.clientMu.Unlock()

			for _, receiver := range clients {
				receiver.sendMessageToWriteChan(msg.Data)
			}

		}
	}
}

func (ph *paintHub) addMoveToHistory(dp DrawPayload) {
	ph.historyMu.Lock()
	defer ph.historyMu.Unlock()
	ph.history = append(ph.history, dp)
}

func (ph *paintHub) clearHistory() {
	ph.historyMu.Lock()
	defer ph.historyMu.Unlock()
	ph.history = make([]DrawPayload, 0)
}

// Получение всех онлайн пользователей
func (ph *paintHub) onlineUsersLocked() []Sender {
	users := make([]Sender, 0, len(ph.clients))
	for _, client := range ph.clients {
		users = append(users, *client.sender())
	}

	return users
}

// // Функция для получения всех пользователей
// // Она запускается каждый раз, когда кто-то заходит или выходит. Если вдуг невозможно отправить кому-либо из
// // списка пользователей сообщение, то все функции снова выполняются в for пока не будет безошибочного результата.
func (ph *paintHub) sendOnlineUsers() {

	data, err := json.Marshal(
		ServerResponse{
			Type: EventTypePresence,
			Payload: PresenceResponse{
				Users: ph.onlineUsersLocked(),
			},
		},
	)

	if err != nil {
		ph.logger.Error().Err(err).Msg("cannot marshal online users")
		return
	}

	msg := writeMessage{
		ClientID: "server",
		Event:    EventTypePresence,
		Data:     data,
	}

	select {
	case ph.RouterChan <- msg:
	default:
		ph.logger.Warn().Str("client_id", "server").Str("event", msg.Event).Msg("router queue full, drop event")
	}

}
