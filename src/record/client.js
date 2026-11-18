// The recorder page. The browser being recorded runs on the server; this page
// shows its screencast, sends clicks and keys to it, and lists the steps the
// server records.
const $ = (id) => document.getElementById(id);
const FRAMEWORKS = {
  playwright: { label: 'Playwright', languages: [['typescript', 'TypeScript'], ['python', 'Python']] },
  selenium: { label: 'Selenium', languages: [['java', 'Java'], ['python', 'Python'], ['typescript', 'TypeScript']] },
  appium: { label: 'Appium', languages: [['java', 'Java'], ['python', 'Python'], ['typescript', 'TypeScript']] },
};
const RUNNABLE = new Set(['playwright/typescript', 'selenium/typescript']);
const ICONS = { goto: '🌐', click: '↖', fill: 'Tr', select: '▾', check: '☑', uncheck: '☐', press: '⏎', hover: '↗', wait: '⏱' };

let id = null;
let viewport = { width: 1280, height: 800 };
let engine = 'rules';
let state = { steps: [], insertAt: null, mode: 'interact' };
let selected = null;
let aiOpen = false;
let aiMode = 'action';
let events = null;
let busy = 0;
let chain = Promise.resolve();

// ---- talking to the server ------------------------------------------------

function toast(message, kind = 'error') {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast ${kind === 'info' ? 'info' : ''}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), kind === 'info' ? 2500 : 6000);
}

async function call(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

/** Sends one action. Actions go out in order, so typing lands after the click that focused the field. */
function op(name, body, { quiet = false } = {}) {
  busy += 1;
  $('busy').hidden = false;
  const p = chain.then(() => call(`api/rec/${id}/${name}`, body));
  chain = p.catch(() => {});
  return p
    .catch((err) => {
      if (!quiet) toast(err.message);
      throw err;
    })
    .finally(() => {
      busy -= 1;
      $('busy').hidden = busy === 0;
    });
}

// ---- starting and ending ------------------------------------------------------

async function start(url) {
  const btn = $('start-btn');
  btn.disabled = true;
  btn.textContent = 'Opening…';
  try {
    const r = await call('api/rec/start', { url });
    id = r.id;
    viewport = r.viewport;
    engine = r.engine;
    $('start').hidden = true;
    $('app').hidden = false;
    $('download-rec').href = `api/rec/${id}/recording`;
    $('dlg-download-rec').href = `api/rec/${id}/recording`;
    listen();
    $('viewer').focus();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start recording';
  }
}

function listen() {
  events = new EventSource(`api/rec/${id}/events`);
  events.addEventListener('frame', (e) => ($('screen').src = `data:image/jpeg;base64,${e.data}`));
  events.addEventListener('steps', (e) => {
    state = JSON.parse(e.data);
    render();
  });
  events.addEventListener('page', (e) => {
    const p = JSON.parse(e.data);
    if (p.url && document.activeElement !== $('url')) $('url').value = p.url;
    if (p.title) document.title = `${p.title} · Low-Code Recorder`;
  });
  events.addEventListener('closed', () => end('This recording was closed.'));
  events.onerror = () => {
    if (events.readyState === EventSource.CLOSED) end('Lost the connection to the recording.');
  };
}

function end(message) {
  events?.close();
  id = null;
  $('app').hidden = true;
  $('start').hidden = false;
  document.title = 'Low-Code Recorder';
  if (message) toast(message, 'info');
}

$('start-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('start-url').value.trim();
  if (!url) return toast('Enter the address of the app to record.');
  start(url);
});
$('demo-btn').addEventListener('click', async () => {
  try {
    const r = await call('api/demo-app');
    $('start-url').value = `${r.url}/login`;
    start(`${r.url}/login`);
  } catch (err) {
    toast(err.message);
  }
});
$('exit').addEventListener('click', async () => {
  if (state.steps.length && !confirm('Exit and discard this recording? Use "Save recording" or "Save as module" first to keep it.')) return;
  await call(`api/rec/${id}/exit`).catch(() => {});
  end();
});

// ---- the browser ------------------------------------------------------------

const viewer = $('viewer');

function point(e) {
  const r = $('screen').getBoundingClientRect();
  return {
    x: Math.round(((e.clientX - r.left) * viewport.width) / r.width),
    y: Math.round(((e.clientY - r.top) * viewport.height) / r.height),
  };
}

viewer.addEventListener('mousedown', (e) => {
  if (e.target.closest('.popover, .banner')) return;
  e.preventDefault();
  viewer.focus();
});
viewer.addEventListener('click', async (e) => {
  if (e.target.closest('.popover, .banner')) return;
  $('select-pop').hidden = true;
  await flushTyping();
  const p = point(e);
  const r = await op('click', p).catch(() => null);
  if (r?.select) showSelect(r.select, e);
});

function showSelect({ options, label }, e) {
  const pop = $('select-pop');
  pop.replaceChildren();
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `Choose an option in "${label}"`;
  pop.append(title);
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(o.selected));
    b.textContent = o.label || o.value || '(empty)';
    b.addEventListener('click', () => {
      pop.hidden = true;
      op('select', { value: o.value });
      viewer.focus();
    });
    pop.append(b);
  }
  const box = viewer.getBoundingClientRect();
  pop.style.left = `${Math.min(e.clientX - box.left, box.width - 220)}px`;
  pop.style.top = `${Math.min(e.clientY - box.top + 8, box.height - 200)}px`;
  pop.hidden = false;
  pop.querySelector('button')?.focus();
}

// Typing: printable keys are batched, so a word is one request, not one per letter.
let typed = '';
let typeTimer = null;
function flushTyping() {
  clearTimeout(typeTimer);
  if (!typed) return Promise.resolve();
  const text = typed;
  typed = '';
  return op('type', { text }).catch(() => {});
}
const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
viewer.addEventListener('keydown', (e) => {
  if (e.target !== viewer) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    flushTyping();
    op('key', { key: 'ControlOrMeta+A' });
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length === 1) {
    e.preventDefault();
    typed += e.key;
    clearTimeout(typeTimer);
    typeTimer = setTimeout(flushTyping, 300);
  } else if (KEYS.has(e.key)) {
    e.preventDefault();
    flushTyping();
    op('key', { key: e.key });
  }
});
viewer.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text');
  if (!text) return;
  e.preventDefault();
  flushTyping();
  op('type', { text });
});
let wheel = { dx: 0, dy: 0, timer: null, at: null };
viewer.addEventListener('wheel', (e) => {
  e.preventDefault();
  wheel.dx += e.deltaX;
  wheel.dy += e.deltaY;
  wheel.at = point(e);
  if (wheel.timer) return;
  wheel.timer = setTimeout(() => {
    const { dx, dy, at } = wheel;
    wheel = { dx: 0, dy: 0, timer: null, at: null };
    op('scroll', { ...at, dx, dy }, { quiet: true }).catch(() => {});
  }, 60);
}, { passive: false });

$('url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  op('goto', { url: $('url').value.trim() });
  viewer.focus();
});
$('back').addEventListener('click', () => op('back'));
$('reload').addEventListener('click', () => op('reload'));

// ---- tools ---------------------------------------------------------------------

function setMode(mode) {
  op('mode', { mode: state.mode === mode ? 'interact' : mode });
}
$('tool-visual').addEventListener('click', () => setMode('visual'));
$('tool-text').addEventListener('click', () => setMode('text'));
$('banner-cancel').addEventListener('click', () => op('mode', { mode: 'interact' }));
$('tool-ai').addEventListener('click', () => {
  aiOpen = !aiOpen;
  render();
  if (aiOpen) document.querySelector('[data-role=instruction]')?.focus();
});
$('verify-url').addEventListener('click', () => op('verify', { what: 'url' }));
$('verify-title').addEventListener('click', () => op('verify', { what: 'title' }));
$('run-all').addEventListener('click', () => {
  selected = null;
  op('replay', {}).then((r) => toast(r.passed ? 'Every step passed.' : 'A step failed: see the steps list.', r.passed ? 'info' : 'error'));
});

// ---- the steps list ---------------------------------------------------------

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...children.filter((c) => c != null && c !== false));
  return n;
}

function insertBlock() {
  const block = $('insert-tpl').content.firstElementChild.cloneNode(true);
  const box = block.querySelector('[data-role=aibox]');
  box.hidden = !aiOpen;
  block.querySelector('[data-act=to-end]').hidden = state.insertAt == null;
  block.querySelector('[data-role=engine]').textContent = engine === 'claude' ? 'Runs with Claude' : 'Built-in rules (set ANTHROPIC_API_KEY for Claude)';
  for (const r of block.querySelectorAll('input[name=ai-mode]')) {
    r.checked = r.value === aiMode;
    r.addEventListener('change', () => (aiMode = r.value));
  }
  const ta = block.querySelector('[data-role=instruction]');
  ta.value = insertBlock.draft || '';
  ta.placeholder = aiMode === 'validation' ? 'e.g. Verify the error message "Invalid email or password" is shown' : 'e.g. Type delhi in the destination field and click Search';
  ta.addEventListener('input', () => (insertBlock.draft = ta.value));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) block.querySelector('[data-act=perform]').click();
  });
  block.querySelector('[data-act=open-ai]').addEventListener('click', () => {
    aiOpen = !aiOpen;
    render();
    if (aiOpen) document.querySelector('[data-role=instruction]')?.focus();
  });
  block.querySelector('[data-act=to-end]').addEventListener('click', () => {
    selected = null;
    op('insert', { index: null });
  });
  block.querySelector('[data-act=perform]').addEventListener('click', async (e) => {
    const instruction = ta.value.trim();
    if (!instruction) return toast('Describe what to do first.');
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Performing…';
    try {
      const r = await op('ai', { instruction, mode: aiMode });
      insertBlock.draft = '';
      toast(`Added ${r.added} step${r.added === 1 ? '' : 's'}.`, 'info');
    } catch {
      // shown by op()
    } finally {
      btn.disabled = false;
      btn.textContent = '✦ Perform';
      render();
    }
  });
  block.querySelector('[data-act=import]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const r = await op('import', { steps: data.steps });
      toast(r.failed ? `Imported ${r.added} steps; ${r.failed} failed on this page.` : `Imported ${r.added} steps.`, r.failed ? 'error' : 'info');
    } catch (err) {
      if (err instanceof SyntaxError) toast('That file is not a saved recording (.json).');
    }
  });
  return block;
}

let dragId = null;
function stepItem(s, i) {
  const isSel = selected === s.id;
  const li = el('li', { class: `step${isSel ? ' selected' : ''}`, draggable: 'true', 'data-id': s.id });
  li.addEventListener('dragstart', (e) => {
    dragId = s.id;
    e.dataTransfer.effectAllowed = 'move';
  });
  li.addEventListener('dragover', (e) => {
    if (!dragId || dragId === s.id) return;
    e.preventDefault();
    li.classList.add('drop-before');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    li.classList.remove('drop-before');
    const from = state.steps.findIndex((x) => x.id === dragId);
    op('move', { id: dragId, to: from < i ? i - 1 : i });
    dragId = null;
  });
  const isCheck = s.type.startsWith('expect');
  li.append(
    el('span', { class: 'grip', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⋮⋮'),
    el('span', { class: 'num' }, String(i + 1)),
    el('span', { class: `ico${s.ai ? ' ai' : ''}`, title: s.ai ? 'Added by AI interactions' : s.type }, s.ai ? '✦' : isCheck ? '✓' : ICONS[s.type] || '•'),
    el('div', {},
      el('div', { class: 'text', role: 'button', tabindex: '0', onclick: () => select(s.id), onkeydown: (e) => e.key === 'Enter' && select(s.id) }, s.text),
      s.url ? el('div', { class: 'sub' }, s.url) : null,
      s.error ? el('div', { class: 'err' }, s.error) : null),
    s.status ? el('span', { class: `badge ${s.status}` }, s.status) : el('span'),
  );
  if (isSel) {
    li.append(el('div', { class: 'step-actions' },
      el('button', { class: 'link', type: 'button', onclick: () => op('replay', { until: i }) }, '▸ Execute till here'),
      el('button', { class: 'link', type: 'button', onclick: () => op('insert', { index: i + 1 }) }, '+ Add step(s)'),
      el('button', { class: 'link bad', type: 'button', onclick: () => { selected = null; op('remove', { id: s.id }); } }, 'Delete')));
  }
  return li;
}

function select(stepId) {
  selected = selected === stepId ? null : stepId;
  render();
}

function render() {
  const list = $('steps');
  const focusedInstruction = document.activeElement?.dataset?.role === 'instruction';
  list.replaceChildren();
  const at = state.insertAt == null ? state.steps.length : state.insertAt;
  state.steps.forEach((s, i) => {
    if (i === at) list.append(insertBlock());
    list.append(stepItem(s, i));
  });
  if (at >= state.steps.length) list.append(insertBlock());
  if (focusedInstruction) document.querySelector('[data-role=instruction]')?.focus();

  $('tool-visual').setAttribute('aria-pressed', String(state.mode === 'visual'));
  $('tool-text').setAttribute('aria-pressed', String(state.mode === 'text'));
  $('tool-ai').setAttribute('aria-pressed', String(aiOpen));
  const validating = state.mode !== 'interact';
  viewer.classList.toggle('validate', validating);
  $('banner').hidden = !validating;
  $('hint').hidden = validating;
  $('banner-text').textContent = state.mode === 'visual' ? 'Click an element to check it is visible' : 'Click an element to check its text or value';
}

// ---- save: export code ---------------------------------------------------------

let framework = 'playwright';
let language = 'typescript';
let files = [];

function renderChoices() {
  $('fw-seg').replaceChildren(...Object.entries(FRAMEWORKS).map(([k, f]) => el('button', { type: 'button', 'aria-pressed': String(k === framework), onclick: () => {
    framework = k;
    if (!FRAMEWORKS[k].languages.some(([l]) => l === language)) language = FRAMEWORKS[k].languages[0][0];
    renderChoices();
  } }, f.label)));
  $('lang-seg').replaceChildren(...FRAMEWORKS[framework].languages.map(([k, label]) => el('button', { type: 'button', 'aria-pressed': String(k === language), onclick: () => {
    language = k;
    renderChoices();
  } }, label)));
  $('verify-wrap').hidden = !RUNNABLE.has(`${framework}/${language}`);
}

$('save').addEventListener('click', () => {
  if (!state.steps.length) return toast('Record some steps first.');
  const first = state.steps.find((s) => s.type === 'goto');
  if ($('test-name').value === 'Recorded test' && first) $('test-name').value = first.text.replace(/^Open page "(.*)"$/, '$1').split(/[|·–-]/)[0].trim() || 'Recorded test';
  renderChoices();
  $('out').hidden = true;
  $('save-dlg').showModal();
});
$('dlg-close').addEventListener('click', () => $('save-dlg').close());

$('generate').addEventListener('click', async () => {
  const btn = $('generate');
  btn.disabled = true;
  const verify = !$('verify-wrap').hidden && $('verify-run').checked;
  btn.textContent = verify ? 'Generating and running…' : 'Generating…';
  try {
    const r = await op('export', { framework, language, title: $('test-name').value.trim(), verify });
    files = r.files;
    const result = $('out-result');
    const v = r.verification;
    if (v?.ran) {
      result.className = `result ${v.failed ? 'bad' : 'ok'}`;
      result.textContent = v.failed ? `The generated test failed: ${v.tests.find((t) => !t.ok)?.error ?? ''}` : `The generated test ran and passed (${v.passed}/${v.passed + v.failed}).`;
    } else {
      result.className = 'result note';
      result.textContent = v?.reason ? `Not run: ${v.reason}` : `${FRAMEWORKS[framework].label} project ready. Its README says how to run it.`;
    }
    renderFiles(files.find((f) => /\.(spec|test)\.|Test\.java$|test_.*\.py$/.test(f.path))?.path ?? files[0]?.path);
    $('out').hidden = false;
  } catch {
    // shown by op()
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate code';
  }
});

function renderFiles(active) {
  $('file-list').replaceChildren(...files.map((f) => el('button', { type: 'button', 'aria-selected': String(f.path === active), onclick: () => renderFiles(f.path) }, f.path)));
  $('file-view').textContent = files.find((f) => f.path === active)?.content ?? '';
}

$('zip').addEventListener('click', async () => {
  const name = `${$('test-name').value.trim() || 'recorded-test'}-${framework}-${language}`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
  const res = await fetch('api/zip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files, name }) });
  if (!res.ok) return toast('Could not build the .zip.');
  const a = el('a', { href: URL.createObjectURL(await res.blob()), download: `${name}.zip` });
  document.body.append(a);
  a.click();
  a.remove();
});

window.addEventListener('beforeunload', () => {
  if (id) navigator.sendBeacon?.(`api/rec/${id}/exit`, new Blob(['{}'], { type: 'application/json' }));
});
