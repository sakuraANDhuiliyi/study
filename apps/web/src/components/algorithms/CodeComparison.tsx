import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Modal, Popconfirm, Radio, Spin, Tag } from 'antd';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { date } from '../../api';
import type { Language } from './types';
import { languageOptions } from './types';
import type { CodeDifferenceHandle } from './MonacoDiffSurface';

const MonacoDiffSurface = lazy(() => import('./MonacoDiffSurface'));
export type CodeComparisonSnapshot = {
  id: string;
  scope: string;
  problemId: string;
  history: {
    id: string;
    language: Language;
    code: string;
    createdAt: string;
    source: string;
    verdict: string;
  };
  current: { language: Language; code: string; unsynced: boolean; capturedAt: string };
  theme: string;
  fontSize: number;
};
export type CodeDifferenceStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; changes: number; identical: boolean }
  | { kind: 'unavailable'; message: string };
const languageName = (value: Language) =>
  languageOptions.find((item) => item.value === value)?.label || value;

class DifferenceBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function CompleteText({ snapshot }: { snapshot: CodeComparisonSnapshot }) {
  return (
    <div className="algo-comparison-texts">
      <label>
        <strong>历史提交完整代码</strong>
        <textarea aria-label="历史提交完整代码" readOnly spellCheck={false} value={snapshot.history.code} />
      </label>
      <label>
        <strong>当前草稿完整代码</strong>
        <textarea
          aria-label="当前草稿完整代码"
          readOnly
          spellCheck={false}
          value={snapshot.current.code}
          placeholder="（空代码）"
        />
      </label>
    </div>
  );
}

export function CodeComparison({
  snapshot,
  onClose,
  onRestore,
}: {
  snapshot: CodeComparisonSnapshot;
  onClose: () => void;
  onRestore: () => void;
}) {
  const [view, setView] = useState<'diff' | 'text'>('diff');
  const [status, setStatus] = useState<CodeDifferenceStatus>({ kind: 'loading' });
  const difference = useRef<CodeDifferenceHandle | null>(null);
  const navigate = status.kind === 'ready' && status.changes > 0 && view === 'diff';
  const differentLanguages = snapshot.history.language !== snapshot.current.language;
  useEffect(() => {
    if (view !== 'diff' || status.kind !== 'loading') return;
    // Also covers a blocked/failed lazy chunk before the local surface can mount.
    const timeout = setTimeout(() => {
      setStatus({ kind: 'unavailable', message: '差异视图加载或计算超时，请使用完整文本查看两份代码。' });
      setView('text');
    }, 15000);
    return () => clearTimeout(timeout);
  }, [view, status.kind]);
  const fallback = (
    <>
      <Alert
        type="warning"
        showIcon
        message="差异视图未能加载，已显示完整文本。"
        description="两份代码均为只读快照，原编辑器内容保持不变。"
      />
      <CompleteText snapshot={snapshot} />
    </>
  );
  return (
    <Modal
      open
      className="algo-comparison-modal"
      title="代码对比"
      width={1180}
      onCancel={onClose}
      footer={
        <div className="algo-comparison-footer">
          <Popconfirm
            title="将历史代码恢复到编辑器？"
            description={`当前编辑器内容会被替换，并切换至 ${languageName(snapshot.history.language)}。恢复后按正常草稿流程同步。`}
            okText="确认恢复历史代码"
            cancelText="取消"
            onConfirm={onRestore}
          >
            <Button icon={<RotateCcw size={14} />}>恢复历史代码</Button>
          </Popconfirm>
          <Button type="primary" aria-label="关闭代码对比" onClick={onClose}>
            关闭代码对比
          </Button>
        </div>
      }
    >
      <div className={`algo-code-comparison ${snapshot.theme === 'vs-dark' ? 'is-dark' : ''}`}>
        <div className="algo-comparison-metadata">
          <section aria-label="历史提交快照">
            <h3>历史提交快照</h3>
            <div>
              <Tag>{languageName(snapshot.history.language)}</Tag>
              <span>
                {snapshot.history.source} · {snapshot.history.verdict}
              </span>
            </div>
            <time>{date(snapshot.history.createdAt)}</time>
            <small>提交编号：{snapshot.history.id}</small>
          </section>
          <section aria-label="当前草稿快照">
            <h3>当前草稿快照</h3>
            <div>
              <Tag>{languageName(snapshot.current.language)}</Tag>
              <span>{snapshot.current.unsynced ? '含未同步修改' : '打开时的编辑器内容'}</span>
            </div>
            <time>快照时间：{date(snapshot.current.capturedAt)}</time>
            {!snapshot.current.code && <small>当前草稿为空。</small>}
          </section>
        </div>
        <p className="algo-muted">
          两侧均为打开时的只读快照，不随草稿同步或评测状态刷新而变化。查看对比不会触发保存、运行或 AI 解析。
        </p>
        {differentLanguages && (
          <Alert type="warning" showIcon message="语言不同，仅比较文本差异，不判断语义等价或代码正确性。" />
        )}
        <div className="algo-comparison-toolbar">
          <Radio.Group
            aria-label="代码对比显示方式"
            value={view}
            onChange={(event) => {
              difference.current = null;
              setView(event.target.value);
              if (event.target.value === 'diff') setStatus({ kind: 'loading' });
            }}
          >
            <Radio.Button value="diff">差异视图</Radio.Button>
            <Radio.Button value="text">完整文本</Radio.Button>
          </Radio.Group>
          <div>
            <Button
              size="small"
              icon={<ArrowUp size={14} />}
              disabled={!navigate}
              onClick={() => difference.current?.goTo('previous')}
            >
              上一处差异
            </Button>
            <Button
              size="small"
              icon={<ArrowDown size={14} />}
              disabled={!navigate}
              onClick={() => difference.current?.goTo('next')}
            >
              下一处差异
            </Button>
          </div>
        </div>
        {view === 'diff' && (
          <div className="algo-comparison-status" role="status">
            {status.kind === 'loading' ? (
              <>
                <Spin size="small" /> 正在计算代码差异…
              </>
            ) : status.kind === 'unavailable' ? (
              status.message
            ) : status.identical ? (
              '代码内容完全相同。'
            ) : status.changes ? (
              `原始代码不同，已显示 ${status.changes} 处差异。`
            ) : (
              '原始文本存在差异，但未生成可定位的行差异，请查看完整文本。'
            )}
          </div>
        )}
        {status.kind === 'unavailable' && (
          <Alert type="warning" showIcon message="差异比较未完成" description={status.message} />
        )}
        {view === 'diff' ? (
          <DifferenceBoundary
            fallback={fallback}
            onFailure={() => {
              difference.current = null;
              setStatus({ kind: 'unavailable', message: '差异视图未能加载，请使用完整文本查看两份代码。' });
            }}
          >
            <Suspense fallback={<div className="algo-editor-loading">正在加载本地差异编辑器…</div>}>
              <MonacoDiffSurface ref={difference} snapshot={snapshot} onStatus={setStatus} />
            </Suspense>
          </DifferenceBoundary>
        ) : (
          <CompleteText snapshot={snapshot} />
        )}
        <p className="algo-comparison-help">
          保留空格、制表符和缩进差异；桌面并排显示，窄屏以内联方式显示增删。高亮用于定位变化，完整文本保留原始内容。
        </p>
      </div>
    </Modal>
  );
}
