import { Socket } from 'socket.io';
import { types as mediasoupTypes } from 'mediasoup';

export type RoomId = string;
export type UserId = string;
export type ProducerId = string;
export type ConsumerId = string;
export type TransportId = string;

/**
 * Участник видеозвонка
 */
export interface Participant {
  userId: UserId;
  displayName?: string;
  socket: Socket;
  producers: Map<ProducerId, Producer>;
  consumers: Map<ConsumerId, Consumer>;
  joinedAt: Date;
}

/**
 * Producer для медиа-потока
 */
export interface Producer {
  id: ProducerId;
  userId: UserId;
  transport: mediasoupTypes.Transport;
  producer: mediasoupTypes.Producer;
  kind: 'audio' | 'video';
  rtpParameters: mediasoupTypes.RtpParameters;
  appData?: Record<string, any>;
}

/**
 * Consumer для медиа-потока
 */
export interface Consumer {
  id: ConsumerId;
  userId: UserId;
  producerId: ProducerId;
  transport: mediasoupTypes.Transport;
  consumer: mediasoupTypes.Consumer;
  kind: 'audio' | 'video';
  rtpParameters: mediasoupTypes.RtpParameters;
  appData?: Record<string, any>;
}

/**
 * Комната видеозвонка
 */
export interface Room {
  id: RoomId;
  participants: Map<UserId, Participant>;
  createdAt: Date;
}

/**
 * Типы сигналинг-сообщений
 */
export enum SignalingMessageType {
  JOIN = 'join',
  LEAVE = 'leave',
  NEW_PRODUCER = 'newProducer',
  PRODUCER_CLOSED = 'producerClosed',
  TRANSPORT_CONNECT = 'transportConnect',
  TRANSPORT_PRODUCE = 'transportProduce',
  TRANSPORT_CONSUME = 'transportConsume',
  CONNECT_TRANSPORT = 'connectTransport',
  CONSUME = 'consume',
  RESUME = 'resume',
  PAUSE = 'pause',
  ERROR = 'error'
}

/**
 * Базовый интерфейс для сигналинг-сообщений
 */
export interface SignalingMessage {
  type: SignalingMessageType;
}

/**
 * Сообщение о присоединении
 */
export interface JoinMessage extends SignalingMessage {
  type: SignalingMessageType.JOIN;
  roomId: RoomId;
  userId: UserId;
  displayName?: string;
}

/**
 * Сообщение о выходе
 */
export interface LeaveMessage extends SignalingMessage {
  type: SignalingMessageType.LEAVE;
  roomId: RoomId;
  userId: UserId;
}

/**
 * Сообщение о новом producer
 */
export interface NewProducerMessage extends SignalingMessage {
  type: SignalingMessageType.NEW_PRODUCER;
  producerId: ProducerId;
  userId: UserId;
  kind: 'audio' | 'video';
}

/**
 * Сообщение о закрытии producer
 */
export interface ProducerClosedMessage extends SignalingMessage {
  type: SignalingMessageType.PRODUCER_CLOSED;
  producerId: ProducerId;
  userId: UserId;
}

/**
 * Сообщение о подключении транспорта
 */
export interface TransportConnectMessage extends SignalingMessage {
  type: SignalingMessageType.TRANSPORT_CONNECT;
  transportId: TransportId;
  dtlsParameters: mediasoupTypes.DtlsParameters;
}

/**
 * Сообщение о создании producer
 */
export interface TransportProduceMessage extends SignalingMessage {
  type: SignalingMessageType.TRANSPORT_PRODUCE;
  transportId: TransportId;
  kind: 'audio' | 'video';
  rtpParameters: mediasoupTypes.RtpParameters;
  appData?: Record<string, any>;
}

/**
 * Сообщение о создании consumer
 */
export interface TransportConsumeMessage extends SignalingMessage {
  type: SignalingMessageType.TRANSPORT_CONSUME;
  transportId: TransportId;
  producerId: ProducerId;
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
}

/**
 * Сообщение о подключении транспорта
 */
export interface ConnectTransportMessage extends SignalingMessage {
  type: SignalingMessageType.CONNECT_TRANSPORT;
  transportId: TransportId;
  dtlsParameters: mediasoupTypes.DtlsParameters;
}

/**
 * Сообщение о создании consumer
 */
export interface ConsumeMessage extends SignalingMessage {
  type: SignalingMessageType.CONSUME;
  consumerId: ConsumerId;
  producerId: ProducerId;
  kind: 'audio' | 'video';
  rtpParameters: mediasoupTypes.RtpParameters;
  userId: UserId;
}

/**
 * Сообщение о возобновлении consumer
 */
export interface ResumeMessage extends SignalingMessage {
  type: SignalingMessageType.RESUME;
  consumerId: ConsumerId;
}

/**
 * Сообщение о паузе consumer
 */
export interface PauseMessage extends SignalingMessage {
  type: SignalingMessageType.PAUSE;
  consumerId: ConsumerId;
}

/**
 * Сообщение об ошибке
 */
export interface ErrorMessage extends SignalingMessage {
  type: SignalingMessageType.ERROR;
  error: string;
  code?: number;
}

/**
 * Объединение всех типов сигналинг-сообщений
 */
export type SignalingMessageUnion =
  | JoinMessage
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