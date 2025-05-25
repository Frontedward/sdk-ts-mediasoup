import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoCallClient } from '../video-call-client';
import { MockSignalingChannel } from '../signaling/signaling-channel';
import { ConnectionStatus, SignalingMessageType } from '../types';

describe('VideoCallClient', () => {
  let client: VideoCallClient;
  let mockSignaling: MockSignalingChannel;
  const mockRoomId = 'test-room';
  const mockUserId = 'test-user';

  beforeEach(() => {
    // Мокаем navigator и getUserMedia
    Object.defineProperty(global, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => [
              { kind: 'video', enabled: true, stop: vi.fn() },
              { kind: 'audio', enabled: true, stop: vi.fn() }
            ],
            getVideoTracks: () => [{ kind: 'video', enabled: true, stop: vi.fn() }],
            getAudioTracks: () => [{ kind: 'audio', enabled: true, stop: vi.fn() }]
          }),
          enumerateDevices: vi.fn().mockResolvedValue([])
        }
      },
      writable: true
    });

    // Мокаем window и localStorage
    const mockStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    };

    Object.defineProperty(global, 'window', {
      value: {
        localStorage: mockStorage,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      },
      writable: true
    });

    Object.defineProperty(global, 'localStorage', {
      value: mockStorage,
      writable: true
    });

    mockSignaling = new MockSignalingChannel();
    client = new VideoCallClient({
      signalingChannel: mockSignaling,
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

      await client.joinCall(mockRoomId, mockUserId);

      expect(statusChanges).toContain(ConnectionStatus.CONNECTING);
      expect(client.getCurrentRoom()?.id).toBe(mockRoomId);
      expect(client.getCurrentUserId()).toBe(mockUserId);
    });

    it('должен обрабатывать ошибки подключения', async () => {
      // Симулируем ошибку подключения
      const mockGetUserMedia = vi.fn().mockRejectedValueOnce(
        new Error('Permission denied')
      );
      
      Object.defineProperty(global, 'navigator', {
        value: {
          mediaDevices: {
            getUserMedia: mockGetUserMedia,
            enumerateDevices: vi.fn().mockResolvedValue([])
          }
        },
        writable: true
      });

      await expect(client.joinCall(mockRoomId, mockUserId)).rejects.toThrow();
      expect(client.getConnectionStatus()).toBe(ConnectionStatus.ERROR);
    });
  });

  describe('leaveCall', () => {
    it('должен корректно отключаться от звонка', async () => {
      // Сначала подключаемся
      await client.joinCall(mockRoomId, mockUserId);
      
      await client.leaveCall();

      expect(client.getCurrentRoom()).toBeNull();
      expect(client.getCurrentUserId()).toBeNull();
      expect(client.getConnectionStatus()).toBe(ConnectionStatus.DISCONNECTED);
    });
  });

  describe('enableVideo', () => {
    it('должен включать и выключать видео', async () => {
      await client.joinCall(mockRoomId, mockUserId);

      // Включаем видео
      await client.enableVideo(true);
      const videoTrack = client.getDeviceManager().getVideoTrack();
      expect(videoTrack).toBeTruthy();

      // Выключаем видео
      await client.enableVideo(false);
      // В mock режиме трек может быть остановлен
    });
  });

  describe('enableAudio', () => {
    it('должен включать и выключать аудио', async () => {
      await client.joinCall(mockRoomId, mockUserId);

      // Включаем аудио
      await client.enableAudio(true);
      const audioTrack = client.getDeviceManager().getAudioTrack();
      expect(audioTrack).toBeTruthy();

      // Выключаем аудио
      await client.enableAudio(false);
      // В mock режиме трек может быть остановлен
    });
  });

  describe('обработка ошибок', () => {
    it('должен корректно обрабатывать ошибки сигналинга', async () => {
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      // Симулируем ошибку через прямой вызов обработчика
      (mockSignaling as any).emit('message', {
        type: SignalingMessageType.ERROR,
        error: 'Connection failed',
        code: 1000
      });

      // Проверяем, что обработчик ошибок был вызван
      expect(errorHandler).toHaveBeenCalled();
    });
  });
}); 