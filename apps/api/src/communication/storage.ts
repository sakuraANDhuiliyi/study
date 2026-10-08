import { Injectable } from '@nestjs/common';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Replace this adapter with S3 using private objects, preserving authorization in the service. */
export interface PrivateStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  putStream(key: string, stream: Readable): Promise<void>;
  get(key: string): ReadStream;
  delete(key: string): Promise<void>;
}

@Injectable()
export class LocalPrivateStorage implements PrivateStorage {
  private readonly root = resolve(process.env.UPLOAD_DIR || './storage/private');
  private path(key: string): string {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid private storage key');
    return resolve(this.root, key);
  }
  async put(key: string, bytes: Buffer): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.path(key), bytes, { flag: 'wx', mode: 0o600 });
  }
  async putStream(key: string, stream: Readable): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const output = createWriteStream(this.path(key), { flags: 'wx', mode: 0o600 });
    let created = false;
    output.once('open', () => {
      created = true;
    });
    try {
      await pipeline(stream, output);
    } catch (error) {
      if (created) await this.delete(key);
      throw error;
    }
  }
  get(key: string): ReadStream {
    return createReadStream(this.path(key));
  }
  async delete(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => undefined);
  }
}
