// Walks a plan through the real app in a browser: each step's element is found
// from what the step says, given the most readable locator that matches only
// it, and the step is performed so the next one sees the right page.
// Assertions are checked as they come, so the report says which expectations
// hold today. Selenium plans are explored the same way; only the locators
// recorded differ.
import { chromium } from '@playwright/test';
import { scanCandidates, firstUnique, clearMarkers } from './dom.js';
import { pick, playwrightOptions, seleniumOptions, guessLocator } from '../locators.js';
import { ELEMENT_ACTIONS } from '../model.js';

const STEP_TIMEOUT = 5000;

/** A structured locator -> a Playwright Locator on `page`. */
export function toPlaywright(page, l) {
  switch (l.strategy) {
    case 'testid': return page.getByTestId(l.value);
    case 'role': return page.getByRole(l.role, { name: l.name, exact: true });
    case 'label': return page.getByLabel(l.value, { exact: true });
    case 'placeholder': return page.getByPlaceholder(l.value, { exact: true });
    case 'text': return page.getByText(l.value, { exact: true });
    case 'id': return page.locator(`[id=${JSON.stringify(l.value)}]`);
    case 'xpath': return page.locator(`xpath=${l.value}`);
    default: return page.locator(l.value);
  }
}

async function resolve(page, action, framework, chooser) {
  const candidates = await page.evaluate(scanCandidates, {});
  try {
    let { choice, ranked } = pick(action.target, action.type, candidates);
    let how = 'matched';
    if (!choice && chooser && ranked.length) {
      const answer = await chooser({ target: action.target, type: action.type, step: action.source?.text, url: page.url(), candidates: ranked.slice(0, 30).map((r) => r.c) }).catch(() => null);
      if (answer) {
        choice = candidates.find((c) => c.index === answer.index) ?? null;
        how = 'chosen by Claude';
      }
    }
    if (!choice) {
      const near = ranked.slice(0, 2).map((r) => `"${r.c.text || r.c.label || r.c.placeholder || r.c.ariaLabel || r.c.tag}"`).join(', ');
      return { locator: null, note: `no element on the page clearly matches "${action.target.description}"${near ? ` (closest: ${near})` : ''}` };
    }
    if (framework === 'selenium') {
      const options = seleniumOptions(choice);
      const ok = await page.evaluate(([opts, i]) => {
        // inline copy of firstUnique: page.evaluate takes one function
        for (const o of opts) {
          const found = [];
          try {
            if (o.check.using === 'css') found.push(...document.querySelectorAll(o.check.value));
            else {
              const r = document.evaluate(o.check.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              for (let k = 0; k < r.snapshotLength; k++) found.push(r.snapshotItem(k));
            }
          } catch {
            continue;
          }
          if (found.length === 1 && found[0].getAttribute('data-agent-cand') === String(i)) return o;
        }
        return null;
      }, [options, choice.index]);
      return ok ? { locator: { strategy: ok.strategy, value: ok.value }, note: how } : { locator: null, note: 'element found, but no unique locator could be built' };
    }
    for (const option of playwrightOptions(choice)) {
      try {
        const loc = toPlaywright(page, option);
        if ((await loc.count()) !== 1) continue;
        if ((await loc.getAttribute('data-agent-cand')) === String(choice.index)) return { locator: option, note: how };
      } catch {
        // an option the engine rejects is skipped
      }
    }
    return { locator: null, note: 'element found, but no unique locator could be built' };
  } finally {
    await page.evaluate(clearMarkers).catch(() => {});
  }
}

const absolute = (url, baseUrl) => new URL(url || '/', baseUrl).href;

async function perform(page, action, loc) {
  switch (action.type) {
    case 'goto': return page.goto(absolute(action.url, action.baseUrl), { waitUntil: 'load', timeout: 15000 });
    case 'click': {
      await loc.click({ timeout: STEP_TIMEOUT });
      return page.waitForLoadState('load', { timeout: STEP_TIMEOUT }).catch(() => {});
    }
    case 'fill': return loc.fill(action.value, { timeout: STEP_TIMEOUT });
    case 'select': return loc.selectOption({ label: action.value }, { timeout: STEP_TIMEOUT }).catch(() => loc.selectOption(action.value, { timeout: STEP_TIMEOUT }));
    case 'check': return loc.check({ timeout: STEP_TIMEOUT });
    case 'uncheck': return loc.uncheck({ timeout: STEP_TIMEOUT });
    case 'hover': return loc.hover({ timeout: STEP_TIMEOUT });
    case 'press': return loc ? loc.press(action.key, { timeout: STEP_TIMEOUT }) : page.keyboard.press(action.key);
    case 'wait': return page.waitForTimeout(Math.min(action.ms, 10000));
    default: return null;
  }
}

/** True when the assertion holds on the live page. */
async function check(page, action, loc) {
  const wait = async (fn) => {
    const end = Date.now() + STEP_TIMEOUT;
    while (Date.now() < end) {
      if (await fn().catch(() => false)) return true;
      await page.waitForTimeout(150);
    }
    return false;
  };
  switch (action.type) {
    case 'expectVisible': return wait(() => loc.isVisible());
    case 'expectHidden': return loc ? wait(async () => !(await loc.isVisible())) : true;
    case 'expectEnabled': return wait(() => loc.isEnabled());
    case 'expectDisabled': return wait(() => loc.isDisabled());
    case 'expectValue': return wait(async () => (await loc.inputValue()) === action.value);
    case 'expectText': return wait(() => page.getByText(action.text).first().isVisible());
    case 'expectUrl': return wait(async () => page.url().toLowerCase().includes(String(action.value).toLowerCase()));
    case 'expectTitle': return wait(async () => (await page.title()).toLowerCase().includes(String(action.value).toLowerCase()));
    default: return null;
  }
}

/**
 * Explores each plan on the live app, filling in target locators and an
 * action `status` + `note`. Plans are explored in fresh browser contexts.
 */
export async function exploreWeb(plans, { baseUrl, framework = 'playwright', chooser = null, headless = true, urlGuard = null, onProgress = () => {} } = {}) {
  // CHROME_ARGS (set in the Dockerfile) keeps Chromium within a small container's memory.
  const args = (process.env.CHROME_ARGS || '').split(/\s+/).filter(Boolean);
  const browser = await chromium.launch({ headless, args });
  try {
    for (const plan of plans) {
      const context = await browser.newContext({ baseURL: baseUrl });
      // Hosted: every request the page makes, redirects included, must go to a public address.
      if (urlGuard) {
        await context.route('**/*', async (route) => {
          try {
            await urlGuard(route.request().url());
            await route.continue();
          } catch {
            await route.abort('blockedbyclient');
          }
        });
      }
      const page = await context.newPage();
      let stoppedAt = null;
      try {
        // Without a goto of its own, a test starts at the base URL.
        if (!plan.actions.some((a) => a.type === 'goto')) await page.goto(baseUrl, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
        for (const action of plan.actions) {
          onProgress({ test: plan.test, action });
          if (action.type === 'manual') {
            action.status = 'manual';
            continue;
          }
          if (stoppedAt) {
            if (action.target) action.target = { ...action.target, locator: guessLocator(action.target, framework), resolved: false };
            action.status = action.target ? 'guessed' : 'ok';
            action.note = `not explored: ${stoppedAt}`;
            continue;
          }
          let loc = null;
          const needsElement = ELEMENT_ACTIONS.has(action.type) || (action.type === 'press' && action.target);
          if (needsElement) {
            const found = await resolve(page, action, framework, chooser);
            if (found.locator) {
              action.target = { ...action.target, locator: found.locator, resolved: true };
              loc = framework === 'selenium' ? (found.locator.strategy === 'xpath' ? page.locator(`xpath=${found.locator.value}`) : page.locator(found.locator.strategy === 'id' ? `[id=${JSON.stringify(found.locator.value)}]` : found.locator.value)) : toPlaywright(page, found.locator);
              action.note = found.note;
            } else {
              action.target = { ...action.target, locator: guessLocator(action.target, framework), resolved: false };
              if (action.type === 'expectHidden') {
                action.status = 'verified';
                action.note = 'not on the page';
                continue;
              }
              action.status = 'failed';
              action.note = found.note;
              if (!action.type.startsWith('expect')) stoppedAt = `step ${action.source?.step} could not be performed`;
              continue;
            }
          }
          if (action.type.startsWith('expect') && action.type !== 'expectStatus' && action.type !== 'expectBody') {
            const ok = await check(page, action, loc);
            action.status = ok ? 'verified' : 'failed';
            if (!ok) {
              action.note = action.type === 'expectUrl' ? `the URL was ${page.url()}`
                : action.type === 'expectTitle' ? `the title was "${await page.title()}"`
                : action.type === 'expectText' ? `"${action.text}" is not on the page`
                : action.type === 'expectValue' ? `the value was "${await loc.inputValue().catch(() => '?')}"`
                : `${action.type.replace('expect', '').toLowerCase()} check failed`;
            }
            continue;
          }
          try {
            await perform(page, { ...action, baseUrl }, loc);
            action.status = needsElement ? 'found' : action.guessed ? 'guessed' : 'ok';
          } catch (err) {
            action.status = 'failed';
            action.note = String(err.message).split('\n')[0].slice(0, 200);
            stoppedAt = `step ${action.source?.step} failed`;
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return plans;
}

export { firstUnique };
