// Local web app: upload or paste manual tests, pick a framework and language,
// watch the agent plan, explore and run, then read or download the project.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { readManualTests } from './input/read.js';
import { convert } from './agent.js';
import { FRAMEWORKS, LANGUAGE_LABELS, RUNNABLE } from './model.js';
import { renderPage } from './ui.js';
import { checkPassword, createUrlGuard } from './guard.js';
import { createRecordingRoutes } from './record/routes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 30 * 1024 * 1024;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error('The upload is larger than 30 MB.');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const sendJson = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
};

/**
 * host 127.0.0.1 (default): a local tool. Any other host (0.0.0.0 on Render):
 * public, so it only explores public URLs, and APP_PASSWORD, when set, guards
 * every page.
 */
export async function startServer({
  port = 9330,
  host = '127.0.0.1',
  password = process.env.APP_PASSWORD || '',
  publicOnly = process.env.PUBLIC_URLS_ONLY ? process.env.PUBLIC_URLS_ONLY !== 'false' : !['127.0.0.1', 'localhost', '::1'].includes(host),
} = {}) {
  let demo = null;
  // One conversion at a time: each can hold a browser, and small hosts have little memory.
  let queue = Promise.resolve();
  const recording = createRecordingRoutes({ publicOnly, readBody, sendJson, demoUrl: () => demo?.url });
  const server = http.createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }
    if (!checkPassword(req, res, password)) return;
    try {
      if (await recording(req, res, path)) return;
      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(renderPage());
      }
      if (req.method === 'GET' && path === '/api/info') {
        return sendJson(res, 200, {
          frameworks: Object.fromEntries(Object.entries(FRAMEWORKS).map(([k, f]) => [k, { label: f.label, kind: f.kind, languages: f.languages.map((l) => ({ key: l, label: LANGUAGE_LABELS[l], runnable: RUNNABLE.has(`${k}/${l}`) })) }])),
          planner: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'claude' : 'rules',
        });
      }
      if (req.method === 'GET' && path === '/api/sample') {
        const kind = new URL(req.url, 'http://x').searchParams.get('kind') === 'api' ? 'api-tests.csv' : 'manual-tests.csv';
        return sendJson(res, 200, { name: kind, text: await readFile(join(ROOT, 'examples', kind), 'utf8') });
      }
      if (req.method === 'POST' && path === '/api/demo-app') {
        if (!demo) {
          const { startDemoApp } = await import('../examples/demo-app.js');
          demo = await startDemoApp(0);
        }
        return sendJson(res, 200, { url: demo.url });
      }
      if (req.method === 'POST' && path === '/api/convert') {
        const input = await readBody(req);
        // Progress, then the result, as one JSON object per line.
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
        const send = (o) => res.write(JSON.stringify(o) + '\n');
        const turn = queue.then(async () => {
          const data = input.fileBase64 ? Buffer.from(input.fileBase64, 'base64') : String(input.text ?? '');
          const tests = await readManualTests({ name: input.fileName || 'pasted.txt', data });
          send({ type: 'progress', stage: 'read', count: tests.length });
          const baseUrl = (input.baseUrl || '').trim();
          const urlGuard = publicOnly ? createUrlGuard([demo?.url]) : null;
          if (urlGuard && baseUrl) await urlGuard(baseUrl);
          return { tests, result: await convert(tests, {
            framework: input.framework, language: input.language, baseUrl,
            explore: !!input.explore, verify: !!input.verify, planner: input.planner || 'auto', urlGuard,
            onProgress: (p) => send({ type: 'progress', ...p }),
          }) };
        });
        queue = turn.catch(() => {});
        try {
          const { result } = await turn;
          send({
            type: 'result',
            framework: input.framework, language: input.language,
            planner: result.planner, explored: result.explored, warnings: result.warnings,
            tests: result.project.report, files: result.project.files, run: result.project.run, verification: result.verification,
          });
        } catch (err) {
          send({ type: 'error', message: err.message });
        }
        return res.end();
      }
      if (req.method === 'POST' && path === '/api/zip') {
        const { files = [], name = 'automation-tests' } = await readBody(req);
        const zip = new JSZip();
        const folder = zip.folder(name.replace(/[^\w.-]+/g, '-'));
        for (const f of files) if (!f.path.includes('..')) folder.file(f.path, f.content);
        const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]+/g, '-')}.zip"` });
        return res.end(buffer);
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      if (!res.headersSent) sendJson(res, 400, { error: err.message });
      else res.end();
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve));
  return { url: `http://${host}:${server.address().port}/`, close: () => new Promise((r) => { demo?.close(); recording.close().finally(() => server.close(r)); }) };
}
