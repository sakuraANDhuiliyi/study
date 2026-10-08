import { BadRequestException, ForbiddenException } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { timingSafeEqual } from 'node:crypto';

/** The first release accepts plain text; submitted HTML is stripped at the boundary. */
export function cleanText(input: string, max = 10000): string {
  const value = sanitizeHtml(input, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: 'discard' })
    .replace(/\u0000/g, '')
    .trim();
  if (!value || value.length > max) throw new BadRequestException(`内容不能为空且不能超过 ${max} 个字符`);
  return value;
}

export function safeFilename(input: string): string {
  const value = input
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 128);
  return value || 'attachment';
}

export function sameSecret(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function validSocketOrigin(origin: unknown, configured: string): boolean {
  if (typeof origin !== 'string') return false;
  return configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);
}

export function canRetract(senderId: string, actorId: string, createdAt: Date, now = Date.now()): boolean {
  const age = now - createdAt.getTime();
  return senderId === actorId && age >= 0 && age < 120000;
}

export function cursorIsNewer(
  next: { id: string; createdAt: Date },
  previous: { messageId: string; messageCreatedAt: Date },
): boolean {
  return (
    next.createdAt > previous.messageCreatedAt ||
    (next.createdAt.getTime() === previous.messageCreatedAt.getTime() && next.id > previous.messageId)
  );
}

function isOfficeZip(buffer: Buffer, prefix: string): boolean {
  // Read the central directory only: no decompression and no ZIP extraction.
  const tailStart = Math.max(0, buffer.length - 65557);
  let end = -1;
  for (let i = buffer.length - 22; i >= tailStart; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return false;
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16),
    bytes = 0;
  const names: string[] = [];
  if (count > 2048 || count === 0) return false;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return false;
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extra = buffer.readUInt16LE(offset + 30),
      comment = buffer.readUInt16LE(offset + 32);
    if (offset + 46 + nameLength + extra + comment > buffer.length) return false;
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (
      name.includes('..') ||
      name.startsWith('/') ||
      name.includes('\\') ||
      /vbaProject|\.exe$|\.js$/i.test(name)
    )
      return false;
    bytes += size;
    if (bytes > 50 * 1024 * 1024) return false;
    names.push(name);
    offset += 46 + nameLength + extra + comment;
  }
  return names.includes('[Content_Types].xml') && names.includes(prefix);
}

/** MIME supplied by a browser is never sufficient: extension and bytes must agree. */
export function inspectUpload(
  filename: string,
  buffer: Buffer,
  maxBytes: number,
): { name: string; mime: string } {
  if (buffer.length === 0 || buffer.length > maxBytes)
    throw new BadRequestException(`文件不能为空且不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB`);
  const name = safeFilename(filename),
    ext = name.split('.').pop()?.toLowerCase();
  const magic = buffer.subarray(0, 32);
  let mime: string | undefined;
  if (ext === 'png' && magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    mime = 'image/png';
  if (['jpg', 'jpeg'].includes(ext || '') && magic[0] === 255 && magic[1] === 216 && magic[2] === 255)
    mime = 'image/jpeg';
  if (ext === 'gif' && ['GIF87a', 'GIF89a'].includes(magic.subarray(0, 6).toString())) mime = 'image/gif';
  if (
    ext === 'webp' &&
    magic.subarray(0, 4).toString() === 'RIFF' &&
    magic.subarray(8, 12).toString() === 'WEBP'
  )
    mime = 'image/webp';
  if (
    ext === 'pdf' &&
    magic.subarray(0, 5).toString() === '%PDF-' &&
    !/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(buffer.toString('latin1'))
  )
    mime = 'application/pdf';
  if (ext === 'mp4' && magic.subarray(4, 8).toString() === 'ftyp') mime = 'video/mp4';
  if (
    ['txt', 'csv'].includes(ext || '') &&
    !buffer.includes(0) &&
    !buffer.toString('utf8').includes('\uFFFD')
  )
    mime = ext === 'csv' ? 'text/csv' : 'text/plain';
  const office: Record<string, [string, string]> = {
    docx: ['word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    xlsx: ['xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    pptx: [
      'ppt/presentation.xml',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  };
  if (
    ext &&
    office[ext] &&
    magic.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])) &&
    isOfficeZip(buffer, office[ext][0])
  )
    mime = office[ext][1];
  if (!mime)
    throw new BadRequestException(
      '文件类型、扩展名或文件内容不被允许；支持图片、PDF、无宏 Office、文本和 MP4',
    );
  return { name, mime };
}

export function assertPrivateParticipant(memberIds: string[], actorId: string): void {
  if (memberIds.length !== 2 || !memberIds.includes(actorId))
    throw new ForbiddenException('无权访问该私人会话');
}
