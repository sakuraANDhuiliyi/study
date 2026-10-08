import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  PayloadTooLargeException,
  RequestTimeoutException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { performance } from 'node:perf_hooks';
import sanitizeHtml from 'sanitize-html';
import { assertSafePdf } from '../common/pdf-security';

const MAX_URL_LENGTH = 2048;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TIMEOUT_MS = 120000;
const executableSuffix =
  /\.(?:exe|dll|com|scr|msi|msp|bat|cmd|ps1|psm1|vbs|vbe|wsf|wsh|hta|sh|bash|js|mjs|cjs|jar|class|apk|app|so|dylib|wasm|bin)(?:$|[\s"';?])/i;
const badUrl = () => new BadRequestException('仅支持可公开访问的 HTTP/HTTPS 资料链接');
const downloadError = () => new BadGatewayException('无法安全下载该资料，请选择其他公开来源');
const timeoutError = () => new RequestTimeoutException('资料下载超时，请稍后重试');
const sizeError = () => new PayloadTooLargeException('资料超过允许下载的大小');
const typeError = () => new UnsupportedMediaTypeException('仅支持安全的 PDF、纯文本或可转换的网页资料');

function ipv4Number(address: string) {
  return address.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}
function ipv4Range(address: string, prefix: string, bits: number) {
  return (
    Math.floor(ipv4Number(address) / 2 ** (32 - bits)) === Math.floor(ipv4Number(prefix) / 2 ** (32 - bits))
  );
}
function ipv6Number(address: string): bigint {
  // isIP validates syntax before this helper. All IPv4-embedded forms are denied below.
  const [left, right] = address.toLowerCase().split('::');
  const a = left ? left.split(':') : [];
  const b = right ? right.split(':') : [];
  const parts = right !== undefined ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return parts.reduce((n, part) => (n << 16n) + BigInt(parseInt(part, 16)), 0n);
}
function ipv6Range(address: bigint, prefix: string, bits: number) {
  const shift = BigInt(128 - bits);
  return address >> shift === ipv6Number(prefix) >> shift;
}
function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    if (address === '168.63.129.16') return false; // Azure virtual platform/metadata endpoint.
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([prefix, bits]) => ipv4Range(address, String(prefix), Number(bits)));
  }
  if (isIP(address) !== 6 || address.includes('.')) return false;
  const value = ipv6Number(address);
  // Global unicast only. Deny mapped/compatible, NAT64, ULA, link-local and multicast by construction.
  if (!ipv6Range(value, '2000::', 3)) return false;
  return ![
    ['2001::', 23], // Special-purpose, Teredo, benchmark and other transition ranges.
    ['2001:db8::', 32],
    ['2002::', 16], // 6to4 can tunnel a non-public IPv4 address.
    ['3fff::', 20],
  ].some(([prefix, bits]) => ipv6Range(value, String(prefix), Number(bits)));
}

function parsePublicUrl(input: string): URL {
  if (
    typeof input !== 'string' ||
    !input ||
    input.length > MAX_URL_LENGTH ||
    /[\s\\\u0000-\u001f\u007f]/u.test(input)
  )
    throw badUrl();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw badUrl();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    input.includes('#')
  )
    throw badUrl();
  const authority = /^https?:\/\/([^/?#]+)/i.exec(input)?.[1];
  if (!authority || authority.includes('@')) throw badUrl();
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) throw badUrl();
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (isIP(host)) {
    if (!publicAddress(host)) throw badUrl();
  } else {
    if (
      host.length > 253 ||
      !host.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|test|example|onion)$/.test(host)
    )
      throw badUrl();
    if (host.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
      throw badUrl();
    url.hostname = host;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw badUrl();
  }
  if (executableSuffix.test(pathname)) throw typeError();
  return url;
}

/** Synchronous URL syntax/literal-IP filter only. downloadStudySource also resolves and pins DNS. */
export function isPublicHttpUrl(url: string): boolean {
  try {
    parsePublicUrl(url);
    return true;
  } catch {
    return false;
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      cleanup();
      reject(timeoutError());
    };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    if (signal.aborted) {
      reject(timeoutError());
      return;
    }
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(
      (result) => {
        cleanup();
        resolve(result);
      },
      () => {
        cleanup();
        reject(downloadError());
      },
    );
  });
}

async function resolvePublic(url: URL, signal: AbortSignal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(hostname);
  const addresses = literal
    ? [{ address: hostname, family: literal }]
    : await abortable(dns.promises.lookup(hostname, { all: true, verbatim: true }), signal);
  if (
    !addresses.length ||
    addresses.some(
      (entry) =>
        ![4, 6].includes(entry.family) ||
        isIP(entry.address) !== entry.family ||
        !publicAddress(entry.address),
    )
  )
    throw badUrl();
  if (signal.aborted) throw timeoutError();
  return addresses[0];
}

type Hop = { redirect: string } | { buffer: Buffer; contentType: string };
async function requestHop(url: URL, maxBytes: number, signal: AbortSignal): Promise<Hop> {
  const pinned = await resolvePublic(url, signal);
  const secure = url.protocol === 'https:';
  // Dedicated agents do not inherit the environment-proxy settings of globalAgent.
  const agent = secure
    ? new https.Agent({ keepAlive: false, maxSockets: 1 })
    : new http.Agent({ keepAlive: false, maxSockets: 1 });
  const lookup: LookupFunction = (_hostname, options, callback) => {
    callback(null, options.all ? [pinned] : pinned.address, options.all ? undefined : pinned.family);
  };
  try {
    return await new Promise<Hop>((resolve, reject) => {
      let settled = false;
      const resources: { request?: http.ClientRequest; response?: http.IncomingMessage } = {};
      const finish = (error?: Error, result?: Hop) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(result!);
        resources.response?.destroy();
        resources.request?.destroy();
      };
      const abort = () => finish(timeoutError());
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      const requestOptions: https.RequestOptions & { autoSelectFamily: boolean } = {
        method: 'GET',
        agent,
        lookup,
        family: pinned.family,
        autoSelectFamily: false,
        maxHeaderSize: 16384,
        insecureHTTPParser: false,
        rejectUnauthorized: true,
        headers: {
          Accept: 'application/pdf,text/plain,text/html,application/xhtml+xml',
          'Accept-Encoding': 'identity',
          'User-Agent': 'Zhixue-Study-Source/1.0',
          Connection: 'close',
        },
      };
      const request = (secure ? https.request : http.request)(url, requestOptions, (incoming) => {
        resources.response = incoming;
        incoming.on('error', () => finish(downloadError()));
        incoming.on('aborted', () => finish(downloadError()));
        if (settled) {
          incoming.destroy();
          return;
        }
        const status = incoming.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = incoming.headers.location;
          const hasAuthority = location && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(location);
          const rawAuthority = location && /^(?:https?:)?\/\/([^/?#]+)/i.exec(location)?.[1];
          if (
            !location ||
            location.length > MAX_URL_LENGTH ||
            /[\s\\\u0000-\u001f\u007f#]/u.test(location) ||
            (hasAuthority && (!rawAuthority || rawAuthority.includes('@')))
          ) {
            finish(badUrl());
            return;
          }
          finish(undefined, { redirect: location });
          return;
        }
        if (status !== 200) {
          finish(downloadError());
          return;
        }
        const encoding = incoming.headers['content-encoding'];
        if (encoding && (typeof encoding !== 'string' || encoding.trim().toLowerCase() !== 'identity')) {
          finish(typeError());
          return;
        }
        const contentType = incoming.headers['content-type'];
        if (
          typeof contentType !== 'string' ||
          contentType.length > 200 ||
          !/^(?:application\/pdf|text\/plain|text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(
            contentType,
          )
        ) {
          finish(typeError());
          return;
        }
        let disposition = incoming.headers['content-disposition'];
        try {
          if (disposition) disposition = decodeURIComponent(disposition);
        } catch {
          finish(typeError());
          return;
        }
        if (disposition && executableSuffix.test(disposition)) {
          finish(typeError());
          return;
        }
        const declared = incoming.headers['content-length'];
        if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
          finish(sizeError());
          return;
        }
        // One bounded buffer also bounds bookkeeping when a server sends one-byte chunks.
        const storage = Buffer.allocUnsafe(maxBytes);
        let size = 0;
        incoming.on('data', (chunk: Buffer) => {
          if (settled) return;
          if (chunk.length > maxBytes - size) {
            finish(sizeError());
            return;
          }
          chunk.copy(storage, size);
          size += chunk.length;
        });
        incoming.on('end', () => {
          if (!size || (declared !== undefined && size !== Number(declared))) {
            finish(downloadError());
            return;
          }
          finish(undefined, { buffer: Buffer.from(storage.subarray(0, size)), contentType });
        });
        incoming.on('close', () => {
          if (!settled) finish(downloadError());
        });
      });
      resources.request = request;
      request.on('error', () => finish(signal.aborted ? timeoutError() : downloadError()));
      request.on('upgrade', (_incoming, socket) => {
        socket.destroy();
        finish(typeError());
      });
      request.end();
    });
  } finally {
    agent.destroy();
  }
}

function declaredCharset(contentType: string): string | undefined {
  const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? match[3]).trim().toLowerCase() : undefined;
}

function htmlMetaCharset(buffer: Buffer): string | undefined {
  let charset: string | undefined;
  // Supported encodings have ASCII-compatible declarations. Parse only a bounded prefix;
  // the HTML parser ignores comments and raw script/style text instead of guessing encoding.
  sanitizeHtml(buffer.subarray(0, 16384).toString('latin1'), {
    allowedTags: ['meta'],
    allowedAttributes: { meta: ['charset', 'http-equiv', 'content'] },
    nestingLimit: 100,
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'template', 'iframe', 'object', 'svg', 'math'],
    exclusiveFilter: (frame) => {
      if (frame.tag === 'meta' && charset === undefined) {
        if (frame.attribs.charset !== undefined) charset = frame.attribs.charset.trim().toLowerCase();
        else if (frame.attribs['http-equiv']?.trim().toLowerCase() === 'content-type')
          charset = declaredCharset(frame.attribs.content || '');
      }
      return true;
    },
  });
  return charset;
}

function toPlainText(buffer: Buffer, contentType: string): Buffer {
  const html = /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(contentType);
  const charset = declaredCharset(contentType) ?? (html ? htmlMetaCharset(buffer) : undefined) ?? 'utf-8';
  if (
    !['utf-8', 'utf8', 'us-ascii', 'iso-8859-1', 'windows-1252', 'gbk', 'gb2312', 'gb18030', 'big5'].includes(
      charset,
    )
  )
    throw typeError();
  let text: string;
  try {
    text = new TextDecoder(charset, { fatal: true }).decode(buffer);
  } catch {
    throw typeError();
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) || /^(?:MZ|#!|\u007fELF)/.test(text))
    throw typeError();
  if (!/^text\/plain(?:\s*;|\s*$)/i.test(contentType)) {
    text = sanitizeHtml(text, {
      allowedTags: ['p', 'br', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'pre', 'blockquote'],
      allowedAttributes: {},
      nestingLimit: 100,
      nonTextTags: [
        'script',
        'style',
        'textarea',
        'option',
        'noscript',
        'template',
        'iframe',
        'object',
        'embed',
        'svg',
        'math',
        'head',
      ],
      disallowedTagsMode: 'discard',
    })
      .replace(/<\/?(?:p|br|div|li|tr|h[1-4]|pre|blockquote)\b[^>]*>/gi, '\n')
      .replace(
        /&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/gi,
        (entity) =>
          ({
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&apos;': "'",
            '&#39;': "'",
            '&#x27;': "'",
            '&nbsp;': ' ',
          })[entity.toLowerCase()] || entity,
      );
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw typeError();
  return Buffer.from(
    text
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    'utf8',
  );
}

/** Caller must supply a source URL already stored from a trusted search-tool result. */
export async function downloadStudySource(
  url: string,
  options: { maxBytes: number; timeoutMs: number },
): Promise<{ buffer: Buffer; contentType: string; extension: 'pdf' | 'txt'; finalUrl: string }> {
  if (
    !options ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    options.maxBytes > MAX_DOWNLOAD_BYTES ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > MAX_TIMEOUT_MS
  )
    throw new BadRequestException('资料下载限制配置无效');
  let target = parsePublicUrl(url);
  const controller = new AbortController();
  const deadline = performance.now() + options.timeoutMs;
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const result = await requestHop(target, options.maxBytes, controller.signal);
      if ('redirect' in result) {
        if (redirects === 3) throw new BadGatewayException('资料来源重定向次数过多，请选择其他来源');
        let next: string;
        try {
          next = new URL(result.redirect, target).href;
        } catch {
          throw badUrl();
        }
        target = parsePublicUrl(next);
        continue;
      }
      let buffer = result.buffer;
      const pdf = /^application\/pdf(?:\s*;|\s*$)/i.test(result.contentType);
      if (pdf) {
        await assertSafePdf(buffer, {
          timeoutMs: Math.max(1, Math.floor(deadline - performance.now())),
          signal: controller.signal,
        });
      } else buffer = toPlainText(buffer, result.contentType);
      if (!buffer.length) throw typeError();
      if (buffer.length > options.maxBytes) throw sizeError();
      if (controller.signal.aborted || performance.now() > deadline) throw timeoutError();
      return {
        buffer,
        contentType: pdf ? 'application/pdf' : 'text/plain; charset=utf-8',
        extension: pdf ? 'pdf' : 'txt',
        finalUrl: target.href,
      };
    }
    throw downloadError();
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError();
    if (error instanceof HttpException) throw error;
    throw downloadError();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
