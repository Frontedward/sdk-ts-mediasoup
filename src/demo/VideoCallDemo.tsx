import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { VideoCallClient } from '../sdk/video-call-client';
import { ConnectionStatus, Participant } from '../sdk/types';
import { CallStore } from '../sdk/store/call-store';

// Компонент для отображения видео участника
const ParticipantView: React.FC<{ participant: Participant }> = ({ participant }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoTrack = Object.values(participant.consumers)
      .find(consumer => consumer.type === 'video')?.track;

    if (videoTrack && videoRef.current) {
      videoRef.current.srcObject = new MediaStream([videoTrack]);
    }
  }, [participant.consumers]);

  return (
    <div className="participant-view">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.userId === 'local'}
        className="w-full h-full object-cover rounded-lg"
      />
      <div className="participant-info">
        {participant.displayName || participant.userId}
      </div>
    </div>
  );
};

// Основной компонент демо
export const VideoCallDemo: React.FC = observer(() => {
  const [client] = useState(() => new VideoCallClient({
    signalingUrl: 'ws://localhost:3000',
    autoReconnect: true,
    useSimulcast: true
  }));

  const [store] = useState(() => new CallStore(client));
  const [roomId, setRoomId] = useState('');
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Подключение к звонку
  const handleJoin = async () => {
    try {
      await client.joinCall(roomId, userId, displayName);
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
        {/* Локальное видео */}
        {store.localVideoEnabled && (
          <div className="aspect-video bg-gray-800 rounded-lg overflow-hidden">
            <video
              ref={(el) => {
                if (el) {
                  const videoTrack = store.localVideoTrack;
                  if (videoTrack) {
                    el.srcObject = new MediaStream([videoTrack]);
                  }
                }
              }}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-2 left-2 text-white bg-black bg-opacity-50 px-2 py-1 rounded">
              Вы (локально)
            </div>
          </div>
        )}

        {/* Удаленные участники */}
        {Object.values(store.participants).map((participant) => (
          <ParticipantView
            key={participant.userId}
            participant={participant}
          />
        ))}
      </div>
    </div>
  );
}); 