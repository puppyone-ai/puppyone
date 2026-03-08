/**
 * Markdown Scenario Parser
 *
 * Converts a .md checklist into executable Stagehand steps.
 *
 * Supported syntax:
 *   - [ ] Navigate to /home                              → page.goto(BASE_URL + path)
 *   - [ ] Wait 2 seconds                                 → page.waitForTimeout(ms)
 *   - [ ] `await page.click('#btn')`                     → Playwright code (hardcoded)
 *   - [ ] Click the first project card                   → AI natural language
 *   - [ ] Any natural language instruction                → AI natural language
 *
 * Optional suffix on any line:
 *   [wait:3000]   → ms to wait before taking the screenshot
 */
import fs from 'fs';
import { BASE_URL, actWithFallback } from './browser.mjs';

const NAVIGATE_RE = /^navigate\s+to\s+(\S+)/i;
const WAIT_RE = /^wait\s+(?:for\s+)?(\d+)\s*(s|seconds?|ms|milliseconds?)?/i;
const WAIT_SUFFIX_RE = /\s*\[wait[:\s]*(\d+)\]\s*$/i;
const STEP_RE = /^-\s*\[[ x]?\]\s*/i;
const CODE_RE = /^`(.+)`$/;

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function parseWaitMs(amount, unit) {
  const n = parseInt(amount, 10);
  if (!unit || /^(s|seconds?)$/i.test(unit)) return n * 1000;
  return n;
}

function buildStep(rawLine) {
  let line = rawLine.replace(STEP_RE, '').trim();

  let waitAfter = 1000;
  const waitMatch = line.match(WAIT_SUFFIX_RE);
  if (waitMatch) {
    waitAfter = parseInt(waitMatch[1], 10);
    line = line.replace(WAIT_SUFFIX_RE, '').trim();
  }

  const name = slugify(line);
  const instruction = line;

  const codeMatch = instruction.match(CODE_RE);
  if (codeMatch) {
    const code = codeMatch[1];
    const fn = new Function('page', 'stagehand', 'BASE_URL', `return (async () => { ${code} })()`);
    return {
      name,
      waitAfter,
      action: async ({ stagehand, page }) => fn(page, stagehand, BASE_URL),
    };
  }

  const navMatch = instruction.match(NAVIGATE_RE);
  if (navMatch) {
    const urlPath = navMatch[1];
    return {
      name,
      waitAfter,
      action: async ({ page }) => {
        const target = urlPath.startsWith('http') ? urlPath : `${BASE_URL}${urlPath}`;
        await page.goto(target);
        await page.waitForLoadState('networkidle');
      },
    };
  }

  const waitStepMatch = instruction.match(WAIT_RE);
  if (waitStepMatch) {
    const ms = parseWaitMs(waitStepMatch[1], waitStepMatch[2]);
    return {
      name,
      waitAfter,
      action: async ({ page }) => {
        await page.waitForTimeout(ms);
      },
    };
  }

  return {
    name,
    waitAfter,
    action: async ({ stagehand, page }) => {
      await actWithFallback(stagehand, page, instruction);
    },
  };
}

export function parseMarkdownScenario(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let description = '';
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const descMatch = fmMatch[1].match(/description:\s*(.+)/i);
    if (descMatch) description = descMatch[1].trim();
  }

  if (!description) {
    const h1 = lines.find((l) => l.startsWith('# '));
    description = h1 ? h1.replace(/^#\s*/, '').trim() : filePath;
  }

  const steps = lines.filter((l) => STEP_RE.test(l.trim())).map((l) => buildStep(l.trim()));

  return { description, steps };
}
