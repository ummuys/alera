/* ===== canvas.js ===== */
/**
 * canvas.js
 *
 * Низкоуровневый canvas-слой.
 *
 * Этот класс отвечает только за локальную работу с canvas:
 * - перевод координат pointer event в нормализованные координаты 0..1;
 * - отрисовку линий;
 * - очистку canvas;
 * - resize с учётом devicePixelRatio;
 * - экспорт PNG.
 *
 * Здесь НЕ должно быть WebSocket-логики, пользователей, комнат,
 * clientId, nickname, прав доступа или backend-состояния.
 */

class CanvasHandler {
  constructor(canvas) {
    if (!canvas) {
      throw new Error('Canvas element #board not found');
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Локальное состояние жеста рисования.
    // Это UI-состояние, его нормально хранить на frontend-е.
    this.isDrawing = false;
    this.lastPoint = null;
    this.tool = 'pen';
  }

  /**
   * Пересчитывает backing canvas size под реальный CSS-размер и DPR.
   *
   * Canvas имеет две системы размеров:
   * - CSS size: как элемент выглядит на странице;
   * - bitmap size: сколько физических пикселей внутри canvas.
   *
   * Для чёткой картинки на Retina/HiDPI нужно умножать bitmap size на DPR.
   */
  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;

    // Сохраняем старую картинку перед изменением canvas.width/height,
    // потому что изменение этих свойств полностью очищает canvas.
    const previous = document.createElement('canvas');
    previous.width = this.canvas.width;
    previous.height = this.canvas.height;

    if (previous.width > 0 && previous.height > 0) {
      previous.getContext('2d').drawImage(this.canvas, 0, 0);
    }

    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    // После setTransform все координаты дальше можно считать в CSS-пикселях,
    // а браузер сам умножит их на DPR.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (previous.width > 0 && previous.height > 0) {
      this.ctx.drawImage(previous, 0, 0, rect.width, rect.height);
    }
  }

  /**
   * Возвращает координату указателя в нормализованном формате 0..1.
   *
   * Для online paint это удобно: разные пользователи могут иметь canvas
   * разного размера, но одно и то же событие рисования воспроизведётся
   * в правильной относительной позиции.
   */
  getPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  /**
   * Рисует один сегмент линии.
   *
   * Backend всё равно должен валидировать draw-события, но frontend тоже
   * защищается от нечисловых значений, чтобы сломанное сообщение не ломало UI.
   */
  drawLine(x0, y0, x1, y1, color = '#111111', size = 5, drawTool = 'pen') {
    const values = [x0, y0, x1, y1, size].map(Number);

    if (values.some((value) => !Number.isFinite(value))) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const [startX, startY, endX, endY, lineSize] = values;

    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = Math.max(1, lineSize);

    if (drawTool === 'eraser') {
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.strokeStyle = color || '#111111';
    }

    this.ctx.beginPath();
    this.ctx.moveTo(startX * rect.width, startY * rect.height);
    this.ctx.lineTo(endX * rect.width, endY * rect.height);
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Рисует stroke, состоящий из массива нормализованных точек.
   *
   * Это формат следующего уровня после одиночных draw-сегментов:
   * backend может прислать одну линию как points[], а canvas-слой
   * сам разложит её на последовательность drawLine-вызовов.
   */
  drawStroke(points, color = '#111111', size = 5, drawTool = 'pen') {
    if (!Array.isArray(points) || points.length < 2) {
      return;
    }

    for (let index = 1; index < points.length; index += 1) {
      const previousPoint = points[index - 1];
      const currentPoint = points[index];

      if (!previousPoint || !currentPoint) {
        continue;
      }

      this.drawLine(
        previousPoint.x,
        previousPoint.y,
        currentPoint.x,
        currentPoint.y,
        color,
        size,
        drawTool,
      );
    }
  }

  /**
   * Рисует одно draw-событие независимо от его формата.
   *
   * Поддерживаются два формата:
   * - текущий сегментный: x0/y0/x1/y1;
   * - будущий stroke-формат: points[].
   */
  drawDrawPayload(payload = {}) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (Array.isArray(payload.points)) {
      this.drawStroke(
        payload.points,
        payload.color,
        payload.size,
        payload.tool,
      );

      return;
    }

    this.drawLine(
      payload.x0,
      payload.y0,
      payload.x1,
      payload.y1,
      payload.color,
      payload.size,
      payload.tool,
    );
  }

  /**
   * Полностью восстанавливает canvas из server-authoritative состояния доски.
   *
   * Метод используется для room_state после join/reconnect. Он сначала очищает
   * canvas, затем последовательно проигрывает события комнаты.
   *
   * Основной поддерживаемый формат:
   * { events: [{ type: 'draw', payload: {...} }, { type: 'clear' }] }
   *
   * Дополнительно поддерживается будущий snapshot-формат:
   * { strokes: [{ points: [...], color, size, tool }] }
   */
  drawBoard(board = {}) {
    this.clearCanvas();

    if (!board || typeof board !== 'object') {
      return;
    }

    const events = Array.isArray(board.events) ? board.events : [];

    if (events.length > 0) {
      events.forEach((event) => {
        if (!event || typeof event !== 'object') {
          return;
        }

        const eventType = String(event.type || '').replace(/[\s_-]/g, '').toLowerCase();

        if (eventType === 'clear') {
          this.clearCanvas();
          return;
        }

        if (eventType === 'draw') {
          this.drawDrawPayload(event.payload || event);
        }
      });

      return;
    }

    const strokes = Array.isArray(board.strokes) ? board.strokes : [];
    strokes.forEach((stroke) => this.drawDrawPayload(stroke));
  }

  /**
   * Локально очищает canvas.
   *
   * Важно: на кнопку "Очистить" frontend больше не вызывает этот метод сразу.
   * Очистка должна происходить только после server-authoritative события clear.
   */
  clearCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
  }

  /**
   * Экспортирует текущую локальную картинку в PNG.
   *
   * Это нормальная frontend-ответственность: браузер уже имеет текущее
   * визуальное состояние canvas и может скачать его как файл.
   */
  exportPng() {
    const sourceRect = this.canvas.getBoundingClientRect();
    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d');

    exportCanvas.width = this.canvas.width;
    exportCanvas.height = this.canvas.height;
    exportCtx.fillStyle = '#ffffff';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(this.canvas, 0, 0);

    if (!sourceRect.width || !sourceRect.height) {
      return this.canvas.toDataURL('image/png');
    }

    return exportCanvas.toDataURL('image/png');
  }

  setTool(newTool) {
    this.tool = newTool === 'eraser' ? 'eraser' : 'pen';
  }

  getTool() {
    return this.tool;
  }
}

/* ===== ui.js ===== */
/**
 * ui.js
 *
 * UI-слой.
 *
 * Этот класс отвечает только за DOM:
 * - поиск обязательных элементов;
 * - отображение статуса соединения;
 * - отображение текущего пользователя;
 * - отображение online users;
 * - отображение сообщений чата;
 * - обновление preview кисти.
 *
 * Здесь НЕ должно быть WebSocket-соединения, бизнес-валидации,
 * хранения комнат, вычисления online users или назначения clientId.
 */

class UI {
  constructor() {
    this.canvas = this.getRequiredElement('board');
    this.penButton = this.getRequiredElement('penButton');
    this.eraserButton = this.getRequiredElement('eraserButton');
    this.clearButton = this.getRequiredElement('clearButton');
    this.saveButton = this.getRequiredElement('saveButton');
    this.colorInput = this.getRequiredElement('colorInput');
    this.sizeInput = this.getRequiredElement('sizeInput');
    this.brushDot = this.getRequiredElement('brushDot');
    this.statusDot = this.getRequiredElement('statusDot');
    this.statusText = this.getRequiredElement('statusText');
    this.chatMessages = this.getRequiredElement('chatMessages');
    this.chatInput = this.getRequiredElement('chatInput');
    this.chatSendButton = this.getRequiredElement('chatSendButton');
    this.chatNickname = this.getRequiredElement('chatNickname');
    this.chatPanel = this.getRequiredElement('chatPanel');
    this.chatToggle = this.getRequiredElement('chatToggle');
    this.chatHeader = this.getRequiredElement('chatHeader');
    this.onlineUsersPanel = this.getRequiredElement('onlineUsersPanel');
    this.onlineUsersList = this.getRequiredElement('onlineUsersList');
    this.usersCount = this.getRequiredElement('usersCount');

    this.joinOverlay = this.getRequiredElement('joinOverlay');
    this.joinForm = this.getRequiredElement('joinForm');
    this.joinNicknameInput = this.getRequiredElement('joinNicknameInput');
    this.joinCursorColorInput = this.getRequiredElement('joinCursorColorInput');
    this.joinCursorColorPreview = this.getRequiredElement('joinCursorColorPreview');
    this.joinColorPalette = this.getRequiredElement('joinColorPalette');

    this.cursorPaletteColors = [
      '#7c3aed',
      '#2563eb',
      '#0891b2',
      '#16a34a',
      '#f59e0b',
      '#ef4444',
      '#db2777',
      '#111827',
    ];

    this.updateOnlineUsersList([]);
  }

  getRequiredElement(id) {
    const element = document.getElementById(id);

    if (!element) {
      throw new Error(`Element #${id} not found`);
    }

    return element;
  }

  setConnectionStatus(status) {
    this.statusDot.classList.toggle('connected', status === 'connected');
    this.statusDot.classList.toggle('error', status === 'error');
    this.statusText.textContent = status;
  }

  /**
   * Показывает nickname, подтверждённый backend-ом.
   */
  setCurrentUser(nickname) {
    this.chatNickname.textContent = nickname || '';
  }


  openJoinDialog(defaults = {}) {
    const fallbackNickname = String(defaults.nickname || 'User').trim() || 'User';
    const fallbackColor = this.normalizeHexColor(defaults.color, '#7c3aed');

    this.joinNicknameInput.value = fallbackNickname;
    this.joinCursorColorInput.value = fallbackColor;
    this.updateJoinCursorColor(fallbackColor);
    this.renderJoinColorPalette(fallbackColor);

    this.joinOverlay.hidden = false;
    this.joinOverlay.classList.add('visible');
    document.body.classList.add('join-dialog-open');

    window.setTimeout(() => {
      this.joinNicknameInput.focus();
      this.joinNicknameInput.select();
    }, 0);

    return new Promise((resolve) => {
      const handleSubmit = (event) => {
        event.preventDefault();

        const nickname = this.joinNicknameInput.value.trim() || fallbackNickname;
        const color = this.normalizeHexColor(this.joinCursorColorInput.value, fallbackColor);

        cleanup();
        this.joinOverlay.classList.remove('visible');
        this.joinOverlay.hidden = true;
        document.body.classList.remove('join-dialog-open');

        resolve({ nickname, color });
      };

      const handleColorInput = () => {
        const color = this.normalizeHexColor(this.joinCursorColorInput.value, fallbackColor);
        this.updateJoinCursorColor(color);
        this.markSelectedJoinColor(color);
      };

      const handlePaletteClick = (event) => {
        const button = event.target.closest('[data-color]');

        if (!button) {
          return;
        }

        const color = this.normalizeHexColor(button.dataset.color, fallbackColor);
        this.joinCursorColorInput.value = color;
        this.updateJoinCursorColor(color);
        this.markSelectedJoinColor(color);
      };

      const cleanup = () => {
        this.joinForm.removeEventListener('submit', handleSubmit);
        this.joinCursorColorInput.removeEventListener('input', handleColorInput);
        this.joinColorPalette.removeEventListener('click', handlePaletteClick);
      };

      this.joinForm.addEventListener('submit', handleSubmit);
      this.joinCursorColorInput.addEventListener('input', handleColorInput);
      this.joinColorPalette.addEventListener('click', handlePaletteClick);
    });
  }

  renderJoinColorPalette(selectedColor) {
    this.joinColorPalette.innerHTML = '';

    this.cursorPaletteColors.forEach((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'join-color-swatch';
      button.dataset.color = color;
      button.style.background = color;
      button.title = `Цвет курсора ${color}`;
      button.setAttribute('aria-label', `Выбрать цвет курсора ${color}`);

      if (color.toLowerCase() === selectedColor.toLowerCase()) {
        button.classList.add('selected');
      }

      this.joinColorPalette.appendChild(button);
    });
  }

  updateJoinCursorColor(color) {
    this.joinCursorColorPreview.style.background = color;
    this.joinCursorColorPreview.style.boxShadow = `0 0 0 8px ${color}22`;
  }

  markSelectedJoinColor(selectedColor) {
    [...this.joinColorPalette.querySelectorAll('[data-color]')].forEach((button) => {
      button.classList.toggle(
        'selected',
        button.dataset.color.toLowerCase() === selectedColor.toLowerCase(),
      );
    });
  }

  normalizeHexColor(color, fallback = '#7c3aed') {
    const value = String(color || '').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  }

  /**
   * Рендерит список online users, который пришёл с backend-а.
   *
   * Frontend не считает online самостоятельно по join/leave событиям.
   * Источник правды — server-authoritative presence message.
   */
  updateOnlineUsersList(users = []) {
    const normalizedUsers = this.normalizeUsers(users);

    this.onlineUsersList.innerHTML = '';
    this.usersCount.textContent = String(normalizedUsers.length);

    if (normalizedUsers.length === 0) {
      const listItem = document.createElement('li');
      listItem.className = 'online-users-empty';
      listItem.textContent = 'Пока никого нет';
      this.onlineUsersList.appendChild(listItem);
      return;
    }

    normalizedUsers.forEach((user) => {
      const listItem = document.createElement('li');
      listItem.className = 'online-user';

      const colorDot = document.createElement('span');
      colorDot.className = 'online-user-color';
      colorDot.style.background = user.color || '#22c55e';

      const name = document.createElement('span');
      name.className = 'online-user-name';
      name.textContent = user.nickname;

      listItem.append(colorDot, name);
      this.onlineUsersList.appendChild(listItem);
    });
  }

  /**
   * Нормализует входной список пользователей только для безопасного рендера.
   *
   * Это не заменяет backend-валидацию. Здесь мы просто приводим данные к виду,
   * удобному для DOM, и не используем innerHTML, чтобы не допустить XSS.
   */
  normalizeUsers(users) {
    if (!Array.isArray(users)) {
      return [];
    }

    const unique = new Map();

    users.forEach((user) => {
      if (typeof user === 'string') {
        const nickname = user.trim();
        if (nickname) {
          unique.set(nickname, { id: nickname, nickname, color: '' });
        }
        return;
      }

      if (!user || typeof user !== 'object') {
        return;
      }

      const id = String(user.id || user.clientId || user.nickname || user.name || '').trim();
      const nickname = String(user.nickname || user.name || id || '').trim();
      const color = String(user.color || '').trim();

      if (!nickname) {
        return;
      }

      unique.set(id || nickname, { id: id || nickname, nickname, color });
    });

    return [...unique.values()];
  }

  addChatMessage(text, variant = 'server') {
    const div = document.createElement('div');
    div.className = `chat-message ${variant}`;
    div.textContent = text;
    this.chatMessages.appendChild(div);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  updateBrushPreview(color, size, tool) {
    const previewSize = Math.max(4, Math.min(Number(size) || 5, 28));
    this.brushDot.style.width = `${previewSize}px`;
    this.brushDot.style.height = `${previewSize}px`;
    this.brushDot.style.background = tool === 'eraser' ? '#ffffff' : color;
    this.brushDot.style.border = tool === 'eraser' ? '1px solid #71717a' : 'none';
  }
}

/* ===== websocket.js ===== */
/**
 * websocket.js
 *
 * WebSocket-клиент и обработчик server-authoritative протокола.
 *
 * Главная идея после рефакторинга:
 * - frontend НЕ создаёт clientId;
 * - frontend НЕ отправляет nickname/clientId в draw/chat/clear;
 * - backend назначает session и sender;
 * - backend подтверждает clear/chat/draw итоговыми событиями;
 * - frontend отображает только то состояние, которое backend прислал как truth.
 */

const PRESENCE_TYPES = new Set(['presence', 'users', 'onlineusers']);

function normalizeType(type) {
  return String(type || '').replace(/[\s_-]/g, '').toLowerCase();
}

function buildDefaultWsUrl() {
  const queryUrl = new URLSearchParams(window.location.search).get('ws');

  if (queryUrl) {
    return queryUrl;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (window.location.protocol === 'file:') {
    return `${protocol}//localhost:8081/ws`;
  }

  const host = window.location.host || 'localhost:8081';

  return `${protocol}//${host}/ws`;
}

class WebSocketHandler {
  constructor(ui, canvasHandler, options = {}) {
    this.ui = ui;
    this.canvasHandler = canvasHandler;
    this.socket = null;
    this.wsUrl = options.wsUrl || buildDefaultWsUrl();

    // Эти значения — только запрос frontend-а.
    // Backend может изменить nickname, roomId или вернуть ошибку.
    this.requestedNickname = options.requestedNickname || '';
    this.requestedRoomId = options.requestedRoomId || 'main';
    this.requestedCursorColor = options.requestedCursorColor || '#7c3aed';

    // Настоящая session появляется только после server message type=session.
    this.session = null;

    this.reconnectDelayMs = options.reconnectDelayMs || 1000;
    this.reconnectTimer = null;
  }

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      this.socket = new WebSocket(this.wsUrl);
      this.ui.setConnectionStatus('connecting');

      this.socket.addEventListener('open', () => {
        this.clearReconnectTimer();
        this.ui.setConnectionStatus('connected');

        // Join содержит только предлагаемые имя, комнату и цвет курсора.
        // clientId должен быть назначен backend-ом и возвращён в session.
        this.sendMessage({
          type: 'join',
          payload: {
            nickname: this.requestedNickname,
            roomId: this.requestedRoomId,
            color: this.requestedCursorColor,
          },
        });
      });

      this.socket.addEventListener('close', () => {
        this.socket = null;
        this.session = null;
        this.ui.setConnectionStatus('disconnected');
        this.ui.setCurrentUser('переподключение...');
        this.ui.addChatMessage('Соединение потеряно. Переподключение...', 'server');
        this.scheduleReconnect();
      });

      this.socket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        this.ui.setConnectionStatus('error');
      });

      this.socket.addEventListener('message', (event) => {
        this.handleServerMessage(event.data);
      });
    } catch (error) {
      console.error('Cannot create WebSocket connection:', error);
      this.ui.setConnectionStatus('error');
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return;
    }

    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  handleServerMessage(rawData) {
    const message = this.parseMessage(rawData);

    if (!message) {
      return;
    }

    const type = normalizeType(message.type);

    if (type === 'session') {
      this.handleSession(message);
      return;
    }

    if (this.isPresenceMessage(message)) {
      this.handlePresence(message);
      return;
    }

    switch (type) {
      case 'userjoined':
      case 'join':
        this.handleUserJoined(message);
        break;

      case 'userleft':
      case 'leave':
        this.handleUserLeft(message);
        break;

      case 'chat':
        this.handleChat(message);
        break;

      case 'roomstate':
        this.handleRoomState(message);
        break;

      case 'draw':
        this.handleDraw(message);
        break;

      case 'clear':
        this.handleClear(message);
        break;

      case 'server':
        if (message.text || message.payload?.text) {
          this.ui.addChatMessage(message.text || message.payload.text, 'server');
        }
        break;

      case 'error':
        this.handleServerError(message);
        break;

      default:
        console.warn('Unknown WebSocket message:', message);
    }
  }

  handleSession(message) {
    const session = message.session || message.payload || message;

    this.session = {
      clientId: String(session.clientId || session.id || ''),
      nickname: String(session.nickname || session.name || this.requestedNickname || ''),
      roomId: String(session.roomId || this.requestedRoomId || 'main'),
      color: String(session.color || session.cursorColor || this.requestedCursorColor || ''),
    };

    this.ui.setCurrentUser(this.session.nickname);
    this.ui.addChatMessage(`Вы подключены как ${this.session.nickname}`, 'server');
  }

  handlePresence(message) {
    const payload = message.payload || message;
    this.ui.updateOnlineUsersList(payload.users || []);
  }

  handleUserJoined(message) {
    const sender = this.getSender(message);

    if (this.isOwnSender(sender)) {
      return;
    }

    this.ui.addChatMessage(`${sender.nickname || 'Кто-то'} вошёл в комнату`, 'server');
  }

  handleUserLeft(message) {
    const sender = this.getSender(message);
    this.ui.addChatMessage(`${sender.nickname || 'Кто-то'} вышел из комнаты`, 'server');
  }

  handleRoomState(message) {
    const payload = message.payload || message;

    // room_state — server-authoritative восстановление доски после join/reconnect.
    // CanvasHandler сам очищает canvas и умеет проигрывать как текущие draw-сегменты,
    // так и будущие strokes с массивом points[].
    this.canvasHandler?.drawBoard(payload);
  }

  handleChat(message) {
    const sender = this.getSender(message);
    const payload = message.payload || message;
    const text = String(payload.text || '').trim();

    if (!text) {
      return;
    }

    const variant = this.isOwnSender(sender) ? 'me' : 'remote';
    const author = this.isOwnSender(sender) ? 'Вы' : sender.nickname || 'Пользователь';

    this.ui.addChatMessage(`${author}: ${text}`, variant);
  }

  handleDraw(message) {
    const sender = this.getSender(message);

    // Свои draw-события уже нарисованы локально optimistic UI.
    // Поэтому server echo пропускаем, чтобы не удваивать линию.
    if (this.isOwnSender(sender)) {
      return;
    }

    const payload = message.payload || message;

    this.canvasHandler?.drawDrawPayload(payload);
  }

  handleClear(message) {
    const sender = this.getSender(message);
    const nickname = this.isOwnSender(sender) ? 'Вы' : sender.nickname || 'Кто-то';

    // Clear выполняется только после backend-события.
    this.canvasHandler?.clearCanvas();
    this.ui.addChatMessage(`${nickname} очистил(а) доску`, 'server');
  }

  handleServerError(message) {
    const payload = message.payload || message;
    const text = payload.message || payload.text || 'Сервер вернул ошибку';
    this.ui.addChatMessage(text, 'server');
  }

  getSender(message) {
    const sender = message.sender || message.user || {};

    // Поддержка legacy flat-полей оставлена только для плавного перехода backend-а.
    return {
      id: String(sender.id || sender.clientId || message.clientId || ''),
      nickname: String(sender.nickname || sender.name || message.nickname || ''),
      color: String(sender.color || message.color || ''),
    };
  }

  isOwnSender(sender) {
    return Boolean(this.session?.clientId && sender?.id && sender.id === this.session.clientId);
  }

  parseMessage(rawData) {
    try {
      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      return parsed;
    } catch (error) {
      console.error('Cannot parse WebSocket message:', error, rawData);
      return null;
    }
  }

  isPresenceMessage(message) {
    return PRESENCE_TYPES.has(normalizeType(message.type));
  }

  sendMessage(data) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      if (data?.type !== 'draw') {
        this.ui.addChatMessage('Нет соединения с сервером', 'server');
      }
      return false;
    }

    try {
      this.socket.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Cannot send WebSocket message:', error);
      this.ui.addChatMessage('Ошибка при отправке сообщения', 'server');
      return false;
    }
  }

  getSession() {
    return this.session;
  }
}

/* ===== events.js ===== */
/**
 * events.js
 *
 * Слой DOM-событий.
 *
 * Этот класс связывает действия пользователя с локальной отрисовкой и
 * отправкой намерений на backend.
 *
 * Важно: frontend больше не отправляет доверенные поля:
 * - clientId;
 * - nickname;
 * - users count;
 * - room membership;
 * - признак успешной очистки доски.
 *
 * Frontend отправляет только пользовательское намерение:
 * - "я хочу нарисовать линию";
 * - "я хочу отправить сообщение";
 * - "я хочу очистить доску".
 *
 * Backend должен проверить, нормализовать и разослать финальное событие.
 */

class EventHandler {
  constructor(ui, canvasHandler, wsHandler) {
    this.ui = ui;
    this.canvasHandler = canvasHandler;
    this.wsHandler = wsHandler;
  }

  init() {
    this.initDrawingEvents();
    this.initToolEvents();
    this.initChatEvents();
    this.initBrushPreviewEvents();
    this.initChatCollapseEvent();
  }

  initDrawingEvents() {
    this.ui.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();

      this.canvasHandler.isDrawing = true;
      this.canvasHandler.lastPoint = this.canvasHandler.getPoint(event);
      this.ui.canvas.setPointerCapture(event.pointerId);
    });

    this.ui.canvas.addEventListener('pointermove', (event) => {
      if (!this.canvasHandler.isDrawing || !this.canvasHandler.lastPoint) {
        return;
      }

      event.preventDefault();

      const currentPoint = this.canvasHandler.getPoint(event);

      // Payload содержит только данные самого действия рисования.
      // Кто рисует и в какой комнате — backend знает из WebSocket-сессии.
      const payload = {
        x0: this.canvasHandler.lastPoint.x,
        y0: this.canvasHandler.lastPoint.y,
        x1: currentPoint.x,
        y1: currentPoint.y,
        color: this.ui.colorInput.value,
        size: Number(this.ui.sizeInput.value),
        tool: this.canvasHandler.getTool(),
      };

      // Optimistic UI: пользователь сразу видит свою линию без задержки сети.
      // Backend всё равно должен провалидировать событие и разослать его другим.
      // Когда backend пришлёт это же draw-событие обратно с sender.id,
      // WebSocketHandler пропустит его для текущего пользователя, чтобы не рисовать дубль.
      this.canvasHandler.drawLine(
        payload.x0,
        payload.y0,
        payload.x1,
        payload.y1,
        payload.color,
        payload.size,
        payload.tool,
      );

      this.wsHandler.sendMessage({
        type: 'draw',
        payload,
      });

      this.canvasHandler.lastPoint = currentPoint;
    });

    const finishDrawing = (event) => {
      this.canvasHandler.isDrawing = false;
      this.canvasHandler.lastPoint = null;

      if (event?.pointerId !== undefined && this.ui.canvas.hasPointerCapture(event.pointerId)) {
        this.ui.canvas.releasePointerCapture(event.pointerId);
      }
    };

    this.ui.canvas.addEventListener('pointerup', finishDrawing);
    this.ui.canvas.addEventListener('pointercancel', finishDrawing);
    this.ui.canvas.addEventListener('lostpointercapture', finishDrawing);
  }

  initToolEvents() {
    this.ui.penButton.addEventListener('click', () => {
      this.canvasHandler.setTool('pen');
      this.ui.penButton.classList.add('active');
      this.ui.eraserButton.classList.remove('active');
      this.updateBrushPreview();
    });

    this.ui.eraserButton.addEventListener('click', () => {
      this.canvasHandler.setTool('eraser');
      this.ui.eraserButton.classList.add('active');
      this.ui.penButton.classList.remove('active');
      this.updateBrushPreview();
    });

    this.ui.clearButton.addEventListener('click', () => {
      // Раньше frontend чистил canvas сразу. Это было неверно архитектурно:
      // если backend потом запретит clear или соединение отвалится, локальное
      // состояние будет отличаться от серверного.
      // Теперь frontend отправляет запрос и ждёт server-authoritative событие clear.
      this.wsHandler.sendMessage({ type: 'clear' });
    });

    this.ui.saveButton.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = 'whiteboard.png';
      link.href = this.canvasHandler.exportPng();
      link.click();
    });
  }

  initChatEvents() {
    const sendChatMessage = () => {
      const text = this.ui.chatInput.value.trim();

      if (!text) {
        return;
      }

      // Frontend больше не подставляет nickname/clientId.
      // Backend обязан взять sender из текущего WebSocket-соединения.
      if (this.wsHandler.sendMessage({ type: 'chat', payload: { text } })) {
        // Не добавляем сообщение в чат сразу как успешное.
        // Финальное chat-событие должен прислать backend.
        this.ui.chatInput.value = '';
        this.ui.chatInput.focus();
      }
    };

    this.ui.chatSendButton.addEventListener('click', sendChatMessage);
    this.ui.chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        sendChatMessage();
      }
    });
  }

  initBrushPreviewEvents() {
    this.ui.colorInput.addEventListener('input', () => this.updateBrushPreview());
    this.ui.sizeInput.addEventListener('input', () => this.updateBrushPreview());
    this.updateBrushPreview();
  }

  initChatCollapseEvent() {
    this.ui.chatHeader.addEventListener('click', () => {
      this.ui.chatPanel.classList.toggle('collapsed');
      this.ui.chatToggle.textContent = this.ui.chatPanel.classList.contains('collapsed') ? '+' : '−';
    });
  }

  updateBrushPreview() {
    this.ui.updateBrushPreview(
      this.ui.colorInput.value,
      Number(this.ui.sizeInput.value),
      this.canvasHandler.getTool(),
    );
  }
}

/* ===== app.js ===== */
/**
 * app.js
 *
 * Точка входа фронтенда.
 *
 * Главная ответственность этого файла — собрать приложение из независимых модулей:
 * UI, CanvasHandler, WebSocketHandler и EventHandler.
 *
 * Важно: frontend больше не генерирует доверенный clientId.
 * clientId должен выдать backend после успешного join/session handshake.
 */


const DEFAULT_CURSOR_COLORS = [
  '#7c3aed',
  '#2563eb',
  '#0891b2',
  '#16a34a',
  '#f59e0b',
  '#ef4444',
  '#db2777',
  '#111827',
];

/**
 * Создаёт локальный fallback nickname.
 *
 * Это НЕ доверенная идентичность пользователя.
 * Это только удобное имя, которое frontend предлагает backend-у.
 * Backend обязан нормализовать nickname: trim, длина, пустые значения, дубли.
 */
function createFallbackNickname() {
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 4)
    : Math.random().toString(16).slice(2, 6);

  return `User-${randomPart}`;
}

function createFallbackCursorColor() {
  const index = Math.floor(Math.random() * DEFAULT_CURSOR_COLORS.length);
  return DEFAULT_CURSOR_COLORS[index];
}

/**
 * Читает roomId из URL.
 *
 * Frontend может попросить подключить пользователя к комнате,
 * но backend должен сам решить: существует ли комната, есть ли доступ,
 * нужно ли создать комнату или вернуть ошибку.
 */
function getRequestedRoomId() {
  const roomId = new URLSearchParams(window.location.search).get('room');
  return roomId?.trim() || 'main';
}

/**
 * Запрашивает стартовые настройки пользователя через кастомное окно.
 *
 * Это UX-операция, а не security/business-логика.
 * Финальные nickname/color придут от backend-а в событии session/presence.
 */
async function askJoinOptions(ui) {
  return ui.openJoinDialog({
    nickname: createFallbackNickname(),
    color: createFallbackCursorColor(),
  });
}

async function init() {
  const ui = new UI();
  const canvasHandler = new CanvasHandler(ui.canvas);
  const joinOptions = await askJoinOptions(ui);

  const wsHandler = new WebSocketHandler(ui, canvasHandler, {
    requestedNickname: joinOptions.nickname,
    requestedCursorColor: joinOptions.color,
    requestedRoomId: getRequestedRoomId(),
  });
  const eventHandler = new EventHandler(ui, canvasHandler, wsHandler);

  // Первичный UI-state до подтверждения backend-а.
  ui.setCurrentUser('подключение...');

  canvasHandler.resizeCanvas();
  eventHandler.init();
  wsHandler.connect();

  // Canvas зависит от размера viewport/container, поэтому на resize нужно пересчитать
  // физический размер canvas и сохранить уже нарисованное содержимое.
  window.addEventListener('resize', () => {
    canvasHandler.resizeCanvas();
  });
}

init().catch((error) => {
  console.error('Cannot initialize app:', error);
});
