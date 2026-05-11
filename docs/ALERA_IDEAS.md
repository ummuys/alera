# Alera — идеи развития проекта

Документ описывает идеи, которые можно реализовать в Alera, и расставляет их по ценности для продукта, backend-портфолио и сложности.

## 1. Главная продуктовая идея

Alera лучше развивать не как «paint в браузере», а как **real-time collaborative whiteboard** для:

- командной работы;
- объяснения архитектуры;
- обучения;
- live coding / собеседований;
- быстрых схем и заметок;
- совместного обсуждения идей.

Сильная формулировка проекта:

> Alera is a real-time collaborative whiteboard built with Go and WebSocket. It supports rooms, live presence, chat, drawing synchronization, board snapshots, reconnect recovery and event-based state management.

## 2. Шкала оценки

| Оценка | Значение |
|---:|---|
| 1–2 | очень просто |
| 3–4 | небольшая фича |
| 5–6 | средняя задача |
| 7–8 | сложная инженерная фича |
| 9–10 | отдельная подсистема / advanced-level |

`Backend value` показывает, насколько фича демонстрирует backend-навыки.

---

# 3. Foundation: привести репозиторий к сильному виду

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| F-01 | README | Описать проект, запуск, архитектуру, протокол и roadmap | Проект становится понятным за 30 секунд | 1 | 4 |
| F-02 | Demo GIF/video | Показать live drawing, chat, online users | Быстро демонстрирует результат | 2 | 2 |
| F-03 | Makefile | `make run`, `make test`, `make race`, `make lint` | Удобство разработки и проверки | 2 | 5 |
| F-04 | `.env.example` | Порт, origins, лимиты, storage mode | Production-like конфигурация | 2 | 5 |
| F-05 | Dockerfile | Запуск backend/frontend в контейнере | Удобно для demo/deploy | 4 | 6 |
| F-06 | Docker Compose | Backend + storage одной командой | Быстрый локальный запуск | 4 | 6 |
| F-07 | `/health` | Healthcheck endpoint | Нужен для деплоя и мониторинга | 2 | 5 |
| F-08 | CI | GitHub Actions: tests, race, lint | Показывает инженерную дисциплину | 4 | 7 |
| F-09 | Архитектурная диаграмма | `Client -> WS -> Hub -> Room -> Storage` | Улучшает восприятие проекта | 2 | 6 |
| F-10 | Changelog | Версионирование изменений | Репозиторий выглядит живым | 1 | 3 |

---

# 4. WebSocket core: самое важное для backend-разработчика

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| WS-01 | `Client.readPump()` | Отдельная goroutine для чтения сообщений клиента | Чистый lifecycle WebSocket-клиента | 5 | 9 |
| WS-02 | `Client.writePump()` | Единственное место записи в WebSocket | Убирает concurrent writes | 6 | 10 |
| WS-03 | Outbound queue | Все исходящие сообщения через `client.Send` | Защита от хаотичной записи в connection | 5 | 9 |
| WS-04 | Heartbeat | Ping/pong, read deadline, write deadline | Сервер понимает, что клиент умер | 5 | 9 |
| WS-05 | Max message size | Ограничить размер входящих сообщений | Защита от больших payload-ов | 3 | 7 |
| WS-06 | Slow client policy | Отключать клиента при переполнении send-очереди | Медленный клиент не кладёт сервер | 5 | 8 |
| WS-07 | Structured errors | `error.code`, `message`, `field`, `retryable` | Frontend может нормально показать ошибку | 4 | 8 |
| WS-08 | `requestId` | Клиент связывает request и response/error | Удобно для debug и тестов | 4 | 7 |
| WS-09 | Protocol version | Поле `version` в envelope | Упрощает будущие изменения протокола | 3 | 7 |
| WS-10 | Graceful close | Close frame + cleanup channels/goroutines | Меньше leaks и подвисших клиентов | 5 | 8 |

### Почему это важно

Фича `readPump/writePump` показывает, что ты понимаешь:

- goroutines;
- channels;
- lifecycle соединения;
- backpressure;
- race-free дизайн;
- отличие демо-WebSocket от production-like WebSocket.

---

# 5. Room system

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| R-01 | `RoomManager` | Управляет комнатами: create/get/join/leave/delete | Главная backend-сущность проекта | 5 | 9 |
| R-02 | `Room` aggregate | У комнаты свои clients, history, presence, revision | Изоляция состояния | 5 | 9 |
| R-03 | Broadcast внутри комнаты | События комнаты A не попадают в B | Базовая корректность collaborative app | 4 | 9 |
| R-04 | Presence per room | Online users отдельно для каждой комнаты | Корректный UX и state model | 4 | 8 |
| R-05 | Join by link | `/room/:id` или `?room=id` | Простое приглашение пользователей | 3 | 6 |
| R-06 | Create room | Создать новую доску | Продуктовый сценарий | 4 | 7 |
| R-07 | Room cleanup | Удаление/заморозка пустых комнат | Не копить состояние в памяти | 5 | 8 |
| R-08 | Room limits | Лимит участников/комнат | Защита от перегрузки | 3 | 7 |
| R-09 | Room metadata | `title`, `ownerId`, `createdAt`, `visibility` | Основа продукта | 4 | 6 |
| R-10 | Private rooms | Вход по invite token | Более реальный access model | 7 | 8 |

### Рекомендуемые структуры

```go
type RoomManager struct {
    mu    sync.RWMutex
    rooms map[string]*Room
}

type Room struct {
    id       string
    clients  map[*Client]struct{}
    history  []BoardEvent
    revision uint64
}
```

---

# 6. State sync: подключение, refresh, reconnect

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| S-01 | `room_state` после join | Новый клиент получает текущее состояние доски | Без этого новые пользователи видят пустой canvas | 6 | 9 |
| S-02 | Room revision | У комнаты есть монотонная версия | Основа для reconnect/snapshot | 5 | 8 |
| S-03 | Reconnect recovery | После обрыва клиент получает актуальное состояние | Production-like поведение | 6 | 9 |
| S-04 | Operation log | Хранить события `draw`, `clear`, `chat` | Основа replay/persistence/debug | 6 | 9 |
| S-05 | Snapshot | Компактное состояние доски | Быстрый вход в большие комнаты | 7 | 9 |
| S-06 | Snapshot + events | Snapshot + докатить события после него | Сильная архитектура хранения | 8 | 10 |
| S-07 | Idempotency | Не применять повторно один и тот же event/request | Полезно для retry/reconnect | 7 | 9 |
| S-08 | Replay session | Воспроизвести создание доски | Очень запоминающаяся фича | 8 | 8 |
| S-09 | Time travel | Перемотка доски назад/вперёд | Advanced editor фича | 9 | 9 |
| S-10 | CRDT/offline-first | Совместное редактирование офлайн | Очень сложно | 10 | 10 |

---

# 7. Validation, security, trust boundary

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| V-01 | Validate `join` | nickname, roomId, color | Сервер не доверяет браузеру | 3 | 8 |
| V-02 | Validate `draw` | coords, size, color, tool | Защита доски от мусора | 4 | 9 |
| V-03 | Validate `chat` | trim, length, empty, control chars | Защита чата | 3 | 8 |
| V-04 | Validate `clear` | Проверка права очистки | Backend принимает решение | 4 | 8 |
| V-05 | Rate limit draw | Ограничить частоту draw events | Защита от перегрузки | 5 | 9 |
| V-06 | Rate limit cursor | Cursor events можно спамить чаще всего | Стабильность real-time канала | 4 | 8 |
| V-07 | Rate limit chat | Антиспам | Нормальная защита продукта | 4 | 8 |
| V-08 | Allowed origins | Не пускать WebSocket с любых сайтов | Базовая security-фича | 3 | 8 |
| V-09 | Roles | owner/editor/viewer | Основа прав доступа | 7 | 9 |
| V-10 | Audit log | Лог важных действий комнаты | Debug и безопасность | 5 | 7 |

---

# 8. Storage

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| DB-01 | Storage interfaces | `RoomStore`, `EventStore`, `SnapshotStore` | Отделяет бизнес-логику от БД | 5 | 9 |
| DB-02 | SQLite mode | Локальное хранение комнат и событий | Лучший первый persistence слой | 5 | 8 |
| DB-03 | Migrations | Версионировать схему БД | Важный backend-паттерн | 4 | 8 |
| DB-04 | Save board events | Сохранять `draw/clear` | Доска переживает restart | 6 | 9 |
| DB-05 | Save chat messages | История чата комнаты | Улучшает UX | 5 | 7 |
| DB-06 | PostgreSQL mode | Production-like storage | Хорошо для портфолио | 6 | 8 |
| DB-07 | Repository tests | Тесты storage layer | Надёжность | 5 | 8 |
| DB-08 | Retention policy | Удалять старые комнаты/события | Не раздувать БД | 5 | 7 |
| DB-09 | Event compaction | Сжимать operation log в snapshot | Инженерная оптимизация | 8 | 9 |
| DB-10 | Multi-tenant model | Workspaces/teams | Почти SaaS-архитектура | 9 | 9 |

### Минимальная схема БД

```sql
rooms(id, title, owner_id, created_at, updated_at, archived_at)
room_events(id, room_id, type, sender_id, payload_json, revision, created_at)
chat_messages(id, room_id, sender_id, text, created_at)
snapshots(id, room_id, revision, payload_json, created_at)
```

---

# 9. Collaboration UX

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| C-01 | Live cursors | Видно курсоры других участников | Сильный wow-эффект | 5 | 7 |
| C-02 | Cursor leave | Убирать курсор при уходе с canvas | Корректный presence UX | 4 | 6 |
| C-03 | User status | `drawing`, `typing`, `idle`, `away` | Доска ощущается живой | 4 | 6 |
| C-04 | Chat history | Новый участник видит последние сообщения | Цельность комнаты | 5 | 7 |
| C-05 | Reactions | Emoji на действия/сообщения | Лёгкая social-фича | 3 | 3 |
| C-06 | Comments | Комментарии к точке на доске | Уже ближе к FigJam/Miro | 7 | 6 |
| C-07 | Mentions | `@nickname` | Командный сценарий | 6 | 6 |
| C-08 | Follow user | Следовать за viewport другого пользователя | Полезно для обучения | 7 | 7 |
| C-09 | Presentation mode | Ведущий управляет вниманием | Хорошо для teaching use case | 7 | 7 |

---

# 10. Editor features

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| E-01 | Text tool | Текст на доске | Доска полезнее для схем | 5 | 5 |
| E-02 | Shapes | rectangle/circle/line | Основа диаграмм | 5 | 5 |
| E-03 | Arrows | Стрелки между объектами | Очень полезно для архитектуры | 6 | 5 |
| E-04 | Sticky notes | Стикеры | Miro/FigJam feeling | 6 | 5 |
| E-05 | Selection tool | Выбор объекта | Переход к object-based model | 8 | 7 |
| E-06 | Move/resize | Двигать и менять размер объектов | Требует событий объектов | 8 | 7 |
| E-07 | Undo/redo | Откат действий | Базовая editor-фича | 6 | 8 |
| E-08 | Per-user undo | Откат только своих действий | Правильно для collaboration | 7 | 9 |
| E-09 | Object locking | Lock объекта при редактировании | Серьёзная collaborative-фича | 8 | 9 |
| E-10 | Layers | Слои | Мощно, но сложно | 9 | 7 |

---

# 11. Export/import/share

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| X-01 | Export PNG | Сохранить canvas как картинку | Быстрая польза | 3 | 2 |
| X-02 | Export JSON | Сохранить состояние доски | Backup/import | 5 | 6 |
| X-03 | Import JSON | Восстановить доску из файла | Templates и перенос | 5 | 6 |
| X-04 | Export SVG | Качественный экспорт схем | Требует object model | 7 | 5 |
| X-05 | Read-only share | Ссылка только для просмотра | Продуктовая фича | 6 | 8 |
| X-06 | Invite tokens | Ссылки с правами | Настоящая access model | 7 | 9 |
| X-07 | Board duplication | Копировать доску | Полезно для templates | 5 | 7 |
| X-08 | Export PDF | Экспорт урока/схемы | Приятно, но не ядро | 7 | 4 |

---

# 12. Observability, testing, performance

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| O-01 | Unit tests | Validators, RoomManager, protocol | Базовая надёжность | 4 | 8 |
| O-02 | Race tests | `go test -race ./...` | Очень важно для goroutines/WebSocket | 5 | 10 |
| O-03 | WebSocket integration tests | Проверить join/draw/chat/clear через WS | Очень сильный backend-сигнал | 7 | 10 |
| O-04 | Load test tool | N клиентов, M комнат, messages/sec | Показывает performance | 6 | 9 |
| O-05 | Prometheus metrics | `/metrics`: clients, rooms, latency, errors | Production observability | 7 | 9 |
| O-06 | Structured logs | `roomId/clientId/eventType/requestId` | Удобный debug | 4 | 8 |
| O-07 | Admin debug page | Активные комнаты/клиенты/очереди | Demo и эксплуатация | 6 | 7 |
| O-08 | p95/p99 latency | Измерение задержки доставки | Серьёзный KPI | 7 | 9 |
| O-09 | Goroutine leak tests | Проверить cleanup после disconnect | Advanced reliability | 7 | 10 |
| O-10 | Chaos scenarios | disconnect storms, slow clients | Очень сильная инженерия | 8 | 10 |

---

# 13. Scaling

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| SC-01 | Redis Pub/Sub | Синхронизация backend-инстансов | Основа horizontal scaling | 8 | 10 |
| SC-02 | Sticky sessions docs | Объяснить WebSocket deploy strategy | Показывает понимание инфраструктуры | 5 | 8 |
| SC-03 | Distributed room events | Инстансы рассылают события локальным клиентам | Реальный multi-instance backend | 9 | 10 |
| SC-04 | NATS adapter | Альтернативный broker | Расширяемая архитектура | 8 | 9 |
| SC-05 | Room ownership/sharding | Комната закрепляется за инстансом | Сложная distributed model | 9 | 10 |
| SC-06 | Broker backpressure | Что делать при перегрузке broker/client | Production-level тема | 10 | 10 |

---

# 14. Вау-фичи

| ID | Функционал | Описание | Смысл | Сложность | Backend value |
|---|---|---|---|---:|---:|
| W-01 | System design mode | Палитра API Gateway, DB, Redis, Queue, Worker | Идеально для backend-портфолио | 8 | 8 |
| W-02 | Templates | Kanban, flowchart, architecture, interview board | Быстрый старт для пользователя | 6 | 5 |
| W-03 | Replay session | Воспроизвести создание доски | Запоминающаяся фича | 8 | 8 |
| W-04 | AI diagram generator | Генерация схемы по тексту | Очень заметно | 9 | 6 |
| W-05 | AI cleanup | Превратить кривую схему в аккуратную | Очень сложно | 10 | 6 |
| W-06 | Public benchmark | Страница с нагрузкой и latency | Сильная backend-демонстрация | 7 | 9 |

---

# 15. Рекомендуемый roadmap

## v0.1 — исправить ядро

- `Client.readPump()`;
- `Client.writePump()`;
- все отправки только через `client.Send`;
- `RoomManager`;
- broadcast только внутри комнаты;
- presence per room;
- `room_state` after join;
- validation `join/draw/chat/clear`;
- basic README;
- basic tests.

## v0.2 — real-time reliability

- heartbeat ping/pong;
- read/write deadlines;
- reconnect recovery;
- room revision;
- structured errors;
- rate limits;
- cursor events.

## v0.3 — persistence

- SQLite;
- migrations;
- rooms table;
- board_events table;
- chat_messages table;
- snapshots table;
- storage interfaces;
- integration tests.

## v0.4 — product polish

- text tool;
- shapes;
- arrows;
- undo/redo;
- export/import JSON;
- templates;
- roles owner/editor/viewer.

## v1.0 — backend portfolio release

- Docker Compose;
- CI;
- `go test -race ./...`;
- WebSocket integration tests;
- Prometheus metrics;
- load test;
- admin debug page;
- demo deploy;
- architecture docs.

## v1.1+ — scaling and wow

- Redis Pub/Sub;
- horizontal scaling;
- replay session;
- system design mode;
- invite tokens;
- public read-only share;
- AI diagram generator.

---

# 16. Самый сильный набор для backend-портфолио

| Место | Фича | Почему она сильная |
|---:|---|---|
| 1 | `readPump/writePump` | Go concurrency, channels, WebSocket lifecycle |
| 2 | `RoomManager` | Архитектура real-time backend-а |
| 3 | `room_state` | Server-side state management |
| 4 | Reconnect recovery | Отказоустойчивость |
| 5 | SQLite/PostgreSQL persistence | БД, миграции, repository layer |
| 6 | Validation + rate limits | Security/backend maturity |
| 7 | Integration tests + race tests | Инженерное качество |
| 8 | Metrics + load test | Production-thinking |
| 9 | Redis Pub/Sub | Distributed systems |
| 10 | Replay session | Запоминающаяся фича поверх event log |

---

# 17. Главная рекомендация

Не начинать с AI, OAuth и сложных UI-фич.

Сначала сделать фундамент:

1. безопасный WebSocket core;
2. комнаты;
3. room-level state;
4. snapshot;
5. reconnect;
6. validation;
7. tests.

После этого любые новые фичи будут ложиться на правильную архитектуру.
