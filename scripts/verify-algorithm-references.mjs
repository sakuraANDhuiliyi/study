/**
 * Offline maintenance check for fixed, trusted repository-owned reference programs.
 * NEVER use this runner for student/browser source. Production code execution belongs to Judge0.
 * Accepted CLI arguments only select languages/problem IDs from the imported fixed catalog.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tsImport } from 'tsx/esm/api';

const { algorithmProblems } = await tsImport(
  '../apps/api/src/algorithms/algorithms.catalog.ts',
  import.meta.url,
);
const { getAlgorithmEditorial } = await tsImport(
  '../apps/api/src/algorithms/algorithms.editorials.ts',
  import.meta.url,
);
const languages = ['python', 'javascript', 'cpp', 'java'];
const ids = new Set(algorithmProblems.map((problem) => problem.id));
let selectedLanguages = languages;
let selectedProblems = algorithmProblems;
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith('--languages=')) {
    selectedLanguages = argument.slice('--languages='.length).split(',');
    if (!selectedLanguages.length || selectedLanguages.some((language) => !languages.includes(language)))
      throw new Error('Only the fixed python,javascript,cpp,java languages can be selected');
  } else if (argument.startsWith('--problems=')) {
    const selected = argument.slice('--problems='.length).split(',');
    if (!selected.length || selected.some((id) => !ids.has(id)))
      throw new Error('Only existing repository catalog problem IDs can be selected');
    selectedProblems = algorithmProblems.filter((problem) => selected.includes(problem.id));
  } else
    throw new Error(
      'Only --languages=... and --problems=... selectors are accepted; source code and paths are not accepted',
    );
}
selectedLanguages = [...new Set(selectedLanguages)];

const env = { PATH: process.env.PATH, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TMPDIR: tmpdir() };
const probe = (candidates, flag) =>
  candidates.find((candidate) => {
    const result = spawnSync(candidate, [flag], { timeout: 5000, stdio: 'ignore', env });
    return !result.error && result.status === 0;
  });
const javaHome = '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin';
const runtimes = {
  python: probe(['/usr/bin/python3', 'python3'], '--version'),
  javascript: process.execPath,
  cpp: probe(['/usr/bin/clang++', 'clang++', 'g++'], '--version'),
  java: probe([join(javaHome, 'java'), 'java'], '-version'),
  javac: probe([join(javaHome, 'javac'), 'javac'], '-version'),
};
const normalize = (value) =>
  value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
const execute = (command, args, cwd, input = '', timeout = 15_000) => {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: 'utf8',
    env,
    shell: false,
    timeout,
    maxBuffer: 4 * 1_048_576,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${result.error?.message ?? `exit ${result.status}, signal ${result.signal}`} ${result.stderr?.slice(0, 2000) ?? ''}`,
    );
  return result.stdout;
};
const directory = mkdtempSync(join(tmpdir(), 'zhixue-trusted-algorithm-references-'));
const failures = [];
let programsPassed = 0,
  casesPassed = 0;
try {
  for (const language of selectedLanguages) {
    if (!runtimes[language] || (language === 'java' && !runtimes.javac)) {
      failures.push(`${language}: required runtime/compiler is unavailable`);
      continue;
    }
    for (const problem of selectedProblems) {
      try {
        const source = getAlgorithmEditorial(problem.id)?.referenceCode[language];
        if (typeof source !== 'string' || !source.trim()) throw new Error('Missing fixed reference source');
        let command = runtimes[language],
          args;
        if (language === 'python') {
          const file = join(directory, 'reference.py');
          writeFileSync(file, source);
          args = [file];
        } else if (language === 'javascript') {
          const file = join(directory, 'reference.cjs');
          writeFileSync(file, source);
          args = [file];
        } else if (language === 'cpp') {
          const file = join(directory, 'reference.cpp');
          writeFileSync(file, source);
          command = join(directory, 'reference-program');
          execute(
            runtimes.cpp,
            ['-std=c++17', '-O2', '-Wall', '-Wextra', file, '-o', command],
            directory,
            '',
            30_000,
          );
          args = [];
        } else {
          const file = join(directory, 'Main.java');
          writeFileSync(file, source);
          execute(runtimes.javac, ['-encoding', 'UTF-8', '-d', directory, file], directory, '', 30_000);
          args = ['-cp', directory, 'Main'];
        }
        for (let index = 0; index < problem.testCases.length; index++) {
          const fixture = problem.testCases[index];
          let output;
          try {
            output = execute(command, args, directory, fixture.input);
          } catch (error) {
            throw new Error(`Case ${index + 1}: ${error.message}`);
          }
          if (normalize(output) !== normalize(fixture.output))
            throw new Error(`Output mismatch at case ${index + 1}`);
          casesPassed++;
        }
        programsPassed++;
        console.log(`PASS ${language} ${problem.id} (${problem.testCases.length} cases)`);
      } catch (error) {
        const failure = `${language} ${problem.id}: ${error.message}`;
        failures.push(failure);
        console.error(`FAIL ${failure}`);
      }
    }
  }
} finally {
  // Only this script's newly created temporary directory is removed.
  rmSync(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ programsPassed, casesPassed, languages: selectedLanguages, failures }, null, 2));
if (failures.length) process.exitCode = 1;
