import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDemoApp } from '../examples/demo-app.js';
import { Recorder } from '../src/record/session.js';
import { interactWithRules, clauses, createClaudeInteractor } from '../src/record/ai.js';
import { stepText, toPlan, exportRecording, describe } from '../src/record/steps.js';
import { verifyProject } from '../src/verify.js';

let demo;
let recorder;
before(async () => {
  demo = await startDemoApp(0);
  recorder = new Recorder();
});
after(async () => {
  await recorder.closeAll();
  demo.close();
});

const center = async (session, selector) => {
  const box = await session.page.locator(selector).boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};

test('step text reads like the steps panel', () => {
  const target = describe({ role: 'textbox', label: 'Flight destination', tag: 'input' }, {});
  assert.equal(stepText({ type: 'fill', target, value: 'delhi' }), 'Type "delhi" in "Flight destination" text input');
  assert.equal(stepText({ type: 'fill', target: describe({ role: 'textbox', label: 'PIN', tag: 'input', type: 'password' }, {}), value: 'x' }), 'Type "••••••" in "PIN" text input');
  assert.equal(stepText({ type: 'goto', url: 'https://kayak.com', title: 'Search Flights' }), 'Open page "Search Flights"');
  assert.equal(stepText({ type: 'click', target: describe({ role: 'button', text: 'Search', tag: 'button' }, {}) }), 'Click on "Search" button');
});

test('an instruction splits into one clause per action', () => {
  assert.deepEqual(clauses('Type delhi in Destination and click Search, then verify "Results" is shown'), ['Type delhi in Destination', 'click Search', 'verify "Results" is shown']);
  // "and" inside a name is not a new action
  assert.deepEqual(clauses('Click Save and Continue'), ['Click Save and Continue']);
});

test('recording clicks, typing, a dropdown, a checkbox and validations', async () => {
  const s = await recorder.open({ id: 'rec-1', url: `${demo.url}/login` });
  await s.run(async () => s.click(...(await center(s, '#email'))));
  await s.run(() => s.type('ana@example'));
  await s.run(() => s.type('.com'));
  await s.run(async () => s.click(...(await center(s, '#password'))));
  await s.run(() => s.type('secret123'));
  const r = await s.run(async () => s.click(...(await center(s, '#country'))));
  assert.deepEqual(r.select.options.map((o) => o.label), ['Choose…', 'India', 'United States']);
  await s.run(() => s.select('in'));
  await s.run(async () => s.click(...(await center(s, '#remember'))));
  await s.run(async () => s.click(...(await center(s, '[data-testid=sign-in]'))));
  await s.page.waitForURL('**/dashboard*');
  await s.run(() => s.verifyPage('url'));
  s.setMode('text');
  await s.run(async () => s.click(...(await center(s, 'h1'))));

  const texts = s.view().steps.map((x) => x.text);
  assert.deepEqual(texts, [
    'Open page "Sign in · Demo Shop"',
    'Click on "Email" text input',
    'Type "ana@example.com" in "Email" text input',
    'Click on "Password" text input',
    'Type "••••••" in "Password" text input',
    'Select "India" in "Country" dropdown',
    'Check "Remember me" checkbox',
    'Click on "Sign in" button',
    'Verify the URL contains "/dashboard"',
    'Verify "Dashboard" heading shows "Dashboard"',
  ]);
  assert.ok(s.steps.filter((x) => x.type.startsWith('expect')).every((x) => x.status === 'passed'));

  // Replays from the start, then exports a project whose test passes.
  assert.equal((await s.run(() => s.replay())).passed, true);
  const project = exportRecording(s.steps, { framework: 'playwright', language: 'typescript', title: 'Sign in' });
  const run = await verifyProject(project.files, { framework: 'playwright', language: 'typescript', baseUrl: demo.url });
  assert.equal(run.failed, 0, JSON.stringify(run));
  assert.equal(run.passed, 1);

  // Clicks get the same readable locators as exploring: role, label, test id; never a CSS path.
  const pw = toPlan(s.steps, { framework: 'playwright' });
  assert.deepEqual(pw.actions.filter((a) => a.target).map((a) => a.target.locator.strategy), ['role', 'role', 'role', 'role', 'role', 'role', 'testid', 'role']);

  const sel = toPlan(s.steps, { framework: 'selenium' });
  assert.ok(sel.actions.filter((a) => a.target).every((a) => a.target.resolved && a.target.locator.strategy !== 'role'));
  assert.equal(sel.actions[0].url, '/login');
  await recorder.close('rec-1');
});

test('AI interactions with the built-in rules, inserted after a chosen step', async () => {
  const s = await recorder.open({ id: 'rec-2', url: `${demo.url}/login` });
  await s.run(() => interactWithRules(s, 'Type ana@example.com in the Email field, type secret123 in the Password field and click Sign in'));
  await s.page.waitForURL('**/dashboard*');
  await s.run(() => interactWithRules(s, 'Verify "Welcome, ana@example.com" is shown', { mode: 'validation' }));
  const steps = s.view().steps;
  assert.equal(steps.length, 5);
  assert.ok(steps.slice(1).every((x) => x.ai && x.status === 'passed'), JSON.stringify(steps));

  // Execute till step 3, then add a step after it.
  await s.run(() => s.replay(2));
  assert.equal(s.insertAt, 3);
  assert.deepEqual(s.view().steps.map((x) => x.status), ['passed', 'passed', 'passed', null, null]);
  await s.run(() => interactWithRules(s, 'Verify the Email field has value "ana@example.com"', { mode: 'validation' }));
  assert.equal(s.view().steps[3].text, 'Verify "Email" text input has value "ana@example.com"');

  await assert.rejects(s.run(() => interactWithRules(s, 'Click the Unicorn button')), /No element clearly matches "Unicorn"/);
  await recorder.close('rec-2');
});

test('AI interactions with Claude: one action per turn, chosen by element index', async () => {
  const s = await recorder.open({ id: 'rec-3', url: `${demo.url}/login` });
  const requests = [];
  // Stands in for the API: reads the candidate list it was sent and answers like the model would.
  const script = [
    (els) => ({ type: 'fill', index: els.find((e) => e.id === 'email').index, value: 'ana@example.com' }),
    (els) => ({ type: 'fill', index: els.find((e) => e.id === 'password').index, value: 'secret123' }),
    (els) => ({ type: 'click', index: els.find((e) => e.testId === 'sign-in').index }),
    null,
  ];
  const client = {
    beta: {
      messages: {
        async create(req) {
          requests.push(req);
          const els = req.messages[0].content.split('Visible elements:\n')[1].split('\n').map((l) => JSON.parse(l));
          const next = script[requests.length - 1];
          const action = next ? { type: 'click', index: -1, value: '', key: '', text: '', url: '', ms: 0, ...next(els) } : { type: 'click', index: -1, value: '', key: '', text: '', url: '', ms: 0 };
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ done: !next, problem: '', action, reason: '' }) }] };
        },
      },
    },
  };
  const interact = createClaudeInteractor({ client });
  const done = await s.run(() => interact(s, 'Sign in as ana@example.com with password secret123'));
  assert.equal(done.length, 3);
  assert.equal(requests.length, 4);
  assert.equal(requests[0].model, 'claude-opus-5-5');
  assert.equal(requests[0].output_config.format.type, 'json_schema');
  assert.match(requests[1].messages[0].content, /1\. Type "ana@example.com" in "Email" text input/);
  assert.deepEqual(s.view().steps.map((x) => x.text).slice(1), ['Type "ana@example.com" in "Email" text input', 'Type "••••••" in "Password" text input', 'Click on "Sign in" button']);
  // The sign-in redirects after a fetch; the check must see where it lands.
  assert.equal((await s.run(() => s.verifyPage('url'))).value, '/dashboard');
  await recorder.close('rec-3');
});
