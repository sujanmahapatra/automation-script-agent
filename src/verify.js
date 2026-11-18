// Runs a generated project to prove it works. Only the targets this project
// can run with its own node_modules (Playwright TS, API TS, Selenium TS);
// Java and Python projects need their own toolchains and are left to CI.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { RUNNABLE } from './model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, { cwd, env, timeout = 300_000 }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function playwrightResults(json) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs || []) {
      const results = spec.tests.flatMap((t) => t.results);
      const last = results.at(-1);
      out.push({ title: spec.title, ok: spec.ok, error: last?.error?.message?.replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join('\n') ?? null, ms: last?.duration ?? null });
    }
    (suite.suites || []).forEach(walk);
  };
  (json.suites || []).forEach(walk);
  return out;
}

function tapResults(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/^(not ok|ok) \d+ - (.+)$/);
    if (!m) return;
    let error = null;
    if (m[1] === 'not ok') {
      const block = lines.slice(i + 1, i + 30).join('\n');
      error = block.match(/error: \|-?\n((?:\s{4,}.*\n?)+)/)?.[1]?.replace(/^\s+/gm, '').trim() || block.match(/error: '?(.+?)'?\n/)?.[1] || 'failed';
    }
    out.push({ title: m[2], ok: m[1] === 'ok', error, ms: null });
  });
  return out;
}

/** Writes the project under .verify/, runs it, and returns { ran, passed, failed, tests: [{ title, ok, error }] }. */
export async function verifyProject(files, { framework, language, baseUrl }) {
  const key = `${framework}/${language}`;
  if (!RUNNABLE.has(key)) return { ran: false, reason: `${key} needs its own toolchain; run it with the commands in its README` };
  const dir = join(ROOT, '.verify', randomUUID());
  try {
    for (const f of files) {
      await mkdir(dirname(join(dir, f.path)), { recursive: true });
      await writeFile(join(dir, f.path), f.content);
    }
    const env = { BASE_URL: baseUrl, HEADLESS: 'true', FORCE_COLOR: '0' };
    let tests;
    if (framework === 'selenium') {
      const r = await run(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', 'tests/*.test.ts'], { cwd: dir, env });
      tests = tapResults(r.stdout);
      if (!tests.length) return { ran: false, reason: (r.stderr || r.stdout).split('\n').slice(0, 8).join('\n') };
    } else {
      const cli = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
      // One worker: a small hosted instance holds one browser, not one per CPU.
      const r = await run(process.execPath, [cli, 'test', '--config', join(dir, 'playwright.config.ts'), '--reporter=json', '--workers=1'], { cwd: dir, env });
      try {
        tests = playwrightResults(JSON.parse(r.stdout));
      } catch {
        return { ran: false, reason: (r.stderr || r.stdout).split('\n').slice(0, 8).join('\n') };
      }
    }
    return { ran: true, passed: tests.filter((t) => t.ok).length, failed: tests.filter((t) => !t.ok).length, tests };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
