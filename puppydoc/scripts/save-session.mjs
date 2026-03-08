/**
 * 一次性登录 — 保存浏览器 session
 *
 * 会打开一个真实的浏览器窗口，你手动完成 OAuth 登录，
 * 登录成功后脚本自动保存 cookies 到 .auth/session.json。
 *
 * 运行: node scripts/save-session.mjs
 */
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
const AUTH_DIR = path.join(__dirname, '../.auth');
const SESSION_FILE = path.join(AUTH_DIR, 'session.json');

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  console.log('🌐 Opening browser — please log in manually via OAuth...');
  console.log(`   URL: ${BASE_URL}/login\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`);

  console.log('⏳ Waiting for you to complete login...');
  console.log('   (Script will detect when you leave the login page)\n');

  await page.waitForURL((url) => !url.toString().includes('/login'), {
    timeout: 300000, // 5 minutes to login
  });

  // Give the app a moment to fully initialize the session
  await page.waitForTimeout(3000);

  console.log(`✅ Login detected! Current URL: ${page.url()}`);

  // Save session (cookies + localStorage)
  await context.storageState({ path: SESSION_FILE });
  console.log(`💾 Session saved to .auth/session.json`);

  await browser.close();
  console.log('\n🎉 Done! Now you can run the screenshot scripts without logging in again.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
