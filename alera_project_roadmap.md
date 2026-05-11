# Roadmap усиления проекта Alera / Online Paint

## 1. Цель проекта

Сделать удобный real-time online paint / whiteboard, где несколько пользователей могут одновременно рисовать, видеть друг друга, общаться, работать в отдельных комнатах и безопасно восстанавливать состояние доски после переподключения.

Итоговый проект должен выглядеть не как учебная демка, а как сильный backend/frontend pet-project для портфолио на Go.

---

## 2. Краткое позиционирование проекта

**Alera** — collaborative whiteboard на Go + WebSocket.

Основные возможности финальной версии:

- рисование на общей доске в реальном времени;
- отображение людей онлайн;
- отображение курсоров участников;
- комнаты / отдельные доски;
- чат внутри комнаты;
- сохранение состояния доски;
- undo / redo;
- роли пользователей;
- гостевой доступ по ссылке;
- стабильное переподключение;
- backend-тесты и WebSocket-интеграционные тесты;
- production-ready структура проекта.

---

## 3. Текущий уровень проекта

Сейчас проект уже имеет хорошую основу:

- Go backend;
- WebSocket endpoint `/ws`;
- frontend на обычном HTML/CSS/JS;
- canvas-доска;
- рисование линий;
- чат;
- online-пользователи после исправления;
- in-memory история доски;
- graceful shutdown сервера.

Но текущая версия всё ещё является **MVP-прототипом**.

Главные ограничения текущей реализации:

- нет комнат;
- нет серверной идентификации клиента;
- нет нормального протокола событий;
- нет read-pump/write-pump архитектуры для WebSocket;
- нет очереди исходящих сообщений на клиента;
- нет ping/pong heartbeat;
- состояние хранится только в памяти;
- история доски может бесконечно расти;
- нет тестов;
- `CheckOrigin` разрешает всех;
- нет rate limit;
- нет авторизации;
- нет масштабирования;
- нет нормального восстановления после reconnect.

---

## 4. Главный технический принцип

Для этого проекта важно разделить 4 типа состояния:

1. **Connection state** — реальные WebSocket-соединения.
2. **Presence state** — кто считается online, где его курсор, когда был последний ping.
3. **Board state** — содержимое доски: штрихи, элементы, очистка, undo/redo.
4. **Room state** — участники, права, история, настройки конкретной комнаты.

Нельзя смешивать эти состояния в одну структуру. Именно смешивание состояния обычно ломает online, reconnect, комнаты и историю.

---

## 5. Целевая архитектура

```text
cmd/alera
  main.go

internal/config
  config.go

internal/logger
  logger.go

internal/httpserver
  server.go
  middleware.go
  static.go
  health.go

internal/ws
  handler.go
  client.go
  hub.go
  read_pump.go
  write_pump.go
  protocol.go
  errors.go

internal/room
  manager.go
  room.go
  participant.go
  presence.go
  board.go
  history.go

internal/auth
  guest.go
  token.go

internal/storage
  storage.go
  memory.go
  sqlite.go

internal/ratelimit
  limiter.go

frontend
  index.html
  src/
    app.js
    api.js
    websocket.js
    protocol.js
    canvas.js
    cursors.js
    rooms.js
    ui.js
    events.js
    styles.css

tests
  websocket_test.go
```

### Почему так лучше

- `ws` отвечает только за WebSocket-соединения и протокол.
- `room` отвечает за бизнес-логику комнат и досок.
- `storage` отвечает за сохранение.
- `frontend/src/protocol.js` и `internal/ws/protocol.go` делают события явными.
- `client.go` хранит соединение, outbound-канал и metadata клиента.

---

## 6. Целевой WebSocket protocol

Все сообщения должны иметь единый формат.

```json
{
  "type": "draw.stroke",
  "roomId": "room_123",
  "clientId": "client_abc",
  "requestId": "req_001",
  "payload": {}
}
```

### Базовые типы сообщений

#### Системные

- `server.welcome` — сервер выдал `clientId`, версию протокола и состояние подключения.
- `server.error` — ошибка протокола, валидации или доступа.
- `server.shutdown` — сервер корректно завершает работу.
- `client.ping` / `server.pong` — heartbeat.

#### Комнаты

- `room.create`
- `room.join`
- `room.leave`
- `room.joined`
- `room.snapshot`
- `room.participants`
- `room.deleted`

#### Presence

- `presence.online`
- `presence.offline`
- `presence.list`
- `presence.cursor`
- `presence.cursor.hidden`

#### Рисование

- `draw.stroke.start`
- `draw.stroke.point`
- `draw.stroke.end`
- `draw.stroke.cancel`
- `draw.clear`
- `draw.undo`
- `draw.redo`

#### Чат

- `chat.message`
- `chat.history`
- `chat.typing`

---

## 7. Модель данных

### Client

```go
type Client struct {
    ID        string
    UserID    string
    Nickname  string
    RoomID    string
    Conn      *websocket.Conn
    Send      chan Envelope
    ConnectedAt time.Time
    LastSeenAt  time.Time
}
```

### Room

```go
type Room struct {
    ID           string
    Name         string
    OwnerID      string
    Participants map[string]*Participant
    Board        *Board
    CreatedAt    time.Time
    UpdatedAt    time.Time
}
```

### Participant

```go
type Participant struct {
    ClientID string
    UserID   string
    Nickname string
    Role     Role
    Cursor   CursorState
    Online   bool
}
```

### Board

```go
type Board struct {
    Elements []BoardElement
    Version  int64
}
```

### Stroke

```go
type Stroke struct {
    ID        string
    ClientID  string
    Nickname  string
    Color     string
    Size      float64
    Tool      string
    Points    []Point
    CreatedAt time.Time
}
```

---

## 8. Roadmap по этапам

# Этап 0. Привести основу проекта в порядок

Цель: сделать код удобным для дальнейшего роста.

## Backend-задачи

- [ ] Переименовать пакет `paint` во что-то более предметное: `room`, `board` или `whiteboard`.
- [ ] Вынести WebSocket-код в отдельный пакет `internal/ws`.
- [ ] Вынести HTTP server в `internal/httpserver`.
- [ ] Добавить `internal/config`.
- [ ] Добавить конфиг через env:
  - `APP_ADDR`;
  - `APP_ENV`;
  - `APP_ALLOWED_ORIGINS`;
  - `APP_LOG_LEVEL`.
- [ ] Добавить `/health` endpoint.
- [ ] Добавить `/ready` endpoint.
- [ ] Добавить Makefile:
  - `make run`;
  - `make test`;
  - `make lint`;
  - `make fmt`;
  - `make race`.
- [ ] Добавить `.gitignore`.
- [ ] Добавить нормальный `README.md`.
- [ ] Добавить `.env.example`.

## Frontend-задачи

- [ ] Вынести константы WebSocket-событий в `frontend/src/protocol.js`.
- [ ] Вынести работу с URL комнаты в `frontend/src/rooms.js`.
- [ ] Убрать `prompt()` для никнейма и заменить на стартовый экран.
- [ ] Добавить состояние приложения:
  - disconnected;
  - connecting;
  - connected;
  - reconnecting;
  - error.

## Definition of Done

- [ ] Проект запускается одной командой.
- [ ] Есть понятный README.
- [ ] Код разбит по зонам ответственности.
- [ ] `go test ./...` проходит.
- [ ] `go test -race ./...` проходит.

---

# Этап 1. Надёжный WebSocket core

Цель: заменить текущую простую WebSocket-логику на устойчивую архитектуру.

## Зачем это нужно

Gorilla WebSocket допускает одного concurrent reader и одного concurrent writer на соединение. Поэтому лучше не писать в `Conn` из разных мест напрямую, а сделать отдельный `writePump`, который читает сообщения из канала клиента и пишет в WebSocket.

## Backend-задачи

- [ ] Сделать `Client.Send chan Envelope`.
- [ ] Сделать `readPump()` для чтения входящих сообщений.
- [ ] Сделать `writePump()` для записи исходящих сообщений.
- [ ] Запретить прямой вызов `Conn.WriteMessage()` из room/business-логики.
- [ ] Добавить write deadline.
- [ ] Добавить read deadline.
- [ ] Добавить ping/pong heartbeat.
- [ ] Добавить max message size.
- [ ] Добавить graceful close с close code.
- [ ] Добавить обработку медленного клиента:
  - если канал `Send` переполнен — отключать клиента;
  - логировать причину отключения.
- [ ] Добавить middleware логирования HTTP-запросов.
- [ ] Добавить request ID.

## Пример целевой логики

```go
func (c *Client) writePump() {
    ticker := time.NewTicker(pingPeriod)
    defer func() {
        ticker.Stop()
        c.Conn.Close()
    }()

    for {
        select {
        case msg, ok := <-c.Send:
            if !ok {
                c.writeClose()
                return
            }
            c.writeJSON(msg)

        case <-ticker.C:
            c.writePing()
        }
    }
}
```

## Definition of Done

- [ ] У каждого клиента есть отдельный write-pump.
- [ ] Все исходящие сообщения проходят через `client.Send`.
- [ ] Нет concurrent write to websocket connection.
- [ ] При закрытии вкладки клиент корректно удаляется.
- [ ] Online-состояние обновляется после disconnect.
- [ ] Сервер не зависает при сломанном соединении.

---

# Этап 2. Комнаты

Цель: сделать отдельные доски по ссылке.

## Product-задачи

- [ ] Пользователь может создать комнату.
- [ ] Пользователь может войти в комнату по ссылке.
- [ ] У каждой комнаты свой online-список.
- [ ] У каждой комнаты свой canvas-state.
- [ ] Чат работает только внутри комнаты.
- [ ] Пользователь может скопировать ссылку на комнату.
- [ ] Если комнаты нет — показывать 404/экран создания.

## Backend-задачи

- [ ] Создать `RoomManager`.
- [ ] Хранить комнаты в `map[string]*Room`.
- [ ] Сделать методы:
  - `CreateRoom()`;
  - `GetRoom(id)`;
  - `JoinRoom(client, roomID)`;
  - `LeaveRoom(client)`;
  - `DeleteRoom(roomID)`;
  - `BroadcastToRoom(roomID, msg)`.
- [ ] Ввести room-level mutex или actor-loop.
- [ ] Сделать автоудаление пустых комнат.
- [ ] Добавить лимит участников на комнату.
- [ ] Добавить лимит комнат в memory-режиме.

## Frontend-задачи

- [ ] Добавить `/room/:roomId` или `?room=roomId`.
- [ ] Сделать стартовый экран:
  - создать комнату;
  - присоединиться по коду;
  - ввести никнейм.
- [ ] Показывать название комнаты.
- [ ] Кнопка «скопировать ссылку».
- [ ] UI ошибки, если комната не найдена.

## Definition of Done

- [ ] Две разные комнаты не видят рисунки друг друга.
- [ ] Online считается отдельно по комнатам.
- [ ] Чат из комнаты A не попадает в комнату B.
- [ ] При выходе последнего участника комната удаляется или помечается как inactive.

---

# Этап 3. Online-пользователи и Presence

Цель: сделать сильную систему присутствия, а не просто список имён.

## Product-задачи

- [ ] Показывать количество людей онлайн.
- [ ] Показывать список участников.
- [ ] Показывать цвет участника.
- [ ] Показывать статус:
  - online;
  - idle;
  - disconnected;
  - reconnecting.
- [ ] Показывать время последней активности.
- [ ] Показывать уведомление «пользователь вошёл/вышел».

## Backend-задачи

- [ ] Сделать `PresenceService` внутри комнаты.
- [ ] Считать online из активных соединений.
- [ ] Не хранить online как отдельный несинхронизированный slice.
- [ ] Добавить `LastSeenAt`.
- [ ] Добавить idle detection.
- [ ] Добавить событие `presence.list`.
- [ ] Добавить событие `presence.online`.
- [ ] Добавить событие `presence.offline`.
- [ ] Добавить stable `clientId`, выданный сервером.

## Frontend-задачи

- [ ] Заменить простой список online на карточки участников.
- [ ] Отображать цвет участника.
- [ ] Отображать «Вы» возле текущего пользователя.
- [ ] Отображать idle-состояние.
- [ ] Анимировать вход/выход пользователя.

## Definition of Done

- [ ] Online корректен при входе.
- [ ] Online корректен при выходе.
- [ ] Online корректен при обновлении страницы.
- [ ] Online корректен при обрыве сети.
- [ ] Один пользователь с двумя вкладками отображается предсказуемо.

---

# Этап 4. Курсоры участников

Цель: сделать эффект настоящей совместной работы.

## Product-задачи

- [ ] Видеть курсоры других пользователей на доске.
- [ ] Возле курсора показывать никнейм.
- [ ] Курсор имеет цвет пользователя.
- [ ] Курсор исчезает, когда пользователь ушёл с canvas.
- [ ] Курсор плавно двигается, без дёргания.
- [ ] Курсор не мешает рисованию.

## Backend-задачи

- [ ] Добавить событие `presence.cursor`.
- [ ] Валидировать координаты курсора: `0 <= x <= 1`, `0 <= y <= 1`.
- [ ] Не сохранять курсоры в историю доски.
- [ ] Рассылать курсор только другим участникам комнаты.
- [ ] Добавить throttling cursor events на сервере.

## Frontend-задачи

- [ ] Создать `frontend/src/cursors.js`.
- [ ] Добавить overlay-слой поверх canvas.
- [ ] На `pointermove` отправлять координаты курсора.
- [ ] Throttle отправку курсора, например до 20–30 событий/сек.
- [ ] Интерполировать движение удалённого курсора.
- [ ] Удалять курсор после timeout без активности.
- [ ] При `pointerleave` отправлять `presence.cursor.hidden`.

## Пример payload

```json
{
  "type": "presence.cursor",
  "roomId": "room_123",
  "clientId": "client_abc",
  "payload": {
    "x": 0.42,
    "y": 0.73,
    "nickname": "Alex",
    "color": "#7c3aed"
  }
}
```

## Definition of Done

- [ ] В двух вкладках видно курсоры друг друга.
- [ ] Курсоры не сохраняются в историю.
- [ ] Курсоры не перегружают WebSocket.
- [ ] Курсор исчезает, если пользователь свернул вкладку или ушёл с доски.

---

# Этап 5. Улучшение рисования

Цель: сделать paint приятным, а не просто технической демкой.

## Product-задачи

- [ ] Плавная кисть.
- [ ] Ластик.
- [ ] Палитра цветов.
- [ ] Размер кисти.
- [ ] Undo / redo.
- [ ] Очистка доски с подтверждением.
- [ ] Экспорт PNG.
- [ ] Горячие клавиши.
- [ ] Touch support для планшетов.

## Backend-задачи

- [ ] Перейти от отдельных line-сегментов к stroke-модели.
- [ ] Один штрих = один объект `Stroke` с массивом точек.
- [ ] Добавить `strokeId`.
- [ ] Добавить серверную версию доски `boardVersion`.
- [ ] Реализовать `draw.undo`.
- [ ] Реализовать `draw.redo`.
- [ ] Ограничить максимальный размер stroke.
- [ ] Ограничить частоту draw-событий.

## Frontend-задачи

- [ ] Собирать точки штриха во время pointermove.
- [ ] Отправлять `stroke.start`, `stroke.point`, `stroke.end`.
- [ ] Рисовать локально оптимистично.
- [ ] Обрабатывать серверное подтверждение.
- [ ] Добавить smoothing:
  - quadratic curves;
  - line interpolation;
  - pressure support при наличии `PointerEvent.pressure`.
- [ ] Добавить горячие клавиши:
  - `B` — brush;
  - `E` — eraser;
  - `Ctrl+Z` — undo;
  - `Ctrl+Shift+Z` — redo;
  - `Ctrl+S` — export PNG.

## Definition of Done

- [ ] Линии выглядят плавнее.
- [ ] Undo отменяет последний свой штрих.
- [ ] Redo возвращает отменённый штрих.
- [ ] Очистка доски синхронизируется у всех участников.
- [ ] Новый пользователь получает актуальное состояние доски.

---

# Этап 6. Снапшоты и история доски

Цель: убрать бесконечный рост истории и сделать быстрое подключение новых клиентов.

## Проблема

Если хранить каждое движение мыши в истории, то со временем история становится огромной. Новый клиент будет получать тысячи сообщений, и доска будет долго восстанавливаться.

## Решение

Хранить:

1. Последний snapshot доски.
2. Операции после snapshot.
3. Версию доски.

## Backend-задачи

- [ ] Добавить `BoardSnapshot`.
- [ ] Добавить `BoardOperation`.
- [ ] Делать snapshot после N операций.
- [ ] Отправлять новому клиенту:
  - snapshot;
  - операции после snapshot.
- [ ] Добавить лимит истории.
- [ ] Добавить compact history.
- [ ] Добавить endpoint для экспорта snapshot.

## Frontend-задачи

- [ ] Уметь применять snapshot.
- [ ] Уметь применять список операций.
- [ ] Показывать loading state при восстановлении доски.
- [ ] Не разрешать рисовать, пока snapshot не применён.

## Definition of Done

- [ ] Новый клиент подключается быстро даже после долгой сессии.
- [ ] История не растёт бесконечно.
- [ ] После перезагрузки страницы доска восстанавливается.

---

# Этап 7. Персистентность

Цель: состояние не должно пропадать при перезапуске сервера.

## Варианты хранения

### Уровень 1: JSON-файлы

Подходит для простого MVP.

- простая реализация;
- легко отлаживать;
- плохо масштабируется;
- возможны проблемы с конкурентной записью.

### Уровень 2: SQLite

Лучший вариант для сильного pet-project.

- один файл;
- транзакции;
- проще PostgreSQL;
- достаточно для комнат, истории и пользователей.

### Уровень 3: PostgreSQL

Подходит для production-версии.

- нормальная многопользовательская БД;
- миграции;
- индексы;
- удобнее масштабировать.

## Рекомендация

Для этого проекта оптимально начать с **SQLite**, а интерфейс `Storage` сделать так, чтобы позже можно было добавить PostgreSQL.

## Backend-задачи

- [ ] Создать интерфейс `Storage`.
- [ ] Реализовать `MemoryStorage`.
- [ ] Реализовать `SQLiteStorage`.
- [ ] Добавить миграции.
- [ ] Хранить комнаты.
- [ ] Хранить board snapshots.
- [ ] Хранить board operations.
- [ ] Хранить chat history.
- [ ] Добавить восстановление комнат при старте.

## Пример интерфейса

```go
type Storage interface {
    CreateRoom(ctx context.Context, room Room) error
    GetRoom(ctx context.Context, roomID string) (Room, error)
    SaveOperation(ctx context.Context, op BoardOperation) error
    GetOperationsAfter(ctx context.Context, roomID string, version int64) ([]BoardOperation, error)
    SaveSnapshot(ctx context.Context, snapshot BoardSnapshot) error
    GetLatestSnapshot(ctx context.Context, roomID string) (BoardSnapshot, error)
}
```

## Definition of Done

- [ ] Сервер перезапускается, а комнаты и доски сохраняются.
- [ ] Есть миграции.
- [ ] Есть тесты storage-слоя.
- [ ] Есть memory-storage для тестов.

---

# Этап 8. Авторизация и роли

Цель: сделать доступ к комнатам управляемым.

## Роли

- `owner` — владелец комнаты.
- `editor` — может рисовать и писать в чат.
- `viewer` — может смотреть, но не рисовать.
- `guest` — временный участник без аккаунта.

## Product-задачи

- [ ] Гостевой вход по никнейму.
- [ ] Комната может быть публичной или приватной.
- [ ] Владелец может очистить доску.
- [ ] Владелец может кикнуть участника.
- [ ] Viewer видит доску и курсоры, но не может рисовать.
- [ ] Share-link для комнаты.

## Backend-задачи

- [ ] Сервер генерирует guest token.
- [ ] JWT или signed token для комнаты.
- [ ] Проверка прав на каждое действие:
  - draw;
  - clear;
  - undo;
  - chat;
  - invite;
  - kick.
- [ ] Добавить middleware auth для HTTP.
- [ ] Добавить auth check в WebSocket handshake.
- [ ] Не доверять `clientId` и `nickname`, пришедшим с клиента.

## Frontend-задачи

- [ ] Экран входа.
- [ ] Экран ошибки доступа.
- [ ] Badge роли возле имени.
- [ ] Disabled UI для viewer.
- [ ] Меню управления участником для owner.

## Definition of Done

- [ ] Viewer не может отправить draw даже через DevTools.
- [ ] Чужой пользователь не может очистить доску без прав.
- [ ] Сервер, а не фронтенд, является источником правды по ролям.

---

# Этап 9. Безопасность и валидация

Цель: защитить сервер от мусорных сообщений и базовых атак.

## Backend-задачи

- [ ] Проверять Origin по allowlist.
- [ ] Ограничить размер входящего WebSocket-сообщения.
- [ ] Валидировать `type`.
- [ ] Валидировать `roomId`.
- [ ] Валидировать координаты.
- [ ] Валидировать цвет.
- [ ] Валидировать размер кисти.
- [ ] Валидировать длину nickname.
- [ ] Валидировать длину chat-сообщения.
- [ ] Rate limit для chat.
- [ ] Rate limit для draw.
- [ ] Rate limit для cursor.
- [ ] Sanitization chat-сообщений на frontend.
- [ ] Запрет HTML-инъекций в чате.
- [ ] Лимит участников на комнату.
- [ ] Лимит комнат на IP.

## Definition of Done

- [ ] Невалидное сообщение не ломает сервер.
- [ ] Большое сообщение не съедает память.
- [ ] Спам курсорами не убивает комнату.
- [ ] HTML в чате не исполняется.
- [ ] Origin не открыт для всех в production-режиме.

---

# Этап 10. Тестирование

Цель: сделать проект убедительным для работодателя.

## Unit-тесты

- [ ] `RoomManager.CreateRoom`.
- [ ] `RoomManager.JoinRoom`.
- [ ] `RoomManager.LeaveRoom`.
- [ ] `Room.Broadcast`.
- [ ] `Presence.List`.
- [ ] `Board.ApplyStroke`.
- [ ] `Board.Undo`.
- [ ] `Board.Redo`.
- [ ] `Storage` memory implementation.
- [ ] Валидация протокола.

## Integration-тесты

- [ ] Два WebSocket-клиента подключаются к одной комнате.
- [ ] Первый клиент рисует, второй получает событие.
- [ ] Пользователь входит — остальные получают presence update.
- [ ] Пользователь выходит — остальные получают presence update.
- [ ] Клиент из другой комнаты не получает чужие события.
- [ ] Viewer не может рисовать.
- [ ] Slow client не ломает broadcast.

## Race-тесты

- [ ] `go test -race ./...`.
- [ ] Много клиентов одновременно подключаются и отключаются.
- [ ] Много клиентов одновременно рисуют.

## Нагрузочные тесты

- [ ] CLI-генератор WebSocket-клиентов.
- [ ] 50 клиентов в одной комнате.
- [ ] 100 клиентов в разных комнатах.
- [ ] Замер latency broadcast.
- [ ] Замер памяти при длинной истории.

## Definition of Done

- [ ] Тесты покрывают ключевую бизнес-логику.
- [ ] Есть интеграционные тесты WebSocket.
- [ ] Race detector проходит.
- [ ] В README есть команда запуска тестов.

---

# Этап 11. UX/UI улучшения

Цель: сделать проект приятным для реального использования.

## Идеи интерфейса

- [ ] Красивый стартовый экран.
- [ ] Создание комнаты в один клик.
- [ ] Генерация короткого room-code.
- [ ] Список участников справа.
- [ ] Чат сворачивается.
- [ ] Мини-панель инструментов.
- [ ] Поддержка тёмной темы.
- [ ] Поддержка мобильного экрана.
- [ ] Toast-уведомления.
- [ ] Индикатор reconnect.
- [ ] Индикатор сохранения.
- [ ] Empty-state для новой доски.
- [ ] Confirmation modal перед очисткой доски.

## Идеи инструментов

- [ ] Кисть.
- [ ] Ластик.
- [ ] Линия.
- [ ] Прямоугольник.
- [ ] Круг.
- [ ] Стрелка.
- [ ] Текст.
- [ ] Sticky notes.
- [ ] Выбор объекта.
- [ ] Перемещение объекта.
- [ ] Изменение размера объекта.
- [ ] Слои.
- [ ] Фон доски:
  - белый;
  - сетка;
  - точки;
  - dark mode.

## Идеи collaborative UX

- [ ] «Alex рисует...».
- [ ] «Maria печатает...».
- [ ] Цвет участника автоматически выбирается сервером.
- [ ] Клик по участнику подсвечивает его курсор.
- [ ] Follow mode: следовать за курсором выбранного участника.
- [ ] Мини-карта доски.

---

# Этап 12. Observability и эксплуатация

Цель: показать, что ты понимаешь production-подход.

## Backend-задачи

- [ ] Структурированные логи:
  - room_created;
  - client_connected;
  - client_disconnected;
  - message_rejected;
  - rate_limited;
  - storage_error.
- [ ] Добавить log level через env.
- [ ] Добавить Prometheus metrics:
  - active_connections;
  - active_rooms;
  - messages_total;
  - rejected_messages_total;
  - websocket_disconnects_total;
  - room_participants;
  - storage_errors_total.
- [ ] Добавить `/metrics`.
- [ ] Добавить `/debug/pprof` только в dev-режиме.
- [ ] Добавить graceful shutdown:
  - закрыть входящие подключения;
  - отправить `server.shutdown`;
  - дождаться write-pump;
  - сохранить состояние комнат.

## Definition of Done

- [ ] По логам понятно, что происходит.
- [ ] Есть healthcheck.
- [ ] Есть метрики.
- [ ] Сервер корректно выключается.

---

# Этап 13. Docker и deployment

Цель: сделать проект легко запускаемым.

## Задачи

- [ ] Добавить `Dockerfile` для backend.
- [ ] Добавить multi-stage build.
- [ ] Добавить `docker-compose.yml`.
- [ ] Добавить volume для SQLite.
- [ ] Добавить Nginx/Caddy reverse proxy.
- [ ] Добавить WebSocket proxy config.
- [ ] Добавить production env example.
- [ ] Добавить GitHub Actions:
  - fmt;
  - test;
  - race;
  - build docker image.

## Definition of Done

- [ ] Проект запускается через `docker compose up`.
- [ ] Frontend открывается в браузере.
- [ ] WebSocket работает через reverse proxy.
- [ ] CI запускает тесты при push.

---

# Этап 14. Масштабирование

Цель: подготовить архитектуру к нескольким backend-инстансам.

## Когда это нужно

Не нужно делать сразу. Это полезно как advanced-этап после стабильного MVP.

## Проблема

Если у тебя несколько Go-серверов, пользователи одной комнаты могут попасть на разные инстансы. Тогда обычный in-memory broadcast не доставит событие всем участникам.

## Решения

### Вариант A: Sticky sessions

Балансировщик отправляет всех участников одной комнаты на один backend.

Плюсы:

- проще;
- меньше инфраструктуры.

Минусы:

- хуже отказоустойчивость;
- одна большая комната нагружает один инстанс.

### Вариант B: Redis Pub/Sub или NATS

Каждый backend публикует события комнаты в broker, остальные backend получают их и отправляют своим клиентам.

Плюсы:

- лучше масштабируется;
- комнаты могут жить на разных backend.

Минусы:

- сложнее;
- нужен внешний сервис;
- нужно думать о порядке событий.

## Задачи

- [ ] Ввести интерфейс `EventBus`.
- [ ] Реализовать `LocalEventBus`.
- [ ] Реализовать `RedisEventBus` или `NATSEventBus`.
- [ ] Добавить room-channel naming.
- [ ] Добавить idempotency для событий.
- [ ] Добавить sequence number.
- [ ] Добавить обработку duplicate events.

## Definition of Done

- [ ] Два backend-инстанса синхронизируют события одной комнаты.
- [ ] Пользователь A на сервере 1 видит рисунок пользователя B на сервере 2.

---

## 9. Хорошие идеи для фич

### Фичи, которые хорошо смотрятся в портфолио

- [ ] Live cursors.
- [ ] Rooms by link.
- [ ] Undo/redo на сервере.
- [ ] Snapshot + operation log.
- [ ] WebSocket integration tests.
- [ ] Rate limiting.
- [ ] Roles: owner/editor/viewer.
- [ ] Docker compose.
- [ ] Prometheus metrics.
- [ ] SQLite persistence.

### Фичи, которые дают «вау-эффект»

- [ ] Follow user mode.
- [ ] Мини-карта большой доски.
- [ ] Sticky notes.
- [ ] Голосование стикерами.
- [ ] Таймер для brainstorming-сессии.
- [ ] Templates:
  - Kanban;
  - Retrospective;
  - Mind map;
  - Blank board.
- [ ] Export PNG/PDF.
- [ ] Share read-only link.
- [ ] Replay mode: воспроизвести историю рисования.

### Фичи, которые лучше не делать слишком рано

- [ ] Полноценные аккаунты.
- [ ] OAuth.
- [ ] PostgreSQL + Redis + Kubernetes сразу.
- [ ] CRDT.
- [ ] Offline-first режим.
- [ ] Сложные векторные инструменты как в Figma.

Эти вещи могут сильно усложнить проект и замедлить прогресс. Их лучше оставить как advanced-планы.

---

## 10. Приоритетная последовательность задач

Ниже порядок, в котором лучше двигаться.

## Блок A. Стабилизировать фундамент

1. Разделить пакеты.
2. Ввести protocol envelope.
3. Сделать readPump/writePump.
4. Сделать heartbeat.
5. Сделать `/health`.
6. Добавить базовые тесты.

## Блок B. Сделать комнаты

1. RoomManager.
2. Room join/leave.
3. Room-specific broadcast.
4. Room-specific online.
5. Room URL на фронте.
6. Кнопка «скопировать ссылку».

## Блок C. Presence и курсоры

1. Presence list.
2. Цвета участников.
3. Cursor events.
4. Cursor overlay.
5. Cursor throttling.
6. Cursor timeout.

## Блок D. Улучшить рисование

1. Stroke model.
2. Smooth drawing.
3. Undo/redo.
4. Clear confirmation.
5. Snapshot.
6. Export PNG.

## Блок E. Сделать проект серьёзным

1. SQLite storage.
2. Миграции.
3. Rate limits.
4. Origin allowlist.
5. Docker.
6. CI.
7. Metrics.

---

## 11. Что показывать работодателю

В README стоит явно описать:

- что это real-time collaborative whiteboard;
- как устроен WebSocket protocol;
- как решена проблема concurrent writes;
- как работают комнаты;
- как работает presence;
- как новые клиенты получают состояние доски;
- как протестировать проект;
- какие trade-offs ты сделал.

Пример сильной формулировки:

> Реализовал real-time collaborative whiteboard на Go и WebSocket. Сервер поддерживает комнаты, presence, live cursors, чат и синхронизацию состояния доски. Для WebSocket используется read-pump/write-pump архитектура с отдельной outbound-очередью на клиента, heartbeat и защитой от slow clients. Состояние доски хранится через snapshot + operation log, что позволяет быстро подключать новых пользователей и восстанавливать комнаты после перезапуска.

---

## 12. Важные инженерные решения

## 12.1. Online должен быть производным состоянием

Плохо:

```go
onlineUsers []string
```

Если такой slice обновлять отдельно, он легко рассинхронизируется.

Лучше:

```go
func (r *Room) OnlineParticipants() []ParticipantView {
    result := make([]ParticipantView, 0, len(r.Participants))
    for _, p := range r.Participants {
        if p.Online {
            result = append(result, p.View())
        }
    }
    return result
}
```

Online должен строиться из реального состояния соединений / участников комнаты.

## 12.2. Нельзя писать в WebSocket откуда угодно

Плохо:

```go
client.Conn.WriteMessage(websocket.TextMessage, data)
```

из разных мест кода.

Лучше:

```go
client.Send <- envelope
```

А фактическая запись происходит только в `writePump()`.

## 12.3. Комната должна быть границей broadcast

Плохо:

```go
for client := range allClients {
    send(client, msg)
}
```

Лучше:

```go
room.Broadcast(msg, Except(senderID))
```

## 12.4. Сервер должен быть источником правды

Не доверять фронтенду в таких полях:

- `clientId`;
- `role`;
- `room permissions`;
- `nickname` после join;
- `boardVersion`;
- `createdAt`.

Фронтенд может отправлять intent. Сервер решает, разрешено ли действие.

---

## 13. Возможные сложности

## Низкая сложность

- `/health`;
- README;
- Makefile;
- UI счётчик online;
- кнопка copy room link;
- basic room ID в URL.

## Средняя сложность

- readPump/writePump;
- heartbeat;
- комнаты;
- live cursors;
- throttling;
- stroke model;
- undo/redo;
- интеграционные WebSocket-тесты.

## Высокая сложность

- snapshot + operation log;
- persistence;
- роли и авторизация;
- масштабирование через Redis/NATS;
- replay history;
- CRDT/offline-first.

---

## 14. Минимальный сильный MVP

Если хочется быстро получить красивую и убедительную версию, достаточно сделать вот это:

- [ ] комнаты по ссылке;
- [ ] нормальный online список;
- [ ] live cursors;
- [ ] stroke-based drawing;
- [ ] undo последнего своего штриха;
- [ ] snapshot для нового клиента;
- [ ] SQLite persistence;
- [ ] WebSocket integration tests;
- [ ] Docker compose;
- [ ] README с архитектурной схемой.

Это уже будет сильный проект для junior/junior+ backend-разработчика.

---

## 15. Расширенный MVP

После минимального сильного MVP можно добавить:

- [ ] роли owner/editor/viewer;
- [ ] chat history;
- [ ] rate limits;
- [ ] metrics;
- [ ] CI;
- [ ] templates;
- [ ] sticky notes;
- [ ] export PNG/PDF;
- [ ] replay mode.

---

## 16. Чеклист качества кода

Перед тем как считать задачу готовой:

- [ ] код отформатирован через `gofmt`;
- [ ] нет data race;
- [ ] ошибки не игнорируются без причины;
- [ ] нет прямых `WriteMessage` вне writePump;
- [ ] входящие сообщения валидируются;
- [ ] нет глобального mutable state без защиты;
- [ ] нет бесконечного роста history;
- [ ] есть тест хотя бы на основную бизнес-логику;
- [ ] есть лог на важное событие;
- [ ] есть понятный failure path;
- [ ] README обновлён.

---

## 17. Suggested GitHub Issues

Ниже готовые issue-названия.

### Foundation

- [ ] `refactor: split websocket and room logic`
- [ ] `feat: add protocol envelope for websocket messages`
- [ ] `feat: implement client readPump and writePump`
- [ ] `feat: add websocket heartbeat`
- [ ] `feat: add health endpoint`
- [ ] `test: add unit tests for room manager`

### Rooms

- [ ] `feat: add room manager`
- [ ] `feat: support room join by link`
- [ ] `feat: isolate board state per room`
- [ ] `feat: isolate chat per room`
- [ ] `feat: add copy room link button`

### Presence

- [ ] `feat: add room participants list`
- [ ] `feat: add participant colors`
- [ ] `feat: add live cursor events`
- [ ] `feat: add cursor overlay on frontend`
- [ ] `feat: add cursor throttling and timeout`

### Board

- [ ] `refactor: replace line history with stroke model`
- [ ] `feat: add undo redo for strokes`
- [ ] `feat: add board snapshot`
- [ ] `feat: add png export improvements`
- [ ] `feat: add smooth drawing`

### Storage

- [ ] `feat: add storage interface`
- [ ] `feat: add sqlite storage`
- [ ] `feat: persist rooms`
- [ ] `feat: persist board operations`
- [ ] `feat: restore board state on startup`

### Security

- [ ] `feat: add origin allowlist`
- [ ] `feat: add websocket message validation`
- [ ] `feat: add rate limit for chat draw cursor events`
- [ ] `feat: add viewer editor owner roles`

### DevOps

- [ ] `chore: add Dockerfile`
- [ ] `chore: add docker compose`
- [ ] `chore: add GitHub Actions CI`
- [ ] `feat: add prometheus metrics`

---

## 18. Проверенные технические опоры

- Gorilla WebSocket поддерживает одного concurrent reader и одного concurrent writer на соединение. Поэтому для проекта нужен единый writer на клиента через `writePump` и канал исходящих сообщений: https://pkg.go.dev/github.com/gorilla/websocket
- В WebSocket нужно обрабатывать close/ping/pong control messages и продолжать читать соединение, чтобы эти сообщения обрабатывались корректно: https://pkg.go.dev/github.com/gorilla/websocket
- Браузерный WebSocket API описан в MDN: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Pointer Events подходят для мыши, тача и стилуса через единый API: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- В Go 1.25 появился новый анализатор `go vet` для ошибок с `WaitGroup.Add`, что полезно для конкурентного кода: https://go.dev/doc/go1.25

---

## 19. Финальная цель

Проект должен демонстрировать не только то, что ты умеешь «поднять WebSocket», а то, что ты понимаешь:

- жизненный цикл соединения;
- конкурентность в Go;
- shared state;
- broadcast;
- комнаты;
- валидацию протокола;
- восстановление состояния;
- UX real-time приложения;
- тестирование WebSocket-сценариев;
- production-подход.

Если довести проект хотя бы до минимального сильного MVP, он может стать очень хорошим аргументом на собеседовании.
