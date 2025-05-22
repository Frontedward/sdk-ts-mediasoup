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
  private connectedTransportsCount: number = 0;
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
      
      // Send join message
      this.signalingChannel.send({
        type: SignalingMessageType.JOIN,
        roomId,
        userId,
        displayName
      });

      // Initialize media device
      await this.deviceManager.getUserMedia();
      
      // Wait for successful connection
      await new Promise<void>((resolve, reject) => {
        // Сохраняем resolve и reject для использования в других методах
        this.joinResolve = resolve;
        this.joinReject = reject;
        
        const timeout = setTimeout(() => {
          console.error('Таймаут подключения. Send transport state:', this.sendTransport?.connectionState);
          console.error('Receive transport state:', this.receiveTransport?.connectionState);
          this.joinReject = null;
          this.joinResolve = null;
          reject(new VideoCallError('Timeout joining call', ErrorType.CONNECTION));
        }, 30000); // Таймаут 30 секунд
        
        // Проверка состояния транспортов каждую секунду
        const checkConnectionInterval = setInterval(() => {
          console.log('Проверка состояния транспортов:');
          console.log('- Send transport:', this.sendTransport?.connectionState);
          console.log('- Receive transport:', this.receiveTransport?.connectionState);
          console.log('- Подтверждено транспортов:', this.connectedTransportsCount);
          
          // Если хотя бы один транспорт подключен, считаем соединение установленным
          // ИЛИ если получены оба подтверждения от сервера
          if ((this.sendTransport?.connectionState === 'connected' || 
              this.receiveTransport?.connectionState === 'connected') ||
              this.connectedTransportsCount >= 2) {
            console.log('Транспорт подключен или получены оба подтверждения, разрешаем Promise');
            clearTimeout(timeout);
            clearInterval(checkConnectionInterval);
            this.joinResolve = null;
            this.joinReject = null;
            resolve();
          }
        }, 1000);
        
        const unsubscribe = this.on('connectionStatusChanged', (status) => {
          console.log('Connection status changed to:', status);
          if (status === ConnectionStatus.CONNECTED) {
            clearTimeout(timeout);
            clearInterval(checkConnectionInterval);
            unsubscribe();
            this.joinResolve = null;
            this.joinReject = null;
            resolve();
          } else if (status === ConnectionStatus.ERROR) {
            clearTimeout(timeout);
            clearInterval(checkConnectionInterval);
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
      
      // Сбрасываем счетчик подключенных транспортов
      this.connectedTransportsCount = 0;
      
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
      await this.deviceManager.getUserMedia({ video: true });
      const newVideoTrack = this.deviceManager.getVideoTrack();
      
      if (newVideoTrack) {
        // Create a new producer if we're connected
        if (this.sendTransport) {
          await this.createProducer(newVideoTrack, 'video');
        }
      }
    } 
    // If we want to disable video and have a track
    else if (!enabled && videoTrack) {
      // Find video producer and close it
      for (const [id, producer] of this.producers.entries()) {
        if (producer.kind === 'video') {
          producer.close();
          this.producers.delete(id);
          break;
        }
      }
      
      // Disable the track
      videoTrack.enabled = false;
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
      await this.deviceManager.getUserMedia({ audio: true });
      const newAudioTrack = this.deviceManager.getAudioTrack();
      
      if (newAudioTrack) {
        // Create a new producer if we're connected
        if (this.sendTransport) {
          await this.createProducer(newAudioTrack, 'audio');
        }
      }
    } 
    // If we want to disable audio and have a track
    else if (!enabled && audioTrack) {
      // Find audio producer and close it
      for (const [id, producer] of this.producers.entries()) {
        if (producer.kind === 'audio') {
          producer.close();
          this.producers.delete(id);
          break;
        }
      }
      
      // Disable the track
      audioTrack.enabled = false;
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

    // If this is our own join confirmation
    if (message.userId === this.currentUserId) {
      const joinResponse = message as JoinResponse;
      console.log('Получен JOIN response:', joinResponse);
      
      try {
        // Load mediasoup device with router capabilities
        console.log('Загрузка устройства с возможностями:', joinResponse.rtpCapabilities);
        this.device = new mediasoupClient.Device();
        await this.device.load({ 
          routerRtpCapabilities: joinResponse.rtpCapabilities 
        });
        
        // Сбрасываем счетчик подключенных транспортов
        this.connectedTransportsCount = 0;
        
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
        
        // Инициируем подключение транспортов
        console.log('Инициирую подключение send транспорта вручную');
        (this.sendTransport as any).emit('connect', {
          dtlsParameters: joinResponse.sendTransportOptions.dtlsParameters
        }, 
        () => console.log('Send transport connect callback успешно выполнен'),
        (error: Error) => console.error('Send transport connect errback:', error));
        
        console.log('Инициирую подключение receive транспорта вручную');
        (this.receiveTransport as any).emit('connect', {
          dtlsParameters: joinResponse.recvTransportOptions.dtlsParameters
        },
        () => console.log('Receive transport connect callback успешно выполнен'),
        (error: Error) => console.error('Receive transport connect errback:', error));
        
        // Периодически проверяем статус подключения транспортов
        const checkTransportsStatus = () => {
          console.log('Проверка статуса транспортов:');
          console.log('- Send transport:', this.sendTransport?.connectionState);
          console.log('- Receive transport:', this.receiveTransport?.connectionState);
          
          if (this.sendTransport?.connectionState === 'connected' || 
              this.receiveTransport?.connectionState === 'connected') {
            console.log('Транспорт подключен успешно, устанавливаем статус CONNECTED');
      this.setConnectionStatus(ConnectionStatus.CONNECTED);
          } else if (this.connectionStatus !== ConnectionStatus.ERROR) {
            // Продолжаем проверять, если не в состоянии ошибки
            setTimeout(checkTransportsStatus, 1000);
          }
        };
        
        // Начинаем проверку через секунду
        setTimeout(checkTransportsStatus, 1000);
        
      } catch (error) {
        console.error('Ошибка при обработке JOIN response:', error);
        throw error;
      }
    }
    
    // Add the participant to our room state
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
    if (!this.currentRoom || !this.receiveTransport || message.userId === this.currentUserId) {
      return;
    }

    // Request to consume this producer
    if (!this.device) {
      console.error('Device is not initialized');
      return;
    }
    
    this.signalingChannel.send({
      type: SignalingMessageType.TRANSPORT_CONSUME,
      transportId: this.receiveTransport.id,
      producerId: message.producerId,
      rtpCapabilities: this.device.rtpCapabilities
    });
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
    
    // Увеличиваем счетчик подключенных транспортов
    this.connectedTransportsCount++;
    console.log(`Подключено транспортов: ${this.connectedTransportsCount} из 2`);
    
    if (this.sendTransport && message.transportId === this.sendTransport.id) {
      console.log('Подтверждение подключения send транспорта');
      // Принудительно считаем send транспорт подключенным
      if (this.sendTransport.connectionState === 'new') {
        console.log('Устанавливаем статус соединения как CONNECTED для send транспорта');
        if (this.connectedTransportsCount >= 2) {
          this.setConnectionStatus(ConnectionStatus.CONNECTED);
          
          // Напрямую разрешаем Promise из joinCall
          if (this.joinResolve) {
            console.log('Напрямую разрешаем Promise из joinCall');
            const resolve = this.joinResolve;
            this.joinResolve = null;
            this.joinReject = null;
            resolve();
          }
        }
      }
    } else if (this.receiveTransport && message.transportId === this.receiveTransport.id) {
      console.log('Подтверждение подключения receive транспорта');
      // Принудительно считаем receive транспорт подключенным
      if (this.receiveTransport.connectionState === 'new') {
        console.log('Устанавливаем статус соединения как CONNECTED для receive транспорта');
        if (this.connectedTransportsCount >= 2) {
          this.setConnectionStatus(ConnectionStatus.CONNECTED);
          
          // Напрямую разрешаем Promise из joinCall
          if (this.joinResolve) {
            console.log('Напрямую разрешаем Promise из joinCall');
            const resolve = this.joinResolve;
            this.joinResolve = null;
            this.joinReject = null;
            resolve();
          }
        }
      }
    } else {
      console.warn('Получено подтверждение для неизвестного транспорта:', message.transportId);
    }
    
    // Проверяем статус подключения обоих транспортов
    const sendConnected = this.sendTransport?.connectionState === 'connected';
    const recvConnected = this.receiveTransport?.connectionState === 'connected';
    
    console.log('Send transport state:', this.sendTransport?.connectionState);
    console.log('Receive transport state:', this.receiveTransport?.connectionState);

    // Если получены подтверждения для обоих транспортов
    if (this.connectedTransportsCount >= 2) {
      console.log('Получены подтверждения для обоих транспортов, устанавливаем статус CONNECTED');
      this.setConnectionStatus(ConnectionStatus.CONNECTED);
      
      // Напрямую разрешаем Promise из joinCall
      if (this.joinResolve) {
        console.log('Напрямую разрешаем Promise из joinCall');
        const resolve = this.joinResolve;
        this.joinResolve = null;
        this.joinReject = null;
        resolve();
      }
    }
    // Если хотя бы один транспорт подключен физически
    else if (sendConnected || recvConnected) {
      console.log('Транспорт подключен успешно физически');
      this.setConnectionStatus(ConnectionStatus.CONNECTED);
      
      // Напрямую разрешаем Promise из joinCall
      if (this.joinResolve) {
        console.log('Напрямую разрешаем Promise из joinCall');
        const resolve = this.joinResolve;
        this.joinResolve = null;
        this.joinReject = null;
        resolve();
      }
    } else if (this.sendTransport?.connectionState === 'connecting' || 
               this.receiveTransport?.connectionState === 'connecting') {
      console.log('Транспорты в процессе подключения...');
    } else {
      console.log('Транспорты пока не подключены. Ожидание...');
    }
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
  private async createProducer(track: MediaStreamTrack, kind: 'audio' | 'video'): Promise<void> {
    if (!this.sendTransport || !this.currentRoom || !this.currentUserId) {
      throw new Error('Not connected to a room');
    }

    try {
      // Create producer options
      const producerOptions = {
        track,
        encodings: kind === 'video' && this.config.useSimulcast
          ? [
              { maxBitrate: 100000, scaleResolutionDownBy: 4 },
              { maxBitrate: 300000, scaleResolutionDownBy: 2 },
              { maxBitrate: 900000 }
            ]
          : undefined,
        codecOptions: kind === 'video'
          ? { videoGoogleStartBitrate: 1000 }
          : undefined,
        appData: { mediaTag: kind }
      };
      
      // Create the producer
      const producer = await this.sendTransport.produce(producerOptions);
      
      // Store the producer
      this.producers.set(producer.id, producer);
      
      // Add to participant state (ourselves)
      const participant = this.currentRoom.participants[this.currentUserId];
      if (participant) {
        const producerInfo: Producer = {
          id: producer.id,
          type: kind,
          paused: producer.paused,
          track: producer.track || undefined,
          appData: producer.appData as Record<string, any>
        };
        
        participant.producers[producer.id] = producerInfo;
        this.emit('newProducer', producerInfo);
      }
      
      // Set up producer event handlers
      producer.on('transportclose', () => {
        console.log('Producer transport closed');
        this.producers.delete(producer.id);
      });
      
      producer.on('trackended', () => {
        console.log('Producer track ended');
        producer.close();
        this.producers.delete(producer.id);
        
        if (participant) {
          delete participant.producers[producer.id];
          this.emit('producerClosed', producer.id);
        }
      });
      
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