import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoCallClient } from '../video-call-client';
import { ConnectionStatus, ErrorType, SignalingMessageType } from '../types';

describe('VideoCallClient', () => {
  let client: VideoCallClient;
  const mockSignalingUrl = 'ws://localhost:3000';
  const mockRoomId = 'test-room';
  const mockUserId = 'test-user';

  beforeEach(() => {
    // Мокаем WebSocket
    global.WebSocket = vi.fn().mockImplementation(() => ({
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      readyState: WebSocket.OPEN
    }));

    // Мокаем getUserMedia
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [
          { kind: 'video', enabled: true, stop: vi.fn() },
          { kind: 'audio', enabled: true, stop: vi.fn() }
        ]
      })
    } as any;

    client = new VideoCallClient({
      signalingUrl: mockSignalingUrl,
      autoReconnect: true
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('joinCall', () => {
    it('должен успешно подключиться к звонку', async () => {
      const statusChanges: ConnectionStatus[] = [];
      client.on('connectionStatusChanged', (status) => {
        statusChanges.push(status);
      });

      // Симулируем успешное подключение
      setTimeout(() => {
        const ws = (WebSocket as any).mock.results[0].value;
        ws.onmessage({ data: JSON.stringify({
          type: SignalingMessageType.JOIN,
          roomId: mockRoomId,
          userId: mockUserId
        })});
      }, 0);

      await client.joinCall(mockRoomId, mockUserId);

      expect(statusChanges).toContain(ConnectionStatus.CONNECTING);
      expect(statusChanges).toContain(ConnectionStatus.CONNECTED);
      expect(client.getCurrentRoom()?.id).toBe(mockRoomId);
      expect(client.getCurrentUserId()).toBe(mockUserId);
    });

    it('должен обрабатывать ошибки подключения', async () => {
      // Симулируем ошибку подключения
      (global.navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(
        new Error('Permission denied')
      );

      await expect(client.joinCall(mockRoomId, mockUserId)).rejects.toThrow();
      expect(client.getConnectionStatus()).toBe(ConnectionStatus.ERROR);
    });
  });

  describe('leaveCall', () => {
    it('должен корректно отключаться от звонка', async () => {
      // Сначала подключаемся
      await client.joinCall(mockRoomId, mockUserId);
      
      const statusChanges: ConnectionStatus[] = [];
      client.on('connectionStatusChanged', (status) => {
        statusChanges.push(status);
      });

      await client.leaveCall();

      expect(statusChanges).toContain(ConnectionStatus.DISCONNECTED);
      expect(client.getCurrentRoom()).toBeNull();
      expect(client.getCurrentUserId()).toBeNull();
    });
  });

  describe('enableVideo', () => {
    it('должен включать и выключать видео', async () => {
      await client.joinCall(mockRoomId, mockUserId);

      // Включаем видео
      await client.enableVideo(true);
      const videoTrack = client.getDeviceManager().getVideoTrack();
      expect(videoTrack?.enabled).toBe(true);

      // Выключаем видео
      await client.enableVideo(false);
      expect(videoTrack?.enabled).toBe(false);
    });
  });

  describe('enableAudio', () => {
    it('должен включать и выключать аудио', async () => {
      await client.joinCall(mockRoomId, mockUserId);

      // Включаем аудио
      await client.enableAudio(true);
      const audioTrack = client.getDeviceManager().getAudioTrack();
      expect(audioTrack?.enabled).toBe(true);

      // Выключаем аудио
      await client.enableAudio(false);
      expect(audioTrack?.enabled).toBe(false);
    });
  });

  describe('обработка ошибок', () => {
    it('должен корректно обрабатывать ошибки сигналинга', async () => {
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      // Симулируем ошибку сигналинга
      setTimeout(() => {
        const ws = (WebSocket as any).mock.results[0].value;
        ws.onmessage({ data: JSON.stringify({
          type: SignalingMessageType.ERROR,
          error: 'Connection failed',
          code: 1000
        })});
      }, 0);

      await client.joinCall(mockRoomId, mockUserId);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ErrorType.SIGNALING
        })
      );
    });
  });
}); 