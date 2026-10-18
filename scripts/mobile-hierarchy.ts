/** Build a read-only hierarchy probe from source for the explicitly owned Android emulator. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve, delimiter } from 'node:path';
export function prepareMobileHierarchy(sdk: string, output: string) {
  const java = process.env.JAVA_HOME;
  if (!java || !existsSync(join(java, 'bin', 'javac')))
    throw new Error('Set JAVA_HOME to the reviewed JDK before Android device acceptance');
  const platform = join(sdk, 'platforms', 'android-36');
  const classes = join(output, 'hierarchy', 'classes'),
    dex = join(output, 'hierarchy', 'dex');
  mkdirSync(classes, { recursive: true });
  mkdirSync(dex, { recursive: true });
  const cp = [
    'android.jar',
    'uiautomator.jar',
    'optional/android.test.base.jar',
    'optional/android.test.runner.jar',
  ]
    .map((p) => join(platform, p))
    .join(delimiter);
  const invoke = (file: string, args: string[]) =>
    execFileSync(file, args, { timeout: 60000, stdio: 'pipe', env: process.env });
  invoke(join(java, 'bin', 'javac'), [
    '-source',
    '8',
    '-target',
    '8',
    '-cp',
    cp,
    '-d',
    classes,
    resolve('tests/android/HierarchyDump.java'),
  ]);
  invoke(join(sdk, 'build-tools', '36.0.0', 'd8'), [
    '--min-api',
    '24',
    '--output',
    dex,
    join(classes, 'cn/huiliyi/verification/HierarchyDump.class'),
  ]);
  const jar = join(output, 'hierarchy', 'hierarchy.jar');
  invoke(join(java, 'bin', 'jar'), ['cf', jar, '-C', dex, 'classes.dex']);
  return jar;
}
