import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPrivateParticipant,
  canRetract,
  cleanText,
  cursorIsNewer,
  inspectUpload,
  safeFilename,
  sameSecret,
  validSocketOrigin,
} from '../apps/api/src/communication/security';
import {
  attachmentSchema,
  parse,
  sendMessageSchema,
} from '../apps/api/src/communication/communication.schemas';

test('讨论文本去除脚本、事件属性、图片与危险链接', () => {
  const text = cleanText(
    '<script>steal()</script><p onclick="evil()">安全内容<img src=x onerror=evil()></p><a href="javascript:evil()">链接</a>',
  );
  assert.equal(text, '安全内容链接');
  assert.throws(() => cleanText('<script>steal()</script>'));
  assert.throws(() => cleanText('x'.repeat(101), 100));
});

test('文件名清理路径、控制字符与响应头注入', () => {
  assert.equal(safeFilename('../../成绩\r\nX-Injected: yes.pdf'), '_.._成绩__X-Injected_ yes.pdf');
  assert(!safeFilename('C:\\secret\\../file.txt').includes('\\'));
  assert.equal(safeFilename('...'), 'attachment');
  assert(safeFilename('x'.repeat(200)).length <= 128);
});

test('上传依据文件字节和扩展名判断；伪装HTML、执行文件、SVG和危险PDF均拒绝', () => {
  const max = 1024 * 1024;
  assert.throws(() => inspectUpload('x.png', Buffer.from('<html>not image</html>'), max));
  assert.throws(() => inspectUpload('x.svg', Buffer.from('<svg onload="evil()"/>'), max));
  assert.throws(() => inspectUpload('x.pdf', Buffer.from('%PDF-1.5 /JavaScript (evil)'), max));
  assert.throws(() => inspectUpload('x.docx', Buffer.from('PK\u0003\u0004fake zip'), max));
  assert.throws(() => inspectUpload('x.exe', Buffer.from('MZbinary'), max));
  assert.throws(() => inspectUpload('x.txt', Buffer.from([0, 1, 2]), max));
  assert.equal(inspectUpload('notes.txt', Buffer.from('这是笔记'), max).mime, 'text/plain');
  assert.equal(
    inspectUpload('handout.pdf', Buffer.from('%PDF-1.5\n1 0 obj<<>>endobj\n%%EOF'), max).mime,
    'application/pdf',
  );
  assert.throws(() => inspectUpload('empty.txt', Buffer.alloc(0), max));
  assert.throws(() => inspectUpload('large.txt', Buffer.from('123456'), 5));
});

test('WebSocket校验精确来源和非空、定长安全CSRF比较', () => {
  assert(validSocketOrigin('https://study.example.com', 'https://study.example.com'));
  assert(!validSocketOrigin('https://study.example.com.evil.invalid', 'https://study.example.com'));
  assert(!validSocketOrigin(undefined, 'https://study.example.com'));
  assert(!validSocketOrigin('http://study.example.com', 'https://study.example.com'));
  assert(sameSecret('valid-csrf', 'valid-csrf'));
  assert(!sameSecret('', ''));
  assert(!sameSecret('secret', 'secreT'));
  assert(!sameSecret('secret', 'secret-too-long'));
});

test('消息撤回严格校验本人及两分钟窗口', () => {
  const now = Date.now();
  assert(canRetract('student', 'student', new Date(now - 119999), now));
  assert(!canRetract('student', 'teacher', new Date(now - 1000), now));
  assert(!canRetract('student', 'student', new Date(now - 120000), now));
  assert(!canRetract('student', 'student', new Date(now + 1000), now));
});

test('私信参与资格不因管理员身份或任意ID获得', () => {
  assert.doesNotThrow(() => assertPrivateParticipant(['teacher', 'student'], 'teacher'));
  assert.throws(() => assertPrivateParticipant(['teacher', 'student'], 'admin'));
  assert.throws(() => assertPrivateParticipant(['teacher', 'student', 'admin'], 'student'));
  assert.throws(() => assertPrivateParticipant([], 'student'));
});

test('已读游标按照时间与ID稳定递增，相同时间与历史请求不能回退', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const old = { messageId: 'b', messageCreatedAt: at };
  assert(cursorIsNewer({ id: 'c', createdAt: at }, old));
  assert(!cursorIsNewer({ id: 'a', createdAt: at }, old));
  assert(!cursorIsNewer({ id: 'b', createdAt: at }, old));
  assert(!cursorIsNewer({ id: 'z', createdAt: new Date(at.getTime() - 1) }, old));
  assert(cursorIsNewer({ id: 'a', createdAt: new Date(at.getTime() + 1) }, old));
});

test('消息必须携带可重试幂等ID，空消息及复合附件范围拒绝', () => {
  assert.throws(() => parse(sendMessageSchema, { body: 'hello' }));
  assert.throws(() => parse(sendMessageSchema, { clientId: 'retry-123', body: '' }));
  assert.equal(parse(sendMessageSchema, { clientId: 'retry-123', body: 'hello' }).clientId, 'retry-123');
  assert.equal(parse(sendMessageSchema, { clientId: 'retry-123', attachmentIds: ['file-1'] }).body, '');
  assert.throws(() => parse(attachmentSchema, { courseId: 'course-1', conversationId: 'conversation-1' }));
  assert.throws(() => parse(attachmentSchema, { assignmentId: 'assignment-1', courseId: 'course-1' }));
});
