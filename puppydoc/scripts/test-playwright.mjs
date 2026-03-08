/**
 * Playwright 版本 — 传统 selector 截图
 *
 * 先运行 save-session.mjs 保存登录态，然后：
 *   node scripts/test-playwright.mjs
 */
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
const SESSION_FILE = path.join(__dirname, '../.auth/session.json');
const OUT_DIR = path.join(__dirname, '../public/screenshots/playwright');

async function main() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.error('❌ No session found. Run `node scripts/save-session.mjs` first.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const times = {};

  console.log('🚀 Starting Playwright...');
  const t0 = Date.now();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    storageState: SESSION_FILE,
  });
  const page = await context.newPage();
  times.init = Date.now() - t0;
  console.log(`   Init: ${times.init}ms`);

  // --- Step 1: Home page ---
  let t = Date.now();
  await page.goto(`${BASE_URL}/home`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT_DIR, '01-home.png') });
  times.homeScreenshot = Date.now() - t;
  console.log(`📸 01-home.png (${times.homeScreenshot}ms)`);

  // --- Step 2: Connect page (hardcoded URL) ---
  t = Date.now();
  await page.goto(`${BASE_URL}/settings/connect`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT_DIR, '02-connect.png') });
  times.connectScreenshot = Date.now() - t;
  console.log(`📸 02-connect.png (${times.connectScreenshot}ms)`);

  // --- Step 3: Find Gmail (hardcoded selector) ---
  t = Date.now();
  try {
    const gmail = page.locator('text=Gmail').first();
    if (await gmail.isVisible()) {
      await gmail.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT_DIR, '03-gmail.png') });
      times.gmailScreenshot = Date.now() - t;
      console.log(`📸 03-gmail.png (${times.gmailScreenshot}ms)`);
    } else {
      times.gmailScreenshot = Date.now() - t;
      console.log(`⚠️  Gmail not visible (${times.gmailScreenshot}ms)`);
    }
  } catch (e) {
    times.gmailScreenshot = Date.now() - t;
    console.log(`⚠️  Gmail step failed (${times.gmailScreenshot}ms): ${e.message}`);
  }

  await browser.close();

  const total = Object.values(times).reduce((a, b) => a + b, 0);
  console.log('\n📊 Playwright Summary:');
  console.log(JSON.stringify(times, null, 2));
  console.log(`Total: ${total}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
