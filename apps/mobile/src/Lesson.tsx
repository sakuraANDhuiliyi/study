import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton, RichText } from './assignment-ui';
import { fetchLessonFile, openLessonFile } from './lesson-files';
import { LessonProgressWriter, lessonPosition, publicResource, type LessonDetail } from './lesson-model';
export function Lesson({ client, id, onSaved }: { client: MobileClient; id: string; onSaved(): void }) {
  const q = useResource<LessonDetail>(client, '/mobile/lessons/' + encodeURIComponent(id));
  const [version, setVersion] = useState(0);
  const [replacement, setReplacement] = useState<LessonDetail | null>(null),
    [reloadError, setReloadError] = useState('');
  if (q.error)
    return (
      <View style={a.card}>
        <Text style={a.error}>{q.error}</Text>
        <AButton title="重新加载课时" onPress={q.reload} />
      </View>
    );
  if (!q.data) return <Text style={a.muted}>正在加载课时…</Text>;
  return (
    <View style={{ gap: 10 }}>
      {reloadError ? <Text style={a.error}>{reloadError}</Text> : null}
      <LessonBody
        key={id + ':' + version}
        client={client}
        lesson={replacement || q.data}
        onSaved={onSaved}
        reload={() => {
          void client
            .request<LessonDetail>('/mobile/lessons/' + encodeURIComponent(id))
            .then((d) => {
              setReloadError('');
              setReplacement(d);
              setVersion((v) => v + 1);
            })
            .catch((e) => setReloadError(e.message));
        }}
      />
    </View>
  );
}
function LessonBody({
  client,
  lesson,
  onSaved,
  reload,
}: {
  client: MobileClient;
  lesson: LessonDetail;
  onSaved(): void;
  reload(): void;
}) {
  const [uri, setUri] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const [completed, setCompleted] = useState(!!lesson.progress?.completed);
  const position = useRef(lesson.progress?.positionSeconds || 0),
    done = useRef(completed),
    mounted = useRef(true);
  const epoch = useRef(client.sessionEpoch()).current;
  const writer = useRef<LessonProgressWriter | null>(null);
  if (!writer.current)
    writer.current = new LessonProgressWriter(lesson.progress, (body) => {
      if (!client.ownsSession(epoch)) return Promise.reject(new Error('登录身份已变化。'));
      return client.request('/mobile/lessons/' + encodeURIComponent(lesson.id) + '/progress', body, 'PUT');
    });
  const save = async () => {
    try {
      await writer.current!.save(done.current, position.current);
      if (mounted.current) {
        setSaved(true);
        setError('');
      }
      onSaved();
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setSaved(false);
      }
      throw e;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const resource = lesson.files.find((f) => f.id === lesson.attachmentId);
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    const clear = client.onSessionInvalidated(() => {
      release.current?.();
      setUri(null);
    });
    return () => {
      mounted.current = false;
      clear();
      release.current?.();
    };
  }, [client]);
  const external = publicResource(lesson.resourceUrl);
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>{lesson.title}</Text>
      <RichText html={lesson.content || '本课时暂无文字内容。'} />
      {lesson.type === 'VIDEO' && resource && !uri && (
        <>
          <Text style={a.muted}>
            下载到私有临时缓存后播放，退出课时即清理。单次上限50 MiB，大文件请在网页查看。
          </Text>
          <AButton
            title={busy ? '正在准备视频…' : '加载课程视频'}
            disabled={busy || resource.size > 50 * 1024 * 1024}
            onPress={() => {
              setBusy(true);
              setError('');
              void fetchLessonFile(client, lesson.id, resource)
                .then((f) => {
                  if (!mounted.current) {
                    f.dispose();
                    return;
                  }
                  release.current?.();
                  release.current = f.dispose;
                  setUri(f.uri);
                })
                .catch((e) => {
                  if (mounted.current) setError(e.message);
                })
                .finally(() => {
                  if (mounted.current) setBusy(false);
                });
            }}
          />
        </>
      )}
      {uri && (
        <LessonVideo
          uri={uri}
          initial={lesson.progress?.positionSeconds || 0}
          position={position}
          save={() => saveRef.current()}
          blocked={!!error}
        />
      )}
      {external && (
        <AButton
          secondary
          title="在浏览器打开外部课程资源"
          onPress={() => void Linking.openURL(external).catch(() => setError('无法打开课程链接。'))}
        />
      )}
      {!!lesson.resourceUrl && !external && (
        <Text style={a.muted}>此资源链接不能在安全手机环境中打开，请联系教师改用HTTPS。</Text>
      )}
      {lesson.files
        .filter((f) => lesson.type !== 'VIDEO' || f.id !== lesson.attachmentId)
        .map((f) => (
          <AButton
            key={f.id}
            secondary
            disabled={busy}
            title={'下载资料：' + f.name}
            onPress={() => {
              setBusy(true);
              void openLessonFile(client, lesson.id, f)
                .catch((e) => {
                  if (mounted.current) setError(e.message);
                })
                .finally(() => {
                  if (mounted.current) setBusy(false);
                });
            }}
          />
        ))}
      {error ? (
        <>
          <Text style={a.error}>{error}</Text>
          <AButton secondary title="重新加载课时" onPress={reload} />
        </>
      ) : null}
      <Text style={a.muted}>
        {saved ? '学习进度已保存' : `上次保存位置：${lesson.progress?.positionSeconds || 0} 秒`}
      </Text>
      <AButton
        secondary
        title="保存当前学习位置"
        disabled={busy || !!error}
        onPress={() => {
          setBusy(true);
          void save()
            .catch(() => {})
            .finally(() => {
              if (mounted.current) setBusy(false);
            });
        }}
      />
      <AButton
        title={completed ? '取消完成标记' : '我已完成学习'}
        disabled={busy || !!error}
        onPress={() => {
          const next = !completed;
          done.current = next;
          setBusy(true);
          void save()
            .then(() => setCompleted(next))
            .catch(() => {
              done.current = completed;
            })
            .finally(() => {
              if (mounted.current) setBusy(false);
            });
        }}
      />
    </View>
  );
}
function LessonVideo({
  uri,
  initial,
  position,
  save,
  blocked,
}: {
  uri: string;
  initial: number;
  position: React.MutableRefObject<number>;
  save(): Promise<void>;
  blocked: boolean;
}) {
  const [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false),
    [time, setTime] = useState(initial),
    [error, setError] = useState('');
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 1;
    p.staysActiveInBackground = false;
    p.loop = false;
  });
  const callback = useRef(save);
  callback.current = save;
  useEffect(() => {
    let loaded = false;
    const load = player.addListener('sourceLoad', (e) => {
      if (!loaded) {
        loaded = true;
        player.currentTime = Math.min(lessonPosition(initial), Math.max(0, e.duration - 1));
        setTime(Math.min(lessonPosition(initial), Math.max(0, e.duration - 1)));
        setReady(true);
      }
    });
    const tick = player.addListener('timeUpdate', (e) => {
      position.current = lessonPosition(e.currentTime);
      const next = position.current;
      setTime((previous) => (Math.floor(previous / 5) === Math.floor(next / 5) ? previous : next));
    });
    const status = player.addListener('statusChange', (e) => {
      if (e.status === 'error') {
        player.pause();
        setError('视频无法播放，请检查资源格式，或在网页中查看。');
      }
    });
    const change = player.addListener('playingChange', (e) => {
      setPlaying(e.isPlaying);
    });
    const end = player.addListener('playToEnd', () => {
      void callback.current().catch(() => player.pause());
    });
    void player.replaceAsync(uri).catch(() => setError('视频加载失败，请重新打开课时。'));
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' && loaded) void callback.current().catch(() => player.pause());
    }, 15000);
    const state = AppState.addEventListener('change', (v) => {
      if (v !== 'active') {
        player.pause();
        void callback.current().catch(() => {});
      }
    });
    return () => {
      load.remove();
      tick.remove();
      status.remove();
      change.remove();
      end.remove();
      state.remove();
      clearInterval(timer);
      void callback.current().catch(() => {});
    };
  }, [player, initial, position, uri]);
  useEffect(() => {
    if (blocked) player.pause();
  }, [blocked, player]);
  return (
    <View style={{ gap: 10 }}>
      <VideoView
        player={player}
        style={{ width: '100%', height: 210, backgroundColor: '#16121f' }}
        nativeControls={false}
      />
      <Text style={a.muted}>{error || (ready ? `播放位置：${time} 秒` : '正在加载播放器…')}</Text>
      <AButton
        title={playing ? '暂停视频' : '播放视频'}
        disabled={!ready || blocked || !!error}
        onPress={() => {
          if (playing) {
            player.pause();
            position.current = lessonPosition(player.currentTime);
            setTime(position.current);
            void save().catch(() => {});
          } else player.play();
        }}
      />
      <View style={a.row}>
        <AButton
          secondary
          title="后退10秒"
          disabled={!ready || blocked}
          onPress={() => {
            player.currentTime = Math.max(0, player.currentTime - 10);
          }}
        />
        <AButton
          secondary
          title="前进10秒"
          disabled={!ready || blocked}
          onPress={() => {
            player.currentTime = Math.min(Math.max(0, player.duration - 1), player.currentTime + 10);
          }}
        />
      </View>
    </View>
  );
}
