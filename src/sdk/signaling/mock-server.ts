import { SimpleEventEmitter } from '../events/typed-event-emitter';
import { 
  ConsumerId,
  ProducerId, 
  RoomId, 
  SignalingMessageType, 
  SignalingMessageUnion, 
  TransportId, 
  UserId 
} from '../types';

/**
 * Events emitted by the mock server
 */
interface MockServerEvents {
  message: SignalingMessageUnion;
  clientConnected: string;
  clientDisconnected: string;
}

/**
 * A simple mock signaling server for testing
 */
export class MockSignalingServer extends SimpleEventEmitter<MockServerEvents> {
  private rooms: Map<RoomId, Set<UserId>> = new Map();
  private clientConnections: Map<string, (message: SignalingMessageUnion) => void> = new Map();
  private producers: Map<ProducerId, { userId: UserId; kind: 'audio' | 'video' }> = new Map();
  private consumers: Map<ConsumerId, { userId: UserId; producerId: ProducerId }> = new Map();
  private transports: Map<TransportId, { userId: UserId; type: 'send' | 'recv' }> = new Map();

  /**
   * Handle a new client connection
   * @param clientId Unique identifier for the client
   * @param sendCallback Callback to send messages to the client
   */
  onClientConnect(clientId: string, sendCallback: (message: SignalingMessageUnion) => void): void {
    this.clientConnections.set(clientId, sendCallback);
    this.emit('clientConnected', clientId);
  }

  /**
   * Handle a client disconnection
   * @param clientId Unique identifier for the client
   */
  onClientDisconnect(clientId: string): void {
    this.clientConnections.delete(clientId);
    this.emit('clientDisconnected', clientId);
  }

  /**
   * Handle a message from a client
   * @param clientId Unique identifier for the client
   * @param message The message from the client
   */
  onClientMessage(clientId: string, message: SignalingMessageUnion): void {
    this.emit('message', message);
    
    switch (message.type) {
      case SignalingMessageType.JOIN:
        this.handleJoin(clientId, message);
        break;
        
      case SignalingMessageType.LEAVE:
        this.handleLeave(clientId, message);
        break;
        
      case SignalingMessageType.TRANSPORT_CONNECT:
        this.handleTransportConnect(clientId, message);
        break;
        
      case SignalingMessageType.TRANSPORT_PRODUCE:
        this.handleTransportProduce(clientId, message);
        break;
        
      case SignalingMessageType.TRANSPORT_CONSUME:
        this.handleTransportConsume(clientId, message);
        break;
        
      case SignalingMessageType.RESUME:
        // Handle resume
        break;
        
      case SignalingMessageType.PAUSE:
        // Handle pause
        break;
    }
  }

  /**
   * Send a message to a specific client
   * @param clientId Unique identifier for the client
   * @param message The message to send
   */
  sendToClient(clientId: string, message: SignalingMessageUnion): void {
    const sendCallback = this.clientConnections.get(clientId);
    if (sendCallback) {
      sendCallback(message);
    }
  }

  /**
   * Send a message to all clients in a room
   * @param roomId The room ID
   * @param message The message to send
   * @param excludeClientId Optional client ID to exclude
   */
  broadcastToRoom(roomId: RoomId, message: SignalingMessageUnion, excludeClientId?: string): void {
    const userIds = this.rooms.get(roomId);
    if (!userIds) return;
    
    // This is a simplified version - in a real implementation we would map userIds to clientIds
    for (const clientId of this.clientConnections.keys()) {
      if (clientId !== excludeClientId) {
        this.sendToClient(clientId, message);
      }
    }
  }

  /**
   * Handle a join message
   * @param clientId Unique identifier for the client
   * @param message The join message
   */
  private handleJoin(clientId: string, message: SignalingMessageUnion & { type: SignalingMessageType.JOIN }): void {
    // Add to room
    if (!this.rooms.has(message.roomId)) {
      this.rooms.set(message.roomId, new Set());
    }
    
    this.rooms.get(message.roomId)!.add(message.userId);
    
    // Confirm join
    this.sendToClient(clientId, {
      type: SignalingMessageType.JOIN,
      roomId: message.roomId,
      userId: message.userId,
      displayName: message.displayName
    });
    
    // Notify others in the room
    this.broadcastToRoom(message.roomId, {
      type: SignalingMessageType.JOIN,
      roomId: message.roomId,
      userId: message.userId,
      displayName: message.displayName
    }, clientId);
    
    // Send existing producers to the new client
    for (const [producerId, producer] of this.producers.entries()) {
      if (producer.userId !== message.userId) {
        this.sendToClient(clientId, {
          type: SignalingMessageType.NEW_PRODUCER,
          producerId,
          userId: producer.userId,
          kind: producer.kind
        });
      }
    }
  }

  /**
   * Handle a leave message
   * @param clientId Unique identifier for the client
   * @param message The leave message
   */
  private handleLeave(clientId: string, message: SignalingMessageUnion & { type: SignalingMessageType.LEAVE }): void {
    // Remove from room
    const room = this.rooms.get(message.roomId);
    if (room) {
      room.delete(message.userId);
      if (room.size === 0) {
        this.rooms.delete(message.roomId);
      }
    }
    
    // Close all producers for this user
    for (const [producerId, producer] of this.producers.entries()) {
      if (producer.userId === message.userId) {
        this.producers.delete(producerId);
        
        // Notify others that producer is closed
        this.broadcastToRoom(message.roomId, {
          type: SignalingMessageType.PRODUCER_CLOSED,
          producerId,
          userId: message.userId
        });
      }
    }
    
    // Close all consumers for this user
    for (const [consumerId, consumer] of this.consumers.entries()) {
      if (consumer.userId === message.userId) {
        this.consumers.delete(consumerId);
      }
    }
    
    // Notify others that user left
    this.broadcastToRoom(message.roomId, {
      type: SignalingMessageType.LEAVE,
      roomId: message.roomId,
      userId: message.userId
    });
  }

  /**
   * Handle a transport connect message
   * @param clientId Unique identifier for the client
   * @param message The transport connect message
   */
  private handleTransportConnect(
    clientId: string, 
    message: SignalingMessageUnion & { type: SignalingMessageType.TRANSPORT_CONNECT }
  ): void {
    // In a real implementation, we would perform the actual transport connection
    // For the mock, we just track the transport
    this.transports.set(message.transportId, { 
      userId: 'unknown', // In a real implementation, we would know which user this is
      type: message.transportId.startsWith('send') ? 'send' : 'recv'
    });
  }

  /**
   * Handle a transport produce message
   * @param clientId Unique identifier for the client
   * @param message The transport produce message
   */
  private handleTransportProduce(
    clientId: string, 
    message: SignalingMessageUnion & { type: SignalingMessageType.TRANSPORT_PRODUCE }
  ): void {
    // Generate a producer ID
    const producerId = 'producer-' + Math.random().toString(36).substring(2, 15);
    
    // In a real implementation, we would perform the actual producer creation
    // For the mock, we just track the producer
    this.producers.set(producerId, {
      userId: 'unknown', // In a real implementation, we would know which user this is
      kind: message.kind
    });
    
    // Notify the client about the new producer
    this.sendToClient(clientId, {
      type: SignalingMessageType.NEW_PRODUCER,
      producerId,
      userId: 'unknown', // In a real implementation, we would know which user this is
      kind: message.kind
    });
    
    // Notify others about the new producer
    // In a real implementation, we would know which room this is
    for (const roomId of this.rooms.keys()) {
      this.broadcastToRoom(roomId, {
        type: SignalingMessageType.NEW_PRODUCER,
        producerId,
        userId: 'unknown', // In a real implementation, we would know which user this is
        kind: message.kind
      }, clientId);
    }
  }

  /**
   * Handle a transport consume message
   * @param clientId Unique identifier for the client
   * @param message The transport consume message
   */
  private handleTransportConsume(
    clientId: string, 
    message: SignalingMessageUnion & { type: SignalingMessageType.TRANSPORT_CONSUME }
  ): void {
    // Generate a consumer ID
    const consumerId = 'consumer-' + Math.random().toString(36).substring(2, 15);
    
    // Get the producer info
    const producer = this.producers.get(message.producerId);
    if (!producer) return;
    
    // In a real implementation, we would perform the actual consumer creation
    // For the mock, we just track the consumer
    this.consumers.set(consumerId, {
      userId: 'unknown', // In a real implementation, we would know which user this is
      producerId: message.producerId
    });
    
    // Notify the client about the new consumer
    this.sendToClient(clientId, {
      type: SignalingMessageType.CONSUME,
      consumerId,
      producerId: message.producerId,
      kind: producer.kind,
      rtpParameters: {}, // In a real implementation, these would be actual RTP parameters
      userId: producer.userId
    });
  }

  /**
   * Get the number of clients connected to the server
   */
  get clientCount(): number {
    return this.clientConnections.size;
  }

  /**
   * Get the number of rooms
   */
  get roomCount(): number {
    return this.rooms.size;
  }

  /**
   * Get the number of producers
   */
  get producerCount(): number {
    return this.producers.size;
  }

  /**
   * Get the number of consumers
   */
  get consumerCount(): number {
    return this.consumers.size;
  }
}