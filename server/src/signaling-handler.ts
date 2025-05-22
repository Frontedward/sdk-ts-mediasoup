import { Socket } from 'socket.io';
import { types as mediasoupTypes } from 'mediasoup';
import { logger } from './logger';
import { MediasoupManager } from './mediasoup-manager';
import {
  SignalingMessageType,
  SignalingMessageUnion,
  TransportConnectMessage,
  TransportProduceMessage,
  TransportConsumeMessage,
  ConsumeMessage,
  ResumeMessage,
  PauseMessage,
  JoinMessage,
  LeaveMessage,
  JoinResponse
} from './types';

/**
 * Обработчик сигналинг-сообщений
 */
export class SignalingHandler {
  private mediasoupManager: MediasoupManager;
  private transports: Map<string, mediasoupTypes.WebRtcTransport> = new Map();
  private producers: Map<string, mediasoupTypes.Producer> = new Map();
  private consumers: Map<string, mediasoupTypes.Consumer> = new Map();

  constructor() {
    this.mediasoupManager = new MediasoupManager();
  }

  async init(): Promise<void> {
    await this.mediasoupManager.init();
  }

  /**
   * Обработка входящего сообщения
   */
  async handleMessage(socket: Socket, message: SignalingMessageUnion): Promise<void> {
    try {
      switch (message.type) {
        case SignalingMessageType.JOIN:
          await this.handleJoinMessage(socket, message);
          break;
        case SignalingMessageType.LEAVE:
          await this.handleLeaveMessage(socket, message);
          break;
        case SignalingMessageType.TRANSPORT_CONNECT:
          await this.handleTransportConnectMessage(socket, message as TransportConnectMessage);
          break;
        case SignalingMessageType.TRANSPORT_PRODUCE:
          await this.handleTransportProduceMessage(socket, message as TransportProduceMessage);
          break;
        case SignalingMessageType.TRANSPORT_CONSUME:
          await this.handleTransportConsumeMessage(socket, message as TransportConsumeMessage);
          break;
        case SignalingMessageType.RESUME:
          await this.handleResumeMessage(socket, message as ResumeMessage);
          break;
        case SignalingMessageType.PAUSE:
          await this.handlePauseMessage(socket, message as PauseMessage);
          break;
        default:
          logger.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      logger.error('Error handling message:', error);
      socket.emit('message', {
        type: SignalingMessageType.ERROR,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Обработка отключения сокета
   */
  handleDisconnect(socket: Socket): void {
    // Закрываем все транспорты пользователя
    this.transports.forEach(transport => {
      transport.close();
      this.transports.delete(transport.id);
    });
    logger.info('Client disconnected:', socket.id);
  }

  /**
   * Обработка сообщения о присоединении
   */
  async handleJoinMessage(socket: Socket, message: JoinMessage): Promise<void> {
    try {
      // Создаем WebRTC транспорты для отправки и получения
      const sendTransport = await this.mediasoupManager.createWebRtcTransport();
      const recvTransport = await this.mediasoupManager.createWebRtcTransport();
      
      this.transports.set(sendTransport.id, sendTransport);
      this.transports.set(recvTransport.id, recvTransport);

      // Получаем возможности роутера
      const router = this.mediasoupManager.getRouter();
      
      // Отправляем информацию о транспортах клиенту
      const response: JoinResponse = {
        type: SignalingMessageType.JOIN,
        sendTransportOptions: {
          id: sendTransport.id,
          iceParameters: sendTransport.iceParameters,
          iceCandidates: sendTransport.iceCandidates,
          dtlsParameters: sendTransport.dtlsParameters
        },
        recvTransportOptions: {
          id: recvTransport.id,
          iceParameters: recvTransport.iceParameters,
          iceCandidates: recvTransport.iceCandidates,
          dtlsParameters: recvTransport.dtlsParameters
        },
        rtpCapabilities: router.rtpCapabilities,
        userId: message.userId,
        roomId: message.roomId,
        displayName: message.displayName
      };

      logger.info('Отправляем JOIN response:', {
        sendTransportId: sendTransport.id,
        recvTransportId: recvTransport.id,
        iceParameters: {
          send: sendTransport.iceParameters,
          recv: recvTransport.iceParameters
        },
        iceCandidates: {
          send: sendTransport.iceCandidates.length,
          recv: recvTransport.iceCandidates.length
        }
      });

      socket.emit('message', response);
      logger.info('Client joined:', message.userId);

      // Настраиваем обработчики событий для send транспорта
      sendTransport.on('dtlsstatechange', (dtlsState) => {
        logger.info('Send transport dtls state changed to', dtlsState);
      });

      sendTransport.on('iceselectedtuplechange', (iceSelectedTuple) => {
        logger.info('Send transport ice selected tuple changed:', iceSelectedTuple);
      });

      sendTransport.observer.on('close', () => {
        logger.info('Send transport closed');
        this.transports.delete(sendTransport.id);
      });

      // Настраиваем обработчики событий для receive транспорта
      recvTransport.on('dtlsstatechange', (dtlsState) => {
        logger.info('Receive transport dtls state changed to', dtlsState);
      });

      recvTransport.on('iceselectedtuplechange', (iceSelectedTuple) => {
        logger.info('Receive transport ice selected tuple changed:', iceSelectedTuple);
      });

      recvTransport.observer.on('close', () => {
        logger.info('Receive transport closed');
        this.transports.delete(recvTransport.id);
      });

    } catch (error) {
      logger.error('Error handling join:', error);
      throw error;
    }
  }

  /**
   * Обработка сообщения о выходе
   */
  async handleLeaveMessage(socket: Socket, message: LeaveMessage): Promise<void> {
    // Закрываем все транспорты пользователя
    this.transports.forEach(transport => {
      transport.close();
      this.transports.delete(transport.id);
    });
    logger.info('Client left:', message.userId);
  }

  /**
   * Обработка сообщения о подключении транспорта
   */
  async handleTransportConnectMessage(socket: Socket, message: TransportConnectMessage): Promise<void> {
    const transport = this.transports.get(message.transportId);
    if (!transport) {
      throw new Error(`Transport not found: ${message.transportId}`);
    }

    try {
      logger.info('Connecting transport:', message.transportId);
      await transport.connect({ dtlsParameters: message.dtlsParameters });
      
      // Отправляем подтверждение подключения
      socket.emit('message', {
        type: SignalingMessageType.CONNECT_TRANSPORT,
        transportId: message.transportId,
        dtlsParameters: message.dtlsParameters
      });
      
      logger.info('Transport connected successfully:', message.transportId);
    } catch (error) {
      logger.error('Error connecting transport:', error);
      throw error;
    }
  }

  /**
   * Обработка сообщения о создании producer
   */
  async handleTransportProduceMessage(socket: Socket, message: TransportProduceMessage): Promise<void> {
    const transport = this.transports.get(message.transportId);
    if (!transport) {
      throw new Error(`Transport not found: ${message.transportId}`);
    }

    const producer = await transport.produce({
      kind: message.kind,
      rtpParameters: message.rtpParameters,
      appData: message.appData
    });

    this.producers.set(producer.id, producer);
    
    producer.on('transportclose', () => {
      this.producers.delete(producer.id);
    });

    // Отправляем ID producer'а обратно клиенту
    socket.emit('message', {
      type: SignalingMessageType.TRANSPORT_PRODUCE,
      id: producer.id,
      producerId: producer.id,
      kind: producer.kind
    });

    // Оповещаем всех в комнате о новом producer
    socket.broadcast.emit('message', {
      type: SignalingMessageType.NEW_PRODUCER,
      producerId: producer.id,
      kind: producer.kind
    });

    logger.info('Producer created:', producer.id);
  }

  /**
   * Обработка сообщения о создании consumer
   */
  async handleTransportConsumeMessage(socket: Socket, message: TransportConsumeMessage): Promise<void> {
    const transport = this.transports.get(message.transportId);
    if (!transport) {
      throw new Error(`Transport not found: ${message.transportId}`);
    }

    const producer = this.producers.get(message.producerId);
    if (!producer) {
      throw new Error(`Producer not found: ${message.producerId}`);
    }

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: message.rtpCapabilities,
      paused: true
    });

    this.consumers.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      this.consumers.delete(consumer.id);
    });

    socket.emit('message', {
      type: SignalingMessageType.CONSUME,
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });

    await consumer.resume();
    logger.info('Consumer created:', consumer.id);
  }

  /**
   * Обработка сообщения о возобновлении consumer
   */
  async handleResumeMessage(socket: Socket, message: ResumeMessage): Promise<void> {
    const consumer = this.consumers.get(message.consumerId);
    if (!consumer) {
      throw new Error(`Consumer not found: ${message.consumerId}`);
    }

    await consumer.resume();
    logger.info('Consumer resumed:', message.consumerId);
  }

  /**
   * Обработка сообщения о паузе consumer
   */
  async handlePauseMessage(socket: Socket, message: PauseMessage): Promise<void> {
    const consumer = this.consumers.get(message.consumerId);
    if (!consumer) {
      throw new Error(`Consumer not found: ${message.consumerId}`);
    }

    await consumer.pause();
    logger.info('Consumer paused:', message.consumerId);
  }
} 