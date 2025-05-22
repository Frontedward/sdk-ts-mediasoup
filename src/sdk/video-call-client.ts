import * as mediasoupClient from 'mediasoup-client';
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
  VideoCallError
} from './types';

/**
 * Configuration for the VideoCallClient
 */
export interface VideoCallClientConfig {
  signalingUrl: string;
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
  private device: mediasoupClient.Device;
  private sendTransport: mediasoupClient.types.Transport | null = null;
  private recvTransport: mediasoupClient.types.Transport | null = null;
  private producers: Map<ProducerId, mediasoupClient.types.Producer> = new Map();
  private consumers: Map<ConsumerId, mediasoupClient.types.Consumer> = new Map();
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private currentRoom: Room | null = null;
  private currentUserId: UserId | null = null;

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
    
    this.signalingChannel = new WebSocketSignalingChannel(
      this.config.signalingUrl,
      this.config.autoReconnect
    );
    
    this.deviceManager = new DeviceManager();
    this.eventQueue = new AsyncEventQueue();
    this.device = new mediasoupClient.Device();
    
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
      const stream = await this.deviceManager.getUserMedia();
      
      // Wait for successful connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new VideoCallError('Timeout joining call', ErrorType.CONNECTION));
        }, 10000);
        
        const unsubscribe = this.on('connectionStatusChanged', (status) => {
          if (status === ConnectionStatus.CONNECTED) {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          } else if (status === ConnectionStatus.ERROR) {
            clearTimeout(timeout);
            unsubscribe();
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
    this.eventQueue.enqueueFunction(async () => {
      try {
        switch (message.type) {
          case SignalingMessageType.JOIN:
            // Server confirmed our join or another participant joined
            await this.handleJoinMessage(message);
            break;
            
          case SignalingMessageType.LEAVE:
            // A participant left
            this.handleLeaveMessage(message);
            break;
            
          case SignalingMessageType.NEW_PRODUCER:
            // A new producer was created
            await this.handleNewProducerMessage(message);
            break;
            
          case SignalingMessageType.PRODUCER_CLOSED:
            // A producer was closed
            this.handleProducerClosedMessage(message);
            break;
            
          case SignalingMessageType.CONSUME:
            // Server tells us to consume a producer
            await this.handleConsumeMessage(message);
            break;
            
          case SignalingMessageType.CONNECT_TRANSPORT:
            // Transport connection info from server
            await this.handleConnectTransportMessage(message);
            break;
            
          case SignalingMessageType.ERROR:
            // Error from server
            this.handleErrorMessage(message);
            break;
            
          default:
            console.warn('Unknown message type:', message);
        }
      } catch (error) {
        console.error('Error handling signaling message:', error);
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
  private async handleJoinMessage(message: SignalingMessageUnion & { type: SignalingMessageType.JOIN }): Promise<void> {
    if (!this.currentRoom) {
      throw new Error('No current room');
    }

    // If this is our own join confirmation
    if (message.userId === this.currentUserId) {
      // Load mediasoup device
      await this.loadDevice();
      
      // Create send and receive transports
      await this.createSendTransport();
      await this.createRecvTransport();
      
      // Create producers for local tracks
      const videoTrack = this.deviceManager.getVideoTrack();
      const audioTrack = this.deviceManager.getAudioTrack();
      
      if (videoTrack) {
        await this.createProducer(videoTrack, 'video');
      }
      
      if (audioTrack) {
        await this.createProducer(audioTrack, 'audio');
      }
      
      this.setConnectionStatus(ConnectionStatus.CONNECTED);
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
    if (!this.currentRoom || !this.recvTransport || message.userId === this.currentUserId) {
      return;
    }

    // Request to consume this producer
    this.signalingChannel.send({
      type: SignalingMessageType.TRANSPORT_CONSUME,
      transportId: this.recvTransport.id,
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
    if (!this.currentRoom || !this.recvTransport) {
      return;
    }

    const participant = this.currentRoom.participants[message.userId];
    if (!participant) {
      return;
    }

    try {
      // Create a consumer
      const consumer = await this.recvTransport.consume({
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
    // No implementation needed as this is typically sent from client to server
  }

  /**
   * Handle error message
   * @param message The error message
   */
  private handleErrorMessage(
    message: SignalingMessageUnion & { type: SignalingMessageType.ERROR }
  ): void {
    this.emit('error', new VideoCallError(
      `Server error: ${message.error}`,
      ErrorType.SIGNALING
    ));
  }

  /**
   * Load the mediasoup device
   */
  private async loadDevice(): Promise<void> {
    try {
      // Request RTP capabilities from server by sending a message
      // In a real implementation, we would wait for the response
      // For now, we'll use a placeholder
      const rtpCapabilities = {
        codecs: [
          {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            parameters: {
              useinbandfec: 1,
              minptime: 10,
              maxplaybackrate: 48000
            },
            rtcpFeedback: []
          },
          {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
            parameters: {},
            rtcpFeedback: [
              { type: 'nack' },
              { type: 'nack', parameter: 'pli' },
              { type: 'ccm', parameter: 'fir' },
              { type: 'goog-remb' }
            ]
          }
        ],
        headerExtensions: [
          {
            kind: 'audio',
            uri: 'urn:ietf:params:rtp-hdrext:sdes:mid',
            preferredId: 1
          },
          {
            kind: 'video',
            uri: 'urn:ietf:params:rtp-hdrext:sdes:mid',
            preferredId: 1
          }
        ]
      };
      
      // Load the device with RTP capabilities
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
      
    } catch (error) {
      console.error('Error loading device:', error);
      throw new VideoCallError(
        `Error loading device: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.MEDIA
      );
    }
  }

  /**
   * Create a send transport
   */
  private async createSendTransport(): Promise<void> {
    try {
      // Request transport parameters from server
      // In a real implementation, we would wait for the response
      // For now, we'll use placeholder data
      const transportOptions = {
        id: 'send-' + Math.random().toString(36).substring(2, 15),
        iceParameters: {
          usernameFragment: 'userfrag',
          password: 'password',
          iceLite: true
        },
        iceCandidates: [
          {
            foundation: '1',
            priority: 1,
            ip: '127.0.0.1',
            protocol: 'udp',
            port: 10000,
            type: 'host'
          }
        ],
        dtlsParameters: {
          role: 'client',
          fingerprints: [
            {
              algorithm: 'sha-256',
              value: '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00'
            }
          ]
        }
      };
      
      // Create the send transport
      this.sendTransport = this.device.createSendTransport(transportOptions);
      
      // Set up transport event handlers
      this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        try {
          // Inform the server to connect the transport
          this.signalingChannel.send({
            type: SignalingMessageType.TRANSPORT_CONNECT,
            transportId: this.sendTransport!.id,
            dtlsParameters
          });
          
          // Signal success
          callback();
        } catch (error) {
          errback(error as Error);
        }
      });
      
      this.sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
        try {
          // Inform the server to create a producer
          this.signalingChannel.send({
            type: SignalingMessageType.TRANSPORT_PRODUCE,
            transportId: this.sendTransport!.id,
            kind,
            rtpParameters,
            appData
          });
          
          // In a real implementation, we would wait for the response with the producer ID
          // For now, we'll generate a random ID
          const producerId = 'producer-' + Math.random().toString(36).substring(2, 15);
          
          // Signal success with the producer ID
          callback({ id: producerId });
        } catch (error) {
          errback(error as Error);
        }
      });
      
      this.sendTransport.on('connectionstatechange', (state) => {
        console.log('Send transport connection state changed to', state);
        if (state === 'failed' || state === 'closed') {
          this.emit('error', new VideoCallError(
            `Send transport connection failed: ${state}`,
            ErrorType.TRANSPORT
          ));
        }
      });
      
    } catch (error) {
      console.error('Error creating send transport:', error);
      throw new VideoCallError(
        `Error creating send transport: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.TRANSPORT
      );
    }
  }

  /**
   * Create a receive transport
   */
  private async createRecvTransport(): Promise<void> {
    try {
      // Request transport parameters from server
      // In a real implementation, we would wait for the response
      // For now, we'll use placeholder data
      const transportOptions = {
        id: 'recv-' + Math.random().toString(36).substring(2, 15),
        iceParameters: {
          usernameFragment: 'userfrag',
          password: 'password',
          iceLite: true
        },
        iceCandidates: [
          {
            foundation: '1',
            priority: 1,
            ip: '127.0.0.1',
            protocol: 'udp',
            port: 10000,
            type: 'host'
          }
        ],
        dtlsParameters: {
          role: 'client',
          fingerprints: [
            {
              algorithm: 'sha-256',
              value: '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00'
            }
          ]
        }
      };
      
      // Create the receive transport
      this.recvTransport = this.device.createRecvTransport(transportOptions);
      
      // Set up transport event handlers
      this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        try {
          // Inform the server to connect the transport
          this.signalingChannel.send({
            type: SignalingMessageType.TRANSPORT_CONNECT,
            transportId: this.recvTransport!.id,
            dtlsParameters
          });
          
          // Signal success
          callback();
        } catch (error) {
          errback(error as Error);
        }
      });
      
      this.recvTransport.on('connectionstatechange', (state) => {
        console.log('Receive transport connection state changed to', state);
        if (state === 'failed' || state === 'closed') {
          this.emit('error', new VideoCallError(
            `Receive transport connection failed: ${state}`,
            ErrorType.TRANSPORT
          ));
        }
      });
      
    } catch (error) {
      console.error('Error creating receive transport:', error);
      throw new VideoCallError(
        `Error creating receive transport: ${error instanceof Error ? error.message : String(error)}`,
        ErrorType.TRANSPORT
      );
    }
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
          track: producer.track,
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
      this.sendTransport = null;
    }
    
    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
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