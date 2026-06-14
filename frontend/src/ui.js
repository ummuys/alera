/**
 * ui.js
 *
 * DOM/UI layer.
 *
 * It does not own backend state. It only renders:
 * - staged room wizard;
 * - connection status;
 * - current user;
 * - online users;
 * - chat;
 * - brush preview.
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
    this.joinTitle = this.getRequiredElement('joinTitle');
    this.joinSubtitle = this.getRequiredElement('joinSubtitle');
    this.wizardGlobalStatus = this.getRequiredElement('wizardGlobalStatus');

    this.wizardDotAction = this.getRequiredElement('wizardDotAction');
    this.wizardDotRoom = this.getRequiredElement('wizardDotRoom');
    this.wizardDotProfile = this.getRequiredElement('wizardDotProfile');
    this.wizardStepAction = this.getRequiredElement('wizardStepAction');
    this.wizardStepCreate = this.getRequiredElement('wizardStepCreate');
    this.wizardStepJoin = this.getRequiredElement('wizardStepJoin');
    this.wizardStepProfile = this.getRequiredElement('wizardStepProfile');

    this.actionCreateButton = this.getRequiredElement('actionCreateButton');
    this.actionJoinButton = this.getRequiredElement('actionJoinButton');

    this.createRoomBackButton = this.getRequiredElement('createRoomBackButton');
    this.createRoomNameInput = this.getRequiredElement('createRoomNameInput');
    this.createRoomCapacityInput = this.getRequiredElement('createRoomCapacityInput');
    this.createRoomPrivateInput = this.getRequiredElement('createRoomPrivateInput');
    this.createRoomButton = this.getRequiredElement('createRoomButton');

    this.joinRoomBackButton = this.getRequiredElement('joinRoomBackButton');
    this.joinRoomNextButton = this.getRequiredElement('joinRoomNextButton');
    this.joinRoomStatus = this.getRequiredElement('joinRoomStatus');
    this.joinRoomsList = this.getRequiredElement('joinRoomsList');
    this.refreshRoomsButton = this.getRequiredElement('refreshRoomsButton');

    this.profileBackButton = this.getRequiredElement('profileBackButton');
    this.selectedRoomSummary = this.getRequiredElement('selectedRoomSummary');
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

  setCurrentUser(nickname) {
    this.chatNickname.textContent = nickname || '';
  }

  openJoinDialog(defaults = {}) {
    const fallbackNickname = String(defaults.nickname || 'User').trim() || 'User';
    const fallbackColor = this.normalizeHexColor(defaults.color, '#7c3aed');
    const preferredRoomId = String(defaults.roomId || '').trim();
    const loadRooms = defaults.loadRooms;
    const createRoom = defaults.createRoom;
    const deleteRoom = defaults.deleteRoom;

    let rooms = [];
    let selectedRoomId = preferredRoomId;
    let selectedRoom = null;
    let actionMode = '';
    let currentStep = 'action';
    let isBusy = false;

    this.joinNicknameInput.value = fallbackNickname;
    this.joinCursorColorInput.value = fallbackColor;
    this.createRoomNameInput.value = '';
    this.createRoomCapacityInput.value = '10';
    this.createRoomPrivateInput.checked = false;
    this.updateJoinCursorColor(fallbackColor);
    this.renderJoinColorPalette(fallbackColor);
    this.renderJoinRoomsList([], selectedRoomId);
    this.setJoinRoomStatus('Комнаты ещё не загружены');
    this.setWizardGlobalStatus('');
    this.renderSelectedRoomSummary(null);
    this.showWizardStep('action');

    this.joinOverlay.hidden = false;
    this.joinOverlay.classList.add('visible');
    document.body.classList.add('join-dialog-open');

    const setBusy = (value) => {
      isBusy = Boolean(value);
      this.actionCreateButton.disabled = isBusy;
      this.actionJoinButton.disabled = isBusy;
      this.refreshRoomsButton.disabled = isBusy;
      this.createRoomButton.disabled = isBusy;
      this.joinRoomNextButton.disabled = isBusy;
      this.createRoomBackButton.disabled = isBusy;
      this.joinRoomBackButton.disabled = isBusy;
      this.profileBackButton.disabled = isBusy;
      this.joinForm.querySelector('.join-submit[type="submit"]').disabled = isBusy;
    };

    const selectRoom = (roomId) => {
      selectedRoomId = String(roomId || '').trim();
      selectedRoom = rooms.find((room) => room.id === selectedRoomId) || null;
      this.renderJoinRoomsList(rooms, selectedRoomId);
      this.renderSelectedRoomSummary(selectedRoom || { id: selectedRoomId, name: selectedRoomId });

      if (selectedRoom) {
        this.setJoinRoomStatus(`Выбрана комната «${selectedRoom.name}»`);
      }
    };

    const showActionStep = () => {
      actionMode = '';
      currentStep = 'action';
      this.setWizardGlobalStatus('');
      this.showWizardStep('action');
    };

    const showCreateStep = () => {
      actionMode = 'create';
      currentStep = 'create';
      this.setWizardGlobalStatus('');
      this.showWizardStep('create');
      window.setTimeout(() => this.createRoomNameInput.focus(), 0);
    };

    const showJoinStep = async () => {
      actionMode = 'join';
      currentStep = 'join';
      this.setWizardGlobalStatus('');
      this.showWizardStep('join');
      await reloadRooms();
    };

    const showProfileStep = () => {
      if (!selectedRoomId) {
        this.setWizardGlobalStatus('Сначала выберите или создайте комнату');
        return;
      }

      currentStep = 'profile';
      this.renderSelectedRoomSummary(selectedRoom || { id: selectedRoomId, name: selectedRoomId });
      this.setWizardGlobalStatus('');
      this.showWizardStep('profile');
      window.setTimeout(() => {
        this.joinNicknameInput.focus();
        this.joinNicknameInput.select();
      }, 0);
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
          selectedRoomId = preferredRoomId && rooms.some((room) => room.id === preferredRoomId)
            ? preferredRoomId
            : rooms[0]?.id || '';
        }

        selectedRoom = rooms.find((room) => room.id === selectedRoomId) || null;
        this.renderJoinRoomsList(rooms, selectedRoomId);
        this.renderSelectedRoomSummary(selectedRoom);

        if (rooms.length === 0) {
          this.setJoinRoomStatus('Комнат пока нет. Вернитесь назад и создайте первую комнату.');
        } else if (preferredRoomId && !rooms.some((room) => room.id === preferredRoomId)) {
          this.setJoinRoomStatus('Комната из URL не найдена. Выберите другую комнату.');
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
        this.setWizardGlobalStatus('Функция создания комнаты не передана');
        return;
      }

      const name = this.createRoomNameInput.value.trim();
      const userCapacity = Number(this.createRoomCapacityInput.value) || 10;
      const isPrivate = this.createRoomPrivateInput.checked;

      setBusy(true);
      this.setWizardGlobalStatus('Создание комнаты...');

      try {
        const createdRoom = await createRoom({ name, userCapacity, private: isPrivate });

        rooms = [createdRoom, ...rooms.filter((room) => room.id !== createdRoom.id)];
        selectedRoomId = createdRoom.id;
        selectedRoom = createdRoom;

        this.createRoomNameInput.value = '';
        this.createRoomCapacityInput.value = '10';
        this.createRoomPrivateInput.checked = false;
        this.renderJoinRoomsList(rooms, selectedRoomId);
        this.renderSelectedRoomSummary(createdRoom);
        this.setWizardGlobalStatus(`Комната «${createdRoom.name}» создана`);
        showProfileStep();
      } catch (error) {
        console.error('Cannot create room:', error);
        this.setWizardGlobalStatus(`Не удалось создать комнату: ${error.message}`);
      } finally {
        setBusy(false);
      }
    };

    const handleDeleteRoom = async (roomId) => {
      if (typeof deleteRoom !== 'function') {
        this.setJoinRoomStatus('Функция удаления комнаты не передана');
        return;
      }

      const room = rooms.find((item) => item.id === roomId);
      const roomName = room?.name || roomId;

      if (!window.confirm(`Удалить комнату «${roomName}»?`)) {
        return;
      }

      setBusy(true);
      this.setJoinRoomStatus(`Удаление комнаты «${roomName}»...`);

      try {
        await deleteRoom(roomId);
        rooms = rooms.filter((item) => item.id !== roomId);

        if (selectedRoomId === roomId) {
          selectedRoomId = rooms[0]?.id || '';
          selectedRoom = rooms.find((item) => item.id === selectedRoomId) || null;
        }

        this.renderJoinRoomsList(rooms, selectedRoomId);
        this.renderSelectedRoomSummary(selectedRoom);
        this.setJoinRoomStatus(rooms.length > 0 ? `Комната «${roomName}» удалена` : 'Комнат пока нет');
      } catch (error) {
        console.error('Cannot delete room:', error);
        this.setJoinRoomStatus(`Не удалось удалить комнату: ${error.message}`);
      } finally {
        setBusy(false);
      }
    };

    const dialogPromise = new Promise((resolve) => {
      const handleSubmit = (event) => {
        event.preventDefault();

        if (isBusy) {
          return;
        }

        if (!selectedRoomId) {
          this.setWizardGlobalStatus('Сначала выберите или создайте комнату');
          return;
        }

        const nickname = this.joinNicknameInput.value.trim() || fallbackNickname;
        const color = this.normalizeHexColor(this.joinCursorColorInput.value, fallbackColor);
        const finalRoom = selectedRoom || rooms.find((room) => room.id === selectedRoomId);

        cleanup();
        this.joinOverlay.classList.remove('visible');
        this.joinOverlay.hidden = true;
        document.body.classList.remove('join-dialog-open');

        resolve({
          nickname,
          color,
          roomId: selectedRoomId,
          roomName: finalRoom?.name || selectedRoomId,
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
        const deleteButton = event.target.closest('[data-delete-room-id]');

        if (deleteButton) {
          event.preventDefault();
          event.stopPropagation();
          handleDeleteRoom(deleteButton.dataset.deleteRoomId);
          return;
        }

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

      const handleJoinNext = () => {
        if (!selectedRoomId) {
          this.setJoinRoomStatus('Сначала выберите комнату');
          return;
        }

        showProfileStep();
      };

      const handleProfileBack = () => {
        if (actionMode === 'create') {
          showCreateStep();
          return;
        }

        if (actionMode === 'join') {
          currentStep = 'join';
          this.showWizardStep('join');
          return;
        }

        showActionStep();
      };

      const cleanup = () => {
        this.joinForm.removeEventListener('submit', handleSubmit);
        this.joinCursorColorInput.removeEventListener('input', handleColorInput);
        this.joinColorPalette.removeEventListener('click', handlePaletteClick);
        this.joinRoomsList.removeEventListener('click', handleRoomsClick);
        this.refreshRoomsButton.removeEventListener('click', reloadRooms);
        this.createRoomButton.removeEventListener('click', handleCreateRoom);
        this.createRoomNameInput.removeEventListener('keydown', handleCreateRoomKeydown);
        this.actionCreateButton.removeEventListener('click', showCreateStep);
        this.actionJoinButton.removeEventListener('click', showJoinStep);
        this.createRoomBackButton.removeEventListener('click', showActionStep);
        this.joinRoomBackButton.removeEventListener('click', showActionStep);
        this.joinRoomNextButton.removeEventListener('click', handleJoinNext);
        this.profileBackButton.removeEventListener('click', handleProfileBack);
      };

      this.joinForm.addEventListener('submit', handleSubmit);
      this.joinCursorColorInput.addEventListener('input', handleColorInput);
      this.joinColorPalette.addEventListener('click', handlePaletteClick);
      this.joinRoomsList.addEventListener('click', handleRoomsClick);
      this.refreshRoomsButton.addEventListener('click', reloadRooms);
      this.createRoomButton.addEventListener('click', handleCreateRoom);
      this.createRoomNameInput.addEventListener('keydown', handleCreateRoomKeydown);
      this.actionCreateButton.addEventListener('click', showCreateStep);
      this.actionJoinButton.addEventListener('click', showJoinStep);
      this.createRoomBackButton.addEventListener('click', showActionStep);
      this.joinRoomBackButton.addEventListener('click', showActionStep);
      this.joinRoomNextButton.addEventListener('click', handleJoinNext);
      this.profileBackButton.addEventListener('click', handleProfileBack);
    });

    window.setTimeout(() => this.actionCreateButton.focus(), 0);

    return dialogPromise;
  }

  showWizardStep(step) {
    const normalizedStep = String(step || 'action');
    const titles = {
      action: 'Что сделать?',
      create: 'Создать комнату',
      join: 'Присоединиться к комнате',
      profile: 'Последний шаг',
    };

    const subtitles = {
      action: 'Сначала выберите действие. После этого откроется следующий шаг.',
      create: 'Создайте комнату через HTTP endpoint, затем frontend перейдёт к настройке профиля.',
      join: 'Выберите комнату из списка. Список приходит с backend через GET /api/v1/room.',
      profile: 'Введите nickname и цвет курсора. После отправки формы откроется WebSocket комнаты.',
    };

    this.joinTitle.textContent = titles[normalizedStep] || titles.action;
    this.joinSubtitle.textContent = subtitles[normalizedStep] || subtitles.action;

    this.wizardStepAction.classList.toggle('active', normalizedStep === 'action');
    this.wizardStepCreate.classList.toggle('active', normalizedStep === 'create');
    this.wizardStepJoin.classList.toggle('active', normalizedStep === 'join');
    this.wizardStepProfile.classList.toggle('active', normalizedStep === 'profile');

    this.wizardDotAction.classList.toggle('active', normalizedStep === 'action');
    this.wizardDotRoom.classList.toggle('active', normalizedStep === 'create' || normalizedStep === 'join');
    this.wizardDotProfile.classList.toggle('active', normalizedStep === 'profile');
  }

  setWizardGlobalStatus(message) {
    this.wizardGlobalStatus.textContent = message || '';
    this.wizardGlobalStatus.hidden = !message;
  }

  setJoinRoomStatus(message) {
    this.joinRoomStatus.textContent = message || '';
  }

  renderSelectedRoomSummary(room) {
    this.selectedRoomSummary.innerHTML = '';

    if (!room?.id) {
      this.selectedRoomSummary.textContent = 'Комната ещё не выбрана';
      return;
    }

    const title = document.createElement('div');
    title.className = 'selected-room-title';
    title.textContent = room.name || room.id;

    const meta = document.createElement('div');
    meta.className = 'selected-room-meta';
    meta.textContent = [
      `id: ${room.id}`,
      room.userCapacity > 0 ? `лимит: ${room.userCapacity}` : '',
      room.private ? 'private' : 'public',
    ].filter(Boolean).join(' · ');

    this.selectedRoomSummary.append(title, meta);
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
      const row = document.createElement('div');
      row.className = 'join-room-row';

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

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'join-room-delete-button';
      deleteButton.dataset.deleteRoomId = room.id;
      deleteButton.title = `Удалить комнату ${room.name || room.id}`;
      deleteButton.textContent = 'Удалить';

      row.append(button, deleteButton);
      this.joinRoomsList.appendChild(row);
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
