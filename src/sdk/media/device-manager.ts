/**
 * Manages media devices and streams
 */

export type MediaConstraints = MediaStreamConstraints;

export interface DeviceInfo {
  deviceId: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
  label: string;
  groupId: string;
}

export class DeviceManager {
  private localStream: MediaStream | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private audioTrack: MediaStreamTrack | null = null;

  /**
   * Get available media devices
   * @returns Promise resolving to an array of available devices
   */
  async getDevices(): Promise<DeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.map(device => ({
        deviceId: device.deviceId,
        kind: device.kind as 'audioinput' | 'audiooutput' | 'videoinput',
        label: device.label,
        groupId: device.groupId
      }));
    } catch (error) {
      console.error('Error getting devices:', error);
      return [];
    }
  }

  /**
   * Get available video input devices
   * @returns Promise resolving to an array of video input devices
   */
  async getVideoInputDevices(): Promise<DeviceInfo[]> {
    const devices = await this.getDevices();
    return devices.filter(device => device.kind === 'videoinput');
  }

  /**
   * Get available audio input devices
   * @returns Promise resolving to an array of audio input devices
   */
  async getAudioInputDevices(): Promise<DeviceInfo[]> {
    const devices = await this.getDevices();
    return devices.filter(device => device.kind === 'audioinput');
  }

  /**
   * Get available audio output devices
   * @returns Promise resolving to an array of audio output devices
   */
  async getAudioOutputDevices(): Promise<DeviceInfo[]> {
    const devices = await this.getDevices();
    return devices.filter(device => device.kind === 'audiooutput');
  }

  /**
   * Get user media with the given constraints
   * @param constraints Media constraints
   * @returns Promise resolving to a MediaStream
   */
  async getUserMedia(constraints: MediaConstraints = { audio: true, video: true }): Promise<MediaStream> {
    try {
      // Release any existing tracks
      this.releaseMediaStream();
      
      // Get new stream
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Store tracks for easy access
      this.videoTrack = this.localStream.getVideoTracks()[0] || null;
      this.audioTrack = this.localStream.getAudioTracks()[0] || null;
      
      return this.localStream;
    } catch (error) {
      console.error('Error getting user media:', error);
      throw error;
    }
  }

  /**
   * Get a fake media stream for testing
   * @returns A MediaStream with fake tracks
   */
  getFakeStream(): MediaStream {
    const stream = new MediaStream();
    
    // Create a fake video track
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // Draw something on the canvas
      setInterval(() => {
        if (ctx) {
          ctx.fillStyle = '#' + Math.floor(Math.random() * 16777215).toString(16);
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#000000';
          ctx.font = '30px Arial';
          ctx.fillText('Fake Video', 50, 50);
          ctx.fillText(new Date().toISOString(), 50, 100);
        }
      }, 1000);
      
      // @ts-ignore - Using non-standard API, but it works in modern browsers
      const videoTrack = canvas.captureStream(10).getVideoTracks()[0];
      stream.addTrack(videoTrack);
      this.videoTrack = videoTrack;
    }
    
    // Create a fake audio track (silence)
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const destination = audioContext.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    const audioTrack = destination.stream.getAudioTracks()[0];
    stream.addTrack(audioTrack);
    this.audioTrack = audioTrack;
    
    this.localStream = stream;
    return stream;
  }

  /**
   * Stop all tracks and release the media stream
   */
  releaseMediaStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
      this.videoTrack = null;
      this.audioTrack = null;
    }
  }

  /**
   * Get the current video track
   * @returns The current video track or null
   */
  getVideoTrack(): MediaStreamTrack | null {
    return this.videoTrack;
  }

  /**
   * Get the current audio track
   * @returns The current audio track or null
   */
  getAudioTrack(): MediaStreamTrack | null {
    return this.audioTrack;
  }

  /**
   * Toggle the enabled state of the video track
   * @returns The new enabled state
   */
  toggleVideo(): boolean {
    if (this.videoTrack) {
      this.videoTrack.enabled = !this.videoTrack.enabled;
      return this.videoTrack.enabled;
    }
    return false;
  }

  /**
   * Toggle the enabled state of the audio track
   * @returns The new enabled state
   */
  toggleAudio(): boolean {
    if (this.audioTrack) {
      this.audioTrack.enabled = !this.audioTrack.enabled;
      return this.audioTrack.enabled;
    }
    return false;
  }

  /**
   * Check if video is enabled
   * @returns Whether video is enabled
   */
  isVideoEnabled(): boolean {
    return this.videoTrack?.enabled ?? false;
  }

  /**
   * Check if audio is enabled
   * @returns Whether audio is enabled
   */
  isAudioEnabled(): boolean {
    return this.audioTrack?.enabled ?? false;
  }
}