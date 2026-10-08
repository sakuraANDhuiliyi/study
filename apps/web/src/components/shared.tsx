import { createElement, useEffect, useRef } from 'react';
import { Alert, Button, Empty, Spin, Tag } from 'antd';
import {
  ArrowUpRight,
  ChevronRight,
  BookOpen,
  ClipboardCheck,
  Clock3,
  ChartNoAxesCombined,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EChartsOption, ECharts } from 'echarts';
import { label } from '../api';
export function PageTitle({
  eyebrow,
  title,
  description,
  extra,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {extra && <div className="page-actions">{extra}</div>}
    </div>
  );
}
export function Panel({
  title,
  description,
  extra,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}
export function QueryState({ query, children }: { query: any; children: React.ReactNode }) {
  if (query.isLoading)
    return (
      <div className="loading-state">
        <Spin size="large" />
        <span>正在载入数据…</span>
      </div>
    );
  if (query.error && (!query.data || [401, 403, 404].includes(query.error.status)))
    return (
      <Alert
        showIcon
        type="error"
        message={query.error.status === 403 ? '无权访问此内容' : '暂时无法加载'}
        description={query.error.message}
        action={<Button onClick={() => query.refetch()}>重试</Button>}
      />
    );
  return (
    <>
      {query.error && (
        <Alert
          style={{ marginBottom: 20 }}
          showIcon
          type="warning"
          message="连接暂时不可用，正在显示上次已加载的内容"
          description="未同步修改仍需成功保存后才算提交。"
          action={<Button onClick={() => query.refetch()}>重新连接</Button>}
        />
      )}{' '}
      {children}
    </>
  );
}
export function EmptyState({
  description = '这里还没有内容',
  children,
}: {
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
      {children}
    </Empty>
  );
}
export function Status({ value }: { value: string }) {
  const color = (
    {
      PUBLISHED: 'green',
      COMPLETED: 'green',
      GRADED: 'green',
      DRAFT: 'default',
      PENDING: 'orange',
      SUBMITTED: 'blue',
      IN_PROGRESS: 'cyan',
      RETURNED: 'orange',
      TIMED_OUT: 'red',
      DISABLED: 'red',
      ACTIVE: 'green',
    } as Record<string, string>
  )[value?.toUpperCase()];
  return <Tag color={color}>{label(value)}</Tag>;
}
export function MoreLink({ to, children = '查看全部' }: { to: string; children?: React.ReactNode }) {
  return (
    <Link className="more-link" to={to}>
      {children}
      <ChevronRight size={15} />
    </Link>
  );
}
export function Metrics({
  items,
}: {
  items: { label: string; value: any; detail?: string; path?: string }[];
}) {
  return (
    <div className="metric-grid">
      {items.map((m, i) => (
        <div className="metric-card" key={m.label}>
          <div className="metric-top">
            <span>{m.label}</span>
            <span className={`metric-symbol symbol-${i % 4}`} aria-hidden="true">
              {createElement([BookOpen, ClipboardCheck, Clock3, ChartNoAxesCombined][i % 4], {
                size: 20,
                strokeWidth: 1.7,
              })}
            </span>
          </div>
          <div className="metric-value">{m.value ?? '—'}</div>
          <div className="metric-foot">
            <span>{m.detail || '根据当前授权范围统计'}</span>
            {m.path && (
              <Link to={m.path} aria-label={`查看${m.label}`}>
                <ArrowUpRight size={17} />
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export function Chart({
  option,
  height = 260,
  label: accessible = '统计图',
}: {
  option: EChartsOption;
  height?: number;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let chart: ECharts | undefined;
    let observer: ResizeObserver | undefined;
    void import('../charts').then((echarts) => {
      if (cancelled || !ref.current) return;
      chart = echarts.init(ref.current);
      chart.setOption(option);
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(ref.current);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      chart?.dispose();
    };
  }, [option]);
  return <div ref={ref} style={{ height, width: '100%' }} role="img" aria-label={accessible} />;
}
export const chartTheme = {
  color: ['#206bc4', '#7a50c4', '#b66a08', '#2b8a3e'],
  textStyle: { fontFamily: '-apple-system, "PingFang SC", sans-serif', fontSize: 12, color: '#626976' },
  grid: { left: 35, right: 16, top: 24, bottom: 28 },
  tooltip: { trigger: 'axis' as const },
  xAxis: { axisLine: { show: false }, axisTick: { show: false } },
  yAxis: {
    splitLine: { lineStyle: { color: '#e6e9ed', type: 'dashed' as const } },
    axisLine: { show: false },
    axisTick: { show: false },
  },
};
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const linkHandler = (event: MouseEvent) => {
      const target = (event.target as Element)?.closest('a');
      if (
        dirty &&
        target &&
        target.getAttribute('href') &&
        !target.getAttribute('href')?.startsWith('#') &&
        !target.hasAttribute('download') &&
        target.target !== '_blank' &&
        !window.confirm('你有尚未保存或同步的修改，确定离开此页面？')
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', handler);
    document.addEventListener('click', linkHandler, true);
    return () => {
      window.removeEventListener('beforeunload', handler);
      document.removeEventListener('click', linkHandler, true);
    };
  }, [dirty]);
}

export function RichContent({ content }: { content: string }) {
  if (!/<\/?(?:p|h[1-6]|ul|ol|li|strong|em|blockquote|pre|code|a|br|img)(?:\s|>)/i.test(content))
    return <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>;
  const document = new DOMParser().parseFromString(content, 'text/html');
  function render(node: Node, key: string): React.ReactNode {
    if (node.nodeType === 3) return node.textContent;
    if (!(node instanceof Element)) return null;
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form'].includes(tag)) return null;
    const children = Array.from(node.childNodes).map((child, index) => render(child, `${key}-${index}`));
    if (
      ![
        'p',
        'br',
        'strong',
        'em',
        'ul',
        'ol',
        'li',
        'blockquote',
        'code',
        'pre',
        'h2',
        'h3',
        'a',
        'img',
      ].includes(tag)
    )
      return children;
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      if (!/^https:\/\/[^\s<>]+$/i.test(src) && !/^\/api\/attachments\/[a-zA-Z0-9_-]+\/preview$/.test(src))
        return null;
      return createElement('img', {
        key,
        src,
        alt: node.getAttribute('alt') || '教学图片',
        loading: 'lazy',
        referrerPolicy: 'no-referrer',
        style: { maxWidth: '100%', height: 'auto', borderRadius: 8 },
      });
    }
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return children;
      return createElement('a', { key, href, target: '_blank', rel: 'noopener noreferrer' }, children);
    }
    return createElement(tag, { key }, tag === 'br' ? undefined : children);
  }
  return (
    <div className="rich-text">
      {Array.from(document.body.childNodes).map((node, index) => render(node, String(index)))}
    </div>
  );
}
