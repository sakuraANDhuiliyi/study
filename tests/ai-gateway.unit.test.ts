import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { AiConfiguration, parseAiConfiguration } from '../apps/api/src/ai-study/ai.config';
import {
  AiGateway,
  parseOpenAiSearch,
  providerJson,
  validateAnalysis,
} from '../apps/api/src/ai-study/ai.gateway';
import { createAiReportInput, type AiMistake } from '../apps/api/src/ai-study/ai-study.schemas';

const mistake: AiMistake = {
  mistakeId: 'm1',
  questionId: 'q1',
  questionVersionId: 'v1',
  courseId: 'private-course-id',
  courseTitle: 'private-course-title',
  stem: '<p>2 + 2 = ?</p>',
  type: 'single',
  options: [
    { id: 'A', text: '4' },
    { id: 'B', text: '5' },
  ],
  studentAnswer: 'B',
  correctAnswer: 'A',
  explanation: '相加得到4',
  knowledgePoints: ['加法'],
  wrongCount: 2,
  answeredAt: '2026-10-08T00:00:00Z',
  scoreCents: 0,
  maxScoreCents: 100,
};
const analysis = () => ({
  summary: '需要巩固加法',
  patterns: [{ label: '计算', evidence: '选择了5', advice: '逐项检查', mistakeIds: ['m1'] }],
  items: [
    {
      mistakeId: 'm1',
      diagnosis: '可能存在计算错误',
      reasoning: '2与2相加',
      correction: '结果为4',
      knowledgePoints: ['加法'],
      confidence: 'low',
    },
  ],
  reviewPlan: ['复习加法'],
  searchQueries: ['加法 基础 练习题'],
});
const output = (value: unknown) => ({
  status: 'completed',
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }],
    },
  ],
});
async function server<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (url: string) => Promise<T>,
) {
  const app = createServer(handler);
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  const address = app.address() as { port: number };
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
  }
}
async function withConfig<T>(content: unknown, run: (config: AiConfiguration) => Promise<T>) {
  const directory = mkdtempSync(join(tmpdir(), 'zhixue-ai-config-'));
  const old = process.env.AI_CONFIG_PATH;
  process.env.AI_CONFIG_PATH = join(directory, 'config.yaml');
  writeFileSync(process.env.AI_CONFIG_PATH, typeof content === 'string' ? content : stringify(content));
  try {
    return await run(new AiConfiguration());
  } finally {
    if (old === undefined) delete process.env.AI_CONFIG_PATH;
    else process.env.AI_CONFIG_PATH = old;
    rmSync(directory, { recursive: true, force: true });
  }
}
async function body(req: IncomingMessage) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
const safeError =
  (status: number, secret = 'fixture-secret') =>
  (error: any) => {
    assert.equal(error.getStatus(), status);
    assert.ok(!error.message.includes(secret));
    return true;
  };

test('YAML严格校验、别名拒绝、格式错误与key均不泄漏到公开状态', async () => {
  for (const yaml of [
    'ai:\n  apiKey: one\n  apiKey: two',
    'ai: &a {apiKey: test}\nwebSearch: *a',
    'ai: {enabled: yes}',
    'ai: {timeoutMs: 0}',
    'unknown: true',
    'ai: !!js/function function(){}',
  ])
    assert.throws(() => parseAiConfiguration(yaml));
  await withConfig('ai:\n  apiKey: "fixture-secret\n', async (c) => {
    assert.equal(c.status().analysis.available, false);
    assert.ok(!JSON.stringify(c.status()).includes('fixture-secret'));
    assert.throws(() => c.read(), safeError(503));
  });
  await withConfig({ ai: { apiKey: 'fixture-secret' } }, async (c) => {
    assert.equal(c.status().analysis.available, true);
    assert.ok(!JSON.stringify(c.status()).includes('fixture-secret'));
  });
});
test('空key功能不可用，Tavily独立key不伪装AI已接通，配置无需重启', async () => {
  await withConfig(
    { ai: { apiKey: '' }, webSearch: { provider: 'tavily', tavily: { apiKey: 'fixture-search-secret' } } },
    async (c) => {
      assert.equal(c.status().analysis.available, false);
      assert.equal(c.status().search.available, true);
      await assert.rejects(new AiGateway(c).analyze([mistake], ''), safeError(503));
      writeFileSync(
        process.env.AI_CONFIG_PATH!,
        stringify({ ai: { apiKey: 'fixture-secret', enabled: false } }),
      );
      assert.equal(c.status().analysis.available, false);
    },
  );
});
test('默认使用DeepSeek与独立Tavily配置，拒绝DeepSeek不支持的输出格式', () => {
  const config = parseAiConfiguration('{}');
  assert.equal(config.ai.apiStyle, 'deepseek');
  assert.equal(config.ai.baseUrl, 'https://api.deepseek.com');
  assert.equal(config.ai.model, 'deepseek-flash');
  assert.equal(config.ai.structuredOutput, 'json_object');
  assert.equal(config.webSearch.provider, 'tavily');
  assert.equal(config.ai.apiKey, '');
  assert.equal(config.webSearch.tavily.apiKey, '');
  assert.throws(() => parseAiConfiguration('ai: {apiStyle: deepseek, structuredOutput: json_schema}'));
});
test('服务端URL不允许userinfo、query、远程明文HTTP；生产拒绝本机HTTP', () => {
  for (const url of [
    'https://user:pass@example.org/v1',
    'https://example.org/v1?key=secret',
    'http://example.org/v1',
  ])
    assert.throws(() => parseAiConfiguration(stringify({ ai: { baseUrl: url } })));
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => parseAiConfiguration('ai: {baseUrl: "http://127.0.0.1:1234"}'));
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});
test('输入拒绝重复错题、超量、越权字段和NUL；输出必须覆盖同一组错题', () => {
  for (const data of [
    { mistakeIds: ['m1', 'm1'] },
    { mistakeIds: Array.from({ length: 11 }, (_, i) => `m${i}`) },
    { mistakeIds: ['m1'], userId: 'other' },
    { mistakeIds: ['m1'], reflection: 'x\0' },
  ])
    assert.equal(createAiReportInput.safeParse(data).success, false);
  assert.deepEqual(validateAnalysis(analysis(), [mistake]), analysis());
  const wrong = analysis();
  wrong.items[0].mistakeId = 'other';
  assert.throws(() => validateAnalysis(wrong, [mistake]));
  const duplicate = analysis();
  duplicate.items.push(duplicate.items[0]);
  assert.throws(() => validateAnalysis(duplicate, [mistake]));
});
test('Responses请求使用严格结构和store=false，仅发送必要题目数据', async () => {
  let captured: any;
  await server(
    (req, res) => {
      void body(req).then((data) => {
        captured = data;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(output(analysis())));
      });
    },
    async (url) =>
      withConfig(
        {
          ai: {
            apiStyle: 'responses',
            structuredOutput: 'json_schema',
            apiKey: 'fixture-secret',
            baseUrl: url + '/v1',
          },
        },
        async (c) => {
          assert.deepEqual(await new AiGateway(c).analyze([mistake], '我把数字看错了'), analysis());
          assert.equal(captured.store, false);
          assert.equal(captured.text.format.strict, true);
          assert.equal(captured.text.format.type, 'json_schema');
          const input = JSON.parse(captured.input);
          assert.equal(input.mistakes[0].studentAnswer, 'B');
          assert.ok(!captured.input.includes('private-course'));
          assert.ok(!captured.input.includes('<p>'));
        },
      ),
  );
});
test('Chat Completions兼容路径支持JSON模式且仍校验本地结构', async () => {
  let captured: any,
    path = '';
  await server(
    (req, res) => {
      path = req.url!;
      void body(req).then((data) => {
        captured = data;
        res.end(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis()) } }],
          }),
        );
      });
    },
    async (url) =>
      withConfig(
        {
          ai: {
            apiKey: 'fixture-secret',
            baseUrl: url + '/v1',
            apiStyle: 'chat_completions',
            structuredOutput: 'json_object',
          },
        },
        async (c) => {
          assert.deepEqual(await new AiGateway(c).analyze([mistake], ''), analysis());
          assert.equal(path, '/v1/chat/completions');
          assert.equal(captured.response_format.type, 'json_object');
          assert.equal(captured.stream, false);
          assert.equal(captured.max_completion_tokens, 6000);
          assert.equal(captured.max_tokens, undefined);
          assert.equal(captured.thinking, undefined);
        },
      ),
  );
});
test('DeepSeek使用max_tokens和非思考JSON模式，拒绝截断与空内容', async () => {
  let captured: any;
  let reply: any = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis()) } }] };
  await server(
    (req, res) => {
      assert.equal(req.url, '/chat/completions');
      assert.equal(req.headers.authorization, 'Bearer fixture-deepseek');
      void body(req).then((data) => {
        captured = data;
        res.end(JSON.stringify(reply));
      });
    },
    async (url) =>
      withConfig({ ai: { baseUrl: url, apiKey: 'fixture-deepseek', maxOutputTokens: 4096 } }, async (c) => {
        assert.deepEqual(await new AiGateway(c).analyze([mistake], '检查加法'), analysis());
        assert.equal(captured.model, 'deepseek-flash');
        assert.equal(captured.max_tokens, 4096);
        assert.equal(captured.max_completion_tokens, undefined);
        assert.deepEqual(captured.thinking, { type: 'disabled' });
        assert.deepEqual(captured.response_format, { type: 'json_object' });
        assert.equal(captured.stream, false);
        assert.match(captured.messages[0].content, /JSON格式示例/);
        const input = JSON.parse(captured.messages[1].content);
        assert.equal(input.reflection, '检查加法');
        assert.ok(!captured.messages[1].content.includes('private-course'));
        for (const message of [
          { finish_reason: 'length', message: { content: JSON.stringify(analysis()) } },
          { finish_reason: 'stop', message: { content: '', reasoning_content: '不能当作JSON报告' } },
          { finish_reason: 'stop', message: { content: '{"summary":"缺少字段"}' } },
        ]) {
          reply = { choices: [message] };
          await assert.rejects(new AiGateway(c).analyze([mistake], ''), safeError(502, 'fixture-deepseek'));
        }
      }),
  );
});
test('供应商截断/拒绝/无效JSON不能保存为成功分析', async () => {
  for (const reply of [
    { status: 'incomplete', output: [] },
    {
      status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }],
    },
    output({ bad: 'result' }),
  ]) {
    await server(
      (_req, res) => res.end(JSON.stringify(reply)),
      async (url) =>
        withConfig({ ai: { apiStyle: 'responses', apiKey: 'fixture-secret', baseUrl: url } }, async (c) =>
          assert.rejects(new AiGateway(c).analyze([mistake], ''), safeError(502)),
        ),
    );
  }
});
test('真实HTTP错误体和认证失败脱敏，无重试且有总超时', async () => {
  let hits = 0;
  await server(
    (_req, res) => {
      hits++;
      res.writeHead(401);
      res.end('fixture-secret internal-url');
    },
    async (url) => assert.rejects(providerJson(url, 'fixture-secret', {}, 1000), safeError(503)),
  );
  assert.equal(hits, 1);
  await server(
    () => {},
    async (url) => assert.rejects(providerJson(url, 'fixture-secret', {}, 30), safeError(504)),
  );
});
test('响应流限制大小且拒绝重定向，不携带密钥跟随新地址', async () => {
  await server(
    (_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/secret' });
      res.end();
    },
    async (url) => assert.rejects(providerJson(url, 'fixture-secret', {}, 1000), safeError(502)),
  );
  await server(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('a'.repeat(1_048_577));
    },
    async (url) => assert.rejects(providerJson(url, 'fixture-secret', {}, 1000), safeError(502)),
  );
});
test('OpenAI联网搜索必须有真实工具调用；正文里编造URL不能成为来源', () => {
  const c = parseAiConfiguration('{}');
  assert.throws(() => parseOpenAiSearch(output({ text: 'fake' }), '加法', c));
  const data = {
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: [
            { url: 'https://openstax.org/books/elementary-algebra', title: '练习题' },
            { url: 'http://127.0.0.1/private' },
            { url: 'file:///etc/passwd' },
          ],
        },
      },
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: '加法练习[1] https://invented.example/fake',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://openstax.org/books/elementary-algebra',
                title: '练习题',
                start_index: 4,
                end_index: 7,
              },
            ],
          },
        ],
      },
    ],
  };
  const result = parseOpenAiSearch(data, '加法', c);
  assert.equal(result.sources.length, 1);
  assert.equal(result.citations.length, 1);
  assert.equal(result.summary.slice(result.citations[0].start, result.citations[0].end), '[1]');
  assert.equal(result.citations[0].sourceId, result.sources[0].id);
  c.webSearch.allowedDomains = ['example.edu'];
  const filtered = parseOpenAiSearch(data, '加法', c);
  assert.equal(filtered.sources.length, 0);
  assert.match(filtered.summary, /没有找到/);
});
test('Tavily结果按来源返回真实摘录、去重、过滤危险链接并保留引用', async () => {
  let captured: any;
  await server(
    (req, res) => {
      void body(req).then((data) => {
        captured = data;
        res.end(
          JSON.stringify({
            results: [
              {
                url: 'https://openstax.org/one',
                title: '一',
                content: '<p>加法练习</p><script>alert(1)</script>',
              },
              { url: 'https://openstax.org/one', title: '重复' },
              { url: 'http://169.254.169.254/metadata' },
              { url: 'https://example.org/no' },
            ],
          }),
        );
      });
    },
    async (url) =>
      withConfig(
        {
          webSearch: {
            provider: 'tavily',
            allowedDomains: ['openstax.org'],
            tavily: { baseUrl: url, apiKey: 'fixture-secret' },
          },
        },
        async (c) => {
          const result = await new AiGateway(c).search('加法');
          assert.equal(result.sources.length, 1);
          assert.equal(result.sources[0].snippet, '加法练习');
          assert.equal(result.citations.length, 1);
          assert.equal(captured.include_raw_content, false);
          assert.deepEqual(captured.include_domains, ['openstax.org']);
        },
      ),
  );
});

test('引用来源严格遵守maxResults，移除不可保留引用的综合正文，保留网页章节链接', () => {
  const config = parseAiConfiguration('webSearch: {maxResults: 1}');
  const result = parseOpenAiSearch(
    {
      status: 'completed',
      output: [
        { type: 'web_search_call', status: 'completed', action: { sources: [] } },
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: '外部综合内容',
              annotations: [
                {
                  type: 'url_citation',
                  title: '首个来源',
                  url: 'https://openstax.org/one#section',
                  start_index: 0,
                  end_index: 2,
                },
                {
                  type: 'url_citation',
                  title: '超量来源',
                  url: 'https://openstax.org/two',
                  start_index: 2,
                  end_index: 4,
                },
              ],
            },
          ],
        },
      ],
    },
    '加法',
    config,
  );
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, 'https://openstax.org/one');
  assert.equal(result.citations.length, 1);
  assert.ok(!result.summary.includes('外部综合内容'));
  assert.equal(result.summary.slice(result.citations[0].start, result.citations[0].end), '[1]');
});
