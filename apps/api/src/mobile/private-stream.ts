import { NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';

/** Keep an early disk error handled while current permissions are checked again. */
export async function recheckPrivateStream(stream: Readable, check: () => Promise<unknown>) {
  stream.on('error', () => {});
  try {
    await check();
    if (stream.errored) throw new NotFoundException('作业附件暂不可用，请刷新后重试');
  } catch (error) {
    stream.destroy();
    throw error;
  }
}
