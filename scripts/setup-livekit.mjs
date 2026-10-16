// Download a pinned media runtime for local/CI verification only. No services or firewall rules are changed.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const livekitVersion = '1.13.10';
export const livekitBinary = resolve('.data/tools/livekit-server');
const artifacts = {
  'linux:x64': {
    url: `https://github.com/livekit/livekit/releases/download/v${livekitVersion}/livekit_${livekitVersion}_linux_amd64.tar.gz`,
    sha: 'c25a3e45fb922e9a93c6443d10c0ed041ba64342097e38632331736630283165',
  },
  'linux:arm64': {
    url: `https://github.com/livekit/livekit/releases/download/v${livekitVersion}/livekit_${livekitVersion}_linux_arm64.tar.gz`,
    sha: 'ff60607e1931ff078576882fa11c087aa5821d635ac0c47f56ff77e203e32006',
  },
  'darwin:arm64': {
    url: 'https://ghcr.io/v2/homebrew/core/livekit/blobs/sha256:fe0cd865ccad6f74ef5e3f69f3c8c63ab0bdb06979af2c80b42e6e628ea03c5e',
    sha: 'fe0cd865ccad6f74ef5e3f69f3c8c63ab0bdb06979af2c80b42e6e628ea03c5e',
    member: `livekit/${livekitVersion}/bin/livekit-server`,
  },
};
export async function setupLivekit() {
  if (process.env.NODE_ENV === 'production') throw new Error('Test runtime setup cannot run in production');
  if (existsSync(livekitBinary)) {
    const result = spawnSync(livekitBinary, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0 && result.stdout.trim() === `livekit-server version ${livekitVersion}`)
      return livekitBinary;
    throw new Error('Existing media runtime differs from the pinned version; inspect it before replacing');
  }
  const artifact = artifacts[`${process.platform}:${process.arch}`];
  if (!artifact) throw new Error('No pinned test media runtime for this platform');
  const headers = {};
  if (process.platform === 'darwin') {
    const response = await fetch(
      'https://ghcr.io/token?service=ghcr.io&scope=repository:homebrew/core/livekit:pull',
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw new Error('Unable to authorize the public test runtime download');
    const { token } = await response.json();
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(artifact.url, { headers, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Unable to download pinned media runtime');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000_000 || createHash('sha256').update(bytes).digest('hex') !== artifact.sha)
    throw new Error('Media runtime checksum mismatch');
  await mkdir(resolve('.data/tools'), { recursive: true });
  const temp = await mkdtemp(resolve('.data/tools/livekit-download-'));
  try {
    const archive = join(temp, 'runtime.tar.gz');
    await writeFile(archive, bytes, { mode: 0o600 });
    const member = artifact.member || 'livekit-server';
    // Extract one allowlisted member to stdout, never arbitrary paths from the archive.
    const result = spawnSync('tar', ['-xOf', archive, member], { maxBuffer: 150_000_000 });
    if (result.status !== 0) throw new Error('Unable to extract pinned media runtime');
    const candidate = join(temp, 'livekit-server');
    await writeFile(candidate, result.stdout, { mode: 0o700 });
    const version = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (version.status !== 0 || version.stdout.trim() !== `livekit-server version ${livekitVersion}`)
      throw new Error('Media runtime version mismatch');
    await rename(candidate, livekitBinary);
    await chmod(livekitBinary, 0o700);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return livekitBinary;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setupLivekit()
    .then(() => console.log(`PASS pinned LiveKit ${livekitVersion} test runtime ready`))
    .catch(() => {
      console.error('FAIL test media runtime setup failed; no service or credentials were changed');
      process.exitCode = 1;
    });
}
