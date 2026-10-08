import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { monaco } from './monacoRuntime';
import 'monaco-editor/features/diffEditor/register.js';
import type { CodeComparisonSnapshot, CodeDifferenceStatus } from './CodeComparison';

export type CodeDifferenceHandle = { goTo: (direction: 'next' | 'previous') => void };
export default forwardRef<
  CodeDifferenceHandle,
  {
    snapshot: CodeComparisonSnapshot;
    onStatus: (status: CodeDifferenceStatus) => void;
  }
>(function MonacoDiffSurface({ snapshot, onStatus }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  useImperativeHandle(ref, () => ({ goTo: (direction) => editor.current?.goToDiff(direction) }), []);
  useEffect(() => {
    if (!container.current) return;
    let live = true;
    let instance: monaco.editor.IStandaloneDiffEditor | undefined;
    const owned: monaco.editor.ITextModel[] = [];
    let listener: monaco.IDisposable | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    onStatus({ kind: 'loading' });
    try {
      // A separate URI namespace and exact owned-model cleanup protect the main
      // editor's active and detached language models, including its undo history.
      const namespace = `file:///algorithm-comparisons/${[snapshot.scope, snapshot.problemId, snapshot.id, crypto.randomUUID()].map(encodeURIComponent).join('/')}/`;
      const extension = { cpp: 'cpp', python: 'py', javascript: 'js', java: 'java' };
      const original = monaco.editor.createModel(
        snapshot.history.code,
        snapshot.history.language,
        monaco.Uri.parse(`${namespace}original.${extension[snapshot.history.language]}`),
      );
      owned.push(original);
      const modified = monaco.editor.createModel(
        snapshot.current.code,
        snapshot.current.language,
        monaco.Uri.parse(`${namespace}modified.${extension[snapshot.current.language]}`),
      );
      owned.push(modified);
      for (const model of owned) model.updateOptions({ tabSize: 4, insertSpaces: true });
      instance = monaco.editor.createDiffEditor(container.current, {
        theme: snapshot.theme,
        fontSize: snapshot.fontSize,
        fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
        readOnly: true,
        originalEditable: false,
        domReadOnly: true,
        renderMarginRevertIcon: false,
        renderGutterMenu: false,
        ignoreTrimWhitespace: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: true,
        renderSideBySideInlineBreakpoint: 700,
        maxComputationTime: 2000,
        maxFileSize: 1,
        diffAlgorithm: 'advanced',
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace: 'all',
        renderIndicators: true,
        accessibilityVerbose: true,
        wordWrap: 'off',
        diffWordWrap: 'off',
        contextmenu: false,
        padding: { top: 10, bottom: 10 },
      });
      editor.current = instance;
      instance
        .getOriginalEditor()
        .updateOptions({ ariaLabel: '历史提交代码（只读）', readOnly: true, domReadOnly: true });
      instance
        .getModifiedEditor()
        .updateOptions({ ariaLabel: '当前草稿代码（只读）', readOnly: true, domReadOnly: true });
      // Read-only code views have no execution or draft-saving shortcuts.
      for (const pane of [instance.getOriginalEditor(), instance.getModifiedEditor()]) {
        pane.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {});
        pane.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {});
        pane.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {});
      }
      const inspect = () => {
        if (!live || !instance) return;
        const changes = instance.getLineChanges();
        if (changes === null) return;
        clearTimeout(timeout);
        // Monaco normalizes model line endings. Only exact snapshot equality can
        // establish identical source; an empty line diff alone never does so.
        onStatus({
          kind: 'ready',
          changes: changes.length,
          identical: snapshot.history.code === snapshot.current.code,
        });
      };
      listener = instance.onDidUpdateDiff(inspect);
      timeout = setTimeout(() => {
        if (live)
          onStatus({
            kind: 'unavailable',
            message: '未能及时完成差异高亮，请切换完整文本查看；此状态不代表代码相同。',
          });
      }, 10000);
      instance.setModel({ original, modified });
      inspect();
    } catch {
      onStatus({ kind: 'unavailable', message: '差异编辑器未能启动，请切换完整文本查看两份代码。' });
    }
    return () => {
      live = false;
      clearTimeout(timeout);
      listener?.dispose();
      editor.current = null;
      instance?.setModel(null);
      instance?.dispose();
      for (const model of owned) if (!model.isDisposed()) model.dispose();
    };
  }, [snapshot, onStatus]);
  return <div className="algo-monaco-diff" ref={container} data-testid="algorithm-code-diff" />;
});
