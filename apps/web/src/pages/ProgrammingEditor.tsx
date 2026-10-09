import { Component, Suspense, lazy, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button } from 'antd';
import { useAuth } from '../auth';
const Monaco = lazy(() => import('./ProgrammingMonaco'));

class EditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ProgrammingEditor(props: {
  projectId: string;
  path: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onRun: () => void;
}) {
  const { user } = useAuth();
  const [session] = useState(() => crypto.randomUUID());
  const [simple, setSimple] = useState(() => window.matchMedia('(max-width: 600px)').matches);
  const scope = `file:///programming/${[user?.organizationId, user?.id, user?.role, session, props.projectId]
    .map((part) => encodeURIComponent(part || 'anonymous'))
    .join('/')}/`;
  const language =
    (
      { html: 'html', css: 'css', js: 'javascript', json: 'json', md: 'markdown', svg: 'html' } as Record<
        string,
        string
      >
    )[props.path.split('.').at(-1) || ''] || 'plaintext';
  const fallback = (
    <textarea
      className="programming-simple-editor"
      aria-label="项目代码编辑器"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          props.onSave();
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          props.onRun();
        }
      }}
    />
  );
  return (
    <div className="programming-editor">
      <div className="programming-editor-heading">
        <span>{props.path}</span>
        <Button size="small" type="text" onClick={() => setSimple(!simple)}>
          {simple ? '使用专业编辑器' : '简易编辑器'}
        </Button>
      </div>
      <div className="programming-editor-surface">
        {simple ? (
          fallback
        ) : (
          <EditorBoundary
            fallback={
              <>
                <Alert type="warning" message="专业编辑器未能加载，已启用简易编辑器。" />
                {fallback}
              </>
            }
          >
            <Suspense fallback={<div className="programming-editor-loading">正在加载本地代码编辑器…</div>}>
              <Monaco
                key={scope}
                path={`${scope}${props.path}`}
                scope={scope}
                language={language}
                value={props.value}
                readOnly={props.disabled}
                onChange={props.onChange}
                onSave={props.onSave}
                onRun={props.onRun}
              />
            </Suspense>
          </EditorBoundary>
        )}
      </div>
      <div className="programming-editor-foot">Ctrl / ⌘ + S 保存 · Ctrl / ⌘ + Enter 预览</div>
    </div>
  );
}
