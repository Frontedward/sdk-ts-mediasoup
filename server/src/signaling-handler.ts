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
  JoinResponse,
  ConnectTransportMessage
} from './types';

type IceSelectedTuple = {
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  protocol: 'udp' | 'tcp';
};

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
      logger.info('Received message:', {
        type: message.type,
        socketId: socket.id,
        message: JSON.stringify(message, null, 2)
      });
      
      switch (message.type) {
        case SignalingMessageType.JOIN:
          await this.handleJoinMessage(socket, message);
          break;
        case SignalingMessageType.LEAVE:
          await this.handleLeaveMessage(socket, message);
          break;
        case SignalingMessageType.TRANSPORT_CONNECT:
          logger.info('Handling TRANSPORT_CONNECT:', {
            transportId: (message as TransportConnectMessage).transportId,
            dtlsParameters: (message as TransportConnectMessage).dtlsParameters
          });
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
      logger.error('Error handling message:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        message: JSON.stringify(message, null, 2)
      });
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
      const { transport: sendTransport, params: sendParams } = await this.mediasoupManager.createWebRtcTransport();
      const { transport: recvTransport, params: recvParams } = await this.mediasoupManager.createWebRtcTransport();
      
      this.transports.set(sendParams.id, sendTransport);
      this.transports.set(recvParams.id, recvTransport);

      // Получаем возможности роутера
      const rtpCapabilities = this.mediasoupManager.getRouterRtpCapabilities();
      
      // Отправляем информацию о транспортах клиенту
      const response: JoinResponse = {
        type: SignalingMessageType.JOIN,
        sendTransportOptions: {
          id: sendParams.id,
          iceParameters: sendParams.iceParameters,
          iceCandidates: sendParams.iceCandidates,
          dtlsParameters: sendParams.dtlsParameters
        },
        recvTransportOptions: {
          id: recvParams.id,
          iceParameters: recvParams.iceParameters,
          iceCandidates: recvParams.iceCandidates,
          dtlsParameters: recvParams.dtlsParameters
        },
        rtpCapabilities,
        userId: message.userId,
        roomId: message.roomId,
        displayName: message.displayName
      };

      logger.info('Отправляем JOIN response:', {
        sendTransportId: sendParams.id,
        recvTransportId: recvParams.id,
        iceParameters: {
          send: sendParams.iceParameters,
          recv: recvParams.iceParameters
        },
        iceCandidates: {
          send: sendParams.iceCandidates.length,
          recv: recvParams.iceCandidates.length
        }
      });

      socket.emit('message', response);
      logger.info('Client joined:', message.userId);

      // Настраиваем обработчики событий для send транспорта
      sendTransport.on('connect' as any, async ({ dtlsParameters }: { dtlsParameters: mediasoupTypes.DtlsParameters }, callback: () => void, errback: (error: Error) => void) => {
        try {
          logger.info('Send transport connect event with parameters:', {
            transportId: sendTransport.id
          });
          await this.mediasoupManager.connectTransport(sendTransport, dtlsParameters);
          logger.info('Send transport connect successful');
          callback();
        } catch (error) {
          logger.error('Error connecting send transport:', error);
          errback(error as Error);
        }
      });

      // Логирование всех возможных событий
      sendTransport.on('connectionstatechange' as any, (state: string) => {
        logger.info('Send transport connection state changed to:', state);
      });

      (sendTransport as any).on('dtlsstatechange', (state: string) => {
        logger.info('Send transport DTLS state changed to:', state);
      });

      (sendTransport as any).on('icestatechange', (state: string) => {
        logger.info('Send transport ICE state changed to:', state);
      });

      (sendTransport as any).on('iceselectedtuplechange', (tuple: IceSelectedTuple) => {
        logger.info('Send transport ICE selected tuple changed:', tuple);
      });

      sendTransport.observer.on('close', () => {
        logger.info('Send transport closed');
        this.transports.delete(sendParams.id);
      });

      // Настраиваем обработчики событий для receive транспорта
      recvTransport.on('connect' as any, async ({ dtlsParameters }: { dtlsParameters: mediasoupTypes.DtlsParameters }, callback: () => void, errback: (error: Error) => void) => {
        try {
          logger.info('Receive transport connect event with parameters:', {
            transportId: recvTransport.id
          });
          await this.mediasoupManager.connectTransport(recvTransport, dtlsParameters);
          logger.info('Receive transport connect successful');
          callback();
        } catch (error) {
          logger.error('Error connecting receive transport:', error);
          errback(error as Error);
        }
      });

      // Логирование всех возможных событий
      recvTransport.on('connectionstatechange' as any, (state: string) => {
        logger.info('Receive transport connection state changed to:', state);
      });

      (recvTransport as any).on('dtlsstatechange', (state: string) => {
        logger.info('Receive transport DTLS state changed to:', state);
      });

      (recvTransport as any).on('icestatechange', (state: string) => {
        logger.info('Receive transport ICE state changed to:', state);
      });

      (recvTransport as any).on('iceselectedtuplechange', (tuple: IceSelectedTuple) => {
        logger.info('Receive transport ICE selected tuple changed:', tuple);
      });

      recvTransport.observer.on('close', () => {
        logger.info('Receive transport closed');
        this.transports.delete(recvParams.id);
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
    try {
      logger.info('Handling TRANSPORT_CONNECT message:', {
        socketId: socket.id,
        transportId: message.transportId,
        dtlsParameters: message.dtlsParameters
      });

      const transport = this.transports.get(message.transportId);
      if (!transport) {
        const error = `Transport not found: ${message.transportId}`;
        logger.error(error);
        throw new Error(error);
      }

      // Проверяем DTLS параметры
      if (!message.dtlsParameters || !message.dtlsParameters.fingerprints || !message.dtlsParameters.role) {
        const error = 'Invalid DTLS parameters';
        logger.error(error, message.dtlsParameters);
        throw new Error(error);
      }

      // Подключаем транспорт
      await this.mediasoupManager.connectTransport(transport, message.dtlsParameters);

      // Отправляем подтверждение - критически важно использовать socket.emit вместо socket.send
      const response: ConnectTransportMessage = {
        type: SignalingMessageType.CONNECT_TRANSPORT,
        transportId: message.transportId,
        dtlsParameters: message.dtlsParameters
      };

      logger.info('Sending CONNECT_TRANSPORT response:', response);
      socket.emit('message', response);

    } catch (error) {
      logger.error('Error in handleTransportConnectMessage:', error);
      socket.emit('message', {
        type: SignalingMessageType.ERROR,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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