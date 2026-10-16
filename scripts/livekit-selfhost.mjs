import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { chmod, chown, mkdir, open, readFile, rm, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function livekitConfiguration(ip, key, secret) {
  if (isIP(ip) !== 4 || /^(0|127|169\.254|22[4-9]|23\d|24\d|25\d)\./.test(ip))
    throw new Error('A routable IPv4 address is required');
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(key) || !/^[A-Za-z0-9_-]{32,512}$/.test(secret))
    throw new Error('Invalid media credentials');
  return `port: 7880\nbind_addresses: [0.0.0.0]\nrtc:\n  tcp_port: 7881\n  udp_port: 7882\n  node_ip: ${ip}\n  use_external_ip: false\nkeys:\n  ${key}: ${secret}\nroom:\n  auto_create: false\n  enable_remote_unmute: false\nlogging:\n  level: warn\n`;
}
export async function initializeLivekit(directory, ip) {
  const key = 'study' + randomBytes(12).toString('hex');
  const secret = randomBytes(48).toString('base64url');
  const config = livekitConfiguration(ip, key, secret);
  await mkdir(directory, { recursive: true });
  const files = [];
  try {
    for (const [name, text] of [
      ['.env', `LIVEKIT_API_KEY=${key}\nLIVEKIT_API_SECRET=${secret}\n`],
      ['livekit.yaml', config],
    ]) {
      const path = join(directory, name);
      const handle = await open(path, 'wx', 0o600);
      files.push(path);
      try {
        await handle.writeFile(text);
      } finally {
        await handle.close();
      }
    }
    if (process.platform === 'linux' && process.getuid?.() === 0)
      await chown(join(directory, 'livekit.yaml'), 1000, 1000);
    for (const path of files) await chmod(path, 0o600);
  } catch {
    // Only files created by this invocation are removed. Existing credentials are never replaced.
    for (const file of files) await rm(file, { force: true });
    throw new Error('Initialization failed or credentials already exist; existing files were preserved');
  }
}
export async function checkLivekitFiles(directory, requireContainerOwner = false) {
  const [text, env] = await Promise.all([
    readFile(join(directory, 'livekit.yaml'), 'utf8'),
    readFile(join(directory, '.env'), 'utf8'),
  ]);
  // Validate our exact generated format without requiring host npm dependencies.
  // This is deliberately not a general YAML parser.
  const values =
    /^LIVEKIT_API_KEY=([A-Za-z0-9_-]{6,100})\nLIVEKIT_API_SECRET=([A-Za-z0-9_-]{32,512})\n$/.exec(env);
  const ip = /^  node_ip: ([0-9.]+)$/m.exec(text)?.[1];
  if (!values || !ip || livekitConfiguration(ip, values[1], values[2]) !== text)
    throw new Error('Configuration is inconsistent with the generated template');
  for (const name of ['.env', 'livekit.yaml']) {
    const s = await lstat(join(directory, name));
    if (!s.isFile() || s.mode & 0o077) throw new Error('Private files must be regular files with mode 600');
    if (requireContainerOwner && name === 'livekit.yaml' && process.platform === 'linux' && s.uid !== 1000)
      throw new Error('Container configuration must belong to UID 1000');
  }
}
async function main(args) {
  const directory = resolve('deploy/livekit');
  if (args.length === 2 && args[0] === '--init' && args[1].startsWith('--node-ip=')) {
    if (process.platform === 'linux' && ![0, 1000].includes(process.getuid?.()))
      throw new Error('Use root or UID 1000 to prepare the container configuration');
    await initializeLivekit(directory, args[1].slice(10));
    console.log('PASS private LiveKit configuration created with mode 600; credentials were not printed');
  } else if (args.length === 1 && args[0] === '--check') {
    await checkLivekitFiles(directory, true);
    console.log('PASS private LiveKit configuration and file permissions are consistent');
  } else throw new Error('Usage: node scripts/livekit-selfhost.mjs --init --node-ip=SERVER_IPV4, or --check');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(() => {
    console.error(
      'FAIL LiveKit configuration check/initialization failed; inspect file ownership, arguments and existing configuration. Credentials were not printed.',
    );
    process.exitCode = 1;
  });
