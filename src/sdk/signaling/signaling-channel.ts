import { io, Socket } from 'socket.io-client';
import { SimpleEventEmitter } from '../events/typed-event-emitter';
import { 
  SignalingMessageUnion, 
  SignalingMessageType,
  JoinMessage,
  JoinResponse,
  TransportConnectMessage
} from '../types';

/**
 * Events emitted by the signaling channel
 */
export interface SignalingEvents {
  message: SignalingMessageUnion;
  open: undefined;
  close: undefined;
  error: Error;
}

/**
 * Interface for a signaling channel
 */
export interface SignalingChannel {
  connect(): Promise<void>;
  disconnect(): void;
  send(message: SignalingMessageUnion): void;
  isConnected(): boolean;
  on<K extends keyof SignalingEvents>(event: K, listener: (data: SignalingEvents[K]) => void): () => void;
  off<K extends keyof SignalingEvents>(event: K, listener: (data: SignalingEvents[K]) => void): void;
}

/**
 * WebSocket implementation of a signaling channel
 */
export class WebSocketSignalingChannel 
  extends SimpleEventEmitter<SignalingEvents> 
  implements SignalingChannel {
  
  private socket: Socket | null = null;
  private url: string;
  private autoReconnect: boolean;

  /**
   * Create a new WebSocket signaling channel
   * @param url The URL of the WebSocket server
   * @param autoReconnect Whether to automatically reconnect on disconnection
   */
  constructor(url: string, autoReconnect: boolean = true) {
    super();
    this.url = url;
    this.autoReconnect = autoReconnect;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.socket?.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = io(this.url, {
        reconnection: this.autoReconnect,
        transports: ['websocket']
      });

      this.socket.on('connect', () => {
        this.emit('open', undefined);
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('Ошибка подключения к сигнальному серверу:', error);
        reject(new Error('Failed to connect to signaling server'));
      });

      this.setupEventListeners();
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Send a message to the signaling server
   * @param message The message to send
   */
  send(message: SignalingMessageUnion): void {
    if (!this.socket || !this.socket.connected) {
      throw new Error('Signaling channel not connected');
    }

    this.socket.emit('message', message);
  }

  /**
   * Check if the signaling channel is connected
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Set up WebSocket event listeners
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('message', (message: SignalingMessageUnion) => {
      this.emit('message', message);
    });

    this.socket.on('disconnect', () => {
      this.emit('close', undefined);
    });

    this.socket.on('error', () => {
      this.emit('error', new Error('Socket error'));
    });
  }

  on<K extends keyof SignalingEvents>(event: K, listener: (data: SignalingEvents[K]) => void): () => void {
    return super.on(event, listener);
  }

  off<K extends keyof SignalingEvents>(event: K, listener: (data: SignalingEvents[K]) => void): void {
    super.off(event, listener);
  }
}

/**
 * Mock implementation of a signaling channel for testing
 */
export class MockSignalingChannel 
  extends SimpleEventEmitter<SignalingEvents> 
  implements SignalingChannel {
  
  private connected: boolean = false;
  private messageHandler?: (message: SignalingMessageUnion) => void;
  private static clients: Map<string, MockSignalingChannel> = new Map(); // userId -> channel (только для локальных уведомлений)
  private userId?: string;
  private roomId?: string;

  // Методы для работы с localStorage для эмуляции общего состояния между вкладками
  private getRoomsFromStorage(): Map<string, Set<string>> {
    try {
      const stored = localStorage.getItem('mock-signaling-rooms');
      if (stored) {
        const parsed = JSON.parse(stored);
        const rooms = new Map<string, Set<string>>();
        for (const [roomId, userIds] of Object.entries(parsed)) {
          rooms.set(roomId, new Set(userIds as string[]));
        }
        return rooms;
      }
    } catch (error) {
      console.warn('Ошибка чтения rooms из localStorage:', error);
    }
    return new Map();
  }

  private saveRoomsToStorage(rooms: Map<string, Set<string>>): void {
    try {
      const obj: Record<string, string[]> = {};
      for (const [roomId, userIds] of rooms.entries()) {
        obj[roomId] = Array.from(userIds);
      }
      localStorage.setItem('mock-signaling-rooms', JSON.stringify(obj));
    } catch (error) {
      console.warn('Ошибка сохранения rooms в localStorage:', error);
    }
  }

  private getClientsFromStorage(): Set<string> {
    try {
      const stored = localStorage.getItem('mock-signaling-clients');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch (error) {
      console.warn('Ошибка чтения clients из localStorage:', error);
    }
    return new Set();
  }

  private saveClientsToStorage(clients: Set<string>): void {
    try {
      localStorage.setItem('mock-signaling-clients', JSON.stringify(Array.from(clients)));
    } catch (error) {
      console.warn('Ошибка сохранения clients в localStorage:', error);
    }
  }

  private broadcastViaStorage(message: any): void {
    try {
      const broadcastMessage = {
        ...message,
        timestamp: Date.now(),
        senderId: this.userId
      };
      // Используем уникальный ключ для каждого сообщения
      const key = `mock-signaling-broadcast-${Date.now()}-${Math.random()}`;
      localStorage.setItem(key, JSON.stringify(broadcastMessage));
      
      // Удаляем через небольшую задержку
      setTimeout(() => {
        localStorage.removeItem(key);
      }, 100);
    } catch (error) {
      console.warn('Ошибка отправки broadcast сообщения:', error);
    }
  }

  private setupStorageListener(): void {
    window.addEventListener('storage', (event) => {
      if (event.key?.startsWith('mock-signaling-broadcast-') && event.newValue) {
        try {
          const message = JSON.parse(event.newValue);
          // Проверяем, что сообщение не от нас самих
          if (message.senderId !== this.userId) {
            // Проверяем, что сообщение предназначено для нас
            if (message.targetUserId === this.userId || !message.targetUserId) {
              console.log('Mock server: получено broadcast сообщение:', message);
              this.emit('message', message);
            }
          }
        } catch (error) {
          console.warn('Ошибка обработки storage event:', error);
        }
      }
    });
  }

  /**
   * Connect to the mock signaling server
   */
  async connect(): Promise<void> {
    this.connected = true;
    this.setupStorageListener();
    this.emit('open', undefined);
    return Promise.resolve();
  }

  /**
   * Disconnect from the mock signaling server
   */
  disconnect(): void {
    if (this.userId && this.roomId) {
      // Get current state from localStorage
      const rooms = this.getRoomsFromStorage();
      const clients = this.getClientsFromStorage();
      
      // Remove from room
      const room = rooms.get(this.roomId);
      if (room) {
        room.delete(this.userId);
        if (room.size === 0) {
          rooms.delete(this.roomId);
        }
      }
      
      // Remove from clients
      clients.delete(this.userId);
      MockSignalingChannel.clients.delete(this.userId);
      
      // Save updated state
      this.saveRoomsToStorage(rooms);
      this.saveClientsToStorage(clients);
      
      // Notify others about leaving
      this.broadcastViaStorage({
        type: SignalingMessageType.LEAVE,
        roomId: this.roomId,
        userId: this.userId
      });
    }
    
    this.connected = false;
    this.emit('close', undefined);
  }

  /**
   * Send a message to the mock signaling server
   * @param message The message to send
   */
  send(message: SignalingMessageUnion): void {
    if (!this.connected) {
      throw new Error('Signaling channel not connected');
    }

    // Обрабатываем сообщения синхронно для лучшей работы
    if (message.type === SignalingMessageType.JOIN) {
      this.handleJoin(message as JoinMessage);
    } else if (message.type === SignalingMessageType.TRANSPORT_CONNECT) {
      this.handleTransportConnect(message as TransportConnectMessage);
    } else if (message.type === SignalingMessageType.TRANSPORT_PRODUCE) {
      this.handleTransportProduce(message);
    } else if (message.type === SignalingMessageType.LEAVE) {
      this.handleLeave(message);
    } else if (message.type === SignalingMessageType.PRODUCER_CLOSED) {
      this.handleProducerClosed(message);
    }

    // For testing purposes, you can simulate responses here
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  private handleJoin(message: JoinMessage): void {
    console.log('Mock server: обработка JOIN', { userId: message.userId, roomId: message.roomId });
    
    this.userId = message.userId;
    this.roomId = message.roomId;
    
    // Add to clients map (local only)
    MockSignalingChannel.clients.set(this.userId, this);
    
    // Get current state from localStorage
    const rooms = this.getRoomsFromStorage();
    const clients = this.getClientsFromStorage();
    
    clients.add(this.userId);
    console.log('Mock server: добавлен клиент', this.userId, 'всего клиентов:', clients.size);
    
    // Add to room
    if (!rooms.has(this.roomId)) {
      rooms.set(this.roomId, new Set());
    }
    const room = rooms.get(this.roomId)!;
    
    console.log('Mock server: участники в комнате до добавления:', Array.from(room));
    
    // Notify existing users about new participant via storage events
    const existingUsers = Array.from(room);
    room.forEach(existingUserId => {
      if (existingUserId !== this.userId) {
        console.log('Mock server: уведомляем существующего пользователя', existingUserId, 'о новом', this.userId);
        // Используем storage event для уведомления других вкладок
        this.broadcastViaStorage({
          type: SignalingMessageType.JOIN,
          roomId: this.roomId!,
          userId: this.userId!,
          displayName: message.displayName,
          targetUserId: existingUserId
        });
      }
    });
    
    room.add(this.userId);
    console.log('Mock server: участники в комнате после добавления:', Array.from(room));
    
    // Save updated state
    this.saveRoomsToStorage(rooms);
    this.saveClientsToStorage(clients);
    
    // Send join response to the new user
    const joinResponse: JoinResponse = {
      type: SignalingMessageType.JOIN,
      sendTransportOptions: {
        id: 'send-transport-' + Math.random().toString(36).substring(2, 15),
        iceParameters: {
          usernameFragment: 'mock-username-' + this.userId,
          password: 'mock-password-' + this.userId,
          iceLite: false
        },
        iceCandidates: [
          {
            foundation: 'mock-foundation',
            priority: 2113667326,
            ip: '127.0.0.1',
            address: '127.0.0.1',
            port: 12345,
            type: 'host' as const,
            protocol: 'udp' as const
          }
        ],
        dtlsParameters: {
          role: 'auto' as const,
          fingerprints: [
            {
              algorithm: 'sha-256',
              value: 'mock-fingerprint-' + this.userId
            }
          ]
        }
      },
      recvTransportOptions: {
        id: 'recv-transport-' + Math.random().toString(36).substring(2, 15),
        iceParameters: {
          usernameFragment: 'mock-username-recv-' + this.userId,
          password: 'mock-password-recv-' + this.userId,
          iceLite: false
        },
        iceCandidates: [
          {
            foundation: 'mock-foundation-recv',
            priority: 2113667326,
            ip: '127.0.0.1',
            address: '127.0.0.1',
            port: 12346,
            type: 'host' as const,
            protocol: 'udp' as const
          }
        ],
        dtlsParameters: {
          role: 'auto' as const,
          fingerprints: [
            {
              algorithm: 'sha-256',
              value: 'mock-fingerprint-recv-' + this.userId
            }
          ]
        }
      },
      rtpCapabilities: {
        codecs: [
          {
            kind: 'audio' as const,
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            parameters: {}
          },
          {
            kind: 'video' as const,
            mimeType: 'video/VP8',
            clockRate: 90000,
            parameters: {}
          }
        ],
        headerExtensions: []
      },
      userId: message.userId,
      roomId: message.roomId,
      displayName: message.displayName
    };
    
    this.emit('message', joinResponse);
    
    // Отправляем новому пользователю информацию о существующих участниках
    existingUsers.forEach(existingUserId => {
      if (existingUserId !== this.userId) {
        console.log('Mock server: отправляем новому пользователю', this.userId, 'информацию о существующем', existingUserId);
        this.emit('message', {
          type: SignalingMessageType.JOIN,
          roomId: this.roomId!,
          userId: existingUserId,
          displayName: `User ${existingUserId}`
        });
      }
    });
  }

  private handleTransportConnect(message: TransportConnectMessage): void {
    // Simulate transport connect confirmation
    this.emit('message', {
      type: SignalingMessageType.CONNECT_TRANSPORT,
      transportId: message.transportId,
      dtlsParameters: message.dtlsParameters
    });
  }

  private handleTransportProduce(message: any): void {
    const producerId = 'producer-' + Math.random().toString(36).substring(2, 15);
    
    console.log('Mock server: обработка TRANSPORT_PRODUCE', { producerId, kind: message.kind, userId: this.userId });
    
    // Сначала отправляем подтверждение создания producer обратно отправителю
    this.emit('message', {
      type: SignalingMessageType.NEW_PRODUCER,
      producerId,
      userId: this.userId!,
      kind: message.kind
    });
    
    // Затем уведомляем всех других участников о новом producer
    if (this.roomId && this.userId) {
      this.broadcastViaStorage({
        type: SignalingMessageType.NEW_PRODUCER,
        producerId,
        userId: this.userId,
        kind: message.kind
      });
    }
  }

  private handleLeave(_message: any): void {
    if (this.userId && this.roomId) {
      this.broadcastViaStorage({
        type: SignalingMessageType.LEAVE,
        roomId: this.roomId,
        userId: this.userId
      });
    }
  }

  private handleProducerClosed(message: any): void {
    console.log('Mock server: обработка PRODUCER_CLOSED', { producerId: message.producerId, userId: this.userId });
    
    // Уведомляем всех других участников о закрытии producer
    if (this.roomId && this.userId) {
      this.broadcastViaStorage({
        type: SignalingMessageType.PRODUCER_CLOSED,
        producerId: message.producerId,
        userId: this.userId
      });
    }
  }



  /**
   * Check if the mock signaling channel is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Set a handler for outgoing messages
   * @param handler The handler function
   */
  setMessageHandler(handler: (message: SignalingMessageUnion) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Simulate receiving a message
   * @param message The message to simulate receiving
   */
  simulateIncomingMessage(message: SignalingMessageUnion): void {
    if (this.connected) {
      this.emit('message', message);
    }
  }

  on<K extends keyof SignalingEvents>(event: K, listener: (data: SignalingEvents[K]) => void): () => void {
    return super.on(event, listener);
  }

  off<K extends keyof SignalingEvents>(event: K, listener: (data: SignalingEvents[K]) => void): void {
    super.off(event, listener);
  }
}