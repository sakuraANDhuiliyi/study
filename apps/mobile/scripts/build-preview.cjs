/** Builds a bundled, debug-key-signed preview APK locally; never a store release. */
const { spawnSync, execFileSync } = require('node:child_process');
const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  openSync,
  closeSync,
  rmSync,
} = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const root = resolve(__dirname, '..');
const local = process.argv.includes('--local');
if (process.argv.slice(2).some((a) => a !== '--local')) throw new Error('Only --local is supported');
const env = {
  ...process.env,
  EXPO_NO_TELEMETRY: '1',
  CI: '1',
  EXPO_PUBLIC_PREVIEW_BUILD: 'true',
  EXPO_PUBLIC_ALLOW_LOCAL_HTTP: local ? 'true' : 'false',
  EXPO_PUBLIC_API_ORIGIN: local ? 'http://127.0.0.1:3030' : 'https://study.huiliyi.cn',
};
for (const key of Object.keys(env))
  if (
    key.startsWith('EXPO_PUBLIC_') &&
    !['EXPO_PUBLIC_ALLOW_LOCAL_HTTP', 'EXPO_PUBLIC_API_ORIGIN', 'EXPO_PUBLIC_PREVIEW_BUILD'].includes(key)
  )
    delete env[key];
if (!env.JAVA_HOME || !(env.ANDROID_HOME || env.ANDROID_SDK_ROOT))
  throw new Error('Set JAVA_HOME (JDK17) and ANDROID_HOME (SDK36, NDK27.1.12297006)');
const out = resolve(root, '.data/apk');
mkdirSync(out, { recursive: true });
for (const [step, command, args, cwd] of [
  ['security', process.execPath, ['scripts/harden-build.cjs', '--check'], root],
  [
    'prebuild',
    process.execPath,
    [
      'node_modules/expo/bin/cli',
      'prebuild',
      '--platform',
      'android',
      '--no-install',
      '--template',
      'expo-template-bare-minimum@56.0.37',
    ],
    root,
  ],
  [
    'assemble',
    resolve(root, 'android/gradlew'),
    ['assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--max-workers=2', '--no-daemon'],
    resolve(root, 'android'),
  ],
]) {
  if (step === 'assemble') {
    // Gradle does not fingerprint JS dependency patches or EXPO_PUBLIC_* values.
    // Missing declared outputs force a fresh bundled app for this exact profile.
    for (const path of [
      'android/app/build/generated/assets/react/release',
      'android/app/build/generated/res/react/release',
    ])
      rmSync(resolve(root, path), { recursive: true, force: true });
  }
  console.log('Android preview: ' + step);
  const log = openSync(resolve(out, step + '.log'), 'w', 0o600);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 1800000,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  if (result.error || result.status !== 0)
    throw new Error('Android ' + step + ' failed; inspect apps/mobile/.data/apk/' + step + '.log');
}
const file = resolve(out, local ? 'zhixue-local-preview-arm64.apk' : 'zhixue-preview-arm64.apk');
copyFileSync(resolve(root, 'android/app/build/outputs/apk/release/app-release.apk'), file);
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
const tool = (name) => resolve(sdk, 'build-tools/36.0.0', name);
const xml = execFileSync(tool('aapt'), ['dump', 'xmltree', file, 'AndroidManifest.xml'], {
  encoding: 'utf8',
  env,
});
const badging = execFileSync(tool('aapt'), ['dump', 'badging', file], { encoding: 'utf8', env });
if (
  !badging.includes("package: name='cn.huiliyi.study.preview'") ||
  badging.includes('application-debuggable')
)
  throw new Error('APK must be a non-debuggable preview package');
for (const name of [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
])
  if (xml.includes(name)) throw new Error('Unexpected APK permission: ' + name);
for (const [name, expected] of [
  ['android:allowBackup', '0x0'],
  ['android:usesCleartextTraffic', local ? '0xffffffff' : '0x0'],
])
  if (!xml.split('\n').some((line) => line.includes(name) && line.trim().endsWith(expected)))
    throw new Error('APK security setting mismatch: ' + name);
execFileSync(tool('apksigner'), ['verify', file], { env, stdio: 'pipe' });
const entries = execFileSync(resolve(env.JAVA_HOME, 'bin/jar'), ['tf', file], {
  encoding: 'utf8',
  env,
}).split('\n');
if (!entries.includes('assets/index.android.bundle')) throw new Error('Standalone APK bundle missing');
const inspect = resolve(out, 'inspection');
rmSync(inspect, { recursive: true, force: true });
mkdirSync(inspect, { recursive: true });
execFileSync(resolve(env.JAVA_HOME, 'bin/jar'), ['xf', file, 'assets/index.android.bundle'], {
  cwd: inspect,
  env,
  stdio: 'pipe',
});
const embedded = readFileSync(resolve(inspect, 'assets/index.android.bundle'));
if (
  !embedded.includes(Buffer.from(env.EXPO_PUBLIC_API_ORIGIN)) ||
  (!local && embedded.includes(Buffer.from('http://127.0.0.1:3030')))
)
  throw new Error('APK embeds stale platform configuration');
rmSync(inspect, { recursive: true, force: true });

const abis = [
  ...new Set(
    entries
      .filter((path) => path.startsWith('lib/') && path.endsWith('.so'))
      .map((path) => path.split('/')[1]),
  ),
];
if (abis.length !== 1 || abis[0] !== 'arm64-v8a') throw new Error('Unexpected APK architecture');
const report = {
  file,
  package: 'cn.huiliyi.study.preview',
  signatureVerified: true,
  cleartextAllowed: local,
  backupAllowed: false,
  debuggable: false,
  bundled: true,
  sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  localPreview: local,
  signing: 'public Android debug key; preview only',
  architecture: 'arm64-v8a',
};
writeFileSync(file + '.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
