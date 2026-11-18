// Recorded steps: what the recorder stores for each click, typed value or
// check, how a step reads in plain English, and how a recording becomes a
// plan the framework writers in src/emit/ turn into code.
//
// Step { id, type, target?, value?, key?, url?, title?, text?, ai?, status?, error? }
//   type    one of the Action types (goto, click, fill, select, check,
//           uncheck, press, expectVisible, expectText, expectValue,
//           expectUrl, expectTitle)
//   target  { description, role, kind, locators: { playwright, selenium } }
//   status  after a run: passed | failed | skipped
import { randomUUID } from 'node:crypto';
import { guessLocator } from '../locators.js';
import { normalizeTest } from '../model.js';
import { generateProject } from '../emit/index.js';

export const RECORDABLE = new Set(['goto', 'click', 'fill', 'select', 'check', 'uncheck', 'press', 'hover', 'expectVisible', 'expectHidden', 'expectText', 'expectValue', 'expectEnabled', 'expectDisabled', 'expectUrl', 'expectTitle', 'wait']);

const KIND = {
  textbox: 'text input', searchbox: 'search input', button: 'button', link: 'link', checkbox: 'checkbox', radio: 'radio button',
  switch: 'switch', combobox: 'dropdown', listbox: 'list', option: 'option', img: 'image', heading: 'heading', tab: 'tab',
  menuitem: 'menu item', spinbutton: 'number input', slider: 'slider', dialog: 'dialog', listitem: 'list item',
};

const humanize = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
const short = (s, max = 80) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A scanned candidate -> the target a step stores: a readable name, its role, and a kind word ("text input"). */
export function describe(c, locators) {
  const name = c.ariaLabel || c.label || c.placeholder || (c.text && c.text.length <= 80 ? c.text : '') || c.title || c.alt || c.value
    || humanize(c.name) || humanize(c.testId) || humanize(c.id) || short(c.text) || c.tag;
  // secret: a password field, whose value the steps list and comments never show
  return { description: short(name), role: c.role || null, kind: KIND[c.role] || 'element', locators, secret: c.type === 'password' };
}

export function newStep(fields) {
  return { id: randomUUID().slice(0, 8), ...fields };
}

const quote = (s) => `"${short(s, 120)}"`;
const masked = (step) => (step.target?.secret ? '••••••' : step.value);

/** How a step reads in the steps panel and in the generated code's comments. */
export function stepText(step) {
  const el = step.target ? `${quote(step.target.description)} ${step.target.kind}` : 'the page';
  switch (step.type) {
    case 'goto': return `Open page ${quote(step.title || step.url)}`;
    case 'click': return `Click on ${el}`;
    case 'hover': return `Hover over ${el}`;
    case 'fill': return step.value === '' ? `Clear ${el}` : `Type ${quote(masked(step))} in ${el}`;
    case 'select': return `Select ${quote(step.value)} in ${el}`;
    case 'check': return `Check ${el}`;
    case 'uncheck': return `Uncheck ${el}`;
    case 'press': return step.target ? `Press ${step.key} in ${el}` : `Press ${step.key}`;
    case 'expectVisible': return `Verify ${el} is visible`;
    case 'expectHidden': return `Verify ${el} is not visible`;
    case 'expectEnabled': return `Verify ${el} is enabled`;
    case 'expectDisabled': return `Verify ${el} is disabled`;
    case 'wait': return `Wait ${Math.round((step.ms || 0) / 100) / 10} seconds`;
    case 'expectText': return step.target ? `Verify ${el} shows ${quote(step.text)}` : `Verify text ${quote(step.text)} is shown`;
    case 'expectValue': return `Verify ${el} has value ${quote(masked(step))}`;
    case 'expectUrl': return `Verify the URL contains ${quote(step.value)}`;
    case 'expectTitle': return `Verify the page title is ${quote(step.value)}`;
    default: return step.type;
  }
}

/** The origin of the first page opened: the generated project's BASE_URL. */
export function baseUrlOf(steps) {
  const first = steps.find((s) => s.type === 'goto' && s.url);
  try {
    return first ? new URL(first.url).origin : '';
  } catch {
    return '';
  }
}

/** Recorded steps -> a Plan for one framework. Same-origin URLs become paths, so BASE_URL can point the tests elsewhere. */
export function toPlan(steps, { framework, title = 'Recorded test', id = 'REC-1' }) {
  const base = baseUrlOf(steps);
  const actions = steps.filter((s) => RECORDABLE.has(s.type)).map((s, i) => {
    const source = { step: i + 1, kind: 'step', text: stepText(s) };
    const a = { type: s.type, source };
    if (s.type === 'goto') {
      const u = new URL(s.url);
      a.url = base && u.origin === base ? `${u.pathname}${u.search}${u.hash}` : s.url;
    }
    if (['fill', 'select', 'expectValue', 'expectUrl', 'expectTitle'].includes(s.type)) a.value = s.value;
    if (s.type === 'press') a.key = s.key;
    if (s.type === 'wait') a.ms = s.ms;
    if (s.type === 'expectText') a.text = s.text;
    if (s.target) {
      const { description, role } = s.target;
      if (framework === 'appium') {
        a.target = { description, role, locator: guessLocator({ description, role }, 'appium'), resolved: false };
      } else {
        const locator = s.target.locators?.[framework === 'selenium' ? 'selenium' : 'playwright'];
        a.target = { description, role, locator: locator ?? guessLocator({ description, role }, framework), resolved: Boolean(locator) };
      }
    }
    a.status = s.status === 'failed' ? 'failed' : !a.target ? 'ok' : !a.target.resolved ? 'guessed' : s.type.startsWith('expect') ? 'verified' : 'found';
    if (s.status === 'failed' && s.error) a.note = s.error;
    return a;
  });
  return { test: normalizeTest({ id, title }), actions };
}

/** A recording -> a complete project, written by the same templates as converted manual tests. */
export function exportRecording(steps, { framework, language, title }) {
  const plan = toPlan(steps, { framework, title });
  return generateProject([plan], { framework, language, baseUrl: baseUrlOf(steps), explored: framework !== 'appium' });
}

/** A recording as manual test steps (one per line), for the converter or a test management tool. */
export function asManualTest(steps, title = 'Recorded test') {
  return { id: 'REC-1', title, steps: steps.map((s) => ({ action: stepText(s), expected: '' })) };
}
