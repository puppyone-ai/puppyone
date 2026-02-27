# E2E Visual Testing (Stagehand)

AI-driven end-to-end visual testing for PuppyOne. Uses [Stagehand](https://github.com/browserbase/stagehand) — Playwright + LLM — so scenarios tolerate UI changes without brittle selectors.

## Quick Start

```bash
cd e2e

# 1. Install
npm install
npx playwright install chromium

# 2. Configure
cp .env.example .env
# Fill in OPENAI_API_KEY (and OPENAI_BASE_URL if using a proxy)

# 3. Save session (one-time — logs in via browser)
npm run save-session

# 4. Run all scenarios
npm test

# 5. Run one scenario
npm run test:one -- connect-gmail

# 6. Run + publish screenshots to puppydoc
npm run publish
```

## Directory Structure

```
e2e/
├── lib/
│   ├── browser.mjs          # Stagehand init + session loading
│   └── save-session.mjs     # OAuth session saver
├── scenarios/                # Test scenarios
│   ├── connect-gmail.mjs
│   ├── create-gmail-access-point.mjs
│   ├── data-browser.mjs
│   └── tools-and-server.mjs
├── auth/                     # Saved session (gitignored)
├── results/                  # Screenshot output (gitignored)
├── run.mjs                   # Scenario runner
├── .env                      # Config (gitignored)
├── .env.example              # Template
└── package.json
```

## Writing Scenarios

Each scenario exports a default object with `description` and `steps`:

```js
import { BASE_URL } from '../lib/browser.mjs';

export default {
  description: 'What this scenario tests',
  steps: [
    {
      name: 'step-name',   // used as screenshot filename
      waitAfter: 2000,     // optional — ms to wait before screenshotting
      action: async ({ stagehand, page }) => {
        // Deterministic: use Playwright's `page`
        await page.goto(`${BASE_URL}/home`);

        // Flexible: use Stagehand's AI
        await stagehand.act('click the first project card');
      },
    },
  ],
};
```

### When to use `page` vs `stagehand.act()`

| Use case | Use |
|----------|-----|
| Navigate to a known URL | `page.goto(url)` |
| Wait for network/DOM | `page.waitForLoadState()` |
| Click something with dynamic text/layout | `stagehand.act('...')` |
| Fill a form field by label | `stagehand.act('...')` |
| Assert something exists visually | `stagehand.act('scroll to ...')` |

## CI

See `.github/workflows/e2e.yml`. The workflow:
1. Starts frontend + backend
2. Restores session from `E2E_SESSION_JSON` secret
3. Runs all scenarios
4. Uploads screenshots as artifact
