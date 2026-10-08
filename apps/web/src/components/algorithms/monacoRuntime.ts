import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor';
// TypeScript's lazy worker module also loads editor contributions. Their service
// singletons must be registered before the first editor initializes its services.
import 'monaco-editor/features/documentSymbols/register.js';
import 'monaco-editor/features/codelens/register.js';
import 'monaco-editor/features/dropOrPasteInto/register.js';
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

// Both lazy editor surfaces initialize the same bundled runtime. In particular,
// opening a diff from the mobile textarea never depends on the main editor mount.
self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) =>
    label === 'javascript' || label === 'typescript' ? new TypescriptWorker() : new EditorWorker(),
};
loader.config({ monaco });
export { monaco };
