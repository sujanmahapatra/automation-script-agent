// The web page served at /. One file, no build step. The client script sits
// inside a template literal, so it uses no backslashes and no ${}.

export function renderPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Automation Script Agent</title>
<style>
  :root { --bg:#f5f5f3; --panel:#fff; --fg:#1b1b19; --muted:#6b6a65; --line:#e2e1dc; --soft:#f0efea; --accent:#2b59c3; --accent-fg:#fff;
          --ok:#1d7a4c; --ok-bg:#e7f4ec; --warn:#a15c07; --warn-bg:#fdf3e1; --bad:#b4271f; --bad-bg:#fbeceb; --info:#2b59c3; --info-bg:#e9effb; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#121211; --panel:#1b1b1a; --fg:#ecebe6; --muted:#9d9c96; --line:#2e2e2b; --soft:#242422;
          --accent:#86a2f2; --accent-fg:#111; --ok:#5ec392; --ok-bg:#15291e; --warn:#e7b24d; --warn-bg:#2b2312; --bad:#f08178; --bad-bg:#2e1715; --info:#86a2f2; --info-bg:#1a2238; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  code, pre, .mono { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size:12.5px; }
  button, input, select, textarea { font:inherit; color:inherit; }
  header { padding:18px 20px; border-bottom:1px solid var(--line); background:var(--panel); }
  header h1 { margin:0; font-size:18px; } header p { margin:2px 0 0; color:var(--muted); }
  .layout { display:grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap:16px; padding:16px; max-width:1500px; margin:0 auto; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; }
  form.card { padding:16px; display:flex; flex-direction:column; gap:18px; align-self:start; position:sticky; top:16px; }
  .field > .label { font-weight:600; margin-bottom:6px; display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
  .field .hint { color:var(--muted); font-size:12.5px; font-weight:400; }
  .drop { display:block; border:1.5px dashed var(--line); border-radius:10px; padding:14px; text-align:center; color:var(--muted); cursor:pointer; }
  .drop:hover, .drop.over { border-color:var(--accent); color:var(--fg); }
  .drop strong { color:var(--fg); }
  textarea { width:100%; min-height:130px; resize:vertical; border:1px solid var(--line); border-radius:8px; padding:8px; background:var(--panel); }
  input[type=url], input[type=text] { width:100%; border:1px solid var(--line); border-radius:8px; padding:7px 9px; background:var(--panel); }
  .linkish { border:0; background:none; padding:0; color:var(--accent); cursor:pointer; font-size:12.5px; }
  .seg { display:flex; flex-wrap:wrap; gap:6px; }
  .seg button { border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:6px 12px; cursor:pointer; }
  .seg button[aria-pressed="true"] { border-color:var(--accent); background:var(--info-bg); color:var(--accent); font-weight:600; }
  .seg button:focus-visible, .linkish:focus-visible, .primary:focus-visible, .tab:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .check { display:flex; gap:8px; align-items:flex-start; margin-top:6px; }
  .check input { margin-top:3px; }
  .check small { display:block; color:var(--muted); }
  .check.disabled { opacity:.55; }
  .primary { border:0; background:var(--accent); color:var(--accent-fg); border-radius:10px; padding:10px 14px; font-weight:600; cursor:pointer; }
  .primary[disabled] { opacity:.6; cursor:progress; }
  .planner { font-size:12.5px; color:var(--muted); }
  .chosen { font-size:12.5px; color:var(--muted); margin-top:6px; overflow-wrap:anywhere; }

  .results { min-width:0; display:flex; flex-direction:column; gap:12px; }
  .empty { padding:48px 24px; text-align:center; color:var(--muted); }
  .empty h2 { color:var(--fg); font-size:16px; margin:0 0 6px; }
  .progress { padding:14px 16px; }
  .progress ol { margin:0; padding-left:18px; color:var(--muted); }
  .progress li:last-child { color:var(--fg); font-weight:600; }
  .summary { display:flex; flex-wrap:wrap; gap:10px; padding:14px 16px; align-items:center; }
  .stat { border:1px solid var(--line); border-radius:10px; padding:8px 12px; min-width:110px; }
  .stat b { display:block; font-size:20px; line-height:1.2; }
  .stat span { color:var(--muted); font-size:12.5px; }
  .summary .spacer { flex:1; }
  .warn { padding:10px 14px; border-radius:10px; background:var(--warn-bg); color:var(--warn); }
  .error { padding:12px 14px; border-radius:10px; background:var(--bad-bg); color:var(--bad); }
  .tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); padding:0 12px; }
  .tab { border:0; background:none; padding:10px 12px; cursor:pointer; color:var(--muted); border-bottom:2px solid transparent; margin-bottom:-1px; }
  .tab[aria-selected="true"] { color:var(--accent); border-bottom-color:var(--accent); font-weight:600; }
  .pane { padding:12px 16px 16px; }
  details.test { border:1px solid var(--line); border-radius:10px; margin-bottom:10px; overflow:hidden; }
  details.test > summary { cursor:pointer; padding:10px 12px; display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; background:var(--soft); list-style:none; }
  details.test > summary::-webkit-details-marker { display:none; }
  details.test > summary .t { font-weight:600; flex:1 1 240px; }
  .wrap { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; min-width:720px; }
  th, td { text-align:left; padding:7px 10px; border-top:1px solid var(--line); vertical-align:top; }
  th { font-size:12px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.03em; }
  td.src { color:var(--muted); white-space:nowrap; font-size:12.5px; }
  td .stext { display:block; color:var(--muted); font-size:12.5px; }
  .badge { display:inline-block; font-size:12px; padding:1px 8px; border-radius:999px; white-space:nowrap; font-weight:600; }
  .b-verified { background:var(--ok-bg); color:var(--ok); }
  .b-found, .b-ok { background:var(--info-bg); color:var(--info); }
  .b-guessed, .b-manual { background:var(--warn-bg); color:var(--warn); }
  .b-failed { background:var(--bad-bg); color:var(--bad); }
  .note { color:var(--muted); font-size:12.5px; }
  .code { display:grid; grid-template-columns: 240px minmax(0, 1fr); gap:12px; }
  .files { list-style:none; margin:0; padding:0; border:1px solid var(--line); border-radius:10px; overflow:auto; max-height:70vh; }
  .files button { all:unset; box-sizing:border-box; display:block; width:100%; padding:6px 10px; cursor:pointer; font-family: ui-monospace, Consolas, monospace; font-size:12.5px; overflow-wrap:anywhere; }
  .files button:hover { background:var(--soft); }
  .files button[aria-current="true"] { background:var(--info-bg); color:var(--accent); }
  .files button:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  .viewer { border:1px solid var(--line); border-radius:10px; overflow:hidden; min-width:0; }
  .viewer .bar { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 10px; background:var(--soft); border-bottom:1px solid var(--line); }
  .viewer pre { margin:0; padding:12px; overflow:auto; max-height:70vh; counter-reset: ln; }
  .viewer pre span.l { display:block; white-space:pre; }
  .viewer pre span.l::before { counter-increment: ln; content: counter(ln); display:inline-block; width:3ch; margin-right:12px; text-align:right; color:var(--muted); user-select:none; }
  .viewer pre span.todo { background:var(--warn-bg); }
  .btn { border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:5px 10px; cursor:pointer; }
  .btn:hover { background:var(--soft); }
  .run li { margin-bottom:8px; } .run pre { white-space:pre-wrap; margin:4px 0 0; color:var(--bad); }
  [hidden] { display:none !important; }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    form.card { position:static; }
    .code { grid-template-columns: 1fr; }
    .files { max-height:200px; }
  }
</style></head><body>
<header>
  <h1>Automation Script Agent</h1>
  <p>Turn manual test cases into Playwright, Selenium, Appium and API automation projects. Or <a href="record">record a test in the browser</a> with the low-code recorder.</p>
</header>
<div class="layout">
  <form class="card" id="form">
    <div class="field">
      <div class="label">Manual tests <span class="hint">.xlsx, .csv, .json or text</span></div>
      <label class="drop" id="drop" tabindex="0"><input type="file" id="file" accept=".xlsx,.csv,.tsv,.json,.txt,.md,.feature" hidden>
        <strong>Choose a file</strong> or drop it here<br><span class="hint">One row per step, like the testcase-generator Excel export</span></label>
      <div class="chosen" id="chosen"></div>
      <div style="margin-top:8px"><button type="button" class="linkish" id="paste-toggle">Paste tests instead</button> ·
        <button type="button" class="linkish" data-sample="web">Load web sample</button> ·
        <button type="button" class="linkish" data-sample="api">Load API sample</button></div>
      <textarea id="text" hidden placeholder="TC-1 Sign in with valid credentials&#10;1. Navigate to /login&#10;2. Enter &quot;ana@example.com&quot; in the Email field&#10;3. Click the Sign in button&#10;Expected: &quot;Welcome&quot; is displayed"></textarea>
    </div>
    <div class="field">
      <div class="label">Framework</div>
      <div class="seg" id="frameworks" role="group" aria-label="Framework"></div>
    </div>
    <div class="field">
      <div class="label">Language</div>
      <div class="seg" id="languages" role="group" aria-label="Language"></div>
    </div>
    <div class="field">
      <div class="label"><label for="base">App URL</label> <button type="button" class="linkish" id="demo">Use the demo app</button></div>
      <input type="url" id="base" placeholder="https://staging.example.com" autocomplete="url">
      <label class="check" id="explore-row"><input type="checkbox" id="explore" checked><span>Explore the app to find real locators<small>Opens the app in a browser, does each step, and checks every expected result.</small></span></label>
      <label class="check" id="verify-row"><input type="checkbox" id="verify" checked><span>Run the generated tests<small id="verify-hint">Proves the scripts pass before you download them.</small></span></label>
    </div>
    <button type="submit" class="primary" id="go">Generate automation scripts</button>
    <div class="planner" id="planner"></div>
  </form>

  <section class="results" id="results" aria-live="polite">
    <div class="card empty" id="empty"><h2>No scripts yet</h2>Add manual tests, choose a framework and language, then generate. Load a sample and use the demo app to try it.</div>
  </section>
</div>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let info = null;
let framework = 'playwright';
let language = 'typescript';
let upload = null;      // { name, base64 }
let result = null;
let currentFile = 0;
const STATUS = { verified: 'verified', found: 'found on app', ok: 'converted', guessed: 'guessed', failed: 'failed on app', manual: 'manual' };
const STAGE = { read: 'Reading the manual tests', plan: 'Planning steps', explore: 'Exploring the app', emit: 'Writing code', verify: 'Running the generated tests' };

function renderChoices() {
  $('frameworks').innerHTML = Object.entries(info.frameworks).map(([k, f]) => '<button type="button" data-fw="' + k + '" aria-pressed="' + (k === framework) + '">' + esc(f.label) + '</button>').join('');
  const langs = info.frameworks[framework].languages;
  if (!langs.some((l) => l.key === language)) language = langs[0].key;
  $('languages').innerHTML = langs.map((l) => '<button type="button" data-lang="' + l.key + '" aria-pressed="' + (l.key === language) + '">' + esc(l.label) + '</button>').join('');
  const kind = info.frameworks[framework].kind;
  const runnable = langs.find((l) => l.key === language).runnable;
  $('explore').disabled = kind === 'mobile';
  $('explore-row').classList.toggle('disabled', kind === 'mobile');
  if (kind === 'mobile') $('explore').checked = false;
  $('verify').disabled = !runnable;
  $('verify-row').classList.toggle('disabled', !runnable);
  if (!runnable) $('verify').checked = false;
  $('verify-hint').textContent = runnable ? 'Proves the scripts pass before you download them.' : (kind === 'mobile' ? 'Needs an Appium server and a device; run it from the README.' : 'This language needs its own toolchain; run it from the README.');
  $('base').placeholder = kind === 'api' ? 'https://api.example.com' : kind === 'mobile' ? 'Not needed for Appium' : 'https://staging.example.com';
}

async function init() {
  info = await (await fetch('api/info')).json();
  $('planner').textContent = info.planner === 'claude' ? 'Steps are planned by Claude.' : 'Steps are planned by built-in rules. Set ANTHROPIC_API_KEY before starting to let Claude plan free-form steps.';
  renderChoices();
}

document.addEventListener('click', async (e) => {
  const fw = e.target.closest('[data-fw]');
  if (fw) { framework = fw.dataset.fw; return renderChoices(); }
  const lang = e.target.closest('[data-lang]');
  if (lang) { language = lang.dataset.lang; return renderChoices(); }
  const sample = e.target.closest('[data-sample]');
  if (sample) {
    const s = await (await fetch('api/sample?kind=' + sample.dataset.sample)).json();
    upload = null;
    $('text').hidden = false;
    $('text').value = s.text;
    $('chosen').textContent = 'Sample: ' + s.name;
    $('paste-toggle').textContent = 'Hide pasted tests';
    framework = sample.dataset.sample === 'api' ? 'api' : (framework === 'api' ? 'playwright' : framework);
    renderChoices();
    return;
  }
  const f = e.target.closest('[data-file]');
  if (f) { currentFile = Number(f.dataset.file); renderCode(); return; }
  const t = e.target.closest('[data-tab]');
  if (t) { showTab(t.dataset.tab); return; }
});

$('paste-toggle').addEventListener('click', () => {
  $('text').hidden = !$('text').hidden;
  $('paste-toggle').textContent = $('text').hidden ? 'Paste tests instead' : 'Hide pasted tests';
  if (!$('text').hidden) $('text').focus();
});
$('demo').addEventListener('click', async () => {
  const r = await (await fetch('api/demo-app', { method: 'POST' })).json();
  $('base').value = r.url + (framework === 'api' ? '' : '');
});

function takeFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    upload = { name: file.name, base64: String(reader.result).split(',')[1] || '' };
    $('chosen').textContent = file.name + ' (' + Math.max(1, Math.round(file.size / 1024)) + ' KB)';
    $('text').hidden = true;
    $('paste-toggle').textContent = 'Paste tests instead';
  };
  reader.readAsDataURL(file);
}
$('file').addEventListener('change', () => takeFile($('file').files[0]));
$('drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
$('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (e) => { e.preventDefault(); $('drop').classList.remove('over'); takeFile(e.dataTransfer.files[0]); });

function locatorText(l) {
  if (!l) return '';
  if (l.strategy === 'role') return 'role=' + l.role + ' "' + l.name + '"';
  return l.strategy + '=' + l.value;
}

function renderResult() {
  const r = result;
  const totals = r.tests.reduce((a, t) => {
    a.total += t.total; a.automated += t.automated; a.todo += t.todo;
    a.verified += t.actions.filter((x) => x.status === 'verified').length;
    return a;
  }, { total: 0, automated: 0, todo: 0, verified: 0 });
  const v = r.verification;
  const runStat = v && v.ran ? '<div class="stat"><b>' + v.passed + ' / ' + (v.passed + v.failed) + '</b><span>tests passed</span></div>' : '';
  const name = r.framework + '-' + r.language + '-tests';
  $('results').innerHTML =
    (r.warnings.length ? r.warnings.map((w) => '<div class="warn">' + esc(w) + '</div>').join('') : '') +
    '<div class="card"><div class="summary">' +
    '<div class="stat"><b>' + r.tests.length + '</b><span>tests</span></div>' +
    '<div class="stat"><b>' + totals.automated + ' / ' + totals.total + '</b><span>actions automated</span></div>' +
    (r.explored ? '<div class="stat"><b>' + totals.verified + '</b><span>checks verified on the app</span></div>' : '') +
    '<div class="stat"><b>' + totals.todo + '</b><span>to review (TODO)</span></div>' + runStat +
    '<span class="spacer"></span><button class="primary" type="button" id="zip">Download .zip</button></div>' +
    '<div class="tabs" role="tablist">' +
    '<button class="tab" role="tab" data-tab="steps" aria-selected="true" type="button">Steps</button>' +
    '<button class="tab" role="tab" data-tab="code" aria-selected="false" type="button">Code (' + r.files.length + ' files)</button>' +
    '<button class="tab" role="tab" data-tab="run" aria-selected="false" type="button">Run</button></div>' +
    '<div class="pane" id="pane-steps">' + r.tests.map(renderTest).join('') + '</div>' +
    '<div class="pane" id="pane-code" hidden><div class="code"><ul class="files" id="files"></ul><div class="viewer"><div class="bar"><span class="mono" id="fname"></span><button class="btn" type="button" id="copy">Copy</button></div><pre id="src"></pre></div></div></div>' +
    '<div class="pane" id="pane-run" hidden>' + renderRun() + '</div></div>';
  currentFile = Math.max(0, r.files.findIndex((f) => /(spec|test|Test)[^/]*$/.test(f.path)));
  renderCode();
  $('zip').addEventListener('click', async () => {
    const res = await fetch('api/zip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: r.files, name }) });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(result.files[currentFile].content);
    $('copy').textContent = 'Copied';
    setTimeout(() => ($('copy').textContent = 'Copy'), 1200);
  });
}

function renderTest(t) {
  const rows = t.actions.map((a) =>
    '<tr><td class="src">' + esc(a.source) + '</td>' +
    '<td>' + esc(a.sourceText).slice(0, 400) + '</td>' +
    '<td class="mono">' + esc(a.type) + (a.target ? ' <span class="note">"' + esc(a.target) + '"</span>' : '') + '</td>' +
    '<td class="mono">' + esc(locatorText(a.locator)) + '</td>' +
    '<td><span class="badge b-' + a.status + '">' + (STATUS[a.status] || a.status) + '</span>' + (a.note ? '<div class="note">' + esc(a.note) + '</div>' : '') + '</td></tr>').join('');
  return '<details class="test" open><summary><span class="t">' + esc([t.id, t.title].filter(Boolean).join(' ')) + '</span>' +
    '<span class="note">' + t.automated + ' of ' + t.total + ' automated</span>' +
    (t.todo ? '<span class="badge b-guessed">' + t.todo + ' to review</span>' : '<span class="badge b-verified">complete</span>') + '</summary>' +
    '<div class="wrap"><table><thead><tr><th>From</th><th>Manual text</th><th>Action</th><th>Locator</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>';
}

function renderCode() {
  const files = result.files;
  $('files').innerHTML = files.map((f, i) => '<li><button type="button" data-file="' + i + '" aria-current="' + (i === currentFile) + '">' + esc(f.path) + '</button></li>').join('');
  const f = files[currentFile];
  $('fname').textContent = f.path;
  $('src').innerHTML = f.content.replace(/[ ]+$/, '').split(String.fromCharCode(10)).map((l) => '<span class="l' + (/TODO|NOTE/.test(l) ? ' todo' : '') + '">' + (esc(l) || ' ') + '</span>').join('');
}

function renderRun() {
  const v = result.verification;
  const steps = '<p>To run it yourself:</p><ol>' + result.run.map((c) => '<li><code>' + esc(c) + '</code></li>').join('') + '</ol>';
  if (!v) return '<p class="note">The generated tests were not run here.</p>' + steps;
  if (!v.ran) return '<p class="note">' + esc(v.reason) + '</p>' + steps;
  return '<ul class="run">' + v.tests.map((t) => '<li>' + (t.ok ? '<span class="badge b-verified">passed</span> ' : '<span class="badge b-failed">failed</span> ') + esc(t.title) + (t.error ? '<pre>' + esc(t.error) + '</pre>' : '') + '</li>').join('') + '</ul>' + steps;
}

function showTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const p of ['steps', 'code', 'run']) $('pane-' + p).hidden = p !== name;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('text').hidden ? '' : $('text').value;
  if (!upload && !text.trim()) { $('results').innerHTML = '<div class="error">Choose a file, paste tests, or load a sample first.</div>'; return; }
  const baseUrl = $('base').value.trim();
  if ((($('explore').checked && !$('explore').disabled) || ($('verify').checked && !$('verify').disabled)) && !baseUrl) {
    $('results').innerHTML = '<div class="error">Exploring and running need the app URL. Enter it, use the demo app, or untick both boxes.</div>';
    $('base').focus();
    return;
  }
  $('go').disabled = true;
  $('go').textContent = 'Working…';
  $('results').innerHTML = '<div class="card progress"><ol id="log"></ol></div>';
  const log = (line) => {
    const items = [...$('log').children].map((li) => li.textContent);
    if (items[items.length - 1] !== line) $('log').insertAdjacentHTML('beforeend', '<li>' + esc(line) + '</li>');
  };
  try {
    const res = await fetch('api/convert', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: upload ? upload.name : 'pasted.txt', fileBase64: upload ? upload.base64 : null, text: upload ? null : text, framework, language, baseUrl,
        explore: $('explore').checked && !$('explore').disabled, verify: $('verify').checked && !$('verify').disabled }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(String.fromCharCode(10));
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.type === 'progress') log(m.stage === 'read' ? 'Read ' + m.count + ' manual test' + (m.count === 1 ? '' : 's') : (STAGE[m.stage] || m.stage) + (m.test ? ': ' + m.test : ''));
        if (m.type === 'error') $('results').innerHTML = '<div class="error">' + esc(m.message) + '</div>';
        if (m.type === 'result') { result = m; renderResult(); }
      }
    }
  } catch (err) {
    $('results').innerHTML = '<div class="error">' + esc(err.message) + '</div>';
  } finally {
    $('go').disabled = false;
    $('go').textContent = 'Generate automation scripts';
  }
});

init();
</script>
</body></html>
`;
}
