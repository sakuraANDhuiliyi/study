import { test, expect, chromium, firefox, webkit } from '@playwright/test';
import { resolve } from 'node:path';
test.use({ channel: undefined });
for (const name of ['chromium', 'chrome', 'firefox', 'webkit'] as const) {
  test(`${name}: installed HTML sanitizer blocks attached-shadow templates, detached handlers and XHTML animation href`, async () => {
    const engine = name === 'firefox' ? firefox : name === 'webkit' ? webkit : chromium;
    const browser = await engine.launch({ channel: name === 'chrome' ? 'chrome' : undefined });
    try {
      const page = await browser.newPage();
      // Use real browser DOM and the locally installed runtime, without a network provider or mocked sanitizer.
      await page.goto('about:blank');
      await page.addScriptTag({ path: resolve('node_modules/dompurify/dist/purify.js') });
      const result = await page.evaluate(() => {
        const create = (window as any).DOMPurify;
        const purify = create(window);
        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.append(
          document.createTextNode('$'),
          document.createElement('object'),
          document.createTextNode('{probe()}'),
        );
        purify.sanitize(host, { IN_PLACE: true, SAFE_FOR_TEMPLATES: true });
        const templates = shadow.textContent || '';
        const handlers: (string | null)[] = [];
        for (const mode of ['parent', 'sibling']) {
          const d = create(window),
            root = document.createElement('div');
          root.innerHTML = '<figure><img class="bad"><img id="evil" onerror="probe()"></figure><p>safe</p>';
          const evil = root.querySelector('#evil')!;
          d.addHook('afterSanitizeAttributes', (node: Element) => {
            if (node.getAttribute?.('class') === 'bad') {
              if (mode === 'parent') node.parentElement?.remove();
              else node.nextElementSibling?.remove();
            }
          });
          d.sanitize(root, { IN_PLACE: true });
          handlers.push(evil.getAttribute('onerror'));
        }
        const svg = purify.sanitize(
          '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="x;javascript:probe()" dur="0.01s" fill="freeze"/><text>safe</text></a></svg>',
          {
            PARSER_MEDIA_TYPE: 'application/xhtml+xml',
            ALLOWED_TAGS: ['svg', 'a', 'animate', 'text'],
            ALLOWED_ATTR: ['attributeName', 'values', 'dur', 'fill'],
          },
        );
        return { templates, handlers, svg };
      });
      expect(result.templates).not.toContain('${probe()}');
      expect(result.handlers).toEqual([null, null]);
      expect(result.svg).not.toMatch(/attributeName\s*=\s*["']href["']/i);
    } finally {
      await browser.close();
    }
  });
}
