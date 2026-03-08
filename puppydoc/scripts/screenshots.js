/**
 * puppyone Documentation Screenshot Script
 *
 * 自动登录产品并截取文档所需的关键页面截图。
 * 截图保存到 public/screenshots/ 目录，可在 MDX 文件里直接引用。
 *
 * 使用：
 *   node scripts/screenshots.js
 *
 * 环境变量（可放在 .env.screenshots 文件中）：
 *   APP_URL      产品地址，默认 http://localhost:3000
 *   APP_EMAIL    登录邮箱
 *   APP_PASSWORD 登录密码
 *   PROJECT_ID   截图用的项目 ID（从产品 URL 里复制）
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// ---------- 配置 ----------
const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
const EMAIL = process.env.APP_EMAIL || '';
const PASSWORD = process.env.APP_PASSWORD || '';
const PROJECT_ID = process.env.PROJECT_ID || '';

const OUT_DIR = path.join(__dirname, '../public/screenshots');

// 截图任务列表：{ name, fn(page, ctx) }
// ctx = { projectId }
const SHOTS = [
  {
    name: 'login',
    fn: async (page) => {
      await page.goto(`${BASE_URL}/login`);
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'home',
    fn: async (page) => {
      await page.goto(`${BASE_URL}/home`);
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'data-browser',
    fn: async (page, { projectId }) => {
      await page.goto(`${BASE_URL}/projects/${projectId}/data`);
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'settings-connect',
    fn: async (page) => {
      await page.goto(`${BASE_URL}/settings/connect`);
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'toolkit',
    fn: async (page, { projectId }) => {
      await page.goto(`${BASE_URL}/projects/${projectId}/toolkit`);
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'tools-and-server',
    fn: async (page) => {
      await page.goto(`${BASE_URL}/tools-and-server`);
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'project-settings',
    fn: async (page, { projectId }) => {
      await page.goto(`${BASE_URL}/projects/${projectId}/settings`);
      await page.waitForLoadState('networkidle');
    },
  },
];

// ---------- 主流程 ----------
async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('❌  请设置 APP_EMAIL 和 APP_PASSWORD 环境变量');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // 2x 高清截图
  });
  const page = await context.newPage();

  // 登录
  console.log('🔐  登录中...');
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|登录/i }).click();
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 });
  console.log('✅  登录成功');

  // 如果没有传 PROJECT_ID，尝试从 URL 里取
  let projectId = PROJECT_ID;
  if (!projectId) {
    await page.goto(`${BASE_URL}/home`);
    await page.waitForLoadState('networkidle');
    // 尝试点第一个项目，从 URL 里提取 projectId
    const firstProject = page.getByRole('link', { name: /project/i }).first();
    if (await firstProject.isVisible()) {
      await firstProject.click();
      await page.waitForLoadState('networkidle');
      const match = page.url().match(/projects\/([^/]+)/);
      if (match) projectId = match[1];
    }
  }

  const ctx = { projectId };

  // 逐个截图
  for (const shot of SHOTS) {
    // 跳过需要 projectId 但没有的任务
    if (!projectId && shot.fn.toString().includes('projectId')) {
      console.log(`⏭  跳过 ${shot.name}（需要 PROJECT_ID）`);
      continue;
    }

    console.log(`📸  截图: ${shot.name}`);
    try {
      await shot.fn(page, ctx);
      const outPath = path.join(OUT_DIR, `${shot.name}.png`);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`   ✅  已保存 → public/screenshots/${shot.name}.png`);
    } catch (err) {
      console.error(`   ❌  ${shot.name} 失败:`, err.message);
    }
  }

  await browser.close();
  console.log('\n🎉  完成！截图保存在 public/screenshots/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
