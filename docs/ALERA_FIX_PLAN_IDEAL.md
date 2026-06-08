# Alera — production-like execution plan v2.0

> Цель: превратить `ummuys/alera` из учебного collaborative paint в сильный портфолио-проект под профиль **Go backend + WebSocket + DevOps + Python automation**.
>
> Этот документ заменяет общий roadmap на **исполняемый план**: что делать, в каком порядке, какими PR, какие тесты писать, как проверять результат и как встроить работу в недельное расписание 10-13 часов.

---

## 0. Главная идея плана

Alera не надо развивать как набор случайных фич. Его нужно развивать как backend-систему:

```text
Frontend canvas
  -> WebSocket transport
  -> server-authoritative protocol
  -> room isolation
  -> board state/history
  -> validation/rate limit/backpressure
  -> graceful shutdown
  -> Docker/CI/observability
  -> Python smoke/load/replay tooling
```

Фокус на ближайшие 6 PR:

1. **Сделать проект запускаемым и проверяемым.**
2. **Зафиксировать текущее поведение тестами.**
3. **Починить WebSocket lifecycle и shutdown.**
4. **Ввести RoomManager без большого одномоментного слома.**
5. **Сделать server-authoritative session + validation + errors.**
6. **Довести rooms до production-like MVP: room_state, presence, history limit, integration tests.**

После PR1-PR6 проект уже можно показывать как серьёзную backend-работу.

---

## 1. Твой рабочий режим

Твоё расписание даёт примерно **10-13 часов в неделю**. Это хороший объём, если работать PR-ами, а не хаотично.

| День | Фокус | Время | Как использовать для Alera |
|---|---:|---:|---|
| Понедельник | Go backend | 1-1.5 ч | Основной код PR: структуры, handlers, packages |
| Вторник | Linux / сети / диагностика | 1-1.5 ч | `curl`, `ss`, `lsof`, WebSocket debugging, logs, Docker networking |
| Среда | Python | 1 ч | Smoke scripts, load scripts, replay tooling, pytest |
| Четверг | DevOps / Docker / monitoring | 1-1.5 ч | Dockerfile, Compose, healthcheck, CI, metrics/logging |
| Пятница | Go + повторение | 1 ч | Refactor, cleanup, review, tests, race detector |
| Суббота | Большая практика связки | 3-3.5 ч | Интеграционный день: Go + Docker + Linux + monitoring |
| Воскресенье | Python + ревизия недели | 3 ч | Python tooling, weekly review, README, issues, demo notes |

### Принцип недели

Каждая неделя должна завершаться одним из трёх результатов:

```text
1. Merge-ready PR
2. Closed technical spike with notes
3. Reproducible demo/checklist result
```

Не засчитывать неделю как успешную, если были только чтение, переписывание планов и фрагментарный код без проверки.

---

## 2. Стратегия с учётом сильного Python-бэкграунда

Если Python уже сильная сторона, его не нужно делать главным языком Alera. Главный стержень проекта — **Go backend**.

Python должен усиливать проект вокруг Go:

```text
Python as leverage:
- smoke tests
- load simulation
- protocol regression checks
- replay/preview generation
- analytics reports
- CI helper scripts
```

Правильная формулировка для портфолио:

> Core сервиса написан на Go, а Python используется как tooling layer для проверки, нагрузки, диагностики и аналитики.

Это выглядит сильнее, чем “я просто добавил Python-скрипты”.

---

## 3. Target architecture v1

### 3.1. Целевая структура после PR1-PR6

```text
cmd/
  main.go

internal/
  config/
    config.go

  web/
    server.go
    handlers.go
    health.go

  ws/
    handler.go
    client.go
    hub.go
    read_pump.go
    write_pump.go
    protocol.go
    validation.go
    errors.go
    integration_test.go

  room/
    manager.go
    room.go
    board.go
    participant.go
    presence.go
    history.go
    manager_test.go
    board_test.go

pkg/
  logger/
    logger.go

frontend/
  index.html
  src/
  bundle.js

docs/
  protocol.md
  architecture.md
  troubleshooting.md

scripts/
  python/
    alera_checker/
    ws_smoke.py
    ws_load.py

.github/
  workflows/
    ci.yml

Dockerfile
docker-compose.yml
Makefile
.env.example
README.md
```

### 3.2. Граница ответственности

| Package | За что отвечает | За что не отвечает |
|---|---|---|
| `internal/web` | HTTP server, static files, `/healthz`, `/readyz`, route registration | Business logic rooms |
| `internal/ws` | WebSocket upgrade, read/write pump, deadlines, ping/pong, protocol envelope | Board history semantics |
| `internal/room` | Rooms, participants, presence, board state, room history | Raw WebSocket conn |
| `internal/config` | Env parsing, defaults, validation | Runtime state |
| `scripts/python` | Smoke/load/replay tooling | Core application state |

### 3.3. Важный архитектурный запрет

Не допускать обратной зависимости:

```text
room -> ws    запрещено
ws -> room    разрешено
web -> ws     разрешено
```

`room` должен быть тестируемым без WebSocket-соединения.

---

## 4. Non-goals до завершения PR1-PR6

До конца PR1-PR6 не делать:

- auth/login;
- database persistence;
- Kubernetes;
- Prometheus/Grafana full stack;
- undo/redo;
- advanced brush engine;
- frontend redesign;
- stroke model rewrite, если segment model ещё не стабилизирован;
- сложные роли и permissions;
- multi-node scaling.

Причина: эти фичи будут усиливать проект только после стабильного WebSocket/room core.

---

# 5. Идеальный PR-by-PR migration plan

Ниже — главный раздел документа. Он превращает roadmap в конкретную последовательность PR.

---

## PR1 — Project baseline: README, Makefile, config, health

### Цель

Сделать проект понятным, запускаемым и проверяемым без знания внутренностей кода.

### Почему это первый PR

До архитектурного refactor нужно иметь стабильные команды:

```bash
make run
make test
make race
make build
make docker-build
```

Это снизит риск всех следующих PR.

### Scope

Добавить:

```text
README.md
Makefile
.env.example
internal/config/config.go
internal/web/health.go
```

Изменить:

```text
cmd/main.go
internal/web/server.go
internal/web/handlers.go
```

### Implementation steps

#### 1. Добавить `internal/config/config.go`

```go
package config

import (
    "os"
    "strconv"
    "strings"
)

type Config struct {
    Addr            string
    Env             string
    LogLevel        string
    FrontendDir     string
    AllowedOrigins  []string
    MaxRoomEvents   int
    WSReadLimit     int64
    WSSendQueueSize int
}

func Load() Config {
    return Config{
        Addr:            getEnv("APP_ADDR", ":8089"),
        Env:             getEnv("APP_ENV", "local"),
        LogLevel:        getEnv("APP_LOG_LEVEL", "debug"),
        FrontendDir:     getEnv("APP_FRONTEND_DIR", "frontend"),
        AllowedOrigins:  splitCSV(getEnv("APP_ALLOWED_ORIGINS", "http://localhost:8089")),
        MaxRoomEvents:   getEnvInt("APP_MAX_ROOM_EVENTS", 10000),
        WSReadLimit:     int64(getEnvInt("APP_WS_READ_LIMIT", 65536)),
        WSSendQueueSize: getEnvInt("APP_WS_SEND_QUEUE_SIZE", 256),
    }
}

func getEnv(key, fallback string) string {
    if value := strings.TrimSpace(os.Getenv(key)); value != "" {
        return value
    }
    return fallback
}

func getEnvInt(key string, fallback int) int {
    raw := strings.TrimSpace(os.Getenv(key))
    if raw == "" {
        return fallback
    }
    value, err := strconv.Atoi(raw)
    if err != nil {
        return fallback
    }
    return value
}

func splitCSV(raw string) []string {
    parts := strings.Split(raw, ",")
    out := make([]string, 0, len(parts))
    for _, p := range parts {
        p = strings.TrimSpace(p)
        if p != "" {
            out = append(out, p)
        }
    }
    return out
}
```

#### 2. Убрать hardcoded server address

Вместо прямого `:8089` использовать `cfg.Addr`.

#### 3. Добавить `/healthz` и `/readyz`

```go
func HealthHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    _, _ = w.Write([]byte(`{"status":"ok","service":"alera","version":"dev"}`))
}

func ReadyHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    _, _ = w.Write([]byte(`{"status":"ready","service":"alera"}`))
}
```

#### 4. Добавить `Makefile`

```makefile
.PHONY: run test race fmt vet build clean docker-build

run:
	go run ./cmd

test:
	go test ./...

race:
	go test -race ./...

fmt:
	gofmt -w .

vet:
	go vet ./...

build:
	mkdir -p bin
	go build -o bin/alera ./cmd

clean:
	rm -rf bin

docker-build:
	docker build -t alera:local .
```

#### 5. Добавить `.env.example`

```env
APP_ADDR=:8089
APP_ENV=local
APP_LOG_LEVEL=debug
APP_ALLOWED_ORIGINS=http://localhost:8089,http://localhost:3000
APP_FRONTEND_DIR=frontend
APP_MAX_ROOM_EVENTS=10000
APP_WS_READ_LIMIT=65536
APP_WS_SEND_QUEUE_SIZE=256
```

#### 6. Добавить README minimum viable version

README должен отвечать на 5 вопросов:

```text
1. Что это за проект?
2. Как запустить локально?
3. Как открыть frontend?
4. Как прогнать тесты?
5. Как устроен WebSocket protocol на высоком уровне?
```

### Tests

Минимум:

```bash
make test
make race
make build
```

Добавить unit tests для config:

```text
internal/config/config_test.go
```

Проверить:

- defaults работают;
- env override работает;
- CSV origins парсятся;
- invalid int fallback не ломает запуск.

### Manual verification

```bash
make run
curl -i http://localhost:8089/healthz
curl -i http://localhost:8089/readyz
curl -i http://localhost:8089/
```

Ожидание:

```text
/healthz -> 200
/readyz  -> 200
/        -> frontend or static response
```

### Definition of Done

- `README.md` есть и по нему можно запустить проект.
- `make run` запускает сервер.
- `make test` проходит.
- `make race` проходит или явно описано, почему пока нет race-test coverage.
- `make build` создаёт бинарь.
- `APP_ADDR` меняет порт без правки кода.
- `/healthz` и `/readyz` отвечают 200.
- PR не меняет WebSocket protocol.

### Что показать в PR description

```md
## What changed
- Added env-based config
- Added health/readiness endpoints
- Added Makefile
- Added README quick start

## Verification
- make test
- make race
- make build
- curl /healthz
- curl /readyz
```

### Риск

Низкий. PR инфраструктурный. Не должен ломать runtime logic.

### Оценка времени

```text
4-6 часов
```

Под твоё расписание:

```text
Пн: config
Чт: health/readiness + Makefile
Сб: README + ручная проверка
Вс: ревизия и PR description
```

---

## PR2 — Characterization tests: зафиксировать текущее поведение до refactor

### Цель

Перед тем как менять WebSocket/room architecture, нужно зафиксировать текущее поведение тестами. Это защитит от случайного слома.

### Почему это второй PR

Refactor без tests быстро превращается в переписывание вслепую. PR2 создаёт safety net.

### Scope

Добавить:

```text
internal/paint/protocol_test.go       # если пакет paint ещё не разнесён
internal/paint/validation_test.go     # пока как characterization или TODO failing tests
internal/web/health_test.go
```

Дополнительно можно добавить test helpers:

```text
internal/testutil/ws_client.go
```

### Важный принцип

В PR2 не надо сразу делать идеальную архитектуру. Нужно описать:

```text
current behavior
expected future behavior
known bugs
```

Для known bugs использовать один из двух подходов:

1. `t.Skip("known bug: global broadcast is not room-isolated yet")`
2. issue/TODO comment рядом с тестом.

### Test categories

#### 1. Protocol JSON parsing

Проверить:

- valid `join` парсится;
- valid `draw` парсится;
- invalid JSON не приводит к panic;
- unknown type обрабатывается предсказуемо.

#### 2. Health endpoints

Проверить:

```text
GET /healthz -> 200
GET /readyz  -> 200
```

#### 3. Basic WebSocket integration smoke

Минимальный тест:

```text
- старт test server
- подключение WS client
- отправка join
- получение session или текущего аналога response
```

Если полноценный WebSocket test пока тяжёлый, в PR2 достаточно подготовить helper и 1 smoke test.

#### 4. Known future tests, временно skipped

```go
func TestRoomIsolation_Future(t *testing.T) {
    t.Skip("known issue: room isolation will be implemented in PR4/PR6")
}
```

Проверки, которые должны появиться:

```text
- room A does not receive room B draw
- clear affects only current room
- presence is scoped by room
- reconnect receives only room state
```

### Manual verification

```bash
make test
make race
```

Если race detector уже показывает проблему, не скрывать её. Зафиксировать в issue/PR notes:

```text
Known race: client metadata is mutated after connection registration. Will be fixed in PR5.
```

### Definition of Done

- Есть хотя бы базовые tests для config/health/protocol.
- Есть первый WebSocket smoke или test helper.
- Известные архитектурные баги оформлены как skipped tests или issues.
- PR не делает большой refactor.
- После PR понятно, что именно должно поменяться в PR3-PR6.

### Что показать в PR description

```md
## What changed
- Added characterization tests before WebSocket/room refactor
- Added health endpoint tests
- Added initial protocol parsing tests
- Documented known room isolation gap

## Verification
- make test
- make race
```

### Риск

Низкий-средний. Может вскрыть текущие race/bugs. Это хорошо.

### Оценка времени

```text
5-7 часов
```

Под твоё расписание:

```text
Пн: protocol tests
Пт: cleanup + race run
Сб: WebSocket smoke helper
Вс: docs/issues for known bugs
```

---

## PR3 — Safe WebSocket lifecycle: client close, pumps, deadlines, shutdown

### Цель

Починить жизненный цикл WebSocket clients: закрытие соединений, завершение goroutines, write deadlines, ping/pong, slow client policy.

### Почему до rooms

Если сначала добавить rooms поверх хрупкого lifecycle, потом будет сложно отделить room bugs от goroutine/channel bugs.

### Scope

Добавить или изменить:

```text
internal/ws/client.go       # или временно internal/paint/client.go
internal/ws/hub.go          # или internal/paint/paint_method.go
internal/ws/read_pump.go
internal/ws/write_pump.go
internal/ws/errors.go
```

Временно можно оставить package `paint`, если полный перенос в `ws` будет в PR4. Главное — стабилизировать lifecycle.

### Target client model

```go
type Client struct {
    id        string
    conn      *websocket.Conn
    send      chan []byte
    done      chan struct{}
    closeOnce sync.Once
}

func (c *Client) Close() {
    c.closeOnce.Do(func() {
        close(c.done)
        close(c.send)
        _ = c.conn.Close()
    })
}
```

### Важная деталь

Не закрывать channel из нескольких мест. Владельцем закрытия должен быть `Client.Close()`.

### writePump target behavior

```go
func (c *Client) writePump() {
    ticker := time.NewTicker(pingPeriod)
    defer func() {
        ticker.Stop()
        c.Close()
    }()

    for {
        select {
        case <-c.done:
            return

        case msg, ok := <-c.send:
            _ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
            if !ok {
                _ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
                return
            }
            if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
                return
            }

        case <-ticker.C:
            _ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
            if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
                return
            }
        }
    }
}
```

### readPump target behavior

```go
func (c *Client) readPump(handle func([]byte)) {
    defer c.Close()

    c.conn.SetReadLimit(maxMessageSize)
    _ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
    c.conn.SetPongHandler(func(string) error {
        return c.conn.SetReadDeadline(time.Now().Add(pongWait))
    })

    for {
        _, msg, err := c.conn.ReadMessage()
        if err != nil {
            return
        }
        handle(msg)
    }
}
```

### Hub shutdown target behavior

```go
func (h *Hub) Close(ctx context.Context) error {
    h.closeOnce.Do(func() {
        h.cancel()

        h.mu.Lock()
        clients := make([]*Client, 0, len(h.clients))
        for _, c := range h.clients {
            clients = append(clients, c)
        }
        h.mu.Unlock()

        for _, c := range clients {
            c.Close()
        }
    })
    return nil
}
```

### Slow client policy

При отправке в `send`:

```go
select {
case c.send <- msg:
    // ok
case <-c.done:
    // client already closed
default:
    // send queue full
    c.Close()
}
```

Для MVP: если очередь переполнена — отключать клиента. Это проще и честнее, чем бесконечно копить память.

### Tests

Добавить tests:

```text
TestClientCloseIsIdempotent
TestHubCloseClosesClients
TestBroadcastDropsOrClosesSlowClient
TestWritePumpStopsAfterClientClose
```

Не все тесты легко написать без mock conn. Если WebSocket conn сложно мокать, вынести отправку в interface:

```go
type Conn interface {
    ReadMessage() (int, []byte, error)
    WriteMessage(int, []byte) error
    SetReadLimit(int64)
    SetReadDeadline(time.Time) error
    SetWriteDeadline(time.Time) error
    SetPongHandler(func(string) error)
    Close() error
}
```

### Manual verification

```bash
make run
# открыть frontend в двух вкладках
# закрыть вкладки
# смотреть logs: client_disconnected без panic
make race
```

Linux diagnostics day:

```bash
lsof -i :8089
ss -tanp | grep 8089
```

Проверить, что после закрытия вкладок соединения не зависают навсегда.

### Definition of Done

- `Client.Close()` idempotent.
- `send` channel закрывается только в одном месте.
- `writePump` завершается после close.
- `readPump` ставит read limit и read deadline.
- Есть ping/pong heartbeat.
- Slow client не ломает весь hub.
- Shutdown закрывает активные clients.
- `make test` проходит.
- `make race` проходит или remaining race явно зафиксирована для PR5.

### PR description

```md
## What changed
- Added idempotent client close
- Added read/write deadlines
- Added ping/pong heartbeat
- Added slow client handling
- Improved hub shutdown

## Verification
- make test
- make race
- manual WS connect/disconnect
- lsof/ss checked no obvious leaked sockets
```

### Риск

Средний. Можно случайно получить `close of closed channel` или deadlock. Поэтому PR должен быть небольшим и focused.

### Оценка времени

```text
7-10 часов
```

Под твоё расписание:

```text
Пн: Client.Close + channel ownership
Вт: lsof/ss диагностика текущего поведения
Пт: writePump/readPump cleanup
Сб: shutdown + manual checks
Вс: notes + tests cleanup
```

---

## PR4 — Introduce RoomManager with strangler pattern

### Цель

Ввести `internal/room` как отдельный domain package, не переписывая весь WebSocket слой за один раз.

### Почему strangler pattern

Большой refactor `paint -> ws + room` одним PR рискованный. Лучше сначала добавить `RoomManager`, покрыть его tests, а потом подключить к WebSocket logic.

### Scope

Добавить:

```text
internal/room/manager.go
internal/room/room.go
internal/room/participant.go
internal/room/board.go
internal/room/history.go
internal/room/presence.go
internal/room/manager_test.go
internal/room/board_test.go
```

Изменить минимально:

```text
internal/paint/paint_method.go
internal/paint/client.go
```

или, если уже начат перенос:

```text
internal/ws/hub.go
internal/ws/client.go
```

### Domain model v1

```go
package room

type Participant struct {
    ID       string
    Nickname string
    Color    string
}

type Event struct {
    ID        string
    Type      string
    Sender    Participant
    Payload   json.RawMessage
    CreatedAt time.Time
}

type Room struct {
    id           string
    participants map[string]Participant
    history      []Event
    version      int64
    maxEvents    int
}

type Manager struct {
    mu     sync.RWMutex
    rooms  map[string]*Room
    config Config
}
```

### Manager API

```go
type Manager struct { /* ... */ }

func NewManager(cfg Config) *Manager
func (m *Manager) Join(roomID string, p Participant) (RoomSnapshot, error)
func (m *Manager) Leave(roomID, participantID string) error
func (m *Manager) AppendEvent(roomID string, event Event) (RoomSnapshot, error)
func (m *Manager) Clear(roomID string, by Participant) (RoomSnapshot, error)
func (m *Manager) Snapshot(roomID string) (RoomSnapshot, error)
func (m *Manager) Presence(roomID string) ([]Participant, error)
```

### RoomSnapshot

```go
type RoomSnapshot struct {
    RoomID       string
    Version      int64
    Participants []Participant
    Events       []Event
}
```

### Правило копирования slices/maps

Никогда не возвращать внутренние slices/maps напрямую.

Плохо:

```go
return r.history
```

Хорошо:

```go
out := make([]Event, len(r.history))
copy(out, r.history)
return out
```

### Подключение к текущему hub

На этом PR допустимо сделать минимальную связку:

```text
client join -> roomManager.Join(roomID, participant)
client disconnect -> roomManager.Leave(roomID, clientID)
draw/chat/clear -> roomManager.AppendEvent or Clear
```

Но broadcast можно окончательно дожать в PR6. В PR4 главная цель — domain layer.

### Tests

Обязательные unit tests:

```text
TestManagerJoinCreatesRoom
TestManagerJoinExistingRoom
TestManagerLeaveRemovesParticipant
TestManagerPresenceIsRoomScoped
TestManagerAppendEventIncrementsVersion
TestManagerHistoryIsLimited
TestManagerClearAffectsOnlyRoom
TestManagerSnapshotReturnsCopies
```

### Manual verification

Минимум:

```bash
make test
make race
```

Если WebSocket уже подключен к RoomManager:

```text
- открыть room=a в двух вкладках
- открыть room=b в третьей
- проверить logs join room_id=a/b
```

### Definition of Done

- `internal/room` не импортирует `internal/ws` или `internal/paint`.
- `Manager` покрыт unit tests.
- Presence считается отдельно по room.
- History ограничен `MaxRoomEvents`.
- Snapshot возвращает copies.
- Clear одной комнаты не трогает другую.
- `make race` проходит на room tests.

### PR description

```md
## What changed
- Added internal/room domain package
- Added RoomManager, Room, Participant, Board/History snapshots
- Added unit tests for room isolation and history limit

## Verification
- make test
- make race
```

### Риск

Средний. Главная опасность — смешать domain layer с WebSocket transport. Не делать этого.

### Оценка времени

```text
8-12 часов
```

Под твоё расписание:

```text
Пн: RoomManager structs/API
Пт: tests for join/leave/presence
Сб: history/version/clear/snapshot tests
Вс: cleanup + README architecture note
```

---

## PR5 — Server-authoritative protocol: session, validation, errors, allowed origins

### Цель

Сделать backend источником истины по session/client identity и перестать доверять frontend.

### Scope

Добавить/изменить:

```text
internal/ws/protocol.go
internal/ws/validation.go
internal/ws/errors.go
internal/ws/handler.go
internal/web/handlers.go
internal/config/config.go
```

Если проект ещё использует `internal/paint`, можно временно держать protocol там, но конечная цель — `internal/ws`.

### Protocol envelope v1

Client -> Server:

```json
{
  "type": "join",
  "requestId": "req_001",
  "payload": {
    "nickname": "Ummuys",
    "roomId": "main",
    "color": "#3366ff"
  }
}
```

Server -> Client success:

```json
{
  "type": "session",
  "requestId": "req_001",
  "payload": {
    "clientId": "uuid",
    "nickname": "Ummuys",
    "roomId": "main",
    "color": "#3366ff"
  }
}
```

Server -> Client error:

```json
{
  "type": "error",
  "requestId": "req_001",
  "payload": {
    "code": "VALIDATION_ERROR",
    "message": "invalid roomId"
  }
}
```

### Error codes

```text
INVALID_JSON
UNKNOWN_EVENT
NOT_JOINED
VALIDATION_ERROR
RATE_LIMITED
UNAUTHORIZED
ROOM_NOT_FOUND
SEND_QUEUE_FULL
INTERNAL_ERROR
```

### Client state

```go
type ClientState int

const (
    ClientStateConnected ClientState = iota
    ClientStateJoined
    ClientStateClosed
)

type ClientSession struct {
    ID       string
    Nickname string
    RoomID   string
    Color    string
}
```

Rules:

```text
- connected client may only send join
- draw/chat/clear before join -> NOT_JOINED
- repeated join -> VALIDATION_ERROR or explicit room switch flow later
- sender is always taken from server session
- frontend cannot override clientId/sender
```

### Validation rules

#### join

```text
nickname:
- trim
- length 2..32
- collapse repeated whitespace optional

roomId:
- trim
- regexp ^[a-zA-Z0-9_-]{1,64}$
- default "main" only if payload roomId is empty and product decision allows it

color:
- #RRGGBB
- if invalid, backend assigns default color
```

#### draw

```text
x0,y0,x1,y1:
- finite number
- range 0..1

size:
- 1..40

tool:
- pen
- eraser

color:
- #RRGGBB
- ignored or normalized for eraser depending on frontend model
```

#### chat

```text
message:
- trim
- non-empty
- max length 1000
- sender from server session only
```

#### clear

MVP:

```text
- allowed for all joined users
- server emits clear event with sender metadata
- future: roles/owner/admin
```

### Allowed origins

Replace `CheckOrigin: return true` with config-based origin check.

```go
func IsAllowedOrigin(origin string, allowed []string) bool {
    if origin == "" {
        return true // allow curl/local non-browser tools if desired
    }
    for _, item := range allowed {
        if origin == item {
            return true
        }
    }
    return false
}
```

### Tests

Mandatory:

```text
TestValidateJoinAcceptsValidPayload
TestValidateJoinRejectsInvalidNickname
TestValidateJoinRejectsInvalidRoomID
TestValidateDrawRejectsOutOfRangeCoordinates
TestValidateDrawRejectsInvalidTool
TestValidateChatRejectsEmptyMessage
TestClientRejectsDrawBeforeJoin
TestErrorResponseIncludesRequestID
TestAllowedOrigins
```

### Manual verification

Use browser devtools or a tiny Python script:

```text
1. send invalid JSON -> error INVALID_JSON
2. send draw before join -> error NOT_JOINED
3. send invalid roomId -> error VALIDATION_ERROR
4. send valid join -> session
5. send valid chat -> broadcast to room
```

### Definition of Done

- Backend generates/owns `clientId`.
- Backend normalizes `nickname`, `roomId`, `color`.
- Client cannot send draw/chat/clear before join.
- Invalid JSON returns `error`, not silent ignore.
- Unknown event returns `UNKNOWN_EVENT`.
- Validation tests exist.
- `CheckOrigin` uses env allowlist.
- `make test` and `make race` pass.

### PR description

```md
## What changed
- Added server-authoritative session lifecycle
- Added validation for join/draw/chat/clear
- Added structured error protocol
- Added allowed origin checks

## Verification
- make test
- make race
- manual invalid event checks
```

### Риск

Средний-высокий. Этот PR может потребовать небольших frontend updates, если frontend ожидал старые payloads.

### Оценка времени

```text
8-12 часов
```

Под твоё расписание:

```text
Пн: session state + protocol types
Вт: manual invalid WebSocket diagnostics
Пт: validation tests
Сб: integration checks with frontend
Вс: docs/protocol.md update
```

---

## PR6 — Room-scoped broadcast, room_state, presence, reconnect MVP

### Цель

Довести rooms до настоящего продукта: события не пересекаются между комнатами, reconnect восстанавливает state, presence корректна.

### Scope

Изменить:

```text
internal/ws/hub.go
internal/ws/handler.go
internal/ws/client.go
internal/room/manager.go
internal/room/presence.go
internal/room/history.go
frontend/src/websocket.js    # если нужно адаптировать protocol
frontend/src/app.js          # если нужно обработать room_state/session
```

Обновить docs:

```text
docs/protocol.md
docs/architecture.md
```

### Required event flow

После `join` server отправляет строго:

```text
1. session
2. room_state
3. presence
4. presence broadcast to other users in same room
```

### session event

```json
{
  "type": "session",
  "payload": {
    "clientId": "uuid",
    "nickname": "Alice",
    "roomId": "main",
    "color": "#3366ff"
  }
}
```

### room_state event

```json
{
  "type": "room_state",
  "payload": {
    "roomId": "main",
    "version": 42,
    "events": []
  }
}
```

### presence event

```json
{
  "type": "presence",
  "payload": {
    "roomId": "main",
    "users": [
      {
        "clientId": "uuid",
        "nickname": "Alice",
        "color": "#3366ff"
      }
    ]
  }
}
```

### Broadcast rule

Never:

```go
for _, client := range allClients { send(client, msg) }
```

Always:

```go
for _, client := range clientsInRoom(roomID) { send(client, msg) }
```

### Reconnect MVP

Reconnect means:

```text
- user opens same room again
- server creates new connection/clientId
- server sends current room_state from in-memory history
- previous clientId is not reused unless explicit auth/session persistence exists
```

Do not pretend to support persistent identity without auth/token storage.

### History limit

MVP policy:

```text
APP_MAX_ROOM_EVENTS=10000
```

When limit exceeded:

```text
- drop oldest events
- increment version
- log history_trimmed with room_id and dropped_count
```

Alternative snapshot model can be added later.

### Integration tests

Mandatory:

```text
TestTwoClientsSameRoomReceiveDraw
TestClientDifferentRoomDoesNotReceiveDraw
TestClearAffectsOnlyCurrentRoom
TestPresenceIsRoomScoped
TestReconnectReceivesRoomState
TestDisconnectUpdatesPresence
TestHistoryLimit
```

### Python smoke script introduced here or immediately after

File:

```text
scripts/python/ws_smoke.py
```

Basic scenario:

```text
1. connect client A to room=alpha
2. connect client B to room=alpha
3. connect client C to room=beta
4. A sends draw
5. B receives draw
6. C does not receive draw
7. A sends clear
8. B receives clear
9. C does not receive clear
10. reconnect D to alpha
11. D receives room_state
```

This script is perfect for your Sunday Python block.

### Manual verification

```text
Browser test:
- tab 1: room=a
- tab 2: room=a
- tab 3: room=b
- draw in tab 1
- tab 2 sees draw
- tab 3 does not
- clear in tab 1
- tab 2 clears
- tab 3 remains unchanged
- reload tab 2
- tab 2 receives room_state for room=a
```

### Definition of Done

- Broadcast is room-scoped.
- Presence is room-scoped.
- Clear is room-scoped.
- Reconnect receives room_state.
- History has limit.
- Integration tests cover room isolation.
- Python smoke test covers room isolation.
- `make test` passes.
- `make race` passes.
- `docs/protocol.md` matches actual implementation.

### PR description

```md
## What changed
- Implemented room-scoped broadcast
- Added room_state after join
- Added room-scoped presence
- Added reconnect state restore from in-memory history
- Added integration tests for room isolation
- Added Python WS smoke scenario

## Verification
- make test
- make race
- python scripts/python/ws_smoke.py
- manual 3-tab room isolation test
```

### Риск

Высокий, но оправданный. Это главный product/backend PR. Если становится слишком большим, разделить:

```text
PR6a: room-scoped broadcast + presence
PR6b: room_state + reconnect + Python smoke
```

### Оценка времени

```text
10-15 часов
```

Под твоё расписание:

```text
Пн: broadcast by room
Вт: WebSocket diagnostics with three clients
Ср: Python smoke skeleton
Пт: Go integration tests
Сб: reconnect/room_state/manual browser test
Вс: Python smoke complete + weekly review
```

---

# 6. После PR1-PR6: следующий слой роста

PR1-PR6 дают крепкий MVP. Дальше идти так.

## PR7 — Docker + docker-compose + healthcheck

Scope:

```text
Dockerfile
docker-compose.yml
.dockerignore
README Docker section
```

DoD:

```text
docker compose up --build
curl /healthz inside/outside container
frontend opens
/ws works through exposed port
```

---

## PR8 — GitHub Actions CI

Scope:

```text
.github/workflows/ci.yml
```

Pipeline:

```text
go test ./...
go test -race ./...
go vet ./...
go build ./cmd
docker build
```

Optional later:

```text
golangci-lint
python smoke against started service
```

---

## PR9 — Observability baseline

Scope:

```text
structured logs
request IDs
event logs
basic metrics endpoint optional
```

Events:

```text
client_connected
client_joined_room
client_disconnected
ws_message_received
ws_message_rejected
room_created
room_cleared
broadcast_dropped
send_queue_full
history_trimmed
```

Fields:

```text
client_id
room_id
event_type
message_size
error_code
latency_ms
```

---

## PR10 — Python checker + load simulator

Scope:

```text
scripts/python/alera_checker/
scripts/python/ws_load.py
scripts/python/requirements.txt
scripts/python/README.md
```

Must-have:

```text
alera_checker check --url http://localhost:8089
ws_load.py --clients 50 --room load --duration 30s --rate 5
CSV output
```

---

## PR11 — Troubleshooting/runbook

Scope:

```text
docs/troubleshooting.md
docs/runbook.md
```

Scenarios:

```text
WebSocket не подключается
Nginx/Proxy 502
/ws не upgrade-ится
draw не доходит
room isolation broken
reconnect пустой
send queue full
race detector failure
Docker healthcheck failed
Python smoke failed
```

---

## PR12 — Portfolio polish

Scope:

```text
README final
architecture diagram
GIF/screenshots
release notes
issue board cleanup
```

---

# 7. 12-недельный план под твоё расписание

## Недели 1-2 — Project baseline + tests

Goal:

```text
PR1 merged
PR2 merged
```

Deliverables:

```text
README
Makefile
config
healthz/readyz
basic tests
current behavior documented
```

## Недели 3-4 — WebSocket lifecycle

Goal:

```text
PR3 merged
```

Deliverables:

```text
safe Client.Close
writePump/readPump deadlines
ping/pong
slow client policy
shutdown closes clients
race run
```

## Недели 5-6 — RoomManager domain

Goal:

```text
PR4 merged
```

Deliverables:

```text
internal/room
unit tests
room-scoped presence model
history limit model
snapshot copies
```

## Недели 7-8 — Protocol hardening

Goal:

```text
PR5 merged
```

Deliverables:

```text
session lifecycle
validation
error protocol
allowed origins
frontend adjusted if needed
```

## Недели 9-10 — Real rooms MVP

Goal:

```text
PR6 merged
```

Deliverables:

```text
room-scoped broadcast
room_state
reconnect MVP
presence per room
integration tests
Python ws_smoke
```

## Недели 11-12 — DevOps + portfolio layer

Goal:

```text
PR7 or PR8 merged
portfolio demo ready
```

Deliverables:

```text
Dockerfile
docker-compose
CI
troubleshooting draft
demo script
```

---

# 8. Weekly operating system

## Monday — Go backend execution

Use for:

```text
- new structs/interfaces
- handlers
- package boundaries
- compiler errors
```

Rule:

```text
End Monday with code compiling or a clear failing test.
```

## Tuesday — Linux/network diagnostics

Use for:

```bash
curl -i http://localhost:8089/healthz
lsof -i :8089
ss -tanp | grep 8089
ps aux | grep alera
```

For WebSocket:

```bash
# optional tools
websocat ws://localhost:8089/ws
wscat -c ws://localhost:8089/ws
```

Write notes into:

```text
docs/troubleshooting.md
```

## Wednesday — Python tooling

Use for:

```text
- ws_smoke.py
- alera_checker
- pytest
- small load scripts
```

Rule:

```text
Python should test Go; it should not distract from Go core.
```

## Thursday — DevOps

Use for:

```text
- Dockerfile
- compose
- healthcheck
- CI
- env config
- logging fields
```

## Friday — Go review and cleanup

Use for:

```bash
gofmt -w .
go test ./...
go test -race ./...
go vet ./...
```

Rule:

```text
No Friday mega-refactor. Friday is for tightening.
```

## Saturday — integration practice

Use for full scenarios:

```text
- 3 browser tabs
- 2 rooms
- disconnect/reconnect
- Docker run
- logs inspection
- Python smoke
```

## Sunday — Python + weekly review

Use for:

```text
- Python smoke/load improvement
- README update
- issue board update
- PR description
- next-week plan
```

Weekly review questions:

```text
1. Что было merged?
2. Что теперь проверяется тестом?
3. Что стало проще диагностировать?
4. Какой баг или риск остался?
5. Какой один PR следующий?
```

---

# 9. Quality gates

## Every PR must pass

```bash
gofmt -w .
go test ./...
go test -race ./...
go vet ./...
go build ./cmd
```

If Docker exists:

```bash
docker build -t alera:local .
docker compose up --build
```

If Python tooling exists:

```bash
python -m pytest scripts/python
python scripts/python/ws_smoke.py
```

## No merge without

```text
- clear PR description
- verification commands pasted into PR
- docs updated if protocol/config changed
- no known panic path
- no unexplained race detector failure
```

---

# 10. Test matrix

| Area | Unit | Integration | Manual | Python |
|---|---:|---:|---:|---:|
| Config/env | yes | no | yes | no |
| Health/readiness | yes | yes | curl | checker |
| Protocol parsing | yes | yes | browser devtools | smoke |
| Validation | yes | yes | invalid payloads | smoke |
| Client lifecycle | partial | yes | close tabs | load |
| Room isolation | yes | yes | 3 tabs | smoke |
| Presence | yes | yes | 2 tabs | smoke |
| Reconnect room_state | partial | yes | reload tab | smoke |
| Backpressure | partial | optional | load test | load |
| Docker | no | CI | compose | checker |

---

# 11. GitHub issue board

## Milestone 1 — Stable local project

```text
#1 Add README quick start
#2 Add Makefile
#3 Add env config
#4 Add health/readiness endpoints
#5 Add config tests
```

## Milestone 2 — Test safety net

```text
#6 Add protocol tests
#7 Add health endpoint tests
#8 Add initial WebSocket smoke helper
#9 Document known room isolation bug
```

## Milestone 3 — WebSocket lifecycle

```text
#10 Make Client.Close idempotent
#11 Close send/done/conn safely
#12 Add read/write deadlines
#13 Add ping/pong heartbeat
#14 Add slow client policy
#15 Improve hub shutdown
```

## Milestone 4 — Room domain

```text
#16 Add internal/room package
#17 Add RoomManager
#18 Add presence model
#19 Add board/history model
#20 Add history limit
#21 Add room unit tests
```

## Milestone 5 — Protocol hardening

```text
#22 Add session lifecycle
#23 Add validation for join/draw/chat/clear
#24 Add structured error protocol
#25 Add allowed origin checks
#26 Update frontend for session/errors if needed
```

## Milestone 6 — Real rooms MVP

```text
#27 Add room-scoped broadcast
#28 Add room_state after join
#29 Add room-scoped presence events
#30 Add reconnect state restore
#31 Add integration tests
#32 Add Python ws_smoke scenario
```

---

# 12. Final MVP definition

Alera v1 is done when this scenario works:

```text
1. Developer clones repo.
2. Runs make run.
3. Opens browser tab A in room=alpha.
4. Opens browser tab B in room=alpha.
5. Opens browser tab C in room=beta.
6. A draws.
7. B sees the drawing.
8. C does not see the drawing.
9. A sends chat.
10. B sees chat.
11. C does not see chat.
12. A clears board.
13. B board clears.
14. C board stays unchanged.
15. B reloads.
16. B receives room_state for alpha.
17. make test passes.
18. make race passes.
19. docker compose up works.
20. Python ws_smoke passes.
```

This is the portfolio baseline.

---

# 13. Interview narrative after PR1-PR6

Формулировка:

> Alera — collaborative whiteboard на Go/WebSocket. Я начал с учебного online paint и довёл backend до production-like MVP: добавил env config, health/readiness, тесты, корректный WebSocket lifecycle, graceful shutdown, room isolation, server-authoritative session, validation, structured errors, room_state после reconnect и Python smoke tooling. Через этот проект я показываю не только код, но и эксплуатационное мышление: как сервис запускается, диагностируется, тестируется и выдерживает некорректных/медленных клиентов.

Ключевые тезисы:

```text
Go:
- goroutines/channels lifecycle
- context cancellation
- WebSocket read/write pumps
- validation
- race detector
- tests

DevOps:
- env config
- health/readiness
- Docker/Compose
- CI
- logs/troubleshooting

Python:
- smoke testing
- protocol regression checks
- load simulation
- automation around Go service
```

---

# 14. Самое важное правило

Не переписывать проект “на вдохновении”. Работать только так:

```text
small PR -> tests -> manual verification -> docs -> merge
```

Для твоего расписания это критично. При 10-13 часах в неделю один хороший PR лучше, чем пять незавершённых направлений.

