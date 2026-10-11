import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Spin } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { api, send, ApiError, getCsrf, type User } from '../api';
import { PageTitle, QueryState } from '../components/shared';

export function AndroidProgramming() {
  const { user } = useAuth();
  const client = useQueryClient();
  const identity = JSON.stringify([user, getCsrf()]);
  const status = useQuery<{
    available: boolean;
    reason: string;
    ai?: { available: boolean; reason: string };
  }>({
    queryKey: ['/programming/android/status', identity],
    enabled: !!user,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    queryFn: async ({ signal }) => {
      const current = () =>
        !signal.aborted &&
        identity === JSON.stringify([client.getQueryData<{ user: User }>(['auth'])?.user, getCsrf()]);
      const check = () => {
        if (!current()) throw new DOMException('工作室身份已变化', 'AbortError');
      };
      check();
      const response = await fetch('/api/programming/android/status', { credentials: 'include', signal });
      check();
      const body = await response.json();
      check();
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event('auth-expired'));
        throw new ApiError(response.status, body.message || '工作室状态读取失败');
      }
      return body;
    },
  });
  return (
    <div className="programming-page">
      <PageTitle
        title="Android App 工作室"
        description="创建 Android 项目，通过 Agent 修改源码、查看任务和构建日志，下载真实构建产物。"
        extra={
          <>
            <Button loading={status.isFetching} onClick={() => void status.refetch()}>
              刷新状态
            </Button>
            <Link to="/programming">
              <Button>返回网站工作室</Button>
            </Link>
          </>
        }
      />
      <QueryState query={status}>
        {status.data?.available ? (
          <>
            {status.data.ai?.available === false && (
              <Alert showIcon type="info" message={status.data.ai.reason} style={{ marginBottom: 16 }} />
            )}
            <iframe
              key={JSON.stringify([user, getCsrf()])}
              src="/api/programming/android/workbench/index.html"
              title="Android Agent 工作台"
              style={{ width: '100%', height: '80vh', border: 0, borderRadius: 12 }}
            />
          </>
        ) : (
          <Alert
            showIcon
            type="info"
            message={status.data?.reason || 'Android 构建服务正在启动'}
            description="服务恢复后点击刷新状态即可重新进入工作室。"
          />
        )}
      </QueryState>
    </div>
  );
}

export function ProgrammingSite() {
  const { id } = useParams();
  const { user } = useAuth();
  const identity = JSON.stringify([user, getCsrf()]);
  return <SiteContent key={identity + id} id={id!} />;
}
function SiteContent({ id }: { id: string }) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setUrl('');
    setError('');
    (async () => {
      const status = await api<{ preview: { origin: string } }>('/programming/status');
      const project = await api<{
        revision: number;
        files: { path: string; content: string }[];
        title: string;
      }>(`/programming/projects/${encodeURIComponent(id)}`);
      const output = await send(`/programming/projects/${encodeURIComponent(id)}/preview`, {
        revision: project.revision,
        files: project.files,
      });
      const target = new URL(output.url),
        origin = new URL(status.preview.origin);
      if (target.origin !== origin.origin || target.username || target.password)
        throw Error('网站运行地址无效');
      if (active) setUrl(target.href);
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : '网站运行失败');
    });
    return () => {
      active = false;
    };
  }, [id, reload]);
  return (
    <div>
      <PageTitle
        title="网站运行"
        description="本站子目录运行当前保存的网站版本。"
        extra={
          <>
            <Link to={`/programming/${id}`}>
              <Button>编辑网站</Button>
            </Link>
            <Button onClick={() => setReload((x) => x + 1)}>重新运行</Button>
          </>
        }
      />
      {error ? (
        <Alert type="error" showIcon message={error} />
      ) : url ? (
        <iframe
          src={url}
          title="生成的网站"
          sandbox="allow-scripts allow-forms allow-modals allow-downloads"
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: '80vh', border: 0 }}
        />
      ) : (
        <Spin />
      )}
    </div>
  );
}
