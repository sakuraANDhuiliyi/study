import type { ProgrammingFile } from './programming.schemas';

const page = (title: string, body: string) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="card">
${body}
  </main>
  <script src="app.js" defer></script>
</body>
</html>
`;
const css = `:root { font-family: system-ui, sans-serif; color: #1e293b; background: #f1f5f9; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.card { width: min(100%, 520px); padding: 32px; background: white; border: 1px solid #e2e8f0; border-radius: 20px; box-shadow: 0 12px 40px #1e293b0a; }
h1 { margin: 0 0 16px; }
p { line-height: 1.7; color: #64748b; }
button { border: 0; border-radius: 10px; padding: 12px 18px; background: #2563eb; color: white; font: inherit; cursor: pointer; }
button:hover { background: #1d4ed8; }
button:focus-visible, input:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
input { padding: 12px; border: 1px solid #cbd5e1; border-radius: 10px; font: inherit; min-width: 0; flex: 1; }
`;
type Template = { id: string; title: string; description: string; files: ProgrammingFile[] };
export const programmingTemplates: Template[] = [
  {
    id: 'starter',
    title: '我的第一个网页',
    description: '从页面结构、基础样式和一个点击事件开始。',
    files: [
      {
        path: 'index.html',
        content: page(
          '我的第一个网页',
          '    <h1>你好，编程世界</h1>\n    <p id="message">修改文字与配色，再运行预览。</p>\n    <button id="hello" type="button">和网页打个招呼</button>',
        ),
      },
      { path: 'style.css', content: css },
      {
        path: 'app.js',
        content: `const button = document.querySelector('#hello');\nbutton.addEventListener('click', () => {\n  document.querySelector('#message').textContent = '你好！这是你的第一个 JavaScript 交互。';\n  console.log('按钮事件已触发');\n});\n`,
      },
      {
        path: 'README.md',
        content:
          '# 我的第一个网页\n\n- index.html：页面结构\n- style.css：布局与样式\n- app.js：按钮交互\n\n学习任务：修改标题；尝试新的背景颜色；让按钮改变另一段文字。\n本地预览使用隔离窗口，不能访问父页面、Cookie或浏览器持久存储。\n',
      },
    ],
  },
  {
    id: 'counter',
    title: '交互计数器',
    description: '学习页面内状态、事件处理和 DOM 更新。',
    files: [
      {
        path: 'index.html',
        content: page(
          '交互计数器',
          '    <h1>交互计数器</h1>\n    <p>每次点击，让状态变化反映到页面上。</p>\n    <output id="count" aria-live="polite">0</output>\n    <div class="row">\n      <button id="decrease" type="button">减一</button>\n      <button id="increase" type="button">加一</button>\n      <button id="reset" type="button">重置</button>\n    </div>',
        ),
      },
      {
        path: 'style.css',
        content:
          css +
          '\n#count { display: block; margin: 20px 0; font-size: 64px; font-weight: 700; color: #2563eb; }\n',
      },
      {
        path: 'app.js',
        content: `let count = 0;\nconst output = document.querySelector('#count');\nfunction update(change) {\n  count += change;\n  output.textContent = String(count);\n  console.log('当前计数：', count);\n}\ndocument.querySelector('#increase').addEventListener('click', () => update(1));\ndocument.querySelector('#decrease').addEventListener('click', () => update(-1));\ndocument.querySelector('#reset').addEventListener('click', () => {\n  count = 0;\n  update(0);\n});\n`,
      },
      {
        path: 'README.md',
        content:
          '# 交互计数器\n\n练习：把每次变化改成2；增加范围限制；为不同数值设置不同颜色。\n状态保存在当前页面内存，刷新预览后会重置。\n',
      },
    ],
  },
  {
    id: 'todo',
    title: '学习待办清单',
    description: '练习表单输入、元素创建及列表交互。',
    files: [
      {
        path: 'index.html',
        content: page(
          '学习待办清单',
          '    <h1>学习待办清单</h1>\n    <p>添加今天的一项小目标，完成后勾选。</p>\n    <div class="row">\n      <input id="task" aria-label="学习目标" placeholder="例如：练习按钮事件" maxlength="100">\n      <button id="add" type="button">添加</button>\n    </div>\n    <ul id="tasks"></ul>',
        ),
      },
      {
        path: 'style.css',
        content:
          css +
          '\n#tasks { padding: 0; list-style: none; }\n#tasks li { display: flex; gap: 12px; align-items: center; padding: 14px 0; border-bottom: 1px solid #e2e8f0; }\n#tasks input { flex: none; }\n#tasks label { flex: 1; overflow-wrap: anywhere; }\n#tasks input:checked + label { text-decoration: line-through; color: #94a3b8; }\n',
      },
      {
        path: 'app.js',
        content: `const input = document.querySelector('#task');\nconst tasks = document.querySelector('#tasks');\nlet sequence = 0;\nfunction addTask() {\n  const text = input.value.trim();\n  if (!text) return;\n  const item = document.createElement('li');\n  const checkbox = document.createElement('input');\n  checkbox.type = 'checkbox';\n  checkbox.id = 'task-' + (++sequence);\n  const label = document.createElement('label');\n  label.htmlFor = checkbox.id;\n  label.textContent = text;\n  item.append(checkbox, label);\n  tasks.append(item);\n  input.value = '';\n  input.focus();\n  console.log('已添加任务：', text);\n}\ndocument.querySelector('#add').addEventListener('click', addTask);\ninput.addEventListener('keydown', event => {\n  if (event.key === 'Enter') addTask();\n});\n`,
      },
      {
        path: 'README.md',
        content:
          '# 学习待办清单\n\n练习：增加删除按钮；显示完成数量；使用数组描述列表状态。\n这个入门版本只保留页面内存状态，重载预览会清空列表。\n',
      },
    ],
  },
];
export const getProgrammingTemplate = (id: string) =>
  programmingTemplates.find((template) => template.id === id);
