import Editor from '@monaco-editor/react';
import { monaco } from './monacoRuntime';
import { useEffect, useRef } from 'react';
import type { Language } from './types';

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
