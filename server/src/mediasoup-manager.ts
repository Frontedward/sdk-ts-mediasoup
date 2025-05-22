import * as mediasoup from 'mediasoup';
import { types as mediasoupTypes } from 'mediasoup';
import { logger } from './logger';

export class MediasoupManager {
  private worker?: mediasoupTypes.Worker;
  private router?: mediasoupTypes.Router;

  async init(): Promise<void> {
    try {
      // Создаем mediasoup Worker
      this.worker = await mediasoup.createWorker({
        logLevel: 'debug',
        logTags: [
          'info',
          'ice',
          'dtls',
          'rtp',
          'srtp',
          'rtcp',
          'rtx',
          'bwe',
          'score',
          'simulcast',
          'svc',
          'sctp'
        ],
        rtcMinPort: 40000,
        rtcMaxPort: 49999
      });

      // Обработчики событий Worker
      this.worker.on('died', () => {
        logger.error('mediasoup Worker died, exiting in 2 seconds... [pid:%d]', this.worker?.pid);
        setTimeout(() => process.exit(1), 2000);
      });

      // Создаем mediasoup Router
      const mediaCodecs: mediasoupTypes.RtpCodecCapability[] = [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
          parameters: {
            useinbandfec: 1,
            minptime: 10,
            maxptime: 60
          }
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
          }
        }
      ];

      this.router = await this.worker.createRouter({ mediaCodecs });
      logger.info('mediasoup Router created');

    } catch (error) {
      logger.error('Error initializing mediasoup:', error);
      throw error;
    }
  }

  async createWebRtcTransport(): Promise<{
    transport: mediasoupTypes.WebRtcTransport;
    params: {
      id: string;
      iceParameters: mediasoupTypes.IceParameters;
      iceCandidates: mediasoupTypes.IceCandidate[];
      dtlsParameters: mediasoupTypes.DtlsParameters;
    };
  }> {
    if (!this.router) {
      throw new Error('Router not initialized');
    }

    try {
      const transport = await this.router.createWebRtcTransport({
        listenIps: [
          {
            ip: '0.0.0.0',
            announcedIp: undefined // Для локальной разработки
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000,
        maxSctpMessageSize: 262144
      });

      // Добавляем обработчики событий
      transport.on('icestatechange', (state) => {
        logger.info('Transport ICE state changed to %s', state);
      });

      transport.on('dtlsstatechange', (state) => {
        logger.info('Transport DTLS state changed to %s', state);
      });

      transport.on('sctpstatechange', (state) => {
        logger.info('Transport SCTP state changed to %s', state);
      });

      transport.observer.on('close', () => {
        logger.info('Transport closed');
      });

      return {
        transport,
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        }
      };
    } catch (error) {
      logger.error('Error creating WebRTC transport:', error);
      throw error;
    }
  }

  async connectTransport(transport: mediasoupTypes.WebRtcTransport, dtlsParameters: mediasoupTypes.DtlsParameters): Promise<void> {
    try {
      logger.info('Connecting transport %s with DTLS parameters: %o', transport.id, dtlsParameters);
      await transport.connect({ dtlsParameters });
      logger.info('Transport %s connected successfully', transport.id);
    } catch (error) {
      logger.error('Error connecting transport %s: %o', transport.id, error);
      throw error;
    }
  }

  async createProducer(
    transport: mediasoupTypes.WebRtcTransport,
    rtpParameters: mediasoupTypes.RtpParameters,
    kind: mediasoupTypes.MediaKind
  ): Promise<mediasoupTypes.Producer> {
    try {
      logger.info('Creating producer with parameters: %o', { transportId: transport.id, kind, rtpParameters });
      const producer = await transport.produce({ kind, rtpParameters });
      
      producer.on('transportclose', () => {
        logger.info('Producer transport closed [producerId:%s]', producer.id);
      });

      producer.on('score', (score) => {
        logger.debug('Producer score update [producerId:%s, score:%o]', producer.id, score);
      });

      return producer;
    } catch (error) {
      logger.error('Error creating producer: %o', error);
      throw error;
    }
  }

  async createConsumer(
    transport: mediasoupTypes.WebRtcTransport,
    producer: mediasoupTypes.Producer,
    rtpCapabilities: mediasoupTypes.RtpCapabilities
  ): Promise<{
    consumer: mediasoupTypes.Consumer;
    params: {
      id: string;
      producerId: string;
      kind: mediasoupTypes.MediaKind;
      rtpParameters: mediasoupTypes.RtpParameters;
      type: mediasoupTypes.ConsumerType;
      producerPaused: boolean;
    };
  }> {
    if (!this.router) {
      throw new Error('Router not initialized');
    }

    try {
      // Проверяем возможность потребления
      if (!this.router.canConsume({
        producerId: producer.id,
        rtpCapabilities
      })) {
        throw new Error('Cannot consume this producer');
      }

      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: false
      });

      consumer.on('transportclose', () => {
        logger.info('Consumer transport closed [consumerId:%s]', consumer.id);
      });

      consumer.on('producerclose', () => {
        logger.info('Consumer producer closed [consumerId:%s]', consumer.id);
      });

      consumer.on('score', (score) => {
        logger.debug('Consumer score update [consumerId:%s, score:%o]', consumer.id, score);
      });

      return {
        consumer,
        params: {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          type: consumer.type,
          producerPaused: consumer.producerPaused
        }
      };
    } catch (error) {
      logger.error('Error creating consumer: %o', error);
      throw error;
    }
  }

  getRouterRtpCapabilities(): mediasoupTypes.RtpCapabilities {
    if (!this.router) {
      throw new Error('Router not initialized');
    }
    return this.router.rtpCapabilities;
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
} 