import type { CreativeItem } from './creative.catalog';

export type CreativeRecipeInput = Omit<CreativeItem, 'files'> & {
  html: string;
  css: string;
  js: string;
  steps: string[];
};

/** Assemble trusted catalog content, retaining the exact upstream notice. */
export function makeCreativeRecipe(input: CreativeRecipeInput): CreativeItem {
  const { html, css, js, steps, ...item } = input;
  const source = item.source;
  const attribution = [
    `# ${item.title} (${item.id})`,
    `Source: ${source.repository}`,
    `Pinned commit: ${source.commit}`,
    `License: ${source.license}`,
    `Scope: ${source.scope}`,
    `Local changes: ${source.changes}`,
    ...source.files.map((file) => `${file.title}: ${file.url}`),
    '',
    source.licenseText,
  ].join('\n');
  const readme = [
    `# ${item.title}`,
    '',
    item.description,
    '',
    '## 学习步骤',
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## 学习目标',
    ...item.learningGoals.map((goal) => `- ${goal}`),
    '',
    '## 来源与本地适配',
    source.repository,
    `固定版本：${source.commit}`,
    `迁入范围：${source.scope}`,
    `修改说明：${source.changes}`,
    '',
    '当前作品只实现浏览器内的界面与交互。演示数据和状态保留于当前预览，不接入来源项目的服务器。',
    '完整版权与许可保存在 NOTICE.txt；修改、保存版本和分享源码时请保留。',
  ].join('\n');
  return {
    ...item,
    files: [
      { path: 'index.html', content: html },
      { path: 'style.css', content: css },
      {
        path: 'app.js',
        content: `// UI source study: ${source.repository} @ ${source.commit}\n// Scope and full attribution: NOTICE.txt\n${js}`,
      },
      { path: 'README.md', content: readme },
      { path: 'NOTICE.txt', content: attribution },
    ],
  };
}
