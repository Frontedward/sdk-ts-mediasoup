import { Socket } from 'socket.io';
import { logger } from './logger';
import { RoomManager } from './room-manager';
import {
  SignalingMessageUnion,
  SignalingMessageType,
  JoinMessage,
  LeaveMessage,
  NewProducerMessage,
  ProducerClosedMessage,
  TransportConnectMessage,
  TransportProduceMessage,
  TransportConsumeMessage,
  ConnectTransportMessage,
  ConsumeMessage,
  ResumeMessage,
  PauseMessage
} from './types';

/**
 * Обработчик сигналинг-сообщений
 */
export class SignalingHandler {
  constructor(private roomManager: RoomManager) {}

  /**
   * Обработка входящего сообщения
   */
  async handleMessage(socket: Socket, message: SignalingMessageUnion): Promise<void> {
    logger.debug('Получено сообщение:', message);

    switch (message.type) {
      case SignalingMessageType.JOIN:
        await this.handleJoinMessage(socket, message);
        break;

      case SignalingMessageType.LEAVE:
        this.handleLeaveMessage(socket, message);
        break;

      case SignalingMessageType.NEW_PRODUCER:
        await this.handleNewProducerMessage(socket, message);
        break;

      case SignalingMessageType.PRODUCER_CLOSED:
        this.handleProducerClosedMessage(socket, message);
        break;

      case SignalingMessageType.TRANSPORT_CONNECT:
        await this.handleTransportConnectMessage(socket, message);
        break;

      case SignalingMessageType.TRANSPORT_PRODUCE:
        await this.handleTransportProduceMessage(socket, message);
        break;

      case SignalingMessageType.TRANSPORT_CONSUME:
        await this.handleTransportConsumeMessage(socket, message);
        break;

      case SignalingMessageType.CONNECT_TRANSPORT:
        await this.handleConnectTransportMessage(socket, message);
        break;

      case SignalingMessageType.CONSUME:
        await this.handleConsumeMessage(socket, message);
        break;

      case SignalingMessageType.RESUME:
        await this.handleResumeMessage(socket, message);
        break;

      case SignalingMessageType.PAUSE:
        await this.handlePauseMessage(socket, message);
        break;

      default:
        logger.warn('Неизвестный тип сообщения:', message);
        socket.emit('message', {
          type: SignalingMessageType.ERROR,
          error: 'Неизвестный тип сообщения'
        });
    }
  }

  /**
   * Обработка отключения сокета
   */
  handleDisconnect(socket: Socket): void {
    // Находим все комнаты, где был этот сокет
    for (const room of this.roomManager.getAllRooms()) {
      for (const [userId, participant] of room.participants.entries()) {
        if (participant.socket.id === socket.id) {
          this.roomManager.removeParticipant(room.id, userId);
          break;
        }
      }
    }
  }

  /**
   * Обработка сообщения о присоединении
   */
  private async handleJoinMessage(socket: Socket, message: JoinMessage): Promise<void> {
    try {
      const { roomId, userId, displayName } = message;

      // Создаем комнату, если её нет
      let room = this.roomManager.getRoom(roomId);
      if (!room) {
        room = this.roomManager.createRoom(roomId);
      }

      // Добавляем участника
      this.roomManager.addParticipant(roomId, socket, userId, displayName);

      // Отправляем подтверждение
      socket.emit('message', {
        type: SignalingMessageType.JOIN,
        roomId,
        userId,
        displayName
      });

    } catch (error) {
      logger.error('Ошибка при обработке join:', error);
      socket.emit('message', {
        type: SignalingMessageType.ERROR,
        error: error instanceof Error ? error.message : 'Ошибка при присоединении'
      });
    }
  }

  /**
   * Обработка сообщения о выходе
   */
  private handleLeaveMessage(socket: Socket, message: LeaveMessage): void {
    const { roomId, userId } = message;
    this.roomManager.removeParticipant(roomId, userId);
  }

  /**
   * Обработка сообщения о новом producer
   */
  private async handleNewProducerMessage(
    socket: Socket,
    message: NewProducerMessage
  ): Promise<void> {
    const { producerId, userId, kind } = message;
    const room = this.roomManager.getRoom(message.roomId);

    if (!room) {
      throw new Error('Комната не найдена');
    }

    // Оповещаем других участников
    for (const participant of room.participants.values()) {
      if (participant.socket.id !== socket.id) {
        participant.socket.emit('message', {
          type: SignalingMessageType.NEW_PRODUCER,
          producerId,
          userId,
          kind
        });
      }
    }
  }

  /**
   * Обработка сообщения о закрытии producer
   */
  private handleProducerClosedMessage(
    socket: Socket,
    message: ProducerClosedMessage
  ): void {
    const { producerId, userId } = message;
    const room = this.roomManager.getRoom(message.roomId);

    if (!room) {
      throw new Error('Комната не найдена');
    }

    // Оповещаем других участников
    for (const participant of room.participants.values()) {
      if (participant.socket.id !== socket.id) {
        participant.socket.emit('message', {
          type: SignalingMessageType.PRODUCER_CLOSED,
          producerId,
          userId
        });
      }
    }
  }

  /**
   * Обработка сообщения о подключении транспорта
   */
  private async handleTransportConnectMessage(
    socket: Socket,
    message: TransportConnectMessage
  ): Promise<void> {
    // Здесь должна быть логика подключения транспорта к mediasoup
    // Для демо просто отправляем подтверждение
    socket.emit('message', {
      type: SignalingMessageType.TRANSPORT_CONNECT,
      transportId: message.transportId
    });
  }

  /**
   * Обработка сообщения о создании producer
   */
  private async handleTransportProduceMessage(
    socket: Socket,
    message: TransportProduceMessage
  ): Promise<void> {
    // Здесь должна быть логика создания producer в mediasoup
    // Для демо просто отправляем подтверждение
    socket.emit('message', {
      type: SignalingMessageType.TRANSPORT_PRODUCE,
      transportId: message.transportId,
      kind: message.kind
    });
  }

  /**
   * Обработка сообщения о создании consumer
   */
  private async handleTransportConsumeMessage(
    socket: Socket,
    message: TransportConsumeMessage
  ): Promise<void> {
    // Здесь должна быть логика создания consumer в mediasoup
    // Для демо просто отправляем подтверждение
    socket.emit('message', {
      type: SignalingMessageType.TRANSPORT_CONSUME,
      transportId: message.transportId,
      producerId: message.producerId
    });
  }

  /**
   * Обработка сообщения о подключении транспорта
   */
  private async handleConnectTransportMessage(
    socket: Socket,
    message: ConnectTransportMessage
  ): Promise<void> {
    // Здесь должна быть логика подключения транспорта к mediasoup
    // Для демо просто отправляем подтверждение
    socket.emit('message', {
      type: SignalingMessageType.CONNECT_TRANSPORT,
      transportId: message.transportId
    });
  }

  /**
   * Обработка сообщения о создании consumer
   */
  private async handleConsumeMessage(
    socket: Socket,
    message: ConsumeMessage
  ): Promise<void> {
    // Здесь должна быть логика создания consumer в mediasoup
    // Для демо просто отправляем подтверждение
    socket.emit('message', {
      type: SignalingMessageType.CONSUME,
      consumerId: message.consumerId,
      producerId: message.producerId,
      kind: message.kind,
      rtpParameters: message.rtpParameters,
      userId: message.userId
    });
  }

  /**
   * Обработка сообщения о возобновлении consumer
   */
  private async handleResumeMessage(
    socket: Socket,
    message: ResumeMessage
  ): Promise<void> {
    // Здесь должна быть логика возобновления consumer в mediasoup
    // Для демо просто отправляем подтверждение
    socket.emit('message', {
      type: SignalingMessageType.RESUME,
      consumerId: message.consumerId
    });
  }

  /**
   * Обработка сообщения о паузе consumer
   */
  private async handlePauseMessage(
    socket: Socket,
    message: PauseMessage
  ): Promise<void> {
    // Здесь должна быть логика паузы consumer в mediasoup
    // Для демо просто отправляем подтверждение
    socket.emit('message', {
      type: SignalingMessageType.PAUSE,
      consumerId: message.consumerId
    });
  }
} 