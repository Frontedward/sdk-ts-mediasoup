import * as mediasoup from 'mediasoup';
import { types as mediasoupTypes } from 'mediasoup';
import { config } from './config';
import { logger } from './logger';

export class MediasoupManager {
  private worker: mediasoupTypes.Worker | null = null;
  private router: mediasoupTypes.Router | null = null;

  async init(): Promise<void> {
    try {
      // Создаем worker
      this.worker = await mediasoup.createWorker({
        ...config.mediasoup.worker,
        logLevel: config.mediasoup.worker.logLevel as mediasoupTypes.WorkerLogLevel
      });

      // Обработка событий worker
      this.worker.on('died', () => {
        logger.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', this.worker?.pid);
        setTimeout(() => process.exit(1), 2000);
      });

      // Создаем router
      this.router = await this.worker.createRouter({
        mediaCodecs: config.mediasoup.router.mediaCodecs as mediasoupTypes.RtpCodecCapability[]
      });

      logger.info('mediasoup worker and router initialized');
    } catch (error) {
      logger.error('failed to initialize mediasoup:', error);
      throw error;
    }
  }

  async createWebRtcTransport(): Promise<mediasoupTypes.WebRtcTransport> {
    if (!this.router) {
      throw new Error('Router not initialized');
    }

    try {
      const transport = await this.router.createWebRtcTransport({
        listenIps: [...config.mediasoup.webRtcTransport.listenIps],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate
      });

      logger.info('Created WebRTC transport:', {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });

      return transport;
    } catch (error) {
      logger.error('Error creating WebRTC transport:', error);
      throw error;
    }
  }

  getRouter(): mediasoupTypes.Router {
    if (!this.router) {
      throw new Error('Router not initialized');
    }
    return this.router;
  }

  async close(): Promise<void> {
    if (this.router) {
      await this.router.close();
      this.router = null;
    }
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
} 