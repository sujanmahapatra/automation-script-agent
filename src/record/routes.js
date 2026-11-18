// HTTP for the recorder page:
//   GET  /record                     the page
//   POST /api/rec/start  { url }     opens a browser on url -> { id, viewport }
//   GET  /api/rec/:id/events         Server-Sent Events: frame (JPEG, base64), steps, page, closed
//   POST /api/rec/:id/:op            click, type, key, scroll, select, goto, back, reload, mode,
//                                    verify, insert, remove, move, replay, ai, import, export, exit
//   GET  /api/rec/:id/recording      the steps as JSON, to import later as a module
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Recorder, VIEWPORT } from './session.js';
import { interactWithRules, createClaudeInteractor } from './ai.js';
import { exportRecording, RECORDABLE, stepText, toPlan, baseUrlOf } from './steps.js';
import { createUrlGuard } from '../guard.js';
import { FRAMEWORKS, RUNNABLE } from '../model.js';
import { verifyProject } from '../verify.js';
import { report } from '../emit/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const httpError = (status, message) => Object.assign(new Error(message), { status });

export function createRecordingRoutes({ publicOnly, readBody, sendJson, demoUrl }) {
  const recorder = new Recorder({ maxSessions: Number(process.env.REC_MAX_SESSIONS) || (publicOnly ? 2 : 4) });
  let claude = null;
  const guard = () => (publicOnly ? createUrlGuard([demoUrl()]) : null);

  async function asset(res, file, type) {
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(await readFile(join(HERE, file), 'utf8'));
  }

  function events(req, res, session) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (type, data) => {
      res.write(`event: ${type}\ndata: ${type === 'frame' ? data : JSON.stringify(data)}\n\n`);
      if (type === 'closed') res.end();
    };
    send('hello', { viewport: VIEWPORT });
    const off = session.subscribe(send);
    session.pageInfo().then((p) => send('page', p)).catch(() => {});
    // Proxies close quiet streams; a comment every 20 s keeps this one open.
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      off();
    });
  }

  const OPS = {
    click: (s, b) => s.click(Number(b.x), Number(b.y)),
    type: (s, b) => s.type(String(b.text ?? '')),
    key: (s, b) => s.key(String(b.key)),
    scroll: (s, b) => s.scroll(Number(b.x), Number(b.y), Number(b.dx) || 0, Number(b.dy) || 0),
    select: (s, b) => s.select(String(b.value)),
    goto: (s, b) => s.goto(String(b.url || '')),
    back: (s) => s.back(),
    reload: (s) => s.reload(),
    mode: (s, b) => s.setMode(b.mode),
    verify: (s, b) => s.verifyPage(b.what === 'title' ? 'title' : 'url'),
    insert: (s, b) => s.setInsertAt(b.index == null ? null : Number(b.index)),
    remove: (s, b) => s.remove(String(b.id)),
    move: (s, b) => s.move(String(b.id), Number(b.to)),
    replay: (s, b) => s.replay(b.until == null ? null : Number(b.until)),
    async ai(s, b) {
      const mode = b.mode === 'validation' ? 'validation' : 'action';
      const instruction = String(b.instruction || '').trim();
      if (!instruction) throw httpError(400, 'Describe what to do first.');
      if (hasClaude() && b.engine !== 'rules') {
        claude ??= createClaudeInteractor();
        return { added: (await claude(s, instruction, { mode })).length, engine: 'claude' };
      }
      return { added: (await interactWithRules(s, instruction, { mode })).length, engine: 'rules' };
    },
    /** A saved recording's steps, run on the page now and added at the insertion point. */
    async import(s, b) {
      const steps = Array.isArray(b.steps) ? b.steps : [];
      if (!steps.length) throw httpError(400, 'That file has no steps.');
      let failed = 0;
      for (const raw of steps) {
        if (!RECORDABLE.has(raw?.type)) throw httpError(400, `Unknown step type "${raw?.type}".`);
        if (raw.target && !raw.target.locators?.playwright) throw httpError(400, 'A step in that file has no locator.');
        const { id, status, error, ...fields } = raw;
        const step = await s.addAndRun(fields);
        if (step.status === 'failed') failed += 1;
      }
      return { added: steps.length, failed };
    },
    async export(s, b) {
      const framework = FRAMEWORKS[b.framework] && b.framework !== 'api' ? b.framework : 'playwright';
      const language = FRAMEWORKS[framework].languages.includes(b.language) ? b.language : FRAMEWORKS[framework].languages[0];
      if (!s.steps.length) throw httpError(400, 'Record some steps first.');
      const title = String(b.title || 'Recorded test').slice(0, 120);
      const project = exportRecording(s.steps, { framework, language, title });
      let verification = null;
      if (b.verify && RUNNABLE.has(`${framework}/${language}`)) {
        verification = await verifyProject(project.files, { framework, language, baseUrl: baseUrlOf(s.steps) });
      }
      return { framework, language, title, files: project.files, tests: report([toPlan(s.steps, { framework, title })]), run: project.run, verification };
    },
  };

  /** Returns true when it handled the request. */
  async function handle(req, res, path) {
    if (req.method === 'GET' && path === '/record/') {
      // The page's relative URLs (api/…, record/client.js) resolve from /record.
      res.writeHead(301, { location: '../record' });
      res.end();
      return true;
    }
    if (req.method === 'GET' && path === '/record') {
      await asset(res, 'page.html', 'text/html');
      return true;
    }
    if (req.method === 'GET' && path === '/record/client.js') {
      await asset(res, 'client.js', 'text/javascript');
      return true;
    }
    if (!path.startsWith('/api/rec/')) return false;
    try {
      if (req.method === 'POST' && path === '/api/rec/start') {
        const { url } = await readBody(req);
        if (!url) throw httpError(400, 'Enter the address of the app to record.');
        const id = randomUUID();
        await recorder.open({ id, url: String(url).trim(), urlGuard: guard() });
        sendJson(res, 200, { id, viewport: VIEWPORT, engine: hasClaude() ? 'claude' : 'rules' });
        return true;
      }
      const [, , , id, op] = path.split('/');
      const session = recorder.get(id);
      if (req.method === 'GET' && op === 'events') {
        events(req, res, session);
        return true;
      }
      if (req.method === 'GET' && op === 'recording') {
        const name = session.steps.find((x) => x.type === 'goto')?.title || 'recording';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]+/g, '-').slice(0, 60)}.recording.json"` });
        res.end(JSON.stringify({ format: 'automation-script-agent/recording@1', steps: session.steps.map(({ status, error, ...s }) => ({ ...s, text: stepText(s) })) }, null, 2));
        return true;
      }
      if (req.method === 'POST' && op === 'exit') {
        await recorder.close(id);
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (req.method !== 'POST' || !OPS[op]) throw httpError(404, 'Not found');
      const body = await readBody(req);
      const result = await session.run(() => OPS[op](session, body));
      sendJson(res, 200, result ?? {});
    } catch (err) {
      sendJson(res, err.status ?? 400, { error: String(err.message).split('\n')[0] });
    }
    return true;
  }
  handle.close = () => recorder.closeAll();
  return handle;
}

