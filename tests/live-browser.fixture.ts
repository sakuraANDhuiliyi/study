import type { BrowserContext, Page } from '@playwright/test';
import type { LiveTestClient } from './live.fixture';

// This generates deterministic camera/microphone/screen sources, but uses the shipped
// UI, real SDP/ICE/SRTP, real LiveKit and PostgreSQL. Peer construction is observed for
// real statistics; no server/SDK response is mocked. Physical devices and OS dialogs
// remain manual checks.
export async function installMedia(context: BrowserContext) {
  const setup = () => {
    const original = window.RTCPeerConnection;
    const peers: RTCPeerConnection[] = [];
    (window as any).__livePeers = peers;
    window.RTCPeerConnection = class extends original {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        peers.push(this);
      }
    };
    const video = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d')!;
      const draw = () => {
        ctx.fillStyle = '#2e5fa3';
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = 'white';
        ctx.font = '28px sans-serif';
        ctx.fillText('Live classroom ' + Date.now(), 20, 160);
      };
      draw();
      const timer = setInterval(draw, 80);
      const stream = canvas.captureStream(12);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        clearInterval(timer);
        stop();
      };
      return track;
    };
    const audio = async () => {
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = 440;
      const gain = ctx.createGain();
      gain.gain.value = 0.02;
      const destination = ctx.createMediaStreamDestination();
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      await ctx.resume();
      const track = destination.stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        oscillator.stop();
        void ctx.close();
        stop();
      };
      return track;
    };
    const getUserMedia = async (constraints: MediaStreamConstraints) => {
      const tracks: MediaStreamTrack[] = [];
      if (constraints?.video) tracks.push(video());
      if (constraints?.audio) tracks.push(await audio());
      return new MediaStream(tracks);
    };
    const getDisplayMedia = async () => new MediaStream([video()]);
    const enumerateDevices = async () =>
      [
        {
          deviceId: 'review-microphone',
          groupId: 'review',
          kind: 'audioinput',
          label: '验收麦克风',
          toJSON: () => ({}),
        },
        {
          deviceId: 'review-camera',
          groupId: 'review',
          kind: 'videoinput',
          label: '验收摄像头',
          toJSON: () => ({}),
        },
      ] as MediaDeviceInfo[];
    // WebKit's methods reject assignment on the instance; define the fixture methods
    // explicitly so a failed installation never silently falls back to physical devices.
    Object.defineProperties(Object.getPrototypeOf(navigator.mediaDevices), {
      getUserMedia: { configurable: true, value: getUserMedia },
      getDisplayMedia: { configurable: true, value: getDisplayMedia },
      enumerateDevices: { configurable: true, value: enumerateDevices },
    });
  };
  // tsx preserves nested function/class names through an esbuild __name helper.
  // Include that helper in the browser's serialized initialization scope.
  await context.addInitScript({
    content:
      'var __name=(target,value)=>Object.defineProperty(target,"name",{value,configurable:true});(' +
      setup.toString() +
      ')();',
  });
}
export async function attachLogin(context: BrowserContext, client: LiveTestClient, origin: string) {
  const cookie = client.cookie
    .split(';')
    .find((s) => s.trim().startsWith('lms_session='))!
    .trim();
  await context.addCookies([
    { name: 'lms_session', value: cookie.slice(12), url: origin, httpOnly: true, sameSite: 'Lax' },
  ]);
}
export async function inbound(page: Page, kind: string) {
  return page.evaluate(async (kind) => {
    let bytes = 0;
    for (const peer of (window as any).__livePeers as RTCPeerConnection[]) {
      if (peer.connectionState === 'closed') continue;
      const stats = await peer.getStats();
      stats.forEach((s) => {
        if (s.type === 'inbound-rtp' && (s.kind || s.mediaType) === kind)
          bytes += Number(s.bytesReceived || 0);
      });
    }
    return bytes;
  }, kind);
}
