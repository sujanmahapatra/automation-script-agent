# Automation Script Agent

Turns manual test cases into runnable automation projects:

| Framework | Languages | Project |
| --- | --- | --- |
| **Playwright** | TypeScript, Python | `@playwright/test` · `pytest-playwright` |
| **Selenium** | Java, Python, TypeScript | Maven + TestNG · pytest · `selenium-webdriver` + `node:test` |
| **Appium** | Java, Python, TypeScript | `java-client` + TestNG · `Appium-Python-Client` + pytest · WebdriverIO |
| **API** | TypeScript, Java, Python | Playwright `request` · REST Assured + TestNG · `requests` + pytest |

Give it the manual tests you already have: an Excel or CSV export with one
row per step (testcase-generator, TestRail, Xray, Zephyr), testcase-generator
JSON, or pasted text. You get a project with its build file, a README saying
how to run it, and one test per manual case. Every line of code has a comment
naming the manual step it came from.

## Use it

```bash
npm install
npx playwright install chromium

npm run serve                      # http://127.0.0.1:9330
```

On the page, add your tests and pick a framework and language. Enter your
app's URL, or click **Use the demo app**, then click **Generate**. You get:

- **Steps**: what each manual step became, its locator, and whether it was
  checked against the app.
- **Code**: every generated file.
- **Run**: the generated tests' results.
- **Download .zip**: the whole project.

### Low-code recorder

Open **/record** (http://127.0.0.1:9330/record), or follow the link at the top
of the main page, to record a test without writing it first:

1. Enter the app's address (or click **Use the demo app**) and click
   **Start recording**. A browser on the server opens the app and streams it
   to the page.
2. Use the app as normal: click, type, choose from dropdowns, tick boxes.
   Each action is done on the real page and listed as a step, such as
   *Click on "Search" button* or *Type "delhi" in "Destination" text input*.
   Password values are shown as ••••••.
3. Add checks:
   - **Visual validation**, then click an element: it must be visible.
   - **Text validation**, then click an element: it must show its text (or
     hold its value).
   - **Verify URL** and **Verify title** check the current page.
4. **AI interactions**: choose **Action** or **Validation**, describe it in
   plain words ("Type delhi in the destination field and click Search",
   "Verify the error 'Invalid password' is shown"), and click **Perform**.
   With `ANTHROPIC_API_KEY` set, Claude does it one action at a time,
   looking at the page after each. Without one, the built-in rules read
   the sentence.
5. Click a step for **Execute till here** (runs steps 1 to that one) and
   **+ Add step(s)** (new steps go after it). Drag steps to reorder them.
   **Run all** replays the whole test.
6. **Save as module** downloads the steps as JSON. **Import a module** runs
   a saved recording (a sign-in, say) and adds its steps where you are.
7. **Save recording** writes the test as Playwright, Selenium or Appium code,
   with the same templates and readable locators as converted tests, and can
   run it once to check it passes.

Locators are built when you click, so they find exactly the element you
clicked: role and name, label or test id for Playwright; id, CSS or XPath for
Selenium. Links that open a new tab load in the recorded tab.

From the command line:

```bash
node bin/autogen.js generate tests.xlsx --framework selenium --language java \
  --base-url https://staging.example.com --explore --out generated/selenium-java

node bin/autogen.js generate api-tests.csv --framework api --language typescript \
  --base-url https://api.example.com --explore --verify
```

| Flag | |
| --- | --- |
| `--framework`, `--language` | Any pair in the table above (`autogen targets` lists them). |
| `--base-url` | The app or API under test. Generated projects default to it, and `BASE_URL` overrides it. |
| `--explore` | Open the app and find real locators (see below). |
| `--verify` | Run the generated tests before writing them out. Works for Playwright TS, API TS and Selenium TS, which run on this project's own dependencies. |
| `--planner` | `auto` (default): Claude when `ANTHROPIC_API_KEY` is set, otherwise the built-in rules. Or force `rules` or `claude`. |
| `--headed` | Watch the browser while it explores. |

## How it works

1. **Read** the manual tests. Columns are matched by name (ID, Title,
   Preconditions, Step, Expected result…). A row with its own ID or title
   starts a new case, and a cell holding "1. … 2. …" becomes several steps.
2. **Plan** each step as an action: `goto`, `click`, `fill`, `select`,
   `check`, `expectVisible`, `expectText`, `expectUrl`, `request`,
   `expectStatus`, `expectBody`…
   - **Built-in rules** handle the phrasing testers use most ("Enter X in
     the Email field", "Click Sign in", "Status code should be 201",
     "Response contains field id"), with no network call.
   - **Claude** (`claude-opus-5-5`, when `ANTHROPIC_API_KEY` is set) plans
     steps written any way at all, using a strict JSON schema.

   Anything neither can automate stays a `TODO (manual)` with the reason,
   never a guess dressed up as code.
3. **Explore** (`--explore`, web and API):
   - **Web.** The agent opens the app in a browser and carries out the steps.
     It finds each element from the step's words (label, text, role,
     placeholder, test id) and builds the most readable locator that matches
     only that element: role and name for Playwright, id, CSS or XPath for
     Selenium. It checks each locator on the page. Each expected result is
     checked as it goes, so the report shows which ones hold on the app
     today. When two elements fit equally well and a key is set, Claude
     picks one or says neither.
   - **API.** Each request is sent and each status and body check is tested
     against the real response.
4. **Write** the project from fixed templates, so the generated code
   always has the same, readable structure.
5. **Run** it (`--verify`) and report the results for each test.

### Reading the result

Each step gets one of these statuses:

| Status | Meaning |
| --- | --- |
| verified | Checked on the live app, and it held. |
| found on app | The element was found and the step was carried out. |
| converted | Needs no element (navigation, waits, requests). |
| guessed | No app to explore, or the element wasn't found. The locator comes from the step text and is marked `TODO`. |
| failed on app | The step ran, but the app didn't behave as the manual test says. The code keeps the check and adds a `NOTE`, because either the test or the app is wrong. If the check was only the agent's reading of vague wording, it is commented out instead. |
| manual | Can't be automated (visual judgement, email, physical action). Left as `TODO (manual)`. |

Appium tests aren't explored, because no device is connected. Their locators
are accessibility ids or text XPath built from the step text, all marked
`TODO` until checked with Appium Inspector.

Selenium projects can run through the self-healing proxy: set
`SELENIUM_REMOTE_URL=http://127.0.0.1:4445`.

## Deploy on Render

`render.yaml` and `Dockerfile` deploy the web page as one Docker service on
the Playwright image, so exploring and running tests work in the cloud too.

1. Push this folder to a GitHub repository.
2. In the Render dashboard, choose **New → Blueprint** and pick the repository.
3. Enter **APP_PASSWORD**: everyone who opens the URL signs in with any user
   name and this password. **ANTHROPIC_API_KEY** is optional.

Things that work differently on the hosted copy:

- **Public URLs only.** The hosted agent explores only public URLs. Private
  and internal addresses are refused, including redirects and requests a page
  makes, because otherwise anyone with the password could use it to reach
  Render's internal network. For internal apps, run `npm run serve` on your
  own machine. The built-in demo app still works.
- **One conversion at a time.** Others wait their turn, which keeps a small
  instance within its memory.
- **Two recordings at a time** (`REC_MAX_SESSIONS` changes it). Each holds a
  browser tab, and a recording left alone for 20 minutes is closed.
- **Free-plan memory.** The free plan has 512 MB of memory, which can be too
  little for a large app with both options on. Use `starter` if you see
  restarts.

To run the same image locally:
`docker build -t automation-script-agent . && docker run -p 10000:10000 -e APP_PASSWORD=pick-one automation-script-agent`

## Develop

```bash
npm test          # reading, rules, Claude mapping, code writing, and end-to-end runs against the demo app
npm run demo-app  # the demo app on http://127.0.0.1:5199
```

`src/input/` reads the manual tests, `src/plan/` turns them into actions
(rules or Claude), `src/explore/` explores the app (`web.js`, `api.js`, plus
`dom.js`, which runs in the browser), `src/locators.js` matches step words to
elements, and `src/emit/` holds one writer per framework. `src/agent.js` ties
these together, `src/verify.js` runs the generated projects, and
`src/server.js` + `src/ui.js` serve the web page. `src/record/` is the
recorder: `session.js` (the streamed browser and the steps), `steps.js` (step
text and export), `ai.js` (AI interactions), `routes.js`, and the page
(`page.html`, `client.js`).
