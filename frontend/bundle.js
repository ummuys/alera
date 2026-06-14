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
 * - lobby комнат: список, создание, выбор;
 * - отображение текущего пользователя;
 * - отображение online users;
 * - отображение сообщений чата;
 * - обновление preview кисти.
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

    this.joinRoomStatus = this.getRequiredElement('joinRoomStatus');
    this.joinRoomsList = this.getRequiredElement('joinRoomsList');
    this.refreshRoomsButton = this.getRequiredElement('refreshRoomsButton');
    this.createRoomNameInput = this.getRequiredElement('createRoomNameInput');
    this.createRoomCapacityInput = this.getRequiredElement('createRoomCapacityInput');
    this.createRoomPrivateInput = this.getRequiredElement('createRoomPrivateInput');
    this.createRoomButton = this.getRequiredElement('createRoomButton');

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

  setCurrentUser(nickname) {
    this.chatNickname.textContent = nickname || '';
  }

  openJoinDialog(defaults = {}) {
    const fallbackNickname = String(defaults.nickname || 'User').trim() || 'User';
    const fallbackColor = this.normalizeHexColor(defaults.color, '#7c3aed');
    const preferredRoomId = String(defaults.roomId || '').trim();
    const loadRooms = defaults.loadRooms;
    const createRoom = defaults.createRoom;

    let rooms = [];
    let selectedRoomId = preferredRoomId;
    let isBusy = false;

    this.joinNicknameInput.value = fallbackNickname;
    this.joinCursorColorInput.value = fallbackColor;
    this.createRoomNameInput.value = '';
    this.createRoomCapacityInput.value = '10';
    this.createRoomPrivateInput.checked = false;
    this.updateJoinCursorColor(fallbackColor);
    this.renderJoinColorPalette(fallbackColor);
    this.renderJoinRoomsList([], selectedRoomId);
    this.setJoinRoomStatus('Загрузка комнат...');

    this.joinOverlay.hidden = false;
    this.joinOverlay.classList.add('visible');
    document.body.classList.add('join-dialog-open');

    const setBusy = (value) => {
      isBusy = Boolean(value);
      this.refreshRoomsButton.disabled = isBusy;
      this.createRoomButton.disabled = isBusy;
      this.joinForm.querySelector('.join-submit').disabled = isBusy;
    };

    const selectRoom = (roomId) => {
      selectedRoomId = String(roomId || '').trim();
      this.renderJoinRoomsList(rooms, selectedRoomId);
    };

    const reloadRooms = async () => {
      if (typeof loadRooms !== 'function') {
        this.setJoinRoomStatus('Функция загрузки комнат не передана');
        return;
      }

      setBusy(true);
      this.setJoinRoomStatus('Загрузка комнат...');

      try {
        rooms = await loadRooms();

        const selectedExists = rooms.some((room) => room.id === selectedRoomId);

        if (!selectedExists) {
          selectedRoomId = rooms[0]?.id || '';
        }

        this.renderJoinRoomsList(rooms, selectedRoomId);

        if (rooms.length === 0) {
          this.setJoinRoomStatus('Комнат пока нет. Создайте первую комнату.');
        } else if (preferredRoomId && !rooms.some((room) => room.id === preferredRoomId)) {
          this.setJoinRoomStatus('Комната из URL не найдена. Выберите другую или создайте новую.');
        } else {
          this.setJoinRoomStatus(`Доступно комнат: ${rooms.length}`);
        }
      } catch (error) {
        console.error('Cannot load rooms:', error);
        this.setJoinRoomStatus(`Не удалось загрузить комнаты: ${error.message}`);
        this.renderJoinRoomsList([], selectedRoomId);
      } finally {
        setBusy(false);
      }
    };

    const handleCreateRoom = async () => {
      if (typeof createRoom !== 'function') {
        this.setJoinRoomStatus('Функция создания комнаты не передана');
        return;
      }

      const name = this.createRoomNameInput.value.trim();
      const userCapacity = Number(this.createRoomCapacityInput.value) || 10;
      const isPrivate = this.createRoomPrivateInput.checked;

      setBusy(true);
      this.setJoinRoomStatus('Создание комнаты...');

      try {
        const createdRoom = await createRoom({ name, userCapacity, private: isPrivate });

        rooms = [createdRoom, ...rooms.filter((room) => room.id !== createdRoom.id)];
        selectedRoomId = createdRoom.id;

        this.createRoomNameInput.value = '';
        this.createRoomCapacityInput.value = '10';
        this.createRoomPrivateInput.checked = false;
        this.renderJoinRoomsList(rooms, selectedRoomId);
        this.setJoinRoomStatus(`Комната «${createdRoom.name}» создана и выбрана`);
      } catch (error) {
        console.error('Cannot create room:', error);
        this.setJoinRoomStatus(`Не удалось создать комнату: ${error.message}`);
      } finally {
        setBusy(false);
      }
    };

    window.setTimeout(() => {
      this.joinNicknameInput.focus();
      this.joinNicknameInput.select();
    }, 0);

    const dialogPromise = new Promise((resolve) => {
      const handleSubmit = (event) => {
        event.preventDefault();

        if (isBusy) {
          return;
        }

        if (!selectedRoomId) {
          this.setJoinRoomStatus('Сначала выберите или создайте комнату');
          return;
        }

        const selectedRoom = rooms.find((room) => room.id === selectedRoomId);
        const nickname = this.joinNicknameInput.value.trim() || fallbackNickname;
        const color = this.normalizeHexColor(this.joinCursorColorInput.value, fallbackColor);

        cleanup();
        this.joinOverlay.classList.remove('visible');
        this.joinOverlay.hidden = true;
        document.body.classList.remove('join-dialog-open');

        resolve({
          nickname,
          color,
          roomId: selectedRoomId,
          roomName: selectedRoom?.name || selectedRoomId,
        });
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

      const handleRoomsClick = (event) => {
        const button = event.target.closest('[data-room-id]');

        if (!button) {
          return;
        }

        selectRoom(button.dataset.roomId);
      };

      const handleCreateRoomKeydown = (event) => {
        if (event.key !== 'Enter') {
          return;
        }

        event.preventDefault();
        handleCreateRoom();
      };

      const cleanup = () => {
        this.joinForm.removeEventListener('submit', handleSubmit);
        this.joinCursorColorInput.removeEventListener('input', handleColorInput);
        this.joinColorPalette.removeEventListener('click', handlePaletteClick);
        this.joinRoomsList.removeEventListener('click', handleRoomsClick);
        this.refreshRoomsButton.removeEventListener('click', reloadRooms);
        this.createRoomButton.removeEventListener('click', handleCreateRoom);
        this.createRoomNameInput.removeEventListener('keydown', handleCreateRoomKeydown);
      };

      this.joinForm.addEventListener('submit', handleSubmit);
      this.joinCursorColorInput.addEventListener('input', handleColorInput);
      this.joinColorPalette.addEventListener('click', handlePaletteClick);
      this.joinRoomsList.addEventListener('click', handleRoomsClick);
      this.refreshRoomsButton.addEventListener('click', reloadRooms);
      this.createRoomButton.addEventListener('click', handleCreateRoom);
      this.createRoomNameInput.addEventListener('keydown', handleCreateRoomKeydown);
    });

    reloadRooms();

    return dialogPromise;
  }

  setJoinRoomStatus(message) {
    this.joinRoomStatus.textContent = message || '';
  }

  renderJoinRoomsList(rooms = [], selectedRoomId = '') {
    this.joinRoomsList.innerHTML = '';

    if (!Array.isArray(rooms) || rooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'join-room-empty';
      empty.textContent = 'Нет доступных комнат';
      this.joinRoomsList.appendChild(empty);
      return;
    }

    rooms.forEach((room) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'join-room-item';
      button.dataset.roomId = room.id;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', room.id === selectedRoomId ? 'true' : 'false');

      if (room.id === selectedRoomId) {
        button.classList.add('selected');
      }

      const title = document.createElement('span');
      title.className = 'join-room-name';
      title.textContent = room.name || room.id;

      const meta = document.createElement('span');
      meta.className = 'join-room-meta';
      meta.textContent = [
        room.userCapacity > 0 ? `лимит: ${room.userCapacity}` : '',
        room.private ? 'private' : 'public',
      ].filter(Boolean).join(' · ');

      button.append(title, meta);
      this.joinRoomsList.appendChild(button);
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

function buildDefaultWsUrl(roomId) {
  const queryUrl = new URLSearchParams(window.location.search).get('ws');

  if (queryUrl) {
    return queryUrl;
  }

  const normalizedRoomId = String(roomId || '').trim();

  if (!normalizedRoomId) {
    throw new Error('roomId is required for WebSocket connection');
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const encodedRoomId = encodeURIComponent(normalizedRoomId);

  if (window.location.protocol === 'file:') {
    return `${protocol}//localhost:8089/api/v1/room/${encodedRoomId}/ws`;
  }

  const host = window.location.host || 'localhost:8089';

  return `${protocol}//${host}/api/v1/room/${encodedRoomId}/ws`;
}

class WebSocketHandler {
  constructor(ui, canvasHandler, options = {}) {
    this.ui = ui;
    this.canvasHandler = canvasHandler;
    this.socket = null;

    // Эти значения — только запрос frontend-а.
    // Backend может изменить nickname, roomId или вернуть ошибку.
    this.requestedNickname = options.requestedNickname || '';
    this.requestedRoomId = options.requestedRoomId || '';
    this.requestedCursorColor = options.requestedCursorColor || '#7c3aed';
    this.wsUrl = options.wsUrl || buildDefaultWsUrl(this.requestedRoomId);

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

        // Комната выбрана URL-ом /api/v1/room/{room_id}/ws.
        // roomId в payload оставлен для совместимости с текущим backend-ом:
        // сейчас backend ещё берёт roomId из join payload при формировании session.
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
      roomId: String(session.roomId || this.requestedRoomId || ''),
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

  isJoined() {
    return Boolean(this.session?.clientId);
  }

  sendMessage(data) {
    const type = normalizeType(data?.type);

    if (this.socket?.readyState !== WebSocket.OPEN) {
      if (type !== 'draw') {
        this.ui.addChatMessage('Нет соединения с сервером', 'server');
      }
      return false;
    }

    if (type !== 'join' && !this.isJoined()) {
      if (type !== 'draw') {
        this.ui.addChatMessage('Сначала дождитесь входа в комнату', 'server');
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

      if (!this.wsHandler.isJoined()) {
        this.canvasHandler.isDrawing = false;
        this.canvasHandler.lastPoint = null;
        this.ui.addChatMessage('Сначала войдите в комнату', 'server');
        return;
      }

      this.canvasHandler.isDrawing = true;
      this.canvasHandler.lastPoint = this.canvasHandler.getPoint(event);
      this.ui.canvas.setPointerCapture(event.pointerId);
    });

    this.ui.canvas.addEventListener('pointermove', (event) => {
      if (!this.wsHandler.isJoined()) {
        this.canvasHandler.isDrawing = false;
        this.canvasHandler.lastPoint = null;
        return;
      }

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
      if (!this.wsHandler.isJoined()) {
        this.ui.addChatMessage('Сначала войдите в комнату', 'server');
        return;
      }

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

      if (!this.wsHandler.isJoined()) {
        this.ui.addChatMessage('Сначала войдите в комнату', 'server');
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
 * Точка входа frontend-а.
 *
 * Новый flow:
 * 1. frontend загружается обычным HTTP;
 * 2. пользователь выбирает существующую комнату или создаёт новую через HTTP API;
 * 3. пользователь вводит nickname/color;
 * 4. frontend открывает WebSocket именно в выбранную комнату:
 *    /api/v1/room/{room_id}/ws;
 * 5. canvas/чат считаются активными только после server message type=session.
 */


const API_BASE = '/api/v1';
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

function getRequestedRoomId() {
  return new URLSearchParams(window.location.search).get('room')?.trim() || '';
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let data = null;

  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`Backend вернул не JSON: ${text}`);
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function normalizeRoom(rawRoom = {}) {
  const id = String(rawRoom.id || rawRoom.ID || '').trim();
  const name = String(rawRoom.name || rawRoom.Name || id || 'Без названия').trim();
  const userCapacity = Number(
    rawRoom.user_capacity
      ?? rawRoom.userCapacity
      ?? rawRoom.UserCapacity
      ?? 0,
  );

  return {
    id,
    name,
    userCapacity: Number.isFinite(userCapacity) ? userCapacity : 0,
    private: Boolean(rawRoom.private ?? rawRoom.Private ?? false),
  };
}

async function loadRooms() {
  const data = await requestJson('/room');
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];

  return rooms
    .map(normalizeRoom)
    .filter((room) => room.id)
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

async function createRoom({ name, userCapacity, private: isPrivate }) {
  const normalizedName = String(name || '').trim();

  if (!normalizedName) {
    throw new Error('Введите название комнаты');
  }

  const normalizedCapacity = Math.max(1, Number(userCapacity) || 10);

  const data = await requestJson('/room', {
    method: 'POST',
    body: JSON.stringify({
      name: normalizedName,
      user_capacity: normalizedCapacity,
      private: Boolean(isPrivate),
    }),
  });

  return normalizeRoom(data);
}

async function askJoinOptions(ui) {
  return ui.openJoinDialog({
    nickname: createFallbackNickname(),
    color: createFallbackCursorColor(),
    roomId: getRequestedRoomId(),
    loadRooms,
    createRoom,
  });
}

async function init() {
  const ui = new UI();
  const canvasHandler = new CanvasHandler(ui.canvas);
  const joinOptions = await askJoinOptions(ui);

  const wsHandler = new WebSocketHandler(ui, canvasHandler, {
    requestedNickname: joinOptions.nickname,
    requestedCursorColor: joinOptions.color,
    requestedRoomId: joinOptions.roomId,
  });

  const eventHandler = new EventHandler(ui, canvasHandler, wsHandler);

  ui.setCurrentUser('подключение...');
  ui.setConnectionStatus('connecting');
  ui.addChatMessage(`Комната: ${joinOptions.roomName || joinOptions.roomId}`, 'server');

  canvasHandler.resizeCanvas();
  eventHandler.init();
  wsHandler.connect();

  window.addEventListener('resize', () => {
    canvasHandler.resizeCanvas();
  });
}

init().catch((error) => {
  console.error('Cannot initialize app:', error);
});
