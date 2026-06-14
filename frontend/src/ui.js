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

export class UI {
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
