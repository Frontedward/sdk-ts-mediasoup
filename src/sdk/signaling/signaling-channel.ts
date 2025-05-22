import { io, Socket } from 'socket.io-client';
import { SimpleEventEmitter } from '../events/typed-event-emitter';
import { SignalingMessageUnion } from '../types';

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

  /**
   * Connect to the mock signaling server
   */
  async connect(): Promise<void> {
    this.connected = true;
    this.emit('open', undefined);
    return Promise.resolve();
  }

  /**
   * Disconnect from the mock signaling server
   */
  disconnect(): void {
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

    // For testing purposes, you can simulate responses here
    if (this.messageHandler) {
      this.messageHandler(message);
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