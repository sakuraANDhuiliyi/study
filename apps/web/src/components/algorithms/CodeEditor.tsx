import {
  Component,
  Suspense,
  forwardRef,
  lazy,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { editor } from 'monaco-editor';
import { Alert, Button, Select, Tooltip } from 'antd';
import { Maximize2, Minimize2, Search, WrapText } from 'lucide-react';
import { useAuth } from '../../auth';
import type { Language } from './types';
const MonacoSurface = lazy(() => import('./MonacoSurface'));
export type CodeEditorHandle = {
  focus: () => void;
  preferences: () => { theme: string; fontSize: number };
};
type Props = {
  problemId: string;
  language: Language;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onRun: () => void;
  onSubmit: () => void;
  canExecute: boolean;
};
class EditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(props, ref) {
  const { user } = useAuth();
  // A fresh editor lifetime also separates repeated logins by the same account.
  const [editorSession] = useState(() => crypto.randomUUID());
  const modelScope = `file:///algorithms/${[user?.organizationId, user?.id, user?.role, editorSession]
    .map((part) => encodeURIComponent(part || 'anonymous'))
    .join('/')}/`;
  const [simple, setSimple] = useState(() => {
    try {
      const preference = localStorage.getItem('algorithm-editor-mode');
      if (preference) return preference === 'simple';
    } catch {
      /* Use the viewport default when storage is unavailable. */
    }
    return window.matchMedia('(max-width: 600px)').matches;
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [theme, setTheme] = useState('vs');
  const [wrapped, setWrapped] = useState(false);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => (simple ? textarea.current?.focus() : instance.current?.focus()),
      preferences: () => ({ theme, fontSize }),
    }),
    [simple, theme, fontSize],
  );
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', key);
    };
  }, [fullscreen]);
  const fallback = (
    <div className="algo-code-editor" style={{ fontSize }}>
      <div ref={gutter} className="algo-line-numbers" aria-hidden="true" style={{ fontSize }}>
        {props.value.split('\n').map((_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>
      <textarea
        ref={textarea}
        aria-label="算法代码编辑器"
        value={props.value}
        disabled={props.disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap={wrapped ? 'soft' : 'off'}
        style={{ fontSize }}
        onChange={(event) => props.onChange(event.target.value)}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            props.onSave();
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            if (props.canExecute) {
              if (event.shiftKey) props.onSubmit();
              else props.onRun();
            }
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            const { selectionStart: start, selectionEnd: end } = event.currentTarget;
            props.onChange(`${props.value.slice(0, start)}    ${props.value.slice(end)}`);
            requestAnimationFrame(() => textarea.current?.setSelectionRange(start + 4, start + 4));
          }
        }}
      />
    </div>
  );
  return (
    <div
      className={`algo-professional-editor ${fullscreen ? 'is-fullscreen' : ''} ${theme === 'vs-dark' ? 'is-dark' : ''}`}
      role={fullscreen ? 'dialog' : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? '全屏代码编辑器' : undefined}
    >
      <div className="algo-editor-preferences">
        <div>
          <Select
            aria-label="编辑器字号"
            size="small"
            value={fontSize}
            onChange={setFontSize}
            options={[12, 14, 16, 18, 20].map((value) => ({ value, label: `${value}px` }))}
          />
          <Select
            aria-label="编辑器主题"
            size="small"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'vs', label: '浅色' },
              { value: 'vs-dark', label: '深色' },
            ]}
          />
          <Button
            size="small"
            type="text"
            onClick={() => {
              instance.current = null;
              setSimple(!simple);
              try {
                localStorage.setItem('algorithm-editor-mode', simple ? 'professional' : 'simple');
              } catch {
                /* Editor mode still changes for this session. */
              }
            }}
          >
            {simple ? '使用专业编辑器' : '简易编辑器'}
          </Button>
        </div>
        <div>
          <Tooltip title="查找 / 替换（Ctrl / ⌘ + F）">
            <Button
              aria-label="查找代码"
              type="text"
              size="small"
              disabled={simple}
              icon={<Search size={14} />}
              onClick={() => instance.current?.getAction('actions.find')?.run()}
            />
          </Tooltip>
          <Tooltip title="自动换行">
            <Button
              aria-label="切换自动换行"
              type={wrapped ? 'primary' : 'text'}
              size="small"
              icon={<WrapText size={14} />}
              onClick={() => {
                instance.current?.updateOptions({ wordWrap: wrapped ? 'off' : 'on' });
                setWrapped(!wrapped);
              }}
            />
          </Tooltip>
          <Button
            aria-label={fullscreen ? '退出编辑器全屏' : '编辑器全屏'}
            type="text"
            size="small"
            icon={fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            onClick={() => setFullscreen(!fullscreen)}
          />
        </div>
      </div>
      <div className="algo-monaco-surface">
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
            <Suspense fallback={<div className="algo-editor-loading">正在加载本地代码编辑器…</div>}>
              <MonacoSurface
                key={modelScope}
                value={props.value}
                language={props.language}
                modelScope={modelScope}
                modelPath={`${modelScope}${encodeURIComponent(props.problemId)}/solution.${{ cpp: 'cpp', python: 'py', javascript: 'js', java: 'java' }[props.language]}`}
                fontSize={fontSize}
                theme={theme}
                readOnly={props.disabled}
                onChange={props.onChange}
                onSave={props.onSave}
                onRun={() => {
                  if (props.canExecute) props.onRun();
                }}
                onSubmit={() => {
                  if (props.canExecute) props.onSubmit();
                }}
                onReady={(editor) => {
                  instance.current = editor;
                  editor.updateOptions({ wordWrap: wrapped ? 'on' : 'off' });
                }}
              />
            </Suspense>
          </EditorBoundary>
        )}
      </div>
      <div className="algo-editor-shortcuts">
        <span>Ctrl / ⌘ + Enter 运行 · + Shift 提交 · Ctrl / ⌘ + S 保存</span>
        {fullscreen && (
          <div>
            <Button size="small" onClick={props.onSave}>
              保存
            </Button>
            <Button size="small" disabled={!props.canExecute} onClick={props.onRun}>
              运行代码
            </Button>
            <Button size="small" type="primary" disabled={!props.canExecute} onClick={props.onSubmit}>
              提交评测
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});
