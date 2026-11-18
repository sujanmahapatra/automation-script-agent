// A recording session: one browser page on the server, streamed to the web
// page as a screencast. The person clicks and types on the stream; each
// action is performed on the real page and saved as a step with locators for
// Playwright and Selenium, built and checked the same way the explorer does.
import { chromium } from '@playwright/test';
import { scanCandidates, clearMarkers } from '../explore/dom.js';
import { uniqueLocator, toPlaywright, perform, check } from '../explore/web.js';
import { pick } from '../locators.js';
import { describe, newStep, stepText } from './steps.js';

export const VIEWPORT = { width: 1280, height: 800 };
const STEP_TIMEOUT = 5000;
const SAVED_KEYS = new Set(['Enter', 'Tab', 'Escape']);

const sameLocator = (a, b) => JSON.stringify(a?.locators?.playwright) === JSON.stringify(b?.locators?.playwright);

export class RecordingSession {
  constructor({ id, context, urlGuard = null }) {
    this.id = id;
    this.context = context;
    this.urlGuard = urlGuard;
    this.steps = [];
    this.insertAt = null; // null: add new steps at the end
    this.mode = 'interact'; // interact | visual | text
    this.listeners = new Set();
    this.lastFrame = null;
    this.queue = Promise.resolve();
    this.lastUsed = Date.now();
    this.closed = false;
  }

  // ---- events to the web page --------------------------------------------

  subscribe(fn) {
    this.listeners.add(fn);
    if (this.lastFrame) fn('frame', this.lastFrame);
    fn('steps', this.view());
    return () => this.listeners.delete(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  view() {
    return {
      steps: this.steps.map((s) => ({ id: s.id, type: s.type, text: stepText(s), url: s.type === 'goto' ? s.url : null, ai: !!s.ai, status: s.status ?? null, error: s.error ?? null })),
      insertAt: this.insertAt,
      mode: this.mode,
    };
  }

  async pageInfo() {
    return { url: this.page.url(), title: await this.page.title().catch(() => '') };
  }

  changed() {
    this.emit('steps', this.view());
  }

  /** Runs `fn` after every earlier action: clicks and keys must reach the page in order. */
  run(fn) {
    this.lastUsed = Date.now();
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next.finally(async () => {
      if (!this.closed) this.emit('page', await this.pageInfo().catch(() => ({})));
    });
  }

  // ---- the page ------------------------------------------------------------

  async start(url) {
    if (this.urlGuard) {
      await this.urlGuard(url);
      await this.context.route('**/*', async (route) => {
        try {
          await this.urlGuard(route.request().url());
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
    }
    this.page = await this.context.newPage();
    // Links that open a new tab load in the recorded tab instead, so the
    // generated test, which drives one page, can follow.
    this.context.on('page', async (popup) => {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      const target = popup.url();
      await popup.close().catch(() => {});
      if (target && target !== 'about:blank') this.run(() => this.page.goto(target, { waitUntil: 'load', timeout: 15000 }).catch(() => {}));
    });
    this.page.on('dialog', (d) => d.accept().catch(() => {}));
    this.inflight = new Set();
    this.lastNetwork = 0;
    const finished = (request) => {
      this.inflight.delete(request);
      this.lastNetwork = Date.now();
    };
    this.page.on('request', (request) => {
      this.inflight.add(request);
      this.lastNetwork = Date.now();
    });
    this.page.on('requestfinished', finished);
    this.page.on('requestfailed', finished);
    this.page.on('framenavigated', (frame) => {
      if (frame !== this.page.mainFrame()) return;
      // Requests of the page navigated away from may never report back.
      for (const r of this.inflight) if (r.frame() !== frame || !r.isNavigationRequest()) this.inflight.delete(r);
      this.lastNetwork = Date.now();
    });
    this.cdp = await this.context.newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      this.lastFrame = data;
      this.emit('frame', data);
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
    await this.run(() => this.goto(url));
  }

  async close() {
    this.closed = true;
    this.emit('closed', {});
    this.listeners.clear();
    await this.context.close().catch(() => {});
  }

  /** The element under (x, y), or the focused element, as a candidate with checked locators. */
  async element(point) {
    const candidates = await this.page.evaluate(scanCandidates, {});
    try {
      const index = await this.page.evaluate((p) => {
        const el = p ? document.elementFromPoint(p.x, p.y) : document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return -1;
        // The control the person meant, not the icon or text inside it.
        const control = el.closest('a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch],[role=combobox],[onclick],[contenteditable=""],[contenteditable="true"]') || el;
        const marked = control.closest('[data-agent-cand]');
        return marked ? Number(marked.getAttribute('data-agent-cand')) : -1;
      }, point);
      const c = candidates[index];
      return c ? await this.withLocators(c) : null;
    } finally {
      await this.page.evaluate(clearMarkers).catch(() => {});
    }
  }

  /** Candidate -> { c, target }. Needs the scan's markers on the page. */
  async withLocators(c) {
    const fallback = c.path ? { strategy: 'css', value: c.path } : null;
    const locators = {
      playwright: (await uniqueLocator(this.page, c, 'playwright')) ?? fallback,
      selenium: (await uniqueLocator(this.page, c, 'selenium')) ?? fallback,
    };
    return { c, target: describe(c, locators) };
  }

  /**
   * After a click or key: lets what it started finish (a fetch, then a redirect)
   * before the next step is recorded, so a check sees the page the person sees.
   */
  async settle() {
    // Playwright's networkidle state is reached once per page and not re-armed
    // by later requests, so the page's own request count is watched instead:
    // quiet for 400 ms since the action, or 3 s at most.
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (this.inflight.size === 0 && Date.now() - Math.max(this.lastNetwork, start) >= 400) break;
      await this.page.waitForTimeout(50);
    }
    await this.page.waitForLoadState('load', { timeout: STEP_TIMEOUT }).catch(() => {});
  }

  locator(target) {
    return toPlaywright(this.page, target.locators.playwright);
  }

  // ---- steps ---------------------------------------------------------------

  add(fields) {
    const step = newStep(fields);
    if (this.insertAt == null) this.steps.push(step);
    else {
      this.steps.splice(this.insertAt, 0, step);
      this.insertAt += 1;
    }
    this.changed();
    return step;
  }

  last() {
    return this.insertAt == null ? this.steps.at(-1) : this.steps[this.insertAt - 1];
  }

  remove(id) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.steps.splice(i, 1);
    if (this.insertAt != null && i < this.insertAt) this.insertAt -= 1;
    this.changed();
  }

  move(id, to) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0) return;
    const [step] = this.steps.splice(i, 1);
    this.steps.splice(Math.max(0, Math.min(to, this.steps.length)), 0, step);
    this.changed();
  }

  setInsertAt(index) {
    this.insertAt = index == null || index >= this.steps.length ? null : Math.max(0, index);
    this.changed();
  }

  setMode(mode) {
    this.mode = ['visual', 'text'].includes(mode) ? mode : 'interact';
    this.changed();
  }

  // ---- what the person does ------------------------------------------------

  async goto(url) {
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (this.urlGuard) await this.urlGuard(url);
    await this.page.goto(url, { waitUntil: 'load', timeout: 20000 });
    this.add({ type: 'goto', url: this.page.url(), title: await this.page.title() });
  }

  /** A click on the stream at viewport (x, y). Returns { select } when it hit a dropdown, so the page can offer its options. */
  async click(x, y) {
    const hit = await this.element({ x, y });
    if (this.mode !== 'interact') {
      if (!hit) throw new Error('Nothing to validate there.');
      await this.validate(hit);
      return {};
    }
    if (hit?.c.tag === 'select') {
      this.pendingSelect = hit;
      const options = await this.locator(hit.target).evaluate((s) => [...s.options].map((o) => ({ label: o.label, value: o.value, selected: o.selected }))).catch(() => []);
      return { select: { options, label: hit.target.description } };
    }
    await this.page.mouse.click(x, y);
    await this.settle();
    if (!hit) return {};
    if (['checkbox', 'radio', 'switch'].includes(hit.c.role)) {
      const checked = await this.locator(hit.target).isChecked().catch(() => null);
      if (checked != null) {
        this.add({ type: checked ? 'check' : 'uncheck', target: hit.target });
        return {};
      }
    }
    this.add({ type: 'click', target: hit.target });
    return {};
  }

  async select(value) {
    const hit = this.pendingSelect;
    if (!hit) throw new Error('Click a dropdown first.');
    this.pendingSelect = null;
    const [chosen] = await this.locator(hit.target).selectOption(value, { timeout: STEP_TIMEOUT });
    const label = await this.locator(hit.target).evaluate((s, v) => [...s.options].find((o) => o.value === v)?.label ?? v, chosen);
    this.add({ type: 'select', target: hit.target, value: label });
  }

  async type(text) {
    await this.page.keyboard.type(text);
    await this.saveTyped();
  }

  /** The focused field's value as one "Type" step, updated while the person keeps typing in the same field. */
  async saveTyped() {
    const hit = await this.element(null);
    if (!hit || !hit.c.editable || hit.c.tag === 'select') return;
    const value = await this.page.evaluate(() => {
      const el = document.activeElement;
      return el.isContentEditable ? el.innerText : el.value;
    });
    const prev = this.last();
    if (prev?.type === 'fill' && sameLocator(prev.target, hit.target)) {
      prev.value = value;
      this.changed();
    } else this.add({ type: 'fill', target: hit.target, value });
  }

  async key(key) {
    const focused = SAVED_KEYS.has(key) ? await this.element(null) : null;
    await this.page.keyboard.press(key);
    if (SAVED_KEYS.has(key)) {
      await this.settle();
      this.add({ type: 'press', key, target: focused?.target ?? null });
    } else if (['Backspace', 'Delete'].includes(key)) await this.saveTyped();
  }

  async scroll(x, y, dx, dy) {
    await this.page.mouse.move(x, y);
    await this.page.mouse.wheel(dx, dy);
  }

  async back() {
    await this.page.goBack({ waitUntil: 'load', timeout: 15000 });
  }

  async reload() {
    await this.page.reload({ waitUntil: 'load', timeout: 15000 });
  }

  /** Visual validation: the element is visible. Text validation: it shows its current text (or holds its value). */
  async validate(hit) {
    const { c, target } = hit;
    let fields;
    if (this.mode === 'text' && c.editable && c.tag !== 'select') {
      fields = { type: 'expectValue', target, value: await this.locator(target).inputValue().catch(() => '') };
    } else if (this.mode === 'text' && c.text) {
      fields = { type: 'expectText', target, text: c.text };
    } else fields = { type: 'expectVisible', target };
    this.setMode('interact');
    return this.checkAndAdd(fields);
  }

  async verifyPage(what) {
    await this.settle();
    const info = await this.pageInfo();
    // The path only: query strings tend to carry ids and tokens that change each run.
    return what === 'title' ? this.checkAndAdd({ type: 'expectTitle', value: info.title }) : this.checkAndAdd({ type: 'expectUrl', value: new URL(info.url).pathname });
  }

  async checkAndAdd(fields) {
    const step = this.add(fields);
    const ok = await this.check(step);
    step.status = ok ? 'passed' : 'failed';
    if (!ok) step.error = 'did not hold when it was added';
    this.changed();
    return step;
  }

  // ---- running steps ---------------------------------------------------------

  /** A step as the Action the explorer's perform/check expect. */
  action(step) {
    return { type: step.type, value: step.value, key: step.key, text: step.text, url: step.url, ms: step.ms };
  }

  async check(step) {
    const loc = step.target ? this.locator(step.target) : null;
    if (step.type === 'expectText' && loc) {
      const end = Date.now() + STEP_TIMEOUT;
      while (Date.now() < end) {
        if ((await loc.innerText().catch(() => '')).includes(step.text)) return true;
        await this.page.waitForTimeout(150);
      }
      return false;
    }
    return check(this.page, this.action(step), loc);
  }

  async execute(step) {
    if (step.type.startsWith('expect')) {
      if (!(await this.check(step))) throw new Error(`${stepText(step)}: did not hold`);
      return;
    }
    const loc = step.target ? this.locator(step.target) : null;
    if (step.type === 'goto') {
      if (this.urlGuard) await this.urlGuard(step.url);
      return this.page.goto(step.url, { waitUntil: 'load', timeout: 20000 });
    }
    await perform(this.page, this.action(step), loc);
    if (['click', 'press', 'select', 'check', 'uncheck'].includes(step.type)) await this.settle();
  }

  /** Runs steps from the first up to and including `until` (all when null), marking each. */
  async replay(until = null) {
    const last = until == null ? this.steps.length - 1 : Math.min(until, this.steps.length - 1);
    for (const s of this.steps) {
      delete s.status;
      delete s.error;
    }
    this.changed();
    let failed = false;
    for (let i = 0; i <= last; i++) {
      const s = this.steps[i];
      if (failed) {
        s.status = 'skipped';
        continue;
      }
      s.status = 'running';
      this.changed();
      try {
        await this.execute(s);
        s.status = 'passed';
      } catch (err) {
        s.status = 'failed';
        s.error = String(err.message).split('\n')[0].slice(0, 200);
        failed = true;
      }
      this.changed();
    }
    // New steps go after the last one run.
    this.setInsertAt(until == null ? null : last + 1);
    return { passed: !failed };
  }

  /** Runs and adds steps from elsewhere (an imported module, an AI interaction). */
  async addAndRun(fields) {
    const step = this.add(fields);
    try {
      await this.execute(step);
      step.status = 'passed';
    } catch (err) {
      step.status = 'failed';
      step.error = String(err.message).split('\n')[0].slice(0, 200);
    }
    this.changed();
    return step;
  }

  /** Finds the element a planned action means (rules or Claude), with checked locators. */
  async find(target, type) {
    const candidates = await this.page.evaluate(scanCandidates, {});
    try {
      const { choice, ranked } = pick(target, type, candidates);
      if (!choice) {
        const near = ranked.slice(0, 2).map((r) => `"${r.c.text || r.c.label || r.c.placeholder || r.c.ariaLabel || r.c.tag}"`).join(', ');
        throw new Error(`No element clearly matches "${target.description}"${near ? ` (closest: ${near})` : ''}.`);
      }
      return await this.withLocators(choice);
    } finally {
      await this.page.evaluate(clearMarkers).catch(() => {});
    }
  }

  /** Candidates on the page now, for Claude to choose from. Markers stay until `release`. */
  async scan() {
    return this.page.evaluate(scanCandidates, { limit: 400 });
  }

  async release() {
    await this.page.evaluate(clearMarkers).catch(() => {});
  }
}

/** Every open session, sharing one browser that closes when the last session does. */
export class Recorder {
  constructor({ maxSessions = 3, idleMs = 20 * 60_000 } = {}) {
    this.sessions = new Map();
    this.maxSessions = maxSessions;
    this.idleMs = idleMs;
    this.browser = null;
    this.sweeper = setInterval(() => this.sweep(), 60_000).unref();
  }

  async open({ id, url, urlGuard }) {
    this.sweep();
    if (this.sessions.size >= this.maxSessions) throw new Error(`${this.maxSessions} recordings are already open. Exit one, or wait a few minutes.`);
    if (!this.browser?.isConnected()) {
      const args = (process.env.CHROME_ARGS || '').split(/\s+/).filter(Boolean);
      this.browser = await chromium.launch({ headless: true, args });
    }
    const context = await this.browser.newContext({ viewport: VIEWPORT });
    const session = new RecordingSession({ id, context, urlGuard });
    this.sessions.set(id, session);
    try {
      await session.start(url);
    } catch (err) {
      await this.close(id);
      throw err;
    }
    return session;
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) throw Object.assign(new Error('This recording has ended. Start a new one.'), { status: 404 });
    return s;
  }

  async close(id) {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    await s?.close();
    if (!this.sessions.size && this.browser) {
      const b = this.browser;
      this.browser = null;
      await b.close().catch(() => {});
    }
  }

  sweep() {
    for (const [id, s] of this.sessions) {
      // A tab left open still holds a browser, so idleness counts actions, not viewers.
      if (Date.now() - s.lastUsed > this.idleMs) this.close(id);
    }
  }

  async closeAll() {
    clearInterval(this.sweeper);
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}
