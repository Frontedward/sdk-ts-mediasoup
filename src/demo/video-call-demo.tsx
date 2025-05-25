import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Mic, MicOff, Video, VideoOff, Users, Phone } from 'lucide-react';
import { 
  VideoCallClient, 
  MockSignalingChannel, 
  ConnectionStatus, 
  Participant 
} from '../sdk';
import { CallStore } from '../sdk/store/call-store';

// Create a mock signaling channel instead of trying to connect to a real server
const mockSignaling = new MockSignalingChannel();

// Create a client with the mock signaling channel
const client = new VideoCallClient({
  signalingChannel: mockSignaling,
  autoReconnect: true,
  useSimulcast: true
});

const store = new CallStore(client);

/**
 * Demo component for video call
 */
const VideoCallDemo: React.FC = observer(() => {
  const [roomId, setRoomId] = useState('demo-room');
  const [userId, setUserId] = useState(`user-${Math.floor(Math.random() * 1000)}`);
  const [displayName, setDisplayName] = useState('Demo User');
  const [isJoining, setIsJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Handler for joining a call
  const handleJoinCall = async () => {
    try {
      setIsJoining(true);
      setErrorMessage(null);
      await store.joinCall(roomId, userId, displayName);
    } catch (error) {
      setErrorMessage(`Failed to join call: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsJoining(false);
    }
  };

  // Handler for leaving a call
  const handleLeaveCall = async () => {
    try {
      await store.leaveCall();
    } catch (error) {
      setErrorMessage(`Failed to leave call: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm p-4">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold text-gray-800">Video Call SDK Demo</h1>
          <div className="flex items-center space-x-4">
            <ConnectionStatusIndicator status={store.connectionStatus} />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-grow container mx-auto p-4">
        {store.connectionStatus === ConnectionStatus.DISCONNECTED ? (
          <JoinForm
            roomId={roomId}
            setRoomId={setRoomId}
            userId={userId}
            setUserId={setUserId}
            displayName={displayName}
            setDisplayName={setDisplayName}
            onJoin={handleJoinCall}
            isJoining={isJoining}
            errorMessage={errorMessage}
          />
        ) : (
          <CallInterface
            store={store}
            onLeave={handleLeaveCall}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 p-4">
        <div className="container mx-auto text-center text-gray-500 text-sm">
          Mediasoup Video Call SDK Demo
        </div>
      </footer>
    </div>
  );
});

/**
 * Join form component
 */
interface JoinFormProps {
  roomId: string;
  setRoomId: (value: string) => void;
  userId: string;
  setUserId: (value: string) => void;
  displayName: string;
  setDisplayName: (value: string) => void;
  onJoin: () => void;
  isJoining: boolean;
  errorMessage: string | null;
}

const JoinForm: React.FC<JoinFormProps> = ({
  roomId,
  setRoomId,
  userId,
  setUserId,
  displayName,
  setDisplayName,
  onJoin,
  isJoining,
  errorMessage
}) => {
  return (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-6 mt-10">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Join Video Call</h2>
      
      <div className="space-y-4">
        <div>
          <label htmlFor="roomId" className="block text-sm font-medium text-gray-700 mb-1">
            Room ID
          </label>
          <input
            type="text"
            id="roomId"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isJoining}
          />
        </div>
        
        <div>
          <label htmlFor="userId" className="block text-sm font-medium text-gray-700 mb-1">
            User ID
          </label>
          <input
            type="text"
            id="userId"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isJoining}
          />
        </div>
        
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
            Display Name
          </label>
          <input
            type="text"
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isJoining}
          />
        </div>
        
        {errorMessage && (
          <div className="text-red-500 text-sm p-2 bg-red-50 rounded-md">
            {errorMessage}
          </div>
        )}
        
        <button
          onClick={onJoin}
          disabled={isJoining || !roomId || !userId}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isJoining ? 'Joining...' : 'Join Call'}
        </button>
      </div>
    </div>
  );
};

/**
 * Call interface component
 */
interface CallInterfaceProps {
  store: CallStore;
  onLeave: () => void;
}

const CallInterface: React.FC<CallInterfaceProps> = observer(({ store, onLeave }) => {
  return (
    <div className="flex flex-col h-full">
      {/* Room info */}
      <div className="bg-white shadow-sm rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              Room: {store.currentRoom?.id}
            </h2>
            <p className="text-sm text-gray-600">
              <Users size={16} className="inline mr-1" />
              {store.participants.length} Participants
            </p>
          </div>
          <button
            onClick={onLeave}
            className="bg-red-500 hover:bg-red-600 text-white rounded-full p-3 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition"
            title="Leave call"
          >
            <Phone size={20} className="transform rotate-135" />
          </button>
        </div>
      </div>
      
      {/* Video grid */}
      <div className="flex-grow grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {/* Local participant */}
        {store.localParticipant && (
          <ParticipantVideo
            participant={store.localParticipant}
            isLocal={true}
          />
        )}
        
        {/* Remote participants */}
        {store.remoteParticipants.map(participant => (
          <ParticipantVideo
            key={participant.userId}
            participant={participant}
            isLocal={false}
          />
        ))}
      </div>
      
      {/* Controls */}
      <div className="bg-white shadow-sm rounded-lg p-4">
        <div className="flex flex-wrap justify-center gap-2 w-full">
          <button
            onClick={() => store.toggleAudio()}
            className={`flex-1 min-w-[120px] rounded-full p-4 focus:outline-none focus:ring-2 focus:ring-offset-2 transition ${
              store.localAudioEnabled ? 'bg-blue-100 text-blue-500 hover:bg-blue-200 focus:ring-blue-500' : 'bg-red-100 text-red-500 hover:bg-red-200 focus:ring-red-500'
            }`}
            title={store.localAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            <div className="flex items-center justify-center">
              {store.localAudioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
            </div>
          </button>
          
          <button
            onClick={() => store.toggleVideo()}
            className={`flex-1 min-w-[120px] rounded-full p-4 focus:outline-none focus:ring-2 focus:ring-offset-2 transition ${
              store.localVideoEnabled ? 'bg-blue-100 text-blue-500 hover:bg-blue-200 focus:ring-blue-500' : 'bg-red-100 text-red-500 hover:bg-red-200 focus:ring-red-500'
            }`}
            title={store.localVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            <div className="flex items-center justify-center">
              {store.localVideoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
            </div>
          </button>
          
          <button
            onClick={onLeave}
            className="flex-1 min-w-[120px] bg-red-500 hover:bg-red-600 text-white rounded-full p-4 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition"
            title="Leave call"
          >
            <div className="flex items-center justify-center">
              <Phone size={24} className="transform rotate-135" />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
});

/**
 * Participant video component
 */
interface ParticipantVideoProps {
  participant: Participant;
  isLocal: boolean;
}

const ParticipantVideo: React.FC<ParticipantVideoProps> = ({ participant, isLocal }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  
  // Attach media tracks to video element
  useEffect(() => {
    let videoTrack: MediaStreamTrack | undefined;
    let audioTrack: MediaStreamTrack | undefined;
    
    // Find video and audio tracks
    const producers = Object.values(participant.producers);
    const consumers = Object.values(participant.consumers);
    
    for (const producer of producers) {
      if (producer.type === 'video' && producer.track) {
        videoTrack = producer.track;
        setHasVideo(true);
      } else if (producer.type === 'audio' && producer.track) {
        audioTrack = producer.track;
        setHasAudio(true);
      }
    }
    
    for (const consumer of consumers) {
      if (consumer.type === 'video' && consumer.track) {
        videoTrack = consumer.track;
        setHasVideo(true);
      } else if (consumer.type === 'audio' && consumer.track) {
        audioTrack = consumer.track;
        setHasAudio(true);
      }
    }
    
    // Create a MediaStream and attach it to the video element
    if (videoRef.current && (videoTrack || audioTrack)) {
      const stream = new MediaStream();
      if (videoTrack) stream.addTrack(videoTrack);
      if (audioTrack) stream.addTrack(audioTrack);
      
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(error => {
        console.error('Error playing video:', error);
      });
    }
    
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [participant]);
  
  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden relative">
      <video
        ref={videoRef}
        className={`w-full h-full object-cover ${!hasVideo ? 'hidden' : ''}`}
        autoPlay
        playsInline
        muted={isLocal} // Mute local video to prevent feedback
      />
      
      {!hasVideo && (
        <div className="flex items-center justify-center h-full bg-gray-700">
          <div className="bg-gray-600 rounded-full w-16 h-16 flex items-center justify-center">
            <span className="text-white text-xl font-medium">
              {participant.displayName?.[0] || participant.userId[0]}
            </span>
          </div>
        </div>
      )}
      
      {/* Participant info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
        <div className="flex justify-between items-center">
          <span className="text-white font-medium truncate">
            {participant.displayName || participant.userId}
            {isLocal && ' (You)'}
          </span>
          
          <div className="flex space-x-1">
            {!hasAudio && <MicOff size={16} className="text-red-400" />}
            {!hasVideo && <VideoOff size={16} className="text-red-400" />}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Connection status indicator component
 */
interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
}

const ConnectionStatusIndicator: React.FC<ConnectionStatusIndicatorProps> = ({ status }) => {
  let statusColor = 'bg-gray-400';
  let statusText = 'Disconnected';
  
  switch (status) {
    case ConnectionStatus.CONNECTED:
      statusColor = 'bg-green-500';
      statusText = 'Connected';
      break;
    case ConnectionStatus.CONNECTING:
      statusColor = 'bg-yellow-500';
      statusText = 'Connecting';
      break;
    case ConnectionStatus.RECONNECTING:
      statusColor = 'bg-yellow-500';
      statusText = 'Reconnecting';
      break;
    case ConnectionStatus.ERROR:
      statusColor = 'bg-red-500';
      statusText = 'Error';
      break;
  }
  
  return (
    <div className="flex items-center">
      <div className={`w-3 h-3 rounded-full ${statusColor} mr-2`}></div>
      <span className="text-sm font-medium text-gray-600">{statusText}</span>
    </div>
  );
};

export default VideoCallDemo;