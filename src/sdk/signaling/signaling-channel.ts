import { SimpleEventEmitter } from '../events/typed-event-emitter';
import { SignalingMessageUnion } from '../types';

/**
 * Events emitted by the signaling channel
 */
export interface SignalingEvents {
  message: SignalingMessageUnion;
  open: void;
  close: void;
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
  on<K extends keyof SignalingEvents>(
    event: K, 
    callback: (payload: SignalingEvents[K]) => void
  ): () => void;
}

/**
 * WebSocket implementation of a signaling channel
 */
export class WebSocketSignalingChannel 
  extends SimpleEventEmitter<SignalingEvents> 
  implements SignalingChannel {
  
  private ws: WebSocket | null = null;
  private url: string;
  private autoReconnect: boolean;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;

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
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      const onOpen = () => {
        this.reconnectAttempts = 0;
        this.emit('open', undefined);
        this.ws?.removeEventListener('open', onOpen);
        resolve();
      };

      const onError = (error: Event) => {
        this.ws?.removeEventListener('error', onError);
        reject(new Error('Failed to connect to signaling server'));
      };

      this.ws.addEventListener('open', onOpen);
      this.ws.addEventListener('error', onError);

      this.setupEventListeners();
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.ws) {
      this.autoReconnect = false;
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send a message to the signaling server
   * @param message The message to send
   */
  send(message: SignalingMessageUnion): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Signaling channel not connected');
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Check if the signaling channel is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Set up WebSocket event listeners
   */
  private setupEventListeners(): void {
    if (!this.ws) return;

    this.ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as SignalingMessageUnion;
        this.emit('message', message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });

    this.ws.addEventListener('close', () => {
      this.emit('close', undefined);
      
      if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => {
          this.connect().catch(error => {
            console.error('Failed to reconnect:', error);
          });
        }, this.reconnectDelay * this.reconnectAttempts);
      }
    });

    this.ws.addEventListener('error', (error) => {
      this.emit('error', new Error('WebSocket error'));
    });
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
}