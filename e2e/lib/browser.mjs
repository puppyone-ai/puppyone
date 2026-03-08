/**
 * Shared Stagehand + Playwright setup.
 *
 * Each scenario gets a fresh Stagehand instance (with shared auth).
 * Exports: createStagehand(), actWithFallback()
 */
import dotenv from 'dotenv';
import { Stagehand } from '@browserbasehq/stagehand';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../auth/session.json');

export const BASE_URL = process.env.APP_URL || 'http://localhost:3000';

export const VIEWPORT = {
  width: parseInt(process.env.VIEWPORT_WIDTH || '1440', 10),
  height: parseInt(process.env.VIEWPORT_HEIGHT || '900', 10),
};

function buildModelConfig() {
  const rawModel = process.env.OPENAI_MODEL || 'gpt-4o';
  return {
    modelName: rawModel.includes('/') ? rawModel : `openai/${rawModel}`,
    apiKey: process.env.OPENAI_API_KEY,
    ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
  };
}

let cachedSession = null;

function getSession() {
  if (!cachedSession) {
    if (!fs.existsSync(SESSION_FILE)) {
      console.error('No session found. Run: npm run save-session');
      process.exit(1);
    }
    cachedSession = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
  }
  return cachedSession;
}

export async function createStagehand() {
  const model = buildModelConfig();

  const stagehand = new Stagehand({
    env: 'LOCAL',
    verbose: 0,
    enableCaching: true,
    model,
  });

  await stagehand.init();

  const page = stagehand.context.pages()[0];
  await page.setViewportSize(VIEWPORT);

  const session = getSession();
  if (session.cookies?.length) {
    await stagehand.context.addCookies(session.cookies);
  }

  return { stagehand, page };
}

/**
 * Try stagehand.act(), fall back to observe() + Playwright click
 * when the LLM returns an elementId that doesn't match Stagehand's schema.
 */
export async function actWithFallback(stagehand, page, instruction, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await stagehand.act(instruction);
      return;
    } catch (err) {
      if (!err.message?.includes('did not match schema')) throw err;
      if (i < retries - 1) {
        await page.waitForTimeout(500);
        continue;
      }
    }
  }

  console.log(`     ↳ act() failed, using observe() fallback...`);
  const candidates = await stagehand.observe(instruction);
  if (candidates?.length > 0 && candidates[0].selector) {
    await page.locator(candidates[0].selector).first().click({ timeout: 10000 });
    return;
  }
  throw new Error(`Could not find element for: "${instruction}"`);
}
