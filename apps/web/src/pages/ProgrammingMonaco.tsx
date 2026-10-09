import Editor from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import { monaco } from '../components/algorithms/monacoRuntime';

export default function ProgrammingMonaco(props: {
  value: string;
  path: string;
  scope: string;
  language: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onRun: () => void;
}) {
  const latest = useRef(props);
  const instance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  latest.current = props;
  useEffect(() => {
    const scope = monaco.Uri.parse(props.scope).path;
    return () => {
      instance.current?.setModel(null);
      instance.current = null;
      for (const model of monaco.editor.getModels()) {
        if (model.uri.scheme === 'file' && model.uri.path.startsWith(scope)) model.dispose();
      }
    };
  }, [props.scope]);
  return (
    <Editor
      height="100%"
      keepCurrentModel
      saveViewState
      path={props.path}
      language={props.language}
      value={props.value}
      theme="vs"
      onChange={(value) => props.onChange(value || '')}
      loading={<div className="programming-editor-loading">正在加载本地代码编辑器…</div>}
      options={{
        ariaLabel: '项目代码编辑器',
        readOnly: props.readOnly,
        fontSize: 14,
        lineHeight: 23,
        fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: 'on',
        padding: { top: 14, bottom: 14 },
        folding: true,
        fixedOverflowWidgets: true,
        accessibilitySupport: 'auto',
      }}
      onMount={(editor, api) => {
        instance.current = editor;
        editor.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.KeyS, () => latest.current.onSave());
        editor.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.Enter, () => latest.current.onRun());
      }}
    />
  );
}
