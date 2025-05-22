import { Socket } from 'socket.io';
import { logger } from './logger';
import { Room, Participant } from './types';

/**
 * Менеджер комнат для видеозвонков
 */
export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  /**
   * Создание новой комнаты
   */
  createRoom(roomId: string): Room {
    if (this.rooms.has(roomId)) {
      throw new Error(`Комната ${roomId} уже существует`);
    }

    const room: Room = {
      id: roomId,
      participants: new Map(),
      createdAt: new Date()
    };

    this.rooms.set(roomId, room);
    logger.info(`Создана новая комната: ${roomId}`);
    return room;
  }

  /**
   * Получение комнаты по ID
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Добавление участника в комнату
   */
  addParticipant(roomId: string, socket: Socket, userId: string, displayName?: string): void {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Комната ${roomId} не найдена`);
    }

    const participant: Participant = {
      userId,
      displayName,
      socket,
      producers: new Map(),
      consumers: new Map(),
      joinedAt: new Date()
    };

    room.participants.set(userId, participant);
    logger.info(`Участник ${userId} присоединился к комнате ${roomId}`);

    // Оповещаем других участников
    this.broadcastToRoom(room, {
      type: 'participantJoined',
      userId,
      displayName
    }, [socket.id]);
  }

  /**
   * Удаление участника из комнаты
   */
  removeParticipant(roomId: string, userId: string): void {
    const room = this.getRoom(roomId);
    if (!room) return;

    const participant = room.participants.get(userId);
    if (!participant) return;

    // Оповещаем других участников
    this.broadcastToRoom(room, {
      type: 'participantLeft',
      userId
    }, [participant.socket.id]);

    // Удаляем участника
    room.participants.delete(userId);
    logger.info(`Участник ${userId} покинул комнату ${roomId}`);

    // Если комната пуста, удаляем её
    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
      logger.info(`Комната ${roomId} удалена (нет участников)`);
    }
  }

  /**
   * Отправка сообщения всем участникам комнаты
   */
  private broadcastToRoom(room: Room, message: any, excludeSocketIds: string[] = []): void {
    for (const participant of room.participants.values()) {
      if (!excludeSocketIds.includes(participant.socket.id)) {
        participant.socket.emit('message', message);
      }
    }
  }

  /**
   * Получение списка всех комнат
   */
  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Получение количества участников в комнате
   */
  getParticipantCount(roomId: string): number {
    return this.getRoom(roomId)?.participants.size ?? 0;
  }
} 