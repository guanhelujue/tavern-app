import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = resolve(root, '.full-test-artifacts');
const reportPath = join(artifactsDir, 'report.json');
const clean = process.argv.includes('--clean');

if (clean && existsSync(artifactsDir)) {
  const relative = dirname(artifactsDir) === root ? artifactsDir.slice(root.length + 1) : '';
  if (relative !== '.full-test-artifacts' || resolve(artifactsDir) !== resolve(root, '.full-test-artifacts')) {
    throw new Error(`Refusing to clean an unexpected path: ${artifactsDir}`);
  }
  rmSync(artifactsDir, { recursive: true, force: true });
}
mkdirSync(artifactsDir, { recursive: true });

const nodeModules = join(root, 'node_modules');
const cli = {
  expo: join(nodeModules, 'expo', 'bin', 'cli'),
  tsc: join(nodeModules, 'typescript', 'bin', 'tsc'),
  vitest: join(nodeModules, 'vitest', 'vitest.mjs'),
};

const results = [];
const startedAt = new Date().toISOString();

function trimOutput(value) {
  const text = value.trim();
  return text.length > 4000 ? `${text.slice(0, 4000)}\n...[truncated]` : text;
}

function run(name, executable, args, extraEnv = {}) {
  return new Promise((resolveResult) => {
    const started = Date.now();
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      const logPath = join(artifactsDir, `${name}.log`);
      writeFileSync(logPath, `COMMAND: ${result.command.join(' ')}\nEXIT CODE: ${result.exitCode}\n\nSTDOUT\n${result.stdout}\n\nSTDERR\n${result.stderr}\n`, 'utf8');
      result.logPath = logPath;
      result.stdout = trimOutput(result.stdout);
      result.stderr = trimOutput(result.stderr);
      results.push(result);
      console.log(`${result.exitCode === 0 ? 'PASS' : 'FAIL'} ${name} (${result.durationMs}ms)`);
      resolveResult(result);
    };
    if (!existsSync(executable)) {
      const result = { name, command: [executable, ...args], exitCode: 1, durationMs: 0, stdout: '', stderr: `Missing CLI: ${executable}` };
      settle(result);
      return;
    }

    const child = spawn(process.execPath, [executable, ...args], {
      cwd: root,
      env: { ...process.env, CI: '1', ...extraEnv },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      const result = { name, command: [executable, ...args], exitCode: 1, durationMs: Date.now() - started, stdout, stderr: `${stderr}\n${error.message}` };
      settle(result);
    });
    child.on('close', (code, signal) => {
      const result = { name, command: [executable, ...args], exitCode: code ?? 1, signal, durationMs: Date.now() - started, stdout, stderr };
      settle(result);
    });
  });
}

await run('expo-dependency-compatibility', cli.expo, ['install', '--check']);
await run('typescript', cli.tsc, ['--noEmit']);
await run('lint', cli.expo, ['lint', '--max-warnings=0']);
await run('vitest', cli.vitest, ['run']);

for (const platform of ['web', 'android', 'ios']) {
  const outputDir = join(artifactsDir, 'export', platform);
  mkdirSync(outputDir, { recursive: true });
  const args = ['export', '--platform', platform, '--output-dir', outputDir];
  if (clean) args.push('--clear');
  await run(`expo-export-${platform}`, cli.expo, args);
}

const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  clean,
  root,
  passed: results.every((result) => result.exitCode === 0),
  steps: results,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Full regression ${report.passed ? 'passed' : 'failed'}. Report: ${reportPath}`);
process.exitCode = report.passed ? 0 : 1;
