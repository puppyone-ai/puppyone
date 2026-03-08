/**
 * One-time OAuth login — saves browser session for reuse.
 *
 * Opens a real browser window. Log in manually via Google/GitHub.
 * Session is saved to auth/session.json automatically.
 *
 *   node lib/save-session.mjs
 */
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
const AUTH_DIR = path.join(__dirname, '../auth');
const SESSION_FILE = path.join(AUTH_DIR, 'session.json');

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  console.log('🌐 Opening browser — log in via OAuth...');
  console.log(`   ${BASE_URL}/login\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`);

  console.log('⏳ Waiting for login (5 min timeout)...\n');
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 300_000 });
  await page.waitForTimeout(3000);

  console.log(`✅ Logged in: ${page.url()}`);
  await context.storageState({ path: SESSION_FILE });
  console.log('💾 Session saved to auth/session.json');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
