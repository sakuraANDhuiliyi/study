import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AudioSession,
  AndroidAudioTypePresets,
  LiveKitRoom,
  VideoTrack,
  useTracks,
} from '@livekit/react-native';
import { AudioPresets, ConnectionState, Room, RoomEvent, Track } from 'livekit-client';

import { AudioSessionLease } from './audio-lifecycle';
import { permissionPrompts } from './permission-lifecycle';
const audioSessions = new AudioSessionLease();

export type Admission = {
  token: string;
  path: string;
  identity: string;
  connectionId: string;
  approved: boolean;
  host: boolean;
};
const outputNames: Record<string, string> = {
  speaker: '扬声器',
  earpiece: '听筒',
  headset: '有线耳机',
  bluetooth: '蓝牙耳机',
  default: '系统默认',
};
export function LiveRoom({
  origin,
  admission,
  onLeave,
}: {
  origin: string;
  admission: Admission;
  onLeave: (reason?: string) => void;
}) {
  const [room] = useState(
    () =>
      new Room({
        adaptiveStream: { pixelDensity: 'screen' },
        dynacast: true,
        publishDefaults: { videoCodec: 'vp8', audioPreset: AudioPresets.speech },
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 20 } },
      }),
  );
  const [audioReady, setAudioReady] = useState(false);
  useEffect(() => {
    let active = true;
    const lease = audioSessions.acquire(
      async () => {
        await AudioSession.configureAudio({
          android: {
            preferredOutputList: ['headset', 'bluetooth', 'earpiece', 'speaker'],
            audioTypeOptions: AndroidAudioTypePresets.communication,
          },
        });
        await AudioSession.startAudioSession();
      },
      () => AudioSession.stopAudioSession(),
    );
    void lease.ready
      .then((ready) => {
        if (active && ready) setAudioReady(true);
      })
      .catch(() => {
        if (active) onLeave('无法启动音频设备，请检查系统设置后重试。');
      });
    return () => {
      active = false;
      void room.disconnect(true).catch(() => undefined);
      void lease.release().catch(() => undefined);
    };
  }, [room]);
  if (!audioReady) return <Text style={s.hint}>正在准备音视频设备…</Text>;
  return (
    <LiveKitRoom
      room={room}
      serverUrl={origin.replace(/^http/, 'ws') + admission.path}
      token={admission.token}
      connect
      audio={false}
      video={false}
      onDisconnected={() => onLeave('音视频连接已断开，请重新进入课堂。')}
      onError={() => onLeave('暂时无法连接音视频，请检查网络、直播服务及平台版本。')}
    >
      <RoomControls room={room} connectionId={admission.connectionId} />
      {process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === 'true' && <PreviewMediaStats room={room} />}
    </LiveKitRoom>
  );
}
function PreviewMediaStats({ room }: { room: Room }) {
  const [stats, setStats] = useState('');
  useEffect(() => {
    let active = true,
      pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void (async () => {
        const rows = new Map<string, any>();
        for (const participant of [room.localParticipant, ...room.remoteParticipants.values()])
          for (const pub of participant.trackPublications.values()) {
            const report = await pub.track?.getRTCStatsReport();
            report?.forEach((row) => rows.set(row.id, row));
          }
        let audio = 0,
          video = 0,
          sent = 0;
        for (const row of rows.values()) {
          if (row.type === 'inbound-rtp') {
            if ((row.kind || row.mediaType) === 'audio') audio += Number(row.bytesReceived || 0);
            if ((row.kind || row.mediaType) === 'video') video += Number(row.framesDecoded || 0);
          }
          if (row.type === 'outbound-rtp') sent += Number(row.bytesSent || 0);
        }
        if (active) setStats(`验收统计：audio=${audio} frames=${video} sent=${sent}`);
      })()
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [room]);
  return (
    <Text accessibilityLabel="验收媒体统计" style={s.hint}>
      {stats}
    </Text>
  );
}
function RoomControls({ room, connectionId }: { room: Room; connectionId: string }) {
  const controlMounted = useRef(true),
    controlBusy = useRef(false);
  useEffect(() => {
    controlMounted.current = true;
    return () => {
      controlMounted.current = false;
    };
  }, []);
  const foreground = () =>
    controlMounted.current &&
    AppState.currentState === 'active' &&
    room.state === ConnectionState.Connected &&
    room.localParticipant.permissions?.canPublish === true;
  async function permission(permission: Parameters<typeof PermissionsAndroid.request>[0]) {
    if (await PermissionsAndroid.check(permission)) return true;
    const microphone = room.localParticipant.isMicrophoneEnabled,
      camera = room.localParticipant.isCameraEnabled;
    const finish = permissionPrompts.begin(connectionId);
    try {
      // No existing capture is kept alive while an OS permission activity is pending.
      if (microphone) await room.localParticipant.setMicrophoneEnabled(false);
      if (camera) await room.localParticipant.setCameraEnabled(false);
      return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 300));
      finish();
      if (foreground()) {
        if (microphone) await room.localParticipant.setMicrophoneEnabled(true);
        if (camera) await room.localParticipant.setCameraEnabled(true);
      }
    }
  }

  const [, update] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [output, setOutput] = useState('');
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);
  useEffect(() => {
    const changed = () => {
      update((x) => x + 1);
      if (room.localParticipant.permissions?.canPublish === false) {
        void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        void room.localParticipant.setCameraEnabled(false).catch(() => undefined);
      }
    };
    const events = [
      RoomEvent.ConnectionStateChanged,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantPermissionsChanged,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
    ];
    events.forEach((e) => room.on(e, changed));
    return () => {
      events.forEach((e) => room.off(e, changed));
    };
  }, [room]);
  const connected = room.state === ConnectionState.Connected;
  const canPublish = connected && room.localParticipant.permissions?.canPublish === true;
  async function device(kind: 'audio' | 'video') {
    if (controlBusy.current || !canPublish) return;
    controlBusy.current = true;
    setBusy(true);
    try {
      const enabled =
        kind === 'audio' ? room.localParticipant.isMicrophoneEnabled : room.localParticipant.isCameraEnabled;
      if (!enabled && Platform.OS === 'android') {
        const requestedPermission =
          kind === 'audio'
            ? PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
            : PermissionsAndroid.PERMISSIONS.CAMERA;
        if ((await permission(requestedPermission)) !== true) {
          Alert.alert('设备未授权', '允许麦克风或摄像头权限后才能开启。你仍可观看课堂。');
          return;
        }
      }
      if (!foreground()) return;
      if (kind === 'audio') await room.localParticipant.setMicrophoneEnabled(!enabled);
      else await room.localParticipant.setCameraEnabled(!enabled);
      update((x) => x + 1);
    } catch {
      Alert.alert('无法开启设备', '请检查系统授权、设备占用或当前连麦权限。');
    } finally {
      controlBusy.current = false;
      if (controlMounted.current) setBusy(false);
    }
  }
  return (
    <View>
      <View style={s.status}>
        <View style={[s.dot, { backgroundColor: connected ? '#22c55e' : '#f59e0b' }]} />
        <Text accessibilityRole="text" style={s.statusText}>
          {connected ? '已连接' : room.state === ConnectionState.Reconnecting ? '正在重连' : '正在连接'}
        </Text>
      </View>
      <View style={s.stage}>
        {!tracks.length && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>◉</Text>
            <Text style={s.emptyTitle}>课堂画面</Text>
            <Text style={s.hint}>等待老师或同学开启摄像头</Text>
          </View>
        )}
        {tracks.map((track) => (
          <View key={`${track.participant.identity}:${track.publication.trackSid}`} style={s.tile}>
            <VideoTrack
              trackRef={track}
              style={s.video}
              objectFit={track.source === Track.Source.ScreenShare ? 'contain' : 'cover'}
              mirror={track.participant.isLocal && track.source === Track.Source.Camera}
            />
            <Text style={s.name}>
              {track.participant.name || '课堂成员'}
              {track.participant.isLocal ? '（我）' : ''}
              {track.source === Track.Source.ScreenShare ? ' · 共享屏幕' : ''}
            </Text>
          </View>
        ))}
      </View>
      <View style={s.actions}>
        <Control
          title={room.localParticipant.isMicrophoneEnabled ? '关闭麦克风' : '开启麦克风'}
          disabled={!canPublish || busy}
          onPress={() => void device('audio')}
        />
        <Control
          title={room.localParticipant.isCameraEnabled ? '关闭摄像头' : '开启摄像头'}
          disabled={!canPublish || busy}
          onPress={() => void device('video')}
        />
        <Control
          title="声音输出"
          disabled={!connected || busy}
          onPress={() => {
            if (controlBusy.current) return;
            controlBusy.current = true;
            setBusy(true);
            setOutputs([]);
            void (async () => {
              if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
                const bluetooth = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
                if (!(await PermissionsAndroid.check(bluetooth))) await permission(bluetooth);
              }
              if (controlMounted.current && AppState.currentState === 'active')
                setOutputs(await AudioSession.getAudioOutputs());
            })()
              .catch(() => {
                if (controlMounted.current) Alert.alert('暂时无法获取音频设备');
              })
              .finally(() => {
                controlBusy.current = false;
                if (controlMounted.current) setBusy(false);
              });
          }}
        />
      </View>
      {!!outputs.length && (
        <ScrollView horizontal contentContainerStyle={s.actions}>
          {outputs.map((id) => (
            <Control
              key={id}
              title={(output === id ? '✓ ' : '') + (outputNames[id] || '音频设备')}
              onPress={() => {
                void AudioSession.selectAudioOutput(id)
                  .then(() => {
                    setOutput(id);
                    setOutputs([]);
                  })
                  .catch(() => Alert.alert('音频切换失败'));
              }}
            />
          ))}
        </ScrollView>
      )}
      <Text style={s.hint}>
        {canPublish
          ? '麦克风和摄像头由你手动开启。建议使用耳机，避免回声。'
          : '当前可观看和收听；举手并经教师批准后可开启设备。'}
      </Text>
    </View>
  );
}
function Control({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={[s.control, disabled && s.disabled]}
    >
      <Text style={s.controlText}>{title}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 14, color: '#475569' },
  stage: { backgroundColor: '#101827', borderRadius: 20, overflow: 'hidden', minHeight: 225 },
  empty: { minHeight: 225, alignItems: 'center', justifyContent: 'center', padding: 18 },
  emptyIcon: { fontSize: 40, color: '#a5b4fc' },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: 'white', marginVertical: 10 },
  hint: { fontSize: 13, lineHeight: 21, color: '#7c879b', marginVertical: 10 },
  tile: { height: 230, marginBottom: 2 },
  video: { flex: 1 },
  name: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    color: 'white',
    backgroundColor: '#101827aa',
    padding: 6,
    borderRadius: 6,
    fontSize: 13,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  control: {
    paddingHorizontal: 13,
    paddingVertical: 13,
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    minHeight: 46,
    justifyContent: 'center',
  },
  controlText: { color: '#4338ca', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
