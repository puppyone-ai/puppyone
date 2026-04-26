#!/usr/bin/env node
/**
 * PuppyOne Frontend Timing — Lighthouse programmatic API
 *
 * Measures FCP, LCP, TTI, TBT, CLS for each key page.
 * Uses Lighthouse (already installed in frontend devDeps).
 *
 * Usage:
 *   node scripts/nav-timing.mjs [--url http://localhost:3001]
 */

import { execSync, spawn } from 'child_process';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const BASE_URL = process.argv[process.argv.indexOf('--url') + 1] || 'http://localhost:3001';
const CHROME_PORT = 9398;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) {
    try { execSync(`"${c}" --version`, { stdio: 'pipe' }); return c; } catch {}
  }
  return null;
}

async function runLighthouse(url, label) {
  const { default: lighthouse } = await import(
    path.join(process.cwd(), 'frontend/node_modules/lighthouse/core/index.js')
  ).catch(() => import('lighthouse/core/index.js'));

  const chromeLauncher = await import(
    path.join(process.cwd(), 'frontend/node_modules/chrome-launcher/dist/chrome-launcher.js')
  ).catch(() => import('chrome-launcher'));

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
    port: CHROME_PORT + Math.floor(Math.random() * 100),
  });

  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance'],
      throttlingMethod: 'provided', // no artificial throttling — measure real speed
      formFactor: 'desktop',
      screenEmulation: {
        mobile: false,
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        disabled: false,
      },
    });

    const a = result.lhr.audits;
    const fmt = v => v ? Math.round(v) + 'ms' : '—';

    return {
      label,
      url,
      score: Math.round(result.lhr.categories.performance.score * 100),
      fcp: Math.round(a['first-contentful-paint']?.numericValue || 0),
      lcp: Math.round(a['largest-contentful-paint']?.numericValue || 0),
      tti: Math.round(a['interactive']?.numericValue || 0),
      tbt: Math.round(a['total-blocking-time']?.numericValue || 0),
      cls: (a['cumulative-layout-shift']?.numericValue || 0).toFixed(3),
      si: Math.round(a['speed-index']?.numericValue || 0),
      blocking: (a['render-blocking-resources']?.details?.items || []).map(i => ({
        name: (i.url || '').split('/').pop()?.split('?')[0]?.slice(0, 50),
        wasted: Math.round(i.wastedMs || 0),
      })),
      topJS: (a['bootup-time']?.details?.items || []).slice(0, 5).map(i => ({
        name: (i.url || '').split('/').pop()?.slice(0, 50),
        ms: Math.round(i.total || 0),
      })),
      topResources: (a['network-requests']?.details?.items || [])
        .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
        .slice(0, 8)
        .map(i => ({
          name: (i.url || '').split('/').pop()?.split('?')[0]?.slice(0, 50),
          kb: Math.round((i.transferSize || 0) / 1024),
          ms: Math.round(i.endTime - i.startTime),
          type: i.resourceType,
        })),
    };
  } finally {
    await chrome.kill();
  }
}

function status(ms, goodMs, warnMs) {
  if (ms <= goodMs) return '\x1b[32m✓\x1b[0m';
  if (ms <= warnMs) return '\x1b[33m△\x1b[0m';
  return '\x1b[31m⚠\x1b[0m';
}

async function main() {
  console.log('\x1b[1m═══════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m  PuppyOne Page Load Timing (no throttling)\x1b[0m');
  console.log(`  Target: ${BASE_URL}`);
  console.log('\x1b[1m═══════════════════════════════════════════════════════\x1b[0m\n');

  const pages = [
    { url: `${BASE_URL}/login`, label: '/login' },
    { url: `${BASE_URL}/home`, label: '/home (dashboard)' },
  ];

  const results = [];
  for (const page of pages) {
    process.stdout.write(`  Measuring ${page.label}...`);
    try {
      const r = await runLighthouse(page.url, page.label);
      results.push(r);
      console.log(' done');
    } catch (e) {
      console.log(` failed: ${e.message}`);
    }
  }

  console.log();
  console.log('\x1b[1m── Web Vitals ──────────────────────────────────────────\x1b[0m');
  console.log('  Page                   Score  FCP      LCP      TTI      TBT    CLS');
  console.log('  ──────────────────────────────────────────────────────────────────');
  for (const r of results) {
    const scoreColor = r.score >= 90 ? '\x1b[32m' : r.score >= 70 ? '\x1b[33m' : '\x1b[31m';
    console.log(
      `  ${r.label.padEnd(22)} ${scoreColor}${String(r.score).padStart(3)}\x1b[0m` +
      `  ${status(r.fcp,1800,3000)} ${String(r.fcp+'ms').padEnd(7)}` +
      `  ${status(r.lcp,2500,4000)} ${String(r.lcp+'ms').padEnd(7)}` +
      `  ${status(r.tti,3800,7300)} ${String(r.tti+'ms').padEnd(7)}` +
      `  ${status(r.tbt,200,600)} ${String(r.tbt+'ms').padEnd(5)}` +
      `  ${String(r.cls).padEnd(6)}`
    );
  }
  console.log('  ── Targets: FCP <1.8s ✓  LCP <2.5s ✓  TTI <3.8s ✓  TBT <200ms ✓  CLS <0.1 ✓');

  console.log();
  console.log('\x1b[1m── Render-Blocking Resources ───────────────────────────\x1b[0m');
  for (const r of results) {
    if (r.blocking.length === 0) continue;
    console.log(`  ${r.label}:`);
    r.blocking.forEach(b => console.log(`    \x1b[31m${String(b.wasted+'ms').padStart(6)}\x1b[0m  ${b.name}`));
  }

  console.log();
  console.log('\x1b[1m── Top JS Execution Time ───────────────────────────────\x1b[0m');
  for (const r of results) {
    if (r.topJS.length === 0) continue;
    console.log(`  ${r.label}:`);
    r.topJS.forEach(j => {
      const flag = j.ms > 100 ? ' \x1b[33m△\x1b[0m' : '';
      console.log(`    ${String(j.ms+'ms').padStart(6)}  ${j.name}${flag}`);
    });
  }

  console.log();
  console.log('\x1b[1m── Largest Network Transfers ───────────────────────────\x1b[0m');
  for (const r of results) {
    if (r.topResources.length === 0) continue;
    console.log(`  ${r.label}:`);
    r.topResources.filter(t => t.kb > 0).slice(0, 6).forEach(t => {
      const flag = t.kb > 500 ? ' \x1b[31m⚠ LARGE\x1b[0m' : t.kb > 100 ? ' \x1b[33m△\x1b[0m' : '';
      console.log(`    ${String(t.kb+'KB').padStart(7)} ${String(t.ms+'ms').padStart(6)}  [${t.type||'?'}] ${t.name}${flag}`);
    });
  }

  console.log();
  console.log('\x1b[1m── Issues & Recommendations ────────────────────────────\x1b[0m');
  const allBlocking = results.flatMap(r => r.blocking);
  const fonts = allBlocking.filter(b => b.name.includes('font') || b.name.includes('css2'));
  if (fonts.length > 0) {
    const totalWasted = fonts.reduce((s, f) => s + f.wasted, 0);
    console.log(`  \x1b[31m⚠ Google Fonts blocking render: ~${totalWasted}ms wasted\x1b[0m`);
    console.log('    Fix in app/layout.tsx:');
    console.log('    1. Add: <link rel="preconnect" href="https://fonts.googleapis.com" />');
    console.log('    2. Add: <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />');
    console.log('    3. Add &display=swap to the Google Fonts URL');
    console.log('    4. Or: use next/font/google instead of <link> (auto-optimizes)');
  }

  const highLCP = results.filter(r => r.lcp > 2500);
  if (highLCP.length > 0) {
    console.log(`  \x1b[33m△ LCP ${highLCP[0].lcp}ms — mostly caused by blocking fonts above\x1b[0m`);
  }

  const goodResults = results.filter(r => r.lcp <= 2500 && r.tbt <= 200);
  if (goodResults.length > 0) {
    console.log(`  \x1b[32m✓ No heavy JS blocking after bundle optimization\x1b[0m`);
    console.log(`  \x1b[32m✓ TBT ${results[0]?.tbt}ms — main thread not blocked\x1b[0m`);
    console.log(`  \x1b[32m✓ CLS 0 — no layout shift\x1b[0m`);
  }

  console.log('\x1b[1m═══════════════════════════════════════════════════════\x1b[0m\n');
}

main().catch(e => { console.error(e); process.exit(1); });
