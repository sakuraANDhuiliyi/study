import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import type { MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton, RichText } from './assignment-ui';
import { fetchLessonFile, openLessonFile } from './lesson-files';
import {
  LessonProgressWriter,
  lessonPosition,
  publicResource,
  publicLessonVideo,
  type LessonDetail,
} from './lesson-model';
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
  const [source, setSource] = useState<VideoSource | null>(null),
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
      setSource(null);
    });
    return () => {
      mounted.current = false;
      clear();
      release.current?.();
    };
  }, [client]);
  const external = publicResource(lesson.resourceUrl);
  const privateVideo = lesson.type === 'VIDEO' && resource?.mime === 'video/mp4';
  useEffect(() => {
    if (!source || !privateVideo || !resource) return;
    let active = true,
      inFlight = false;
    const renew = async () => {
      if (inFlight || AppState.currentState !== 'active') return;
      inFlight = true;
      try {
        const next = await client.lessonVideoSource(lesson.id, resource.id);
        if (active && mounted.current && client.ownsSession(epoch)) setSource(next);
      } catch (e) {
        if (active && mounted.current) {
          setSource(null);
          setError((e as Error).message);
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void renew(), 4 * 60000),
      subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void renew();
      }),
      stopToken = client.onAccessTokenChanged(() => void renew());
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
      stopToken();
    };
  }, [client, lesson.id, resource, privateVideo, !!source, epoch]);
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>{lesson.title}</Text>
      <RichText html={lesson.content || '本课时暂无文字内容。'} />
      {lesson.type === 'VIDEO' && resource && !source && (
        <>
          <Text style={a.muted}>
            {privateVideo
              ? '按需分段加载课程 MP4，可前后跳转并继续上次播放位置；每次加载均核验当前课程权限。'
              : '此格式使用私有临时缓存播放，单次上限 50 MiB；也可下载后使用设备兼容应用打开。'}
          </Text>
          <AButton
            title={busy ? '正在准备视频…' : '加载课程视频'}
            disabled={busy || (!privateVideo && resource.size > 50 * 1024 * 1024)}
            onPress={() => {
              setBusy(true);
              setError('');
              if (privateVideo) {
                void client
                  .lessonVideoSource(lesson.id, resource.id)
                  .then((next) => {
                    if (mounted.current && client.ownsSession(epoch)) setSource(next);
                  })
                  .catch((e) => {
                    if (mounted.current) setError(e.message);
                  })
                  .finally(() => {
                    if (mounted.current) setBusy(false);
                  });
                return;
              }
              void fetchLessonFile(client, lesson.id, resource)
                .then((f) => {
                  if (!mounted.current) {
                    f.dispose();
                    return;
                  }
                  release.current?.();
                  release.current = f.dispose;
                  setSource({ uri: f.uri, useCaching: false });
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
      {lesson.type === 'VIDEO' && !resource && external && !source && (
        <>
          <Text style={a.muted}>
            公开外部 HTTPS 视频由原生播放器直接加载，不发送学习平台登录凭据。网页型资源可使用下方浏览器入口。
          </Text>
          <AButton
            title="播放公开课程视频"
            onPress={() => {
              setError('');
              setSource(publicLessonVideo(external));
            }}
          />
        </>
      )}
      {source && (
        <LessonVideo
          source={source}
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
        .filter((f) => lesson.type !== 'VIDEO' || f.id !== lesson.attachmentId || f.mime !== 'video/mp4')
        .map((f) => (
          <AButton
            key={f.id}
            secondary
            disabled={busy}
            title={'打开或保存资料：' + f.name}
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
      {!!lesson.files.length && (
        <Text style={a.muted}>
          文档由 Android
          系统交给本机兼容应用打开或保存，平台不上传给第三方在线查看器。如未出现可用阅读器，可先保存文件再用
          PDF、Office 等本机应用打开。
        </Text>
      )}
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
  source,
  initial,
  position,
  save,
  blocked,
}: {
  source: VideoSource;
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
  const resumeAfterReplace = useRef(false);
  callback.current = save;
  // Expo releases its native player in a passive cleanup. Detach this source's
  // listeners during layout cleanup, while that same player is still valid.
  useLayoutEffect(() => {
    let active = true;
    let loaded = false;
    const savePlayback = () =>
      void callback.current().catch(() => {
        if (active) player.pause();
      });
    const start = lessonPosition(position.current),
      resume = resumeAfterReplace.current;
    resumeAfterReplace.current = false;
    player.pause();
    setReady(false);
    setError('');
    const load = player.addListener('sourceLoad', (e) => {
      if (!loaded) {
        loaded = true;
        player.currentTime = Math.min(start, Math.max(0, e.duration - 1));
        setTime(Math.min(start, Math.max(0, e.duration - 1)));
        setReady(true);
        if (resume && AppState.currentState === 'active') player.play();
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
        setError('视频暂时无法播放。请重新加载课时核对权限与格式；外部网页型资源可用浏览器打开。');
      }
    });
    const change = player.addListener('playingChange', (e) => {
      setPlaying(e.isPlaying);
    });
    const end = player.addListener('playToEnd', savePlayback);
    void player.replaceAsync(source).catch(() => {
      if (active) setError('视频加载失败，请重新打开课时。');
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' && loaded) savePlayback();
    }, 15000);
    const state = AppState.addEventListener('change', (v) => {
      if (v !== 'active') {
        player.pause();
        void callback.current().catch(() => {});
      }
    });
    return () => {
      active = false;
      load.remove();
      tick.remove();
      status.remove();
      change.remove();
      end.remove();
      state.remove();
      clearInterval(timer);
      resumeAfterReplace.current = player.playing;
      player.pause();
      void callback.current().catch(() => {});
    };
  }, [player, initial, position, source]);
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
