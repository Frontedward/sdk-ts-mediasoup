/**
 * Общие типы, используемые в SDK
 */

export type RoomId = string;
export type UserId = string;
export type ProducerId = string;
export type ConsumerId = string;
export type TransportId = string;

/**
 * Статус соединения для видеозвонка
 */
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

/**
 * Участник видеозвонка
 */
export interface Participant {
  userId: UserId;
  displayName?: string;
  producers: Record<ProducerId, Producer>;
  consumers: Record<ConsumerId, Consumer>;
  joinedAt: Date;
}

/**
 * Producer для локальных медиа
 */
export interface Producer {
  id: ProducerId;
  type: 'audio' | 'video';
  paused: boolean;
  track?: MediaStreamTrack;
  appData?: Record<string, any>;
}

/**
 * Consumer для удаленных медиа
 */
export interface Consumer {
  id: ConsumerId;
  producerId: ProducerId;
  type: 'audio' | 'video';
  paused: boolean;
  track?: MediaStreamTrack;
  appData?: Record<string, any>;
}

/**
 * Информация о комнате
 */
export interface Room {
  id: RoomId;
  participants: Record<UserId, Participant>;
  createdAt: Date;
}

/**
 * Типы ошибок, которые могут возникнуть в SDK
 */
export enum ErrorType {
  CONNECTION = 'connection',
  SIGNALING = 'signaling',
  MEDIA = 'media',
  TRANSPORT = 'transport',
  PERMISSION = 'permission',
  UNKNOWN = 'unknown',
}

/**
 * Специфичный для SDK класс ошибок
 */
export class VideoCallError extends Error {
  type: ErrorType;
  
  constructor(message: string, type: ErrorType = ErrorType.UNKNOWN) {
    super(message);
    this.type = type;
    this.name = 'VideoCallError';
  }
}

/**
 * Типы сигнальных сообщений
 */
export enum SignalingMessageType {
  JOIN = 'join',
  LEAVE = 'leave',
  NEW_PRODUCER = 'newProducer',
  PRODUCER_CLOSED = 'producerClosed',
  TRANSPORT_CONNECT = 'TRANSPORT_CONNECT',
  TRANSPORT_PRODUCE = 'transportProduce',
  TRANSPORT_CONSUME = 'transportConsume',
  CONNECT_TRANSPORT = 'CONNECT_TRANSPORT',
  CONSUME = 'consume',
  RESUME = 'resume',
  PAUSE = 'pause',
  ERROR = 'error'
}

/**
 * Base interface for signaling messages
 */
export interface SignalingMessage {
  type: SignalingMessageType;
}

/**
 * Join message
 */
export interface JoinMessage extends SignalingMessage {
  type: SignalingMessageType.JOIN;
  roomId: RoomId;
  userId: UserId;
  displayName?: string;
}

/**
 * Leave message
 */
export interface LeaveMessage extends SignalingMessage {
  type: SignalingMessageType.LEAVE;
  roomId: RoomId;
  userId: UserId;
}

/**
 * New producer message
 */
export interface NewProducerMessage extends SignalingMessage {
  type: SignalingMessageType.NEW_PRODUCER;
  producerId: ProducerId;
  userId: UserId;
  kind: 'audio' | 'video';
}

/**
 * Producer closed message
 */
export interface ProducerClosedMessage extends SignalingMessage {
  type: SignalingMessageType.PRODUCER_CLOSED;
  producerId: ProducerId;
  userId: UserId;
}

/**
 * Transport connect message
 */
export interface TransportConnectMessage extends SignalingMessage {
  type: SignalingMessageType.TRANSPORT_CONNECT;
  transportId: TransportId;
  dtlsParameters: any;
}

/**
 * Transport produce message
 */
export interface TransportProduceMessage extends SignalingMessage {
  type: SignalingMessageType.TRANSPORT_PRODUCE;
  transportId: TransportId;
  kind: 'audio' | 'video';
  rtpParameters: any;
  appData?: Record<string, any>;
}

/**
 * Transport consume message
 */
export interface TransportConsumeMessage extends SignalingMessage {
  type: SignalingMessageType.TRANSPORT_CONSUME;
  transportId: TransportId;
  producerId: ProducerId;
  rtpCapabilities: any;
}

/**
 * Connect transport message
 */
export interface ConnectTransportMessage extends SignalingMessage {
  type: SignalingMessageType.CONNECT_TRANSPORT;
  transportId: TransportId;
  dtlsParameters: any;
}

/**
 * Consume message
 */
export interface ConsumeMessage extends SignalingMessage {
  type: SignalingMessageType.CONSUME;
  consumerId: ConsumerId;
  producerId: ProducerId;
  kind: 'audio' | 'video';
  rtpParameters: any;
  userId: UserId;
}

/**
 * Resume message
 */
export interface ResumeMessage extends SignalingMessage {
  type: SignalingMessageType.RESUME;
  consumerId: ConsumerId;
}

/**
 * Pause message
 */
export interface PauseMessage extends SignalingMessage {
  type: SignalingMessageType.PAUSE;
  consumerId: ConsumerId;
}

/**
 * Error message
 */
export interface ErrorMessage extends SignalingMessage {
  type: SignalingMessageType.ERROR;
  error: string;
  code?: number;
}

/**
 * Union of all signaling message types
 */
export type SignalingMessageUnion = 
  | JoinMessage
  | JoinResponse
  | LeaveMessage
  | NewProducerMessage
  | ProducerClosedMessage
  | TransportConnectMessage
  | TransportProduceMessage
  | TransportConsumeMessage
  | ConnectTransportMessage
  | ConsumeMessage
  | ResumeMessage
  | PauseMessage
  | ErrorMessage;

/**
 * Join response message
 */
import { types as mediasoupTypes } from 'mediasoup-client';

export interface JoinResponse extends SignalingMessage {
  type: SignalingMessageType.JOIN;
  sendTransportOptions: {
    id: string;
    iceParameters: mediasoupTypes.IceParameters;
    iceCandidates: mediasoupTypes.IceCandidate[];
    dtlsParameters: mediasoupTypes.DtlsParameters;
  };
  recvTransportOptions: {
    id: string;
    iceParameters: mediasoupTypes.IceParameters;
    iceCandidates: mediasoupTypes.IceCandidate[];
    dtlsParameters: mediasoupTypes.DtlsParameters;
  };
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
  userId: UserId;
  roomId: RoomId;
  displayName?: string;
}