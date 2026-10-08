import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/codeEditor/register.js';
import 'monaco-editor/features/codicon/register.js';
import 'monaco-editor/features/tokenization/register.js';
import 'monaco-editor/features/find/register.js';
import 'monaco-editor/features/bracketMatching/register.js';
import 'monaco-editor/features/clipboard/register.js';
import 'monaco-editor/features/comment/register.js';
import 'monaco-editor/features/contextmenu/register.js';
import 'monaco-editor/features/cursorUndo/register.js';
import 'monaco-editor/features/folding/register.js';
import 'monaco-editor/features/fontZoom/register.js';
import 'monaco-editor/features/format/register.js';
import 'monaco-editor/features/gotoLine/register.js';
import 'monaco-editor/features/hover/register.js';
import 'monaco-editor/features/indentation/register.js';
import 'monaco-editor/features/lineSelection/register.js';
import 'monaco-editor/features/linesOperations/register.js';
import 'monaco-editor/features/links/register.js';
import 'monaco-editor/features/multicursor/register.js';
import 'monaco-editor/features/parameterHints/register.js';
import 'monaco-editor/features/snippet/register.js';
import 'monaco-editor/features/suggest/register.js';
import 'monaco-editor/features/toggleTabFocusMode/register.js';
import 'monaco-editor/features/wordHighlighter/register.js';
import 'monaco-editor/features/wordOperations/register.js';
import 'monaco-editor/features/wordPartOperations/register.js';
import 'monaco-editor/features/quickCommand/register.js';
import 'monaco-editor/features/readOnlyMessage/register.js';
import 'monaco-editor/features/smartSelect/register.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/features/typescript/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import TypescriptWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker';
import { useEffect, useRef } from 'react';
import type { Language } from './types';

// Supply the imported API to the React loader before mounting; no CDN/AMD loader is used.
self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) =>
    label === 'javascript' || label === 'typescript' ? new TypescriptWorker() : new EditorWorker(),
};
loader.config({ monaco });

export default function MonacoSurface(props: {
  value: string;
  language: Language;
  modelPath: string;
  modelScope: string;
  fontSize: number;
  theme: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onRun: () => void;
  onSubmit: () => void;
  onReady: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}) {
  const latest = useRef(props);
  const instance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  latest.current = props;
  useEffect(() => {
    const scope = monaco.Uri.parse(props.modelScope).path;
    return () => {
      // The React wrapper only disposes its current language's model. Dispose every
      // model owned by this editor lifetime, including detached language/undo state.
      instance.current?.setModel(null);
      instance.current = null;
      for (const model of monaco.editor.getModels()) {
        if (model.uri.scheme === 'file' && model.uri.path.startsWith(scope)) model.dispose();
      }
    };
  }, [props.modelScope]);
  return (
    <Editor
      height="100%"
      keepCurrentModel
      saveViewState={false}
      path={props.modelPath}
      language={props.language}
      value={props.value}
      theme={props.theme}
      onChange={(value) => props.onChange(value || '')}
      loading={<div className="algo-editor-loading">正在加载本地代码编辑器…</div>}
      options={{
        ariaLabel: '算法代码编辑器',
        readOnly: props.readOnly,
        fontSize: props.fontSize,
        lineHeight: Math.round(props.fontSize * 1.75),
        fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        detectIndentation: false,
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        autoIndent: 'full',
        padding: { top: 15, bottom: 15 },
        renderLineHighlight: 'line',
        smoothScrolling: true,
        wordWrap: 'off',
        folding: true,
        find: { addExtraSpaceOnTop: false },
        fixedOverflowWidgets: true,
        quickSuggestions: { other: true, comments: false, strings: false },
        accessibilitySupport: 'auto',
      }}
      onMount={(editor, api) => {
        instance.current = editor;
        editor.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.KeyS, () => latest.current.onSave());
        editor.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.Enter, () => latest.current.onRun());
        editor.addCommand(api.KeyMod.CtrlCmd | api.KeyMod.Shift | api.KeyCode.Enter, () =>
          latest.current.onSubmit(),
        );
        latest.current.onReady(editor);
      }}
    />
  );
}
