import { makeAutoObservable, action } from 'mobx';
import { 
  ConnectionStatus, 
  Consumer, 
  Participant, 
  Producer, 
  Room, 
  RoomId, 
  UserId, 
  VideoCallError 
} from '../types';
import { VideoCallClient } from '../video-call-client';

/**
 * MobX store for video call state
 */
export class CallStore {
  // Connection state
  connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  error: VideoCallError | null = null;
  
  // Room state
  currentRoom: Room | null = null;
  currentUserId: UserId | null = null;
  
  // Media state
  localVideoEnabled: boolean = true;
  localAudioEnabled: boolean = true;
  
  // Client reference
  private client: VideoCallClient;

  /**
   * Create a new CallStore
   * @param client The VideoCallClient to use
   */
  constructor(client: VideoCallClient) {
    this.client = client;
    this.setupListeners();
    makeAutoObservable(this);
  }

  // Actions
  setConnectionStatus = action((status: ConnectionStatus) => {
    this.connectionStatus = status;
  });

  setError = action((error: VideoCallError | null) => {
    this.error = error;
  });

  updateRoomState = action(() => {
    this.currentRoom = this.client.getCurrentRoom();
    this.currentUserId = this.client.getCurrentUserId();
  });

  toggleVideo = action(() => {
    this.localVideoEnabled = !this.localVideoEnabled;
    // Здесь должна быть логика включения/выключения видео через client
  });

  toggleAudio = action(() => {
    this.localAudioEnabled = !this.localAudioEnabled;
    // Здесь должна быть логика включения/выключения аудио через client
  });

  /**
   * Join a call
   * @param roomId The room ID to join
   * @param userId The user ID to use
   * @param displayName Optional display name
   */
  async joinCall(roomId: RoomId, userId: UserId, displayName?: string): Promise<void> {
    try {
      this.error = null;
      await this.client.joinCall(roomId, userId, displayName);
    } catch (error) {
      if (error instanceof VideoCallError) {
        this.error = error;
      } else {
        this.error = new VideoCallError(
          `Failed to join call: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      throw error;
    }
  }

  /**
   * Leave the current call
   */
  async leaveCall(): Promise<void> {
    try {
      await this.client.leaveCall();
    } catch (error) {
      if (error instanceof VideoCallError) {
        this.error = error;
      } else {
        this.error = new VideoCallError(
          `Failed to leave call: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      throw error;
    }
  }

  /**
   * Get all participants in the current room
   */
  get participants(): Participant[] {
    if (!this.currentRoom) {
      return [];
    }
    
    return Object.values(this.currentRoom.participants);
  }

  /**
   * Get all remote participants in the current room
   */
  get remoteParticipants(): Participant[] {
    if (!this.currentRoom || !this.currentUserId) {
      return [];
    }
    
    return Object.values(this.currentRoom.participants)
      .filter(participant => participant.userId !== this.currentUserId);
  }

  /**
   * Get the local participant
   */
  get localParticipant(): Participant | null {
    if (!this.currentRoom || !this.currentUserId) {
      return null;
    }
    
    return this.currentRoom.participants[this.currentUserId] || null;
  }

  /**
   * Get all consumers in the current room
   */
  get allConsumers(): Consumer[] {
    const consumers: Consumer[] = [];
    
    if (this.currentRoom) {
      for (const participant of Object.values(this.currentRoom.participants)) {
        consumers.push(...Object.values(participant.consumers));
      }
    }
    
    return consumers;
  }

  /**
   * Get all producers in the current room
   */
  get allProducers(): Producer[] {
    const producers: Producer[] = [];
    
    if (this.currentRoom) {
      for (const participant of Object.values(this.currentRoom.participants)) {
        producers.push(...Object.values(participant.producers));
      }
    }
    
    return producers;
  }

  /**
   * Get the client
   */
  getClient(): VideoCallClient {
    return this.client;
  }

  /**
   * Set up event listeners
   */
  private setupListeners(): void {
    // Connection status changes
    this.client.on('connectionStatusChanged', action((status) => {
      this.connectionStatus = status;
    }));
    
    // Error events
    this.client.on('error', action((error) => {
      this.error = error;
    }));
    
    // Room state updates
    this.client.on('participantJoined', () => this.updateRoomState());
    this.client.on('participantLeft', () => this.updateRoomState());
    this.client.on('newConsumer', () => this.updateRoomState());
    this.client.on('consumerClosed', () => this.updateRoomState());
    this.client.on('newProducer', () => this.updateRoomState());
    this.client.on('producerClosed', () => this.updateRoomState());
  }
}