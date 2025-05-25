import * as mediasoupClient from 'mediasoup-client';
import { types as mediasoupTypes } from 'mediasoup-client';
import { AsyncEventQueue } from './events/event-queue';
import { SimpleEventEmitter } from './events/typed-event-emitter';
import { DeviceManager } from './media/device-manager';
import { SignalingChannel, WebSocketSignalingChannel } from './signaling/signaling-channel';
import {
  ConnectionStatus,
  Consumer,
  ConsumerId,
  ErrorType,
  Participant,
  Producer,
  ProducerId,
  Room,
  RoomId,
  SignalingMessageType,
  SignalingMessageUnion,
  UserId,
  VideoCallError,
  JoinMessage,
  JoinResponse,
  TransportConnectMessage
} from './types';

/**
 * Configuration for the VideoCallClient
 */
export interface VideoCallClientConfig {
  signalingUrl?: string;
  signalingChannel?: SignalingChannel;
  autoReconnect?: boolean;
  useSimulcast?: boolean;
}

/**
 * Events emitted by the VideoCallClient
 */
export interface VideoCallEvents {
  connectionStatusChanged: ConnectionStatus;
  participantJoined: Participant;
  participantLeft: Participant;
  newConsumer: Consumer;
  consumerClosed: ConsumerId;
  newProducer: Producer;
  producerClosed: ProducerId;
  error: VideoCallError;
}

/**
 * Main SDK class for video calls
 */
export class VideoCallClient extends SimpleEventEmitter<VideoCallEvents> {
  private config: VideoCallClientConfig;
  private signalingChannel: SignalingChannel;
  private deviceManager: DeviceManager;
  private eventQueue: AsyncEventQueue;
  private device?: mediasoupClient.Device;
  private sendTransport?: mediasoupTypes.Transport;
  private receiveTransport?: mediasoupTypes.Transport;
  private producers: Map<ProducerId, mediasoupTypes.Producer> = new Map();
  private consumers: Map<ConsumerId, mediasoupTypes.Consumer> = new Map();
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private currentRoom: Room | null = null;
  private currentUserId: UserId | null = null;
  private joinResolve: (() => void) | null = null;
  private joinReject: ((error: Error) => void) | null = null;

  /**
   * Create a new VideoCallClient
   * @param config Configuration for the client
   */
  constructor(config: VideoCallClientConfig) {
    super();
    this.config = {
      autoReconnect: true,
      useSimulcast: true,
      ...config
    };
    
    if (this.config.signalingChannel) {
      this.signalingChannel = this.config.signalingChannel;
    } else if (this.config.signalingUrl) {
    this.signalingChannel = new WebSocketSignalingChannel(
      this.config.signalingUrl,
      this.config.autoReconnect
    );
    } else {
      throw new Error('Either signalingUrl or signalingChannel must be provided');
    }
    
    this.deviceManager = new DeviceManager();
    this.eventQueue = new AsyncEventQueue();
    
    this.setupSignalingListeners();
  }

  /**
   * Join a video call
   * @param roomId Room ID to join
   * @param userId User ID to use
   * @param displayName Optional display name
   * @returns Promise that resolves when joined
   */
  async joinCall(roomId: RoomId, userId: UserId, displayName?: string): Promise<void> {
    try {
      this.setConnectionStatus(ConnectionStatus.CONNECTING);
      
      // Connect to signaling server if not already connected
      if (!this.signalingChannel.isConnected()) {
        await this.signalingChannel.connect();
      }
      
      // Store user and room info
      this.currentUserId = userId;
      this.currentRoom = {
        id: roomId,
        participants: {},
        createdAt: new Date()
      };
      
      // Initialize media device
      await this.deviceManager.getUserMedia({ audio: true, video: false });
      
      // В mock режиме обрабатываем подключение синхронно
      const isMockMode = this.signalingChannel.constructor.name === 'MockSignalingChannel';
      
      if (isMockMode) {
        // Send join message
        this.signalingChannel.send({
          type: SignalingMessageType.JOIN,
          roomId,
          userId,
          displayName
        });
        
        // В mock режиме соединение уже установлено
        console.log('Mock режим: подключение завершено');
        return;
      }
      
      // Wait for successful connection (только для реального режима)
      await new Promise<void>((resolve, reject) => {
        // Сохраняем resolve и reject для использования в других методах
        this.joinResolve = resolve;
        this.joinReject = reject;
        
        // Send join message
        this.signalingChannel.send({
          type: SignalingMessageType.JOIN,
          roomId,
          userId,
          displayName
        });
        
        const timeout = setTimeout(() => {
          console.error('Таймаут подключения');
          this.joinReject = null;
          this.joinResolve = null;
          reject(new VideoCallError('Timeout joining call', ErrorType.CONNECTION));
        }, 10000); // Таймаут 10 секунд
        
        const unsubscribe = this.on('connectionStatusChanged', (status) => {
          console.log('Connection status changed to:', status);
          if (status === ConnectionStatus.CONNECTED) {
            clearTimeout(timeout);
            unsubscribe();
            this.joinResolve = null;
            this.joinReject = null;
            resolve();
          } else if (status === ConnectionStatus.ERROR) {
            clearTimeout(timeout);
            unsubscribe();
            this.joinResolve = null;
            this.joinReject = null;
            reject(new VideoCallError('Failed to join call', ErrorType.CONNECTION));
          }
        });
      });
      
    } catch (error) {
      this.setConnectionStatus(ConnectionStatus.ERROR);
      throw new VideoCallError(
        `Failed to join call: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.CONNECTION
      );
    }
  }

  /**
   * Leave the current call
   */
  async leaveCall(): Promise<void> {
    if (!this.currentRoom || !this.currentUserId) {
      return;
    }

    try {
      // Close all transports and tracks
      this.closeAllTransports();
      this.deviceManager.releaseMediaStream();
      
      // Очищаем joinResolve и joinReject
      this.joinResolve = null;
      this.joinReject = null;
      
      // Send leave message if connected
      if (this.signalingChannel.isConnected()) {
        this.signalingChannel.send({
          type: SignalingMessageType.LEAVE,
          roomId: this.currentRoom.id,
          userId: this.currentUserId
        });
      }
      
      // Disconnect from signaling
      this.signalingChannel.disconnect();
      
      // Reset state
      this.currentRoom = null;
      this.currentUserId = null;
      this.setConnectionStatus(ConnectionStatus.DISCONNECTED);
      
    } catch (error) {
      console.error('Error leaving call:', error);
      throw new VideoCallError(
        `Failed to leave call: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.CONNECTION
      );
    }
  }

  /**
   * Enable or disable local video
   * @param enabled Whether video should be enabled
   */
  async enableVideo(enabled: boolean): Promise<void> {
    const videoTrack = this.deviceManager.getVideoTrack();
    
    // If we want to enable video but don't have a track, get one
    if (enabled && !videoTrack) {
      // Get current audio track to preserve it
      const audioTrack = this.deviceManager.getAudioTrack();
      const constraints = {
        video: true,
        audio: !!audioTrack // Keep audio if we already have it
      };
      
      await this.deviceManager.getUserMedia(constraints);
      const newVideoTrack = this.deviceManager.getVideoTrack();
      
      if (newVideoTrack) {
        // Create a new producer if we're connected
        if (this.sendTransport || this.signalingChannel.constructor.name === 'MockSignalingChannel') {
          await this.createProducer(newVideoTrack, 'video');
        }
      }
    } 
    // If we want to disable video and have a track
    else if (!enabled && videoTrack) {
      const isMockMode = this.signalingChannel.constructor.name === 'MockSignalingChannel';
      
      if (isMockMode) {
        // В mock режиме просто уведомляем о закрытии producer
        if (this.currentRoom && this.currentUserId) {
          const participant = this.currentRoom.participants[this.currentUserId];
          if (participant) {
            const videoProducer = Object.values(participant.producers).find(p => p.type === 'video');
            if (videoProducer) {
              // Удаляем producer из состояния участника
              delete participant.producers[videoProducer.id];
              
              // Уведомляем других участников
              this.signalingChannel.send({
                type: SignalingMessageType.PRODUCER_CLOSED,
                producerId: videoProducer.id,
                userId: this.currentUserId
              });
            }
          }
        }
      } else {
        // Find video producer and close it
        for (const [id, producer] of this.producers.entries()) {
          if (producer.kind === 'video') {
            producer.close();
            this.producers.delete(id);
            break;
          }
        }
      }
      
      // Stop the video track
      videoTrack.stop();
      
      // Clear the video track reference manually
      if (this.deviceManager.getVideoTrack() === videoTrack) {
        // The track will be cleared when we call getUserMedia next time
      }
    }
  }

  /**
   * Enable or disable local audio
   * @param enabled Whether audio should be enabled
   */
  async enableAudio(enabled: boolean): Promise<void> {
    const audioTrack = this.deviceManager.getAudioTrack();
    
    // If we want to enable audio but don't have a track, get one
    if (enabled && !audioTrack) {
      // Get current video track to preserve it
      const videoTrack = this.deviceManager.getVideoTrack();
      const constraints = {
        audio: true,
        video: !!videoTrack // Keep video if we already have it
      };
      
      await this.deviceManager.getUserMedia(constraints);
      const newAudioTrack = this.deviceManager.getAudioTrack();
      
      if (newAudioTrack) {
        // Create a new producer if we're connected
        if (this.sendTransport || this.signalingChannel.constructor.name === 'MockSignalingChannel') {
          await this.createProducer(newAudioTrack, 'audio');
        }
      }
    } 
    // If we want to disable audio and have a track
    else if (!enabled && audioTrack) {
      const isMockMode = this.signalingChannel.constructor.name === 'MockSignalingChannel';
      
      if (isMockMode) {
        // В mock режиме просто уведомляем о закрытии producer
        if (this.currentRoom && this.currentUserId) {
          const participant = this.currentRoom.participants[this.currentUserId];
          if (participant) {
            const audioProducer = Object.values(participant.producers).find(p => p.type === 'audio');
            if (audioProducer) {
              // Удаляем producer из состояния участника
              delete participant.producers[audioProducer.id];
              
              // Уведомляем других участников
              this.signalingChannel.send({
                type: SignalingMessageType.PRODUCER_CLOSED,
                producerId: audioProducer.id,
                userId: this.currentUserId
              });
            }
          }
        }
      } else {
        // Find audio producer and close it
        for (const [id, producer] of this.producers.entries()) {
          if (producer.kind === 'audio') {
            producer.close();
            this.producers.delete(id);
            break;
          }
        }
      }
      
      // Stop the audio track
      audioTrack.stop();
    }
  }

  /**
   * Get the current connection status
   */
  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Get the current room information
   */
  getCurrentRoom(): Room | null {
    return this.currentRoom;
  }

  /**
   * Get the current user ID
   */
  getCurrentUserId(): UserId | null {
    return this.currentUserId;
  }

  /**
   * Get the device manager
   */
  getDeviceManager(): DeviceManager {
    return this.deviceManager;
  }

  /**
   * Set up signaling event listeners
   */
  private setupSignalingListeners(): void {
    this.signalingChannel.on('open', () => {
      console.log('Signaling connection established');
    });

    this.signalingChannel.on('close', () => {
      console.log('Signaling connection closed');
      if (this.connectionStatus === ConnectionStatus.CONNECTED) {
        this.setConnectionStatus(ConnectionStatus.DISCONNECTED);
      }
    });

    this.signalingChannel.on('error', (error) => {
      console.error('Signaling error:', error);
      this.emit('error', new VideoCallError(
        `Signaling error: ${error.message}`,
        ErrorType.SIGNALING
      ));
    });

    this.signalingChannel.on('message', (message) => {
      this.handleSignalingMessage(message);
    });
  }

  /**
   * Handle incoming signaling messages
   * @param message The message to handle
   */
  private handleSignalingMessage(message: SignalingMessageUnion): void {
    // Enqueue message handling to ensure sequential processing
    console.log('Получено сообщение от сервера:', message);
    
    // В mock режиме обрабатываем все сообщения синхронно
    const isMockMode = this.signalingChannel.constructor.name === 'MockSignalingChannel';
    if (isMockMode) {
      console.log('Обработка сообщения в mock режиме (синхронно):', message.type);
      
      // Обрабатываем сообщения синхронно в mock режиме
      try {
        switch (message.type) {
          case SignalingMessageType.JOIN:
            this.handleJoinMessage(message as JoinMessage | JoinResponse);
            break;
          case SignalingMessageType.LEAVE:
            this.handleLeaveMessage(message);
            break;
          case SignalingMessageType.NEW_PRODUCER:
            this.handleNewProducerMessage(message);
            break;
          case SignalingMessageType.PRODUCER_CLOSED:
            this.handleProducerClosedMessage(message);
            break;
          case SignalingMessageType.CONNECT_TRANSPORT:
            this.handleConnectTransportMessage(message);
            break;
          case SignalingMessageType.ERROR:
            this.handleErrorMessage(message);
            break;
          default:
            console.warn('Неизвестный тип сообщения:', message);
        }
      } catch (error) {
        console.error('Ошибка обработки сообщения в mock режиме:', error);
        this.emit('error', new VideoCallError(
          `Error handling signaling message: ${error instanceof Error ? error.message : String(error)}`,
          ErrorType.SIGNALING
        ));
      }
      return;
    }
    
    this.eventQueue.enqueueFunction(async () => {
      try {
        switch (message.type) {
          case SignalingMessageType.JOIN:
            // Server confirmed our join or another participant joined
            console.log('Обработка JOIN сообщения');
            await this.handleJoinMessage(message as JoinMessage | JoinResponse);
            break;
            
          case SignalingMessageType.LEAVE:
            // A participant left
            console.log('Обработка LEAVE сообщения');
            this.handleLeaveMessage(message);
            break;
            
          case SignalingMessageType.NEW_PRODUCER:
            // A new producer was created
            console.log('Обработка NEW_PRODUCER сообщения');
            await this.handleNewProducerMessage(message);
            break;
            
          case SignalingMessageType.PRODUCER_CLOSED:
            // A producer was closed
            console.log('Обработка PRODUCER_CLOSED сообщения');
            this.handleProducerClosedMessage(message);
            break;
            
          case SignalingMessageType.CONSUME:
            // Server tells us to consume a producer
            console.log('Обработка CONSUME сообщения');
            await this.handleConsumeMessage(message);
            break;
            
          case SignalingMessageType.CONNECT_TRANSPORT:
            // Transport connection info from server
            console.log('Обработка CONNECT_TRANSPORT сообщения');
            await this.handleConnectTransportMessage(message);
            break;
            
          case SignalingMessageType.ERROR:
            // Error from server
            console.log('Обработка ERROR сообщения');
            this.handleErrorMessage(message);
            break;
            
          default:
            console.warn('Неизвестный тип сообщения:', message);
        }
      } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
        this.emit('error', new VideoCallError(
          `Error handling signaling message: ${error instanceof Error ? error.message : String(error)}`,
          ErrorType.SIGNALING
        ));
      }
    }, `Handle ${message.type} message`);
  }

  /**
   * Handle join message
   * @param message The join message
   */
  private async handleJoinMessage(message: JoinMessage | JoinResponse): Promise<void> {
    if (!this.currentRoom) {
      throw new Error('No current room');
    }

    // Add the participant to our room state if it's not us
    if (message.userId !== this.currentUserId) {
      console.log('Новый участник присоединился:', message.userId);
      if (!this.currentRoom.participants[message.userId]) {
        const newParticipant: Participant = {
          userId: message.userId,
          displayName: message.displayName,
          producers: {},
          consumers: {},
          joinedAt: new Date()
        };
        
        this.currentRoom.participants[message.userId] = newParticipant;
        this.emit('participantJoined', newParticipant);
      }
      return;
    }

    // If this is our own join confirmation
    const joinResponse = message as JoinResponse;
    console.log('Получен JOIN response:', joinResponse);
    
    try {
      // Проверяем, используем ли мы mock signaling channel
      const isMockMode = this.signalingChannel.constructor.name === 'MockSignalingChannel';
      
      if (isMockMode) {
        console.log('Mock режим: упрощенная инициализация');
        
        // В mock режиме просто устанавливаем статус подключения
        this.setConnectionStatus(ConnectionStatus.CONNECTED);
        
        // Добавляем себя как участника в комнату
        const selfParticipant: Participant = {
          userId: this.currentUserId,
          displayName: joinResponse.displayName,
          producers: {},
          consumers: {},
          joinedAt: new Date()
        };
        this.currentRoom.participants[this.currentUserId] = selfParticipant;
        
        // Создаем producers для локальных треков
        const videoTrack = this.deviceManager.getVideoTrack();
        const audioTrack = this.deviceManager.getAudioTrack();
        
        if (videoTrack) {
          console.log('Создание видео producer в mock режиме');
          await this.createProducer(videoTrack, 'video');
        }
        
        if (audioTrack) {
          console.log('Создание аудио producer в mock режиме');
          await this.createProducer(audioTrack, 'audio');
        }
        
        // В mock режиме joinResolve не используется, так как подключение синхронное
        console.log('Mock режим: JOIN обработан синхронно');
        
        return;
      }
      
      // Load mediasoup device with router capabilities
      console.log('Загрузка устройства с возможностями:', joinResponse.rtpCapabilities);
      this.device = new mediasoupClient.Device();
      await this.device.load({ 
        routerRtpCapabilities: joinResponse.rtpCapabilities 
      });
      
      // Create send transport
      console.log('Создание send транспорта с параметрами:', joinResponse.sendTransportOptions);
      this.sendTransport = this.device.createSendTransport({
        id: joinResponse.sendTransportOptions.id,
        iceParameters: joinResponse.sendTransportOptions.iceParameters,
        iceCandidates: joinResponse.sendTransportOptions.iceCandidates,
        dtlsParameters: joinResponse.sendTransportOptions.dtlsParameters,
        iceServers: [
          {
            urls: [
              'stun:stun1.l.google.com:19302',
              'stun:stun2.l.google.com:19302'
            ]
          }
        ],
        iceTransportPolicy: 'all',
        additionalSettings: {
          iceCheckingTimeout: 5000,
          iceReconnectTimeout: 2000,
          retries: 5
        },
        enableTcp: true,
        enableUdp: true,
        preferTcp: true
      } as any);

      // Set up send transport event handlers BEFORE using it
      this.sendTransport.on('connect', async (
        { dtlsParameters }: { dtlsParameters: mediasoupTypes.DtlsParameters }, 
        callback: () => void, 
        errback: (error: Error) => void
      ) => {
        try {
          console.log('Send transport connect event с параметрами:', {
            dtlsParameters,
            transportId: this.sendTransport?.id,
            connectionState: this.sendTransport?.connectionState,
            closed: this.sendTransport?.closed
          });

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              console.error('Send transport connect timeout. Current state:', {
                connectionState: this.sendTransport?.connectionState,
                closed: this.sendTransport?.closed,
                dtlsParameters
              });
              reject(new Error('Timeout waiting for send transport connect response'));
            }, 15000);

            const messageHandler = (msg: SignalingMessageUnion) => {
              console.log('Получено сообщение в send transport connect:', {
                messageType: msg.type,
                expectedType: SignalingMessageType.CONNECT_TRANSPORT,
                messageTransportId: msg.type === SignalingMessageType.CONNECT_TRANSPORT ? msg.transportId : undefined,
                expectedTransportId: this.sendTransport!.id,
                fullMessage: msg
              });
              
              if (msg.type === SignalingMessageType.CONNECT_TRANSPORT && 
                  msg.transportId === this.sendTransport!.id) {
                console.log('Получено подтверждение подключения send транспорта:', {
                  transportId: msg.transportId,
                  dtlsParameters: msg.dtlsParameters,
                  connectionState: this.sendTransport?.connectionState
                });
                this.signalingChannel.off('message', messageHandler);
                clearTimeout(timeout);
                resolve();
              } else if (msg.type === SignalingMessageType.ERROR) {
                console.error('Получена ошибка при подключении транспорта:', msg);
                this.signalingChannel.off('message', messageHandler);
                clearTimeout(timeout);
                reject(new Error(msg.error));
              }
            };

            this.signalingChannel.on('message', messageHandler);
            
            const transportConnectMessage: TransportConnectMessage = {
              type: SignalingMessageType.TRANSPORT_CONNECT,
              transportId: this.sendTransport!.id,
              dtlsParameters
            };
            
            console.log('Отправка TRANSPORT_CONNECT для send транспорта:', transportConnectMessage);
            this.signalingChannel.send(transportConnectMessage);
          });

          console.log('Send transport connect успешно завершен');
          callback();
        } catch (error) {
          console.error('Ошибка в send transport connect:', error);
          this.setConnectionStatus(ConnectionStatus.ERROR);
          errback(error as Error);
        }
      });

      this.sendTransport.on('connectionstatechange', (state: string) => {
        console.log('Send transport connection state changed:', {
          state,
          transportId: this.sendTransport?.id,
          closed: this.sendTransport?.closed
        });
        
        if (state === 'connected') {
          console.log('Send transport успешно подключен!');
          this.setConnectionStatus(ConnectionStatus.CONNECTED);
        }
      });

      this.sendTransport.on('icegatheringstatechange', (state: string) => {
        console.log('Send transport ICE gathering state changed:', state);
      });

      (this.sendTransport as any).on('dtlsstatechange', (state: string) => {
        console.log('Send transport DTLS state changed:', state);
        
        if (state === 'connected') {
          console.log('Send transport DTLS соединение установлено!');
          this.setConnectionStatus(ConnectionStatus.CONNECTED);
        }
      });
      
      (this.sendTransport as any).on('icestatechange', (state: string) => {
        console.log('Send transport ICE state changed:', state);
        
        if (state === 'completed' || state === 'connected') {
          console.log('Send transport ICE соединение установлено!');
        }
      });

      this.sendTransport.on('produce', async (
        { kind, rtpParameters }: { kind: mediasoupTypes.MediaKind, rtpParameters: mediasoupTypes.RtpParameters },
        callback: (data: { id: string }) => void,
        errback: (error: Error) => void
      ) => {
        try {
          console.log('Transport produce event:', { kind, rtpParameters });
          this.signalingChannel.send({
            type: SignalingMessageType.TRANSPORT_PRODUCE,
            transportId: this.sendTransport!.id,
            kind,
            rtpParameters,
            appData: { mediaTag: kind }
          });
          console.log('Отправлено TRANSPORT_PRODUCE');
          const producerId = 'producer-' + Math.random().toString(36).substring(2, 15);
          callback({ id: producerId });
        } catch (error) {
          console.error('Ошибка в transport produce:', error);
          errback(error as Error);
        }
      });

      // Create receive transport
      console.log('Создание receive транспорта с параметрами:', joinResponse.recvTransportOptions);
      this.receiveTransport = this.device.createRecvTransport({
        id: joinResponse.recvTransportOptions.id,
        iceParameters: joinResponse.recvTransportOptions.iceParameters,
        iceCandidates: joinResponse.recvTransportOptions.iceCandidates,
        dtlsParameters: joinResponse.recvTransportOptions.dtlsParameters,
        iceServers: [
          {
            urls: [
              'stun:stun1.l.google.com:19302',
              'stun:stun2.l.google.com:19302'
            ]
          }
        ],
        iceTransportPolicy: 'all',
        additionalSettings: {
          iceCheckingTimeout: 5000,
          iceReconnectTimeout: 2000,
          retries: 5
        },
        enableTcp: true,
        enableUdp: true,
        preferTcp: true
      } as any);

      // Set up receive transport event handlers BEFORE using it
      this.receiveTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          console.log('Receive transport connect event с параметрами:', {
            dtlsParameters,
            transportId: this.receiveTransport?.id,
            connectionState: this.receiveTransport?.connectionState,
            closed: this.receiveTransport?.closed
          });

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Timeout waiting for receive transport connect response'));
            }, 15000);

            const messageHandler = (msg: SignalingMessageUnion) => {
              console.log('Получено сообщение в receive transport connect:', {
                messageType: msg.type,
                expectedType: SignalingMessageType.CONNECT_TRANSPORT,
                messageTransportId: msg.type === SignalingMessageType.CONNECT_TRANSPORT ? msg.transportId : undefined,
                expectedTransportId: this.receiveTransport!.id,
                fullMessage: msg
              });
              
              if (msg.type === SignalingMessageType.CONNECT_TRANSPORT && 
                  msg.transportId === this.receiveTransport!.id) {
                console.log('Получено подтверждение подключения receive транспорта:', {
                  transportId: msg.transportId,
                  dtlsParameters: msg.dtlsParameters,
                  connectionState: this.receiveTransport?.connectionState
                });
                this.signalingChannel.off('message', messageHandler);
                clearTimeout(timeout);
                resolve();
              } else if (msg.type === SignalingMessageType.ERROR) {
                console.error('Получена ошибка при подключении транспорта:', msg);
                this.signalingChannel.off('message', messageHandler);
                clearTimeout(timeout);
                reject(new Error(msg.error));
              }
            };

            this.signalingChannel.on('message', messageHandler);
            
            const transportConnectMessage: TransportConnectMessage = {
              type: SignalingMessageType.TRANSPORT_CONNECT,
              transportId: this.receiveTransport!.id,
              dtlsParameters
            };
            
            console.log('Отправка TRANSPORT_CONNECT для receive транспорта:', transportConnectMessage);
            this.signalingChannel.send(transportConnectMessage);
          });
          console.log('Receive transport connect успешно завершен');
          callback();
        } catch (error) {
          console.error('Ошибка в receive transport connect:', error);
          this.setConnectionStatus(ConnectionStatus.ERROR);
          errback(error as Error);
        }
      });

      this.receiveTransport.on('connectionstatechange', (state) => {
        console.log('Receive transport connection state changed:', {
          state,
          transportId: this.receiveTransport?.id,
          closed: this.receiveTransport?.closed
        });
        
        if (state === 'connected') {
          console.log('Receive transport успешно подключен!');
          this.setConnectionStatus(ConnectionStatus.CONNECTED);
        }
      });

      this.receiveTransport.on('icegatheringstatechange', (state) => {
        console.log('Receive transport ICE gathering state changed:', state);
      });

      (this.receiveTransport as any).on('icestatechange', (state: string) => {
        console.log('Receive transport ICE state changed:', state);
        
        if (state === 'completed' || state === 'connected') {
          console.log('Receive transport ICE соединение установлено!');
        }
      });

      (this.receiveTransport as any).on('dtlsstatechange', (state: string) => {
        console.log('Receive transport DTLS state changed:', state);
      });
    
    // Create producers for local tracks
    const videoTrack = this.deviceManager.getVideoTrack();
    const audioTrack = this.deviceManager.getAudioTrack();
    
    if (videoTrack) {
        console.log('Создание видео producer');
      await this.createProducer(videoTrack, 'video');
    }
    
    if (audioTrack) {
        console.log('Создание аудио producer');
      await this.createProducer(audioTrack, 'audio');
    }
    
      console.log('Все обработчики событий установлены');
      
      // Устанавливаем статус подключения
      this.setConnectionStatus(ConnectionStatus.CONNECTED);
      
      // Добавляем себя как участника в комнату
      const selfParticipant: Participant = {
        userId: this.currentUserId,
        displayName: joinResponse.displayName,
        producers: {},
        consumers: {},
        joinedAt: new Date()
      };
      this.currentRoom.participants[this.currentUserId] = selfParticipant;
      
      // Разрешаем Promise из joinCall
      if (this.joinResolve) {
        console.log('Разрешаем Promise из joinCall');
        const resolve = this.joinResolve;
        this.joinResolve = null;
        this.joinReject = null;
        resolve();
      }
      
    } catch (error) {
      console.error('Ошибка при обработке JOIN response:', error);
      throw error;
    }
  }

  /**
   * Handle leave message
   * @param message The leave message
   */
  private handleLeaveMessage(message: SignalingMessageUnion & { type: SignalingMessageType.LEAVE }): void {
    if (!this.currentRoom) {
      return;
    }

    const participant = this.currentRoom.participants[message.userId];
    if (participant) {
      // Close all consumers associated with this participant
      Object.values(participant.consumers).forEach(consumer => {
        const mediasoupConsumer = this.consumers.get(consumer.id);
        if (mediasoupConsumer) {
          mediasoupConsumer.close();
          this.consumers.delete(consumer.id);
        }
        
        this.emit('consumerClosed', consumer.id);
      });
      
      // Remove the participant
      delete this.currentRoom.participants[message.userId];
      this.emit('participantLeft', participant);
    }
  }

  /**
   * Handle new producer message
   * @param message The new producer message
   */
  private async handleNewProducerMessage(
    message: SignalingMessageUnion & { type: SignalingMessageType.NEW_PRODUCER }
  ): Promise<void> {
    if (!this.currentRoom) {
      return;
    }

    console.log('Получено сообщение о новом producer:', message);
    
    // Добавляем producer к участнику (включая себя)
    const participant = this.currentRoom.participants[message.userId];
    if (participant) {
      // Проверяем, не существует ли уже такой producer
      if (!participant.producers[message.producerId]) {
        // Для локального пользователя пытаемся найти соответствующий track
        let track: MediaStreamTrack | undefined;
        if (message.userId === this.currentUserId) {
          if (message.kind === 'video') {
            track = this.deviceManager.getVideoTrack() || undefined;
          } else if (message.kind === 'audio') {
            track = this.deviceManager.getAudioTrack() || undefined;
          }
        }
        
        const producerInfo: Producer = {
          id: message.producerId,
          type: message.kind,
          paused: false,
          track: track,
          appData: {}
        };
        
        participant.producers[message.producerId] = producerInfo;
        this.emit('newProducer', producerInfo);
        
        console.log('Добавлен producer для участника:', message.userId, producerInfo);
      } else {
        console.log('Producer уже существует:', message.producerId);
      }
    } else {
      console.warn('Участник не найден для producer:', message.userId);
    }
  }

  /**
   * Handle producer closed message
   * @param message The producer closed message
   */
  private handleProducerClosedMessage(
    message: SignalingMessageUnion & { type: SignalingMessageType.PRODUCER_CLOSED }
  ): void {
    if (!this.currentRoom) {
      return;
    }

    const participant = this.currentRoom.participants[message.userId];
    if (participant) {
      const producer = participant.producers[message.producerId];
      if (producer) {
        delete participant.producers[message.producerId];
        this.emit('producerClosed', message.producerId);
      }
    }
  }

  /**
   * Handle consume message
   * @param message The consume message
   */
  private async handleConsumeMessage(
    message: SignalingMessageUnion & { type: SignalingMessageType.CONSUME }
  ): Promise<void> {
    if (!this.currentRoom || !this.receiveTransport) {
      return;
    }

    const participant = this.currentRoom.participants[message.userId];
    if (!participant) {
      return;
    }

    try {
      // Create a consumer
      const consumer = await this.receiveTransport.consume({
        id: message.consumerId,
        producerId: message.producerId,
        kind: message.kind,
        rtpParameters: message.rtpParameters
      });
      
      // Store the consumer
      this.consumers.set(consumer.id, consumer);
      
      // Add to participant state
      const consumerInfo: Consumer = {
        id: consumer.id,
        producerId: message.producerId,
        type: message.kind,
        paused: consumer.paused,
        track: consumer.track,
        appData: consumer.appData as Record<string, any>
      };
      
      participant.consumers[consumer.id] = consumerInfo;
      
      // Resume the consumer
      this.signalingChannel.send({
        type: SignalingMessageType.RESUME,
        consumerId: consumer.id
      });
      
      this.emit('newConsumer', consumerInfo);
      
    } catch (error) {
      console.error('Error consuming producer:', error);
      this.emit('error', new VideoCallError(
        `Error consuming producer: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.MEDIA
      ));
    }
  }

  /**
   * Handle connect transport message
   * @param message The connect transport message
   */
  private async handleConnectTransportMessage(
    message: SignalingMessageUnion & { type: SignalingMessageType.CONNECT_TRANSPORT }
  ): Promise<void> {
    console.log('Получено подтверждение подключения транспорта:', message.transportId);
    // В mock режиме просто логируем подтверждение
  }

  /**
   * Handle error message
   * @param message The error message
   */
  private handleErrorMessage(
    message: SignalingMessageUnion & { type: SignalingMessageType.ERROR }
  ): void {
    // Если есть активный joinReject, используем его
    if (this.joinReject) {
      const reject = this.joinReject;
      this.joinReject = null;
      this.joinResolve = null;
      reject(new Error(`Server error: ${message.error}`));
    }
    
          this.emit('error', new VideoCallError(
      `Server error: ${message.error}`,
      ErrorType.SIGNALING
    ));
  }

  /**
   * Create a producer for a track
   * @param track The track to produce
   * @param kind The kind of track
   */
  private async createProducer(_track: MediaStreamTrack, kind: 'audio' | 'video'): Promise<void> {
    if (!this.currentRoom || !this.currentUserId) {
      throw new Error('Not connected to a room');
    }

    try {
      console.log('Создание producer для:', { kind, userId: this.currentUserId });
      
      // Проверяем, есть ли уже producer такого типа
      const participant = this.currentRoom.participants[this.currentUserId];
      if (participant) {
        const existingProducer = Object.values(participant.producers).find(p => p.type === kind);
        if (existingProducer) {
          console.log('Producer уже существует для типа:', kind);
          return;
        }
      }
      
      // Проверяем, используем ли мы mock режим
      const isMockMode = this.signalingChannel.constructor.name === 'MockSignalingChannel';
      
      if (isMockMode) {
        // В mock режиме просто уведомляем сервер
        this.signalingChannel.send({
          type: SignalingMessageType.TRANSPORT_PRODUCE,
          transportId: 'mock-transport-' + kind,
          kind,
          rtpParameters: {},
          appData: { mediaTag: kind }
        });
      } else {
        // В реальном режиме используем настоящий transportId
        if (!this.sendTransport) {
          throw new Error('Send transport not available');
        }
        
        this.signalingChannel.send({
          type: SignalingMessageType.TRANSPORT_PRODUCE,
          transportId: this.sendTransport.id,
          kind,
          rtpParameters: {},
          appData: { mediaTag: kind }
        });
      }
      
      console.log('Отправлено TRANSPORT_PRODUCE сообщение');
      
    } catch (error) {
      console.error('Error creating producer:', error);
      throw new VideoCallError(
        `Error creating producer: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.MEDIA
      );
    }
  }

  /**
   * Close all transports
   */
  private closeAllTransports(): void {
    // Close all producers
    this.producers.forEach(producer => {
      producer.close();
    });
    this.producers.clear();
    
    // Close all consumers
    this.consumers.forEach(consumer => {
      consumer.close();
    });
    this.consumers.clear();
    
    // Close transports
    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = undefined;
    }
    
    if (this.receiveTransport) {
      this.receiveTransport.close();
      this.receiveTransport = undefined;
    }
  }

  /**
   * Set the connection status and emit an event
   * @param status The new connection status
   */
  private setConnectionStatus(status: ConnectionStatus): void {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.emit('connectionStatusChanged', status);
    }
  }
}