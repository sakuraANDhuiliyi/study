import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { HttpException } from '@nestjs/common';
import { downloadStudySource, isPublicHttpUrl } from '../apps/api/src/ai-study/safe-download';

const limits = { maxBytes: 4096, timeoutMs: 1000 };
const publicRecord = { address: '8.8.8.8', family: 4 };
type Hop = {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Buffer[];
  neverEnd?: boolean;
  delay?: number;
  error?: string;
  truncated?: boolean;
};
function network(
  t: TestContext,
  hops: Hop[],
  resolve?: (hostname: string, call: number) => Promise<dns.LookupAddress[]> | dns.LookupAddress[],
) {
  const requests: {
    url: URL;
    options: https.RequestOptions & { autoSelectFamily?: boolean };
    request: any;
    response: any;
  }[] = [];
  const dnsCalls: string[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  t.after(() => timers.forEach(clearTimeout));
  t.mock.method(dns.promises, 'lookup', async (hostname: string, options: any) => {
    assert.equal(options.all, true);
    assert.equal(options.verbatim, true);
    dnsCalls.push(hostname);
    return resolve ? resolve(hostname, dnsCalls.length) : [publicRecord];
  });
  const request = (url: URL, options: https.RequestOptions, callback: (response: any) => void) => {
    const hop = hops[requests.length];
    assert(hop, 'Unexpected additional network request');
    const req: any = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
      return req;
    };
    const res: any = new PassThrough();
    res.statusCode = hop.status || 200;
    res.headers = { 'content-type': 'text/plain; charset=utf-8', ...hop.headers };
    requests.push({ url, options, request: req, response: res });
    req.end = () => {
      const deliver = () => {
        if (req.destroyed) return;
        if (hop.error) {
          req.emit('error', new Error(hop.error));
          return;
        }
        callback(res);
        if (res.destroyed) return;
        for (const chunk of hop.chunks || [Buffer.from('公开学习资料')]) {
          if (!res.destroyed) res.write(chunk);
        }
        if (hop.truncated) res.destroy();
        else if (!hop.neverEnd && !res.destroyed) res.end();
      };
      if (hop.delay) timers.push(setTimeout(deliver, hop.delay));
      else queueMicrotask(deliver);
      return req;
    };
    return req;
  };
  t.mock.method(http, 'request', request);
  t.mock.method(https, 'request', request);
  return { requests, dnsCalls };
}
function status(expected: number) {
  return (error: unknown) => {
    assert(error instanceof HttpException);
    assert.equal(error.getStatus(), expected);
    assert(/[\u4e00-\u9fff]/.test(error.message));
    return true;
  };
}

test('公共URL过滤拒绝本地/私网/保留/metadata/IPv6转换地址与非默认端口', () => {
  for (const value of [
    'http://localhost/',
    'http://localhost./',
    'http://a.localhost/',
    'https://metadata.google.internal/',
    'http://metadata/',
    'http://10.0.0.1/',
    'http://172.31.1.1/',
    'http://192.168.1.1/',
    'http://0.0.0.0/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://169.254.169.254/latest/meta-data',
    'http://100.100.100.200/',
    'http://168.63.129.16/',
    'http://198.18.0.1/',
    'http://192.0.2.1/',
    'http://203.0.113.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://[::1]/',
    'http://[::ffff:8.8.8.8]/',
    'http://[::ffff:808:808]/',
    'http://[::8.8.8.8]/',
    'http://[64:ff9b::808:808]/',
    'http://[fd00:ec2::254]/',
    'http://[fe80::1]/',
    'http://[ff00::1]/',
    'http://[2001:db8::1]/',
    'http://[2002:7f00:1::]/',
    'http://[2001::1]/',
    'http://[3fff::1]/',
    'http://example.com:8080/',
    'http://example.com:443/',
    'https://example.com:80/',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'https://user:secret@example.com/',
    'https://@example.com/',
    'https:////@example.com/',
    'https:///example.com/',
    'https:example.com/',
    'https://example.com/#part',
    'https://example.com/#',
    'https://example.com/\nsecret',
    'https://example.com\\@127.0.0.1/',
    'https://example.com/' + 'a'.repeat(2050),
    'https://a..com/',
    'https://example.com/tool.exe',
    'https://example.com/tool%2eJS',
  ])
    assert.equal(isPublicHttpUrl(value), false, value);
  for (const value of [
    'https://example.com/a.pdf?q=practice',
    'http://8.8.8.8:80/',
    'https://example.com:443/',
    'https://[2606:4700:4700::1111]/',
  ])
    assert.equal(isPublicHttpUrl(value), true, value);
});

test('DNS所有地址必须公开，混合公私地址和伪造family均在连接前拒绝', async (t) => {
  const net = network(t, [], (_host, call) =>
    call === 1 ? [publicRecord, { address: '127.0.0.1', family: 4 }] : [{ address: '8.8.8.8', family: 6 }],
  );
  await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(400));
  await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(400));
  assert.equal(net.requests.length, 0);
});

test('连接lookup固定已验证IP，原始域名保留TLS验证且不携带认证或环境代理', async (t) => {
  const previous = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = 'http://127.0.0.1:9999';
  t.after(() => {
    if (previous === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = previous;
  });
  const net = network(t, [{}], (_host, call) =>
    call === 1 ? [publicRecord] : [{ address: '127.0.0.1', family: 4 }],
  );
  const result = await downloadStudySource('https://source.example.com/lesson', limits);
  assert.equal(result.extension, 'txt');
  assert.equal(result.buffer.toString(), '公开学习资料');
  assert.equal(result.contentType, 'text/plain; charset=utf-8');
  assert.equal(net.dnsCalls.length, 1);
  const { options, url } = net.requests[0];
  assert.equal(url.hostname, 'source.example.com');
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.family, 4);
  assert.equal(options.autoSelectFamily, false);
  assert.notEqual(options.agent, https.globalAgent);
  assert.deepEqual((options.agent as https.Agent).options.proxyEnv, undefined);
  assert.equal((options.headers as any)['Accept-Encoding'], 'identity');
  assert.equal((options.headers as any).Authorization, undefined);
  assert.equal((options.headers as any).Cookie, undefined);
  assert.equal(options.auth, undefined);
  assert.equal(options.socketPath, undefined);
  options.lookup!('source.example.com', {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, '8.8.8.8');
    assert.equal(family, 4);
  });
  options.lookup!('source.example.com', { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [publicRecord]);
  });
});

test('公共IPv6和HTTP默认端口可下载；IP字面量不触发DNS', async (t) => {
  const net = network(t, [{}, {}]);
  await downloadStudySource('https://[2606:4700:4700::1111]/', limits);
  await downloadStudySource('http://8.8.8.8/', limits);
  assert.deepEqual(net.dnsCalls, []);
  assert.equal(net.requests[0].options.family, 6);
  assert.equal(net.requests[1].options.family, 4);
  assert.notEqual(net.requests[1].options.agent, http.globalAgent);
});

test('重定向每一跳重新解析，允许相对跳转但拒绝指向内部地址', async (t) => {
  const net = network(t, [
    { status: 302, headers: { location: '/next' } },
    { status: 307, headers: { location: 'http://169.254.169.254/' } },
  ]);
  await assert.rejects(downloadStudySource('https://source.example.com/start', limits), status(400));
  assert.equal(net.requests.length, 2);
  assert.equal(net.requests[1].url.pathname, '/next');
  assert.equal(net.dnsCalls.length, 2);
});

test('同域重定向时DNS重新绑定为私网也被阻止', async (t) => {
  const net = network(t, [{ status: 302, headers: { location: '/next' } }], (_host, call) =>
    call === 1 ? [publicRecord] : [{ address: '192.168.1.2', family: 4 }],
  );
  await assert.rejects(downloadStudySource('https://source.example.com/start', limits), status(400));
  assert.equal(net.requests.length, 1);
});

test('重定向原文中的空凭据、反斜杠、空白和片段在URL规范化前拒绝', async (t) => {
  const locations = [
    'https://@public.example.com/',
    '//@public.example.com/',
    'https:////@public.example.com/',
    '///@public.example.com/',
    'https:/public.example.com/',
    'https://public.example.com\\path',
    ' https://public.example.com/',
    'https://public.example.com/\npath',
    '#',
  ];
  const net = network(
    t,
    locations.map((location) => ({ status: 302, headers: { location } })),
  );
  for (const _location of locations)
    await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(400));
  assert.equal(net.requests.length, locations.length);
  assert(net.requests.every((r) => r.request.destroyed && r.response.destroyed));
});

test('最多三次重定向，超限不发第五个请求；最终URL为校验后的实际来源', async (t) => {
  const net = network(
    t,
    Array.from({ length: 4 }, (_, n) => ({ status: 302, headers: { location: `/hop${n}` } })),
  );
  await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(502));
  assert.equal(net.requests.length, 4);
});

test('三次重定向可以成功，响应Cookie不传递到下一跳', async (t) => {
  const net = network(t, [
    { status: 301, headers: { location: '/one', 'set-cookie': 'secret=abc' } },
    { status: 303, headers: { location: 'https://other.example.com/two' } },
    { status: 308, headers: { location: '/final' } },
    {},
  ]);
  const result = await downloadStudySource('https://source.example.com/', limits);
  assert.equal(result.finalUrl, 'https://other.example.com/final');
  assert(net.requests.every((r) => !(r.options.headers as any).Cookie));
});

test('Content-Length超限与未知长度流式超限都会立即销毁请求', async (t) => {
  const net = network(t, [
    { headers: { 'content-length': '17' } },
    { chunks: [Buffer.alloc(8, 'a'), Buffer.alloc(9, 'b')], neverEnd: true },
  ]);
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      downloadStudySource('https://source.example.com/', { ...limits, maxBytes: 16 }),
      status(413),
    );
  assert(net.requests.every((r) => r.request.destroyed && r.response.destroyed));
});

test('压缩与多重Content-Encoding直接拒绝，不解压压缩炸弹', async (t) => {
  const net = network(
    t,
    ['gzip', 'br', 'deflate', 'gzip, identity'].map((encoding) => ({
      headers: { 'content-encoding': encoding },
      chunks: [Buffer.from('bomb')],
    })),
  );
  for (let i = 0; i < 4; i++)
    await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(415));
  assert(net.requests.every((r) => r.response.destroyed));
});

test('单字节网络分片也使用有界缓冲并保留完整UTF-8正文', async (t) => {
  const body = Buffer.from('公开资料'.repeat(128));
  network(t, [{ chunks: [...body].map((byte) => Buffer.from([byte])) }]);
  const result = await downloadStudySource('https://source.example.com/', {
    ...limits,
    maxBytes: body.length,
  });
  assert.deepEqual(result.buffer, body);
});

test('PDF需要匹配MIME、严格文件头和结束标记，拒绝伪装及常见主动内容标记', async (t) => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
  network(t, [
    { headers: { 'content-type': 'application/pdf' }, chunks: [pdf] },
    { headers: { 'content-type': 'application/octet-stream' }, chunks: [pdf] },
    { headers: { 'content-type': 'application/pdf' }, chunks: [Buffer.concat([Buffer.from(' '), pdf])] },
    { headers: { 'content-type': 'application/pdf' }, chunks: [Buffer.from('%PDF-1.7\ntruncated')] },
    {
      headers: { 'content-type': 'application/pdf' },
      chunks: [Buffer.from('%PDF-1.7\n/JavaScript(alert(1))\n%%EOF')],
    },
    {
      headers: { 'content-type': 'application/pdf' },
      chunks: [
        Buffer.concat([Buffer.from([0xa5, 0xd0, 0xc4, 0xc6, 0xad, 0xb1, 0xae, 0xb7]), pdf.subarray(8)]),
      ],
    },
    { headers: { 'content-type': 'application/pdf' }, chunks: [Buffer.from('%PDF-1.7 payload\n%%EOF')] },
  ]);
  const result = await downloadStudySource('https://source.example.com/paper.pdf', limits);
  assert.equal(result.extension, 'pdf');
  assert.equal(result.contentType, 'application/pdf');
  assert.deepEqual(result.buffer, pdf);
  for (let i = 0; i < 6; i++)
    await assert.rejects(downloadStudySource('https://source.example.com/paper.pdf', limits), status(415));
});

test('HTML转纯文本保留题目与段落，去掉脚本样式对象表单内容且不跟随链接', async (t) => {
  const html =
    '<!doctype html><html><head><title>ignored</title><style>secret-css</style></head><body><h1>练习 &amp; 解析</h1><p>求 2 &lt; 3 的真假。</p><script>alert("secret")</script><iframe>secret-frame</iframe><object>secret-object</object><textarea>secret-form</textarea><svg><script>secret-svg</script></svg><a href="http://127.0.0.1/private">解题提示</a><p>&#x4E2D;&#25991;&nbsp;答案</p></body></html>';
  const net = network(t, [
    { headers: { 'content-type': 'text/html; charset=utf-8' }, chunks: [Buffer.from(html)] },
  ]);
  const result = await downloadStudySource('https://source.example.com/lesson', limits);
  assert.equal(result.extension, 'txt');
  assert.equal(result.contentType, 'text/plain; charset=utf-8');
  assert.match(result.buffer.toString(), /练习 & 解析/);
  assert.match(result.buffer.toString(), /求 2 < 3 的真假。/);
  assert.match(result.buffer.toString(), /中文.*答案/);
  assert(!/secret|<script|<iframe|<html|127\.0\.0\.1/.test(result.buffer.toString()));
  assert.equal(net.requests.length, 1);
});

const gb2312Chinese = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
const legacyHtml = (declaration: string, body = gb2312Chinese) =>
  Buffer.concat([
    Buffer.from(`<html><head>${declaration}</head><body><p>`),
    body,
    Buffer.from('</p></body></html>'),
  ]);

test('无HTTP charset的HTML按meta charset白名单解码为UTF-8', async (t) => {
  network(t, [{ headers: { 'content-type': 'text/html' }, chunks: [legacyHtml('<meta charset="GB2312">')] }]);
  const result = await downloadStudySource('https://source.example.com/', limits);
  assert.equal(result.buffer.toString(), '中文');
  assert.equal(result.contentType, 'text/plain; charset=utf-8');
});

test('旧HTML的http-equiv Content-Type声明支持大小写与属性顺序', async (t) => {
  network(t, [
    {
      headers: { 'content-type': 'text/html' },
      chunks: [legacyHtml('<META CONTENT="text/html; charset=gb2312" HTTP-EQUIV="Content-Type">')],
    },
  ]);
  const result = await downloadStudySource('https://source.example.com/', limits);
  assert.equal(result.buffer.toString(), '中文');
});

test('HTTP charset始终优先于meta，包括未知HTTP编码也不能被meta覆盖', async (t) => {
  network(t, [
    {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      chunks: [legacyHtml('<meta charset="gb2312">', Buffer.from('中文'))],
    },
    {
      headers: { 'content-type': 'text/html; charset=gb2312' },
      chunks: [legacyHtml('<meta charset="utf-8">')],
    },
    {
      headers: { 'content-type': 'text/html; charset=utf-7' },
      chunks: [legacyHtml('<meta charset="gb2312">')],
    },
  ]);
  for (let index = 0; index < 2; index++) {
    const result = await downloadStudySource('https://source.example.com/', limits);
    assert.equal(result.buffer.toString(), '中文');
  }
  await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(415));
});

test('未知meta编码和指定编码下的非法字节均拒绝，不猜测备用编码', async (t) => {
  network(t, [
    { headers: { 'content-type': 'text/html' }, chunks: [legacyHtml('<meta charset="utf-7">')] },
    {
      headers: { 'content-type': 'text/html' },
      chunks: [legacyHtml('<meta http-equiv="Content-Type" content="text/html; charset=x-unknown">')],
    },
    {
      headers: { 'content-type': 'text/html' },
      chunks: [legacyHtml('<meta charset="gb2312">', Buffer.from([0x81]))],
    },
  ]);
  for (let index = 0; index < 3; index++)
    await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(415));
});

test('纯文本不会嗅探HTML声明或转换正文标签', async (t) => {
  const literal = '<meta charset="gb2312">中文';
  network(t, [
    { headers: { 'content-type': 'text/plain' }, chunks: [legacyHtml('<meta charset="gb2312">')] },
    { headers: { 'content-type': 'text/plain' }, chunks: [Buffer.from(literal)] },
  ]);
  await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(415));
  const result = await downloadStudySource('https://source.example.com/', limits);
  assert.equal(result.buffer.toString(), literal);
});

test('HTML仅扫描头16KiB，较晚meta声明不能改变默认UTF-8', async (t) => {
  const body = Buffer.concat([Buffer.alloc(16384, ' '), legacyHtml('<meta charset="gb2312">')]);
  network(t, [{ headers: { 'content-type': 'text/html' }, chunks: [body] }]);
  await assert.rejects(
    downloadStudySource('https://source.example.com/', { ...limits, maxBytes: 32768 }),
    status(415),
  );
});

test('注释与脚本内伪造的meta不会影响HTML编码选择', async (t) => {
  const misleading = '<!-- <meta charset="gb2312"> --><script>"<meta charset=gb2312>"</script>';
  network(t, [
    { headers: { 'content-type': 'text/html' }, chunks: [legacyHtml(misleading, Buffer.from('中文'))] },
    { headers: { 'content-type': 'text/html' }, chunks: [legacyHtml(misleading)] },
  ]);
  const result = await downloadStudySource('https://source.example.com/', limits);
  assert.equal(result.buffer.toString(), '中文');
  await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(415));
});

test('可执行MIME/文件名、二进制伪装、脚本和非法文本编码均拒绝', async (t) => {
  network(t, [
    { headers: { 'content-type': 'application/javascript' } },
    { headers: { 'content-disposition': 'attachment; filename="malware.exe"' } },
    { chunks: [Buffer.from('MZbinary')] },
    { chunks: [Buffer.from('#!/bin/sh\nwhoami')] },
    { chunks: [Buffer.from([0, 1, 2])] },
    { chunks: [Buffer.from([0xff, 0xff])] },
    { headers: { 'content-type': 'text/plain; charset=x-unknown' } },
    { headers: { 'content-disposition': "attachment; filename*=UTF-8''malware%2eexe" } },
    { headers: { 'content-type': 'text/html' }, chunks: [Buffer.from('<p>hello&#1;world</p>')] },
  ]);
  for (let i = 0; i < 9; i++)
    await assert.rejects(downloadStudySource('https://source.example.com/', limits), status(415));
});

test('转码后的输出大小也计入上限', async (t) => {
  network(t, [
    { headers: { 'content-type': 'text/plain; charset=iso-8859-1' }, chunks: [Buffer.from([0xe9, 0xe9])] },
  ]);
  await assert.rejects(
    downloadStudySource('https://source.example.com/', { ...limits, maxBytes: 2 }),
    status(413),
  );
});

test('总超时包含DNS，DNS未返回时不会继续发出请求', async (t) => {
  const net = network(t, [], () => new Promise(() => {}));
  await assert.rejects(
    downloadStudySource('https://source.example.com/', { ...limits, timeoutMs: 15 }),
    status(408),
  );
  assert.equal(net.requests.length, 0);
});

test('超时后才返回的DNS结果不会产生迟到连接', async (t) => {
  let resolveLookup!: (records: dns.LookupAddress[]) => void;
  const net = network(
    t,
    [],
    () =>
      new Promise((resolve) => {
        resolveLookup = resolve;
      }),
  );
  await assert.rejects(
    downloadStudySource('https://source.example.com/', { ...limits, timeoutMs: 15 }),
    status(408),
  );
  resolveLookup([publicRecord]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(net.requests.length, 0);
});

test('总超时终止持续未完成的数据流并清理socket', async (t) => {
  const net = network(t, [{ chunks: [Buffer.from('partial')], neverEnd: true }]);
  await assert.rejects(
    downloadStudySource('https://source.example.com/', { ...limits, timeoutMs: 20 }),
    status(408),
  );
  assert.equal(net.requests[0].request.destroyed, true);
  assert.equal(net.requests[0].response.destroyed, true);
});

test('重定向不会重置超时预算', async (t) => {
  const net = network(t, [{ status: 302, headers: { location: '/next' }, delay: 15 }, { delay: 20 }]);
  await assert.rejects(
    downloadStudySource('https://source.example.com/', { ...limits, timeoutMs: 25 }),
    status(408),
  );
  assert.equal(net.requests.length, 2);
});

test('拒绝登录/限流/中断响应，异常信息不包含内部IP、凭据或响应体', async (t) => {
  network(t, [
    { status: 401, chunks: [Buffer.from('password=secret')] },
    { status: 429 },
    { error: 'connect ECONNREFUSED 127.0.0.1:80 secret-token' },
    { truncated: true, chunks: [Buffer.from('partial')] },
    { headers: { 'content-length': '100' }, chunks: [Buffer.from('short')] },
  ]);
  for (let i = 0; i < 5; i++)
    await assert.rejects(downloadStudySource('https://source.example.com/', limits), (error: unknown) => {
      status(502)(error);
      assert(!/127\.0\.0\.1|secret|password|ECONNREFUSED/.test(String(error)));
      return true;
    });
});

test('无效限额在联网之前失败，不提供生产绕过开关', async (t) => {
  const net = network(t, []);
  for (const options of [
    { maxBytes: 0, timeoutMs: 100 },
    { maxBytes: 100, timeoutMs: 0 },
    { maxBytes: Infinity, timeoutMs: 100 },
    { maxBytes: 100, timeoutMs: 120001 },
  ])
    await assert.rejects(downloadStudySource('https://source.example.com/', options), status(400));
  assert.equal(net.dnsCalls.length, 0);
  assert.equal(net.requests.length, 0);
});
