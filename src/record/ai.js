// AI interactions: the person writes what to do ("Type delhi in the
// destination and pick the first suggestion") or what to check ("Verify the
// fare summary shows 1 adult"), and the agent does it on the live page,
// adding a step for each thing it does.
//
// With an API key, Claude picks one action at a time from the elements on the
// page, seeing the page again after each. Without one, the built-in rules
// read the sentence the same way they read manual test steps.
import Anthropic from '@anthropic-ai/sdk';
import { parseAction, parseExpectation } from '../plan/rules.js';
import { stepText } from './steps.js';

const MAX_ACTIONS = 10;
const TYPES = ['click', 'fill', 'select', 'check', 'uncheck', 'press', 'hover', 'goto', 'wait', 'expectVisible', 'expectHidden', 'expectText', 'expectValue', 'expectEnabled', 'expectUrl', 'expectTitle'];
const ELEMENT = new Set(['click', 'fill', 'select', 'check', 'uncheck', 'hover', 'expectVisible', 'expectHidden', 'expectValue', 'expectEnabled', 'expectDisabled']);

/** "Type x in A, then click B and verify C" -> one clause per action. */
export function clauses(instruction) {
  return String(instruction || '')
    .split(/\r?\n|;|,?\s+then\s+|,\s*(?=(?:click|tap|type|enter|fill|select|choose|pick|check|uncheck|press|open|go|navigate|verify|validate|ensure|confirm|assert|wait|hover)\b)|\s+and\s+(?=(?:click|tap|type|enter|fill|select|choose|pick|check|uncheck|press|open|go|navigate|verify|validate|ensure|confirm|assert|wait|hover)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One planned Action (from the rules) -> a step added to the session and run. */
async function apply(session, a) {
  const fields = { ai: true };
  if (a.type === 'manual') throw new Error('not something the agent can do on the page');
  if (a.type === 'goto') {
    if (!a.url || a.guessed) throw new Error('give the address to open, e.g. "Open https://example.com/login"');
    const url = new URL(a.url, session.page.url()).href;
    if (session.urlGuard) await session.urlGuard(url);
    return session.addAndRun({ ...fields, type: 'goto', url, title: '' }).then(async (s) => {
      s.title = await session.page.title();
      session.changed();
      return s;
    });
  }
  if (a.target && (ELEMENT.has(a.type) || a.type === 'press')) {
    let hit;
    try {
      hit = await session.find(a.target, a.type);
    } catch (err) {
      if (a.type !== 'expectHidden') throw err;
      // Not on the page is what "should not be visible" means.
      const locator = { strategy: 'text', value: a.target.description };
      hit = { target: { description: a.target.description, role: a.target.role, kind: 'element', locators: { playwright: locator, selenium: { strategy: 'xpath', value: `//*[normalize-space()=${JSON.stringify(a.target.description)}]` } } } };
    }
    fields.target = hit.target;
  }
  Object.assign(fields, { type: a.type, value: a.value, key: a.key, text: a.text, ms: a.ms });
  return a.type.startsWith('expect') ? session.checkAndAdd(fields) : session.addAndRun(fields);
}

/** The built-in rules: no network call, the phrasing manual tests use. */
export async function interactWithRules(session, instruction, { mode = 'action' } = {}) {
  const done = [];
  for (const clause of clauses(instruction)) {
    const actions = mode === 'validation' ? parseExpectation(clause) : parseAction(clause);
    for (const a of actions) {
      if (a.type === 'expectStatus' || a.type === 'expectBody' || a.type === 'request') throw new Error(`"${clause}": API checks are not part of a browser recording.`);
      try {
        done.push(await apply(session, a));
      } catch (err) {
        throw new Error(`"${clause}": ${err.message}`);
      }
    }
  }
  if (!done.length) throw new Error('Nothing to do: describe an action, e.g. "Type delhi in Destination and click Search".');
  return done;
}

const SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean', description: 'True when the request is complete (or nothing more can be done); action is then ignored.' },
    problem: { type: 'string', description: 'Why the request cannot be done on this page, or "".' },
    action: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: TYPES },
        index: { type: 'integer', description: 'Candidate index of the element, or -1 for page-level actions (goto, press without element, wait, expectText of page text, expectUrl, expectTitle).' },
        value: { type: 'string', description: 'Text to type, option label to select, expected value, URL fragment or title. "" if unused.' },
        key: { type: 'string', description: 'Key for press, e.g. Enter, Tab, Escape, ArrowDown. "" if unused.' },
        text: { type: 'string', description: 'Expected text for expectText. "" if unused.' },
        url: { type: 'string', description: 'Absolute or relative URL for goto. "" if unused.' },
        ms: { type: 'integer', description: 'Milliseconds for wait, else 0.' },
      },
      required: ['type', 'index', 'value', 'key', 'text', 'url', 'ms'],
      additionalProperties: false,
    },
    reason: { type: 'string' },
  },
  required: ['done', 'problem', 'action', 'reason'],
  additionalProperties: false,
};

const compact = (c) => Object.fromEntries(Object.entries(c).filter(([k, v]) => !['path', 'within', 'testIdAttr', 'editable', 'disabled'].includes(k) ? v !== '' && v != null : v === true));

const SYSTEM = `You drive a web page for a tester who is recording an automated test. Each turn you see the request, the steps already done for it, the page's URL and title, and its visible elements (each with an index). Reply with the single next action, or done=true when the request is complete.
Rules:
- Do only what the request asks; every action becomes a step in the test.
- Use an element only by its candidate index from the current list. If nothing on the page fits, set problem and done=true.
- To type into a field, use fill on the field itself (not on its label). Autocomplete suggestions appear after a fill; pick them with click on the next turn.
- In validation mode use only expect* types: expectText for text the page shows (with index -1, or the element's index to check text inside it), expectVisible/expectHidden/expectEnabled for elements, expectValue for a field's value, expectUrl/expectTitle for the page. Assert what the page actually shows now; if it does not show what the request expects, still add the check (the tester wants to see it fail) and then finish.`;

/** Claude, one action at a time on the live page. */
export function createClaudeInteractor({ model = process.env.AUTOGEN_MODEL || 'claude-opus-5-5', client } = {}) {
  const anthropic = client || new Anthropic();
  return async function interact(session, instruction, { mode = 'action' } = {}) {
    const done = [];
    for (let turn = 0; turn < MAX_ACTIONS; turn++) {
      const candidates = await session.scan();
      let answer;
      try {
        const info = await session.pageInfo();
        const response = await anthropic.beta.messages.create({
          model,
          max_tokens: 8000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
          system: SYSTEM,
          messages: [{
            role: 'user',
            content: `Mode: ${mode}\nRequest: ${instruction}\n\nSteps already done for this request:\n${done.length ? done.map((s, i) => `${i + 1}. ${s.text}${s.status === 'failed' ? ` (FAILED: ${s.error})` : ''}`).join('\n') : '(none)'}\n\nPage: ${info.title} ${info.url}\nVisible elements:\n${candidates.map((c) => JSON.stringify(compact(c))).join('\n')}`,
          }],
        });
        if (response.stop_reason === 'refusal') throw new Error('Claude declined this request.');
        if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of room to answer; try a shorter request.');
        answer = JSON.parse(response.content.find((b) => b.type === 'text')?.text ?? '{}');
      } catch (err) {
        await session.release();
        throw err;
      }
      if (answer.problem && !answer.done) answer.done = true;
      if (answer.done) {
        await session.release();
        if (answer.problem && !done.length) throw new Error(answer.problem);
        break;
      }
      const a = answer.action;
      if (mode === 'validation' && !a.type.startsWith('expect')) {
        await session.release();
        throw new Error(`Validation mode only adds checks; Claude proposed "${a.type}". Switch to Action to do it.`);
      }
      let target = null;
      if (a.index >= 0) {
        const c = candidates[a.index];
        if (!c) {
          await session.release();
          throw new Error('Claude named an element that is not on the page.');
        }
        target = (await session.withLocators(c)).target;
      }
      await session.release();
      const fields = { ai: true, type: a.type, target, value: a.value, key: a.key, text: a.text, ms: a.ms };
      if (a.type === 'goto') {
        fields.url = new URL(a.url || '/', session.page.url()).href;
        if (session.urlGuard) await session.urlGuard(fields.url);
      }
      if (a.type === 'expectText' && !a.text) fields.text = a.value;
      const step = a.type.startsWith('expect') ? await session.checkAndAdd(fields) : await session.addAndRun(fields);
      if (a.type === 'goto') {
        step.title = await session.page.title();
        session.changed();
      }
      done.push({ ...step, text: stepText(step) });
      // A failed action leaves the page somewhere Claude did not expect; stop and let the person look.
      if (step.status === 'failed' && !a.type.startsWith('expect')) break;
    }
    if (!done.length) throw new Error('Claude found nothing to do for that request on this page.');
    return done;
  };
}

