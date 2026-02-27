/**
 * Stagehand 版本 — AI 驱动的文档截图
 *
 * 先运行 save-session.mjs 保存登录态，然后：
 *   OPENAI_API_KEY=sk-xxx node scripts/test-stagehand.mjs
 */
import { Stagehand } from '@browserbasehq/stagehand';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
const SESSION_FILE = path.join(__dirname, '../.auth/session.json');
const OUT_DIR = path.join(__dirname, '../public/screenshots/stagehand');

async function main() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.error('❌ No session found. Run `node scripts/save-session.mjs` first.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const times = {};

  console.log('🚀 Starting Stagehand (LOCAL mode)...');
  const t0 = Date.now();

  const stagehand = new Stagehand({
    env: 'LOCAL',
    verbose: 1,
    enableCaching: true,
    browserbaseSessionCreateParams: {
      storageState: SESSION_FILE,
    },
  });
  await stagehand.init();
  times.init = Date.now() - t0;
  console.log(`   Init: ${times.init}ms`);

  const page = stagehand.context.pages()[0];
  await page.setViewportSize({ width: 1440, height: 900 });

  // Inject saved session cookies manually if storageState param isn't supported
  try {
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    if (session.cookies?.length) {
      await stagehand.context.addCookies(session.cookies);
    }
  } catch (_) {}

  // --- Step 1: Home page ---
  let t = Date.now();
  await page.goto(`${BASE_URL}/home`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT_DIR, '01-home.png') });
  times.homeScreenshot = Date.now() - t;
  console.log(`📸 01-home.png (${times.homeScreenshot}ms)`);

  // --- Step 2: AI navigates to connect page (natural language) ---
  t = Date.now();
  await stagehand.act('find and click on a link or menu item related to Connect, Integrations, or Settings in the sidebar or navigation');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT_DIR, '02-connect.png') });
  times.connectScreenshot = Date.now() - t;
  console.log(`📸 02-connect.png (${times.connectScreenshot}ms)`);

  // --- Step 3: AI finds Gmail ---
  t = Date.now();
  try {
    await stagehand.act('scroll to and highlight the Gmail connector or Gmail integration card');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT_DIR, '03-gmail.png') });
    times.gmailScreenshot = Date.now() - t;
    console.log(`📸 03-gmail.png (${times.gmailScreenshot}ms)`);
  } catch (e) {
    times.gmailScreenshot = Date.now() - t;
    console.log(`⚠️  Gmail step failed (${times.gmailScreenshot}ms): ${e.message}`);
  }

  await stagehand.close();

  const total = Object.values(times).reduce((a, b) => a + b, 0);
  console.log('\n📊 Stagehand Summary:');
  console.log(JSON.stringify(times, null, 2));
  console.log(`Total: ${total}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
