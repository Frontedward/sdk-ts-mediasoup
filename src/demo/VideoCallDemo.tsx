import React, { useEffect, useState, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { VideoCallClient } from '../sdk/video-call-client';
import { ConnectionStatus, Participant } from '../sdk/types';
import { CallStore } from '../sdk/store/call-store';
import { MockSignalingChannel } from '../sdk/signaling/signaling-channel';

// Компонент для отображения видео участника
const ParticipantView: React.FC<{ participant: Participant; client: VideoCallClient }> = observer(({ participant, client }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const currentUserId = client.getCurrentUserId();

  useEffect(() => {
    // Для локального пользователя показываем реальное видео
    if (participant.userId === currentUserId) {
      const videoTrack = client.getDeviceManager().getVideoTrack();
      if (videoTrack && videoRef.current) {
        videoRef.current.srcObject = new MediaStream([videoTrack]);
      } else if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      return;
    }

    // Для удаленных участников в mock режиме показываем заглушку
    // В реальном режиме здесь будут consumers
    const videoConsumer = Object.values(participant.consumers)
      .find(consumer => consumer.type === 'video');
    
    if (videoConsumer?.track && videoRef.current) {
      videoRef.current.srcObject = new MediaStream([videoConsumer.track]);
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [participant.consumers, participant.producers, participant.userId, currentUserId, client]);

  // Проверяем, есть ли видео
  const isLocalUser = participant.userId === currentUserId;
  const hasLocalVideo = isLocalUser && client.getDeviceManager().getVideoTrack();
  const hasRemoteVideo = !isLocalUser && Object.values(participant.producers).some(p => p.type === 'video');
  


  // Для локального пользователя добавляем индикатор
  const displayName = isLocalUser 
    ? `${participant.displayName || participant.userId} (Вы)` 
    : (participant.displayName || participant.userId);

  return (
    <div className="aspect-video bg-gray-800 rounded-lg overflow-hidden relative">
      {(hasLocalVideo || hasRemoteVideo) ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocalUser}
            className="w-full h-full object-cover"
          />
          {/* Для удаленных участников в mock режиме показываем заглушку поверх видео */}
          {!isLocalUser && (
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <div className="text-center text-white">
                <div className="text-6xl mb-4">📹</div>
                <div className="text-lg font-semibold">Видео участника</div>
                <div className="text-sm opacity-75">(Mock режим)</div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white">
          <div className="text-center">
            <div className="text-4xl mb-2">👤</div>
            <div>Нет видео</div>
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 text-white bg-black bg-opacity-50 px-2 py-1 rounded">
        {displayName}
      </div>
    </div>
  );
});

// Основной компонент демо
export const VideoCallDemo: React.FC = observer(() => {
  const client = useMemo(() => new VideoCallClient({
    signalingChannel: new MockSignalingChannel(),
    autoReconnect: true,
    useSimulcast: false
  }), []);

  const [store] = useState(() => new CallStore(client));
  const [roomId, setRoomId] = useState('');
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Подключение к звонку
  const handleJoin = async () => {
    try {
      await client.joinCall(roomId, userId);
    } catch (error) {
      console.error('Ошибка подключения:', error);
    }
  };

  // Отключение от звонка
  const handleLeave = async () => {
    try {
      await client.leaveCall();
    } catch (error) {
      console.error('Ошибка отключения:', error);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Демо видеозвонка</h1>

      {/* Форма подключения */}
      {store.connectionStatus === ConnectionStatus.DISCONNECTED && (
        <div className="mb-4 p-4 border rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Подключение к звонку</h2>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="ID комнаты"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full p-2 border rounded"
            />
            <input
              type="text"
              placeholder="ID пользователя"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full p-2 border rounded"
            />
            <input
              type="text"
              placeholder="Отображаемое имя"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full p-2 border rounded"
            />
            <button
              onClick={handleJoin}
              disabled={!roomId || !userId}
              className="w-full bg-blue-500 text-white p-2 rounded disabled:bg-gray-300"
            >
              Присоединиться
            </button>
          </div>
        </div>
      )}

      {/* Статус соединения */}
      <div className="mb-4">
        Статус: {store.connectionStatus}
      </div>

      {/* Управление медиа */}
      {store.connectionStatus === ConnectionStatus.CONNECTED && (
        <div className="mb-4 flex space-x-2">
          <button
            onClick={() => store.toggleVideo()}
            className={`px-4 py-2 rounded ${
              store.localVideoEnabled ? 'bg-red-500' : 'bg-green-500'
            } text-white`}
          >
            {store.localVideoEnabled ? 'Выключить видео' : 'Включить видео'}
          </button>
          <button
            onClick={() => store.toggleAudio()}
            className={`px-4 py-2 rounded ${
              store.localAudioEnabled ? 'bg-red-500' : 'bg-green-500'
            } text-white`}
          >
            {store.localAudioEnabled ? 'Выключить аудио' : 'Включить аудио'}
          </button>
          <button
            onClick={handleLeave}
            className="px-4 py-2 bg-red-500 text-white rounded"
          >
            Покинуть звонок
          </button>
        </div>
      )}

      {/* Сетка участников */}
      <div className="grid grid-cols-2 gap-4">
        {/* Все участники (включая локального) */}
        {Object.values(store.participants).map((participant) => (
          <ParticipantView
            key={participant.userId}
            participant={participant}
            client={client}
          />
        ))}
      </div>
    </div>
  );
}); 