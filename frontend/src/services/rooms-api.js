import { API_BASE } from '../core/constants.js';
import { normalizeRoom } from '../core/utils.js';

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
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || text || `HTTP ${response.status}`;
    throw new Error(message.trim());
  }

  return data;
}

export async function loadRooms() {
  const data = await requestJson('/room');
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];

  return rooms
    .map(normalizeRoom)
    .filter((room) => room.id)
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

export async function createRoom({ name, userCapacity, private: isPrivate }) {
  const normalizedName = String(name || '').trim();

  if (!normalizedName) {
    throw new Error('Введите название комнаты');
  }

  const normalizedCapacity = Math.max(1, Math.min(100, Number(userCapacity) || 10));

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

export async function deleteRoom(roomId) {
  const normalizedRoomId = String(roomId || '').trim();

  if (!normalizedRoomId) {
    throw new Error('roomId is required');
  }

  await requestJson(`/room/${encodeURIComponent(normalizedRoomId)}`, {
    method: 'DELETE',
  });

  return normalizedRoomId;
}
