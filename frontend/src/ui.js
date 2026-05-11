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
