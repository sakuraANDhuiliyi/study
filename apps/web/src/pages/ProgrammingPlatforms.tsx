import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Spin } from 'antd';
import { useAuth } from '../auth';
import { api, send, useData, getCsrf } from '../api';
import { PageTitle, QueryState } from '../components/shared';

export function AndroidProgramming() {
  const { user } = useAuth();
  const status = useData<{ available: boolean; reason: string }>('/programming/android/status');
  return (
    <div className="programming-page">
      <PageTitle
        title="Android App 工作室"
        description="创建 Android 项目，通过 Agent 修改源码、查看任务和构建日志，下载真实构建产物。"
        extra={
          <Link to="/programming">
            <Button>返回网站工作室</Button>
          </Link>
        }
      />
      <QueryState query={status}>
        {status.data?.available ? (
          <iframe
            key={JSON.stringify([user, getCsrf()])}
            src="/api/programming/android/workbench/index.html"
            title="Android Agent 工作台"
            style={{ width: '100%', height: '80vh', border: 0, borderRadius: 12 }}
          />
        ) : (
          <Alert
            showIcon
            type="info"
            message={status.data?.reason || 'Android 构建服务正在启动'}
            description="请启动本地 Android Agent 服务，随后刷新此页。"
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
