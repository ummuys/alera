import { DEFAULT_CURSOR_COLORS, TOOL_NAMES } from '../core/constants.js';

export class UI {
  constructor() {
    this.canvas = this.getRequiredElement('board');
    this.overlayCanvas = this.getRequiredElement('boardOverlay');

    this.penButton = this.getRequiredElement('penButton');
    this.markerButton = this.getRequiredElement('markerButton');
    this.lineButton = this.getRequiredElement('lineButton');
    this.rectangleButton = this.getRequiredElement('rectangleButton');
    this.circleButton = this.getRequiredElement('circleButton');
    this.eraserButton = this.getRequiredElement('eraserButton');
    this.fillButton = this.getRequiredElement('fillButton');
    this.pipetteButton = this.getRequiredElement('pipetteButton');
    this.clearButton = this.getRequiredElement('clearButton');
    this.saveButton = this.getRequiredElement('saveButton');
    this.colorInput = this.getRequiredElement('colorInput');
    this.sizeInput = this.getRequiredElement('sizeInput');
    this.sizePresetList = this.getRequiredElement('sizePresetList');
    this.brushDot = this.getRequiredElement('brushDot');
    this.statusDot = this.getRequiredElement('statusDot');
    this.statusText = this.getRequiredElement('statusText');
    this.currentRoomName = this.getRequiredElement('currentRoomName');

    this.chatMessages = this.getRequiredElement('chatMessages');
    this.chatInput = this.getRequiredElement('chatInput');
    this.chatSendButton = this.getRequiredElement('chatSendButton');
    this.chatNickname = this.getRequiredElement('chatNickname');
    this.chatPanel = this.getRequiredElement('chatPanel');
    this.chatToggle = this.getRequiredElement('chatToggle');
    this.chatHeader = this.getRequiredElement('chatHeader');
    this.chatToggleButton = this.getRequiredElement('chatToggleButton');

    this.onlineUsersPanel = this.getRequiredElement('onlineUsersPanel');
    this.onlineUsersList = this.getRequiredElement('onlineUsersList');
    this.usersCount = this.getRequiredElement('usersCount');
    this.usersToggleButton = this.getRequiredElement('usersToggleButton');
    this.usersPanelToggle = this.getRequiredElement('usersPanelToggle');

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

    this.toolButtons = Object.fromEntries(
      TOOL_NAMES.map((toolName) => [toolName, document.getElementById(`${toolName}Button`)]),
    );

    this.cursorPaletteColors = DEFAULT_CURSOR_COLORS.slice();
    this.setTool('pen');
    this.updateOnlineUsersList([]);
    this.setChatCollapsed(true);
    this.setUsersCollapsed(true);
  }

  getRequiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element #${id} not found`);
    }
    return element;
  }

  normalizeHexColor(value, fallback = '#7c3aed') {
    if (typeof value !== 'string') {
      return fallback;
    }

    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toLowerCase();
    }
    return fallback;
  }

  setConnectionStatus(status) {
    const labels = {
      connected: 'в сети',
      connecting: 'подключение…',
      disconnected: 'не в сети',
      error: 'ошибка',
    };

    this.statusDot.classList.toggle('connected', status === 'connected');
    this.statusDot.classList.toggle('error', status === 'error');
    this.statusText.textContent = labels[status] || status;
  }

  setCurrentUser(nickname) {
    this.chatNickname.textContent = nickname || '';
  }

  setRoomName(roomName) {
    this.currentRoomName.textContent = roomName || 'Доска';
  }

  setTool(toolName) {
    TOOL_NAMES.forEach((name) => {
      this.toolButtons[name]?.classList.toggle('active', name === toolName);
    });
  }

  updateBrushPreview(color, size, tool) {
    const normalizedColor = this.normalizeHexColor(color, '#111111');
    const normalizedSize = Math.max(6, Math.min(26, Number(size) || 5));
    this.brushDot.style.width = `${normalizedSize}px`;
    this.brushDot.style.height = `${normalizedSize}px`;
    this.brushDot.style.background = normalizedColor;
    this.brushDot.style.opacity = tool === 'marker' ? '0.45' : '1';
    this.brushDot.style.borderRadius = tool === 'eraser' ? '4px' : '999px';
  }

  syncSizePresetButtons(size) {
    const numericSize = Number(size);
    this.sizePresetList.querySelectorAll('.size-preset').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.size) === numericSize);
    });
  }

  setChatCollapsed(collapsed) {
    this.chatPanel.classList.toggle('collapsed', collapsed);
    this.chatToggle.textContent = collapsed ? '+' : '×';
    this.chatToggleButton.textContent = collapsed ? 'Чат' : 'Скрыть чат';
  }

  toggleChatCollapsed() {
    this.setChatCollapsed(!this.chatPanel.classList.contains('collapsed'));
  }

  setUsersCollapsed(collapsed) {
    this.onlineUsersPanel.classList.toggle('collapsed', collapsed);
    this.usersToggleButton.textContent = collapsed ? 'Участники' : 'Скрыть участников';
    this.usersPanelToggle.textContent = collapsed ? '+' : '×';
  }

  toggleUsersCollapsed() {
    this.setUsersCollapsed(!this.onlineUsersPanel.classList.contains('collapsed'));
  }

  addChatMessage(text, variant = 'server') {
    const message = document.createElement('div');
    message.className = `chat-message ${variant}`;
    message.textContent = String(text || '').trim();

    if (!message.textContent) {
      return;
    }

    this.chatMessages.appendChild(message);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  updateOnlineUsersList(users = []) {
    const normalizedUsers = Array.isArray(users) ? users : [];
    this.usersCount.textContent = String(normalizedUsers.length);
    this.onlineUsersList.innerHTML = '';

    if (normalizedUsers.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'online-user-item';
      empty.innerHTML = '<div class="online-user-meta">Пока никого нет</div>';
      this.onlineUsersList.appendChild(empty);
      return;
    }

    normalizedUsers.forEach((user) => {
      const item = document.createElement('li');
      item.className = 'online-user-item';

      const color = this.normalizeHexColor(user.color || '#7c3aed', '#7c3aed');
      const nickname = String(user.nickname || user.name || 'Пользователь');
      const id = String(user.id || user.clientId || '').trim();

      item.innerHTML = `
        <span class="online-user-color" style="background:${color}"></span>
        <div>
          <div class="online-user-name">${this.escapeHtml(nickname)}</div>
          <div class="online-user-meta">${id ? this.escapeHtml(id.slice(0, 8)) : 'онлайн'}</div>
        </div>
      `;

      this.onlineUsersList.appendChild(item);
    });
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
    let isBusy = false;

    this.joinNicknameInput.value = fallbackNickname;
    this.joinCursorColorInput.value = fallbackColor;
    this.createRoomNameInput.value = '';
    this.createRoomCapacityInput.value = '10';
    this.createRoomPrivateInput.checked = false;
    this.updateJoinCursorColor(fallbackColor);
    this.renderJoinColorPalette(fallbackColor);
    this.renderJoinRoomsList([], selectedRoomId, async () => {}, () => {});
    this.setJoinRoomStatus('Комнаты ещё не загружены');
    this.setWizardGlobalStatus('');
    this.renderSelectedRoomSummary(null);
    this.showWizardStep('action');

    this.joinOverlay.hidden = false;
    document.body.classList.add('join-dialog-open');

    const setBusy = (value) => {
      isBusy = Boolean(value);
      [
        this.actionCreateButton,
        this.actionJoinButton,
        this.refreshRoomsButton,
        this.createRoomButton,
        this.joinRoomNextButton,
        this.createRoomBackButton,
        this.joinRoomBackButton,
        this.profileBackButton,
        this.joinForm.querySelector('.primary-button[type="submit"]'),
      ].forEach((element) => {
        if (element) {
          element.disabled = isBusy;
        }
      });
    };

    const selectRoom = (roomId) => {
      selectedRoomId = String(roomId || '').trim();
      selectedRoom = rooms.find((room) => room.id === selectedRoomId) || null;
      this.renderJoinRoomsList(rooms, selectedRoomId, handleDeleteRoom, selectRoom);
      this.renderSelectedRoomSummary(selectedRoom || { id: selectedRoomId, name: selectedRoomId });
      if (selectedRoom) {
        this.setJoinRoomStatus(`Выбрана «${selectedRoom.name}»`);
      }
    };

    const reloadRooms = async () => {
      if (typeof loadRooms !== 'function') {
        this.setJoinRoomStatus('Не удалось загрузить список комнат');
        return;
      }

      setBusy(true);
      this.setJoinRoomStatus('Загрузка комнат...');

      try {
        rooms = await loadRooms();

        const preferredExists = rooms.some((room) => room.id === preferredRoomId);
        if (!rooms.some((room) => room.id === selectedRoomId)) {
          selectedRoomId = preferredExists ? preferredRoomId : rooms[0]?.id || '';
        }

        selectedRoom = rooms.find((room) => room.id === selectedRoomId) || null;
        this.renderJoinRoomsList(rooms, selectedRoomId, handleDeleteRoom, selectRoom);
        this.renderSelectedRoomSummary(selectedRoom);

        if (rooms.length === 0) {
          this.setJoinRoomStatus('Пока нет ни одной комнаты');
        } else {
          this.setJoinRoomStatus(`Найдено комнат: ${rooms.length}`);
        }
      } catch (error) {
        this.renderJoinRoomsList([], '', handleDeleteRoom, selectRoom);
        this.setJoinRoomStatus(`Ошибка: ${error.message}`);
      } finally {
        setBusy(false);
      }
    };

    const handleDeleteRoom = async (roomId) => {
      if (typeof deleteRoom !== 'function') {
        return;
      }

      setBusy(true);
      this.setJoinRoomStatus('Удаление комнаты...');

      try {
        await deleteRoom(roomId);
        rooms = rooms.filter((room) => room.id !== roomId);
        if (selectedRoomId === roomId) {
          selectedRoomId = rooms[0]?.id || '';
          selectedRoom = rooms.find((room) => room.id === selectedRoomId) || null;
        }
        this.renderJoinRoomsList(rooms, selectedRoomId, handleDeleteRoom, selectRoom);
        this.renderSelectedRoomSummary(selectedRoom);
        this.setJoinRoomStatus('Комната удалена');
        if (typeof loadRooms === 'function') {
          await reloadRooms();
        }
      } catch (error) {
        this.setJoinRoomStatus(`Не удалось удалить комнату: ${error.message}`);
      } finally {
        setBusy(false);
      }
    };

    const showCreateStep = () => {
      this.setWizardGlobalStatus('');
      this.showWizardStep('create');
      window.setTimeout(() => this.createRoomNameInput.focus(), 0);
    };

    const showJoinStep = async () => {
      this.setWizardGlobalStatus('');
      this.showWizardStep('join');
      await reloadRooms();
    };

    const showProfileStep = () => {
      if (!selectedRoomId) {
        this.setWizardGlobalStatus('Сначала выбери комнату');
        return;
      }

      this.setWizardGlobalStatus('');
      this.renderSelectedRoomSummary(selectedRoom || { id: selectedRoomId, name: selectedRoomId });
      this.showWizardStep('profile');
      window.setTimeout(() => this.joinNicknameInput.focus(), 0);
    };

    const handleCreateRoom = async () => {
      if (typeof createRoom !== 'function') {
        this.setWizardGlobalStatus('Не удалось создать комнату');
        return;
      }

      setBusy(true);
      this.setWizardGlobalStatus('Создаём комнату...');

      try {
        const createdRoom = await createRoom({
          name: this.createRoomNameInput.value.trim(),
          userCapacity: Number(this.createRoomCapacityInput.value) || 10,
          private: this.createRoomPrivateInput.checked,
        });

        rooms = [createdRoom, ...rooms.filter((room) => room.id !== createdRoom.id)];
        selectedRoomId = createdRoom.id;
        selectedRoom = createdRoom;
        this.renderJoinRoomsList(rooms, selectedRoomId, handleDeleteRoom, selectRoom);
        this.renderSelectedRoomSummary(createdRoom);
        this.setWizardGlobalStatus('Комната готова');
        this.showWizardStep('profile');
      } catch (error) {
        this.setWizardGlobalStatus(error.message || 'Не удалось создать комнату');
      } finally {
        setBusy(false);
      }
    };

    return new Promise((resolve) => {
      const handleSubmit = (event) => {
        event.preventDefault();

        if (!selectedRoomId) {
          this.setWizardGlobalStatus('Выбери комнату');
          return;
        }

        const nickname = this.joinNicknameInput.value.trim() || fallbackNickname;
        const color = this.normalizeHexColor(this.joinCursorColorInput.value, fallbackColor);

        this.joinOverlay.hidden = true;
        document.body.classList.remove('join-dialog-open');
        resolve({
          nickname,
          color,
          roomId: selectedRoomId,
          roomName: selectedRoom?.name || selectedRoomId,
        });
      };

      this.joinForm.onsubmit = handleSubmit;
      this.actionCreateButton.onclick = showCreateStep;
      this.actionJoinButton.onclick = showJoinStep;
      this.createRoomBackButton.onclick = () => this.showWizardStep('action');
      this.joinRoomBackButton.onclick = () => this.showWizardStep('action');
      this.profileBackButton.onclick = () => this.showWizardStep(selectedRoom ? 'join' : 'action');
      this.createRoomButton.onclick = handleCreateRoom;
      this.joinRoomNextButton.onclick = showProfileStep;
      this.refreshRoomsButton.onclick = reloadRooms;

      this.joinCursorColorInput.oninput = () => {
        this.updateJoinCursorColor(this.joinCursorColorInput.value);
        this.renderJoinColorPalette(this.joinCursorColorInput.value);
      };
    });
  }

  showWizardStep(stepName) {
    const states = {
      action: { dots: [true, false, false], steps: ['wizardStepAction'] },
      create: { dots: [true, true, false], steps: ['wizardStepCreate'] },
      join: { dots: [true, true, false], steps: ['wizardStepJoin'] },
      profile: { dots: [true, true, true], steps: ['wizardStepProfile'] },
    };

    const state = states[stepName] || states.action;

    [this.wizardStepAction, this.wizardStepCreate, this.wizardStepJoin, this.wizardStepProfile].forEach((step) => {
      step.classList.remove('active');
    });

    state.steps.forEach((stepId) => this[stepId]?.classList.add('active'));

    [this.wizardDotAction, this.wizardDotRoom, this.wizardDotProfile].forEach((dot, index) => {
      dot.classList.toggle('active', state.dots[index]);
    });
  }

  renderJoinRoomsList(rooms, selectedRoomId, onDeleteRoom, onSelectRoom) {
    this.joinRoomsList.innerHTML = '';

    rooms.forEach((room) => {
      const item = document.createElement('div');
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.className = `join-room-item${room.id === selectedRoomId ? ' selected' : ''}`;

      const meta = [room.private ? 'private' : 'public'];
      if (room.userCapacity) {
        meta.push(`до ${room.userCapacity}`);
      }

      item.innerHTML = `
        <div class="join-room-row">
          <div>
            <div class="wizard-choice-title">${this.escapeHtml(room.name)}</div>
            <div class="join-room-meta">${meta.map((value) => `<span>${this.escapeHtml(value)}</span>`).join('')}</div>
          </div>
          <button class="join-room-delete-button" type="button">Удалить</button>
        </div>
      `;

      item.addEventListener('click', (event) => {
        if (event.target.closest('.join-room-delete-button')) {
          return;
        }
        this.joinRoomsList.querySelectorAll('.join-room-item').forEach((node) => node.classList.remove('selected'));
        item.classList.add('selected');
        onSelectRoom?.(room.id);
      });

      const deleteButton = item.querySelector('.join-room-delete-button');
      deleteButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        await onDeleteRoom?.(room.id);
      });

      this.joinRoomsList.appendChild(item);
    });
  }

  setJoinRoomStatus(text) {
    this.joinRoomStatus.textContent = text || '';
  }

  setWizardGlobalStatus(text) {
    this.wizardGlobalStatus.textContent = text || '';
  }

  renderSelectedRoomSummary(room) {
    if (!room) {
      this.selectedRoomSummary.textContent = 'Комната ещё не выбрана';
      return;
    }

    const pieces = [room.name || room.id || 'Комната'];
    if (room.userCapacity) {
      pieces.push(`до ${room.userCapacity} участников`);
    }
    this.selectedRoomSummary.textContent = pieces.join(' · ');
  }

  renderJoinColorPalette(selectedColor) {
    const normalizedSelected = this.normalizeHexColor(selectedColor, '#7c3aed');
    this.joinColorPalette.innerHTML = '';

    this.cursorPaletteColors.forEach((color) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `join-color-chip${color === normalizedSelected ? ' active' : ''}`;
      chip.style.background = color;
      chip.addEventListener('click', () => {
        this.joinCursorColorInput.value = color;
        this.updateJoinCursorColor(color);
        this.renderJoinColorPalette(color);
      });
      this.joinColorPalette.appendChild(chip);
    });
  }

  updateJoinCursorColor(color) {
    const normalized = this.normalizeHexColor(color, '#7c3aed');
    this.joinCursorColorPreview.style.background = normalized;
    this.joinCursorColorInput.value = normalized;
  }

  escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
