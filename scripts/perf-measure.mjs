#!/usr/bin/env node
/**
 * PuppyOne Frontend Performance Measurement
 *
 * 三层测速：
 *   1. Bundle 大小分析（.next/static/chunks）
 *   2. Backend API 直接测速（不经前端）
 *   3. Next.js SSR 页面响应时间
 *
 * 使用方法：
 *   # 本地前端
 *   node scripts/perf-measure.mjs
 *
 *   # 对比 Railway
 *   node scripts/perf-measure.mjs --api https://qubits-api.puppyone.ai --frontend https://qubits.puppyone.ai
 *
 *   # 带认证测试私有端点
 *   node scripts/perf-measure.mjs --token YOUR_JWT_TOKEN
 */

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i+1] : null; };

const API_BASE = getArg('--api') || 'http://localhost:9090';
const FRONTEND_BASE = getArg('--frontend') || 'http://localhost:3000';
const TOKEN = getArg('--token') || '';
const REPEAT = parseInt(getArg('--repeat') || '5');

// ── Timing helper ──────────────────────────────────────────────────────────
async function timed(fn, n = REPEAT) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    try { await fn(); } catch {}
    times.push(Math.round(performance.now() - t));
  }
  return {
    avg: Math.round(times.reduce((a, b) => a + b, 0) / n),
    min: Math.min(...times),
    max: Math.max(...times),
    p95: times.sort((a,b)=>a-b)[Math.floor(n * 0.95)] ?? times[times.length-1],
    samples: times,
  };
}

async function fetchUrl(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...opts });
  await res.text();
  return res;
}

// ── 1. Bundle Analysis ─────────────────────────────────────────────────────
async function analyzeBundles() {
  const { existsSync, readdirSync, statSync, readFileSync } = await import('fs');
  const { join } = await import('path');

  // Find frontend dir
  const candidates = ['frontend/.next', '.next', '../frontend/.next'];
  const nextDir = candidates.find(c => existsSync(c));
  if (!nextDir) return null;

  const chunksDir = join(nextDir, 'static/chunks');
  if (!existsSync(chunksDir)) return null;

  // Collect all JS files recursively
  function walk(dir) {
    const results = [];
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) results.push(...walk(full));
      else if (f.endsWith('.js')) results.push({ path: full, name: f, size: statSync(full).size });
    }
    return results;
  }

  const files = walk(chunksDir).sort((a, b) => b.size - a.size);
  const totalKB = Math.round(files.reduce((s, f) => s + f.size, 0) / 1024);

  return {
    totalKB,
    fileCount: files.length,
    top10: files.slice(0, 10).map(f => ({
      name: f.name.length > 40 ? f.name.slice(0, 37) + '...' : f.name,
      kb: Math.round(f.size / 1024),
    })),
    over100kb: files.filter(f => f.size > 100 * 1024).length,
    over500kb: files.filter(f => f.size > 500 * 1024).length,
  };
}

// ── 2. API Endpoint Timing ────────────────────────────────────────────────
async function measureApi() {
  const headers = TOKEN ? { 'Authorization': `Bearer ${TOKEN}` } : {};

  // First get a project ID if we have a token
  let projectId = null;
  if (TOKEN) {
    try {
      const r = await fetch(`${API_BASE}/api/v1/projects/`, { headers });
      const d = await r.json();
      projectId = d?.data?.[0]?.id;
    } catch {}
  }

  const endpoints = [
    { name: 'health', url: `${API_BASE}/health`, auth: false },
    { name: 'organizations', url: `${API_BASE}/api/v1/organizations/`, auth: true },
    { name: 'projects', url: `${API_BASE}/api/v1/projects/`, auth: true },
    ...(projectId ? [
      { name: 'content/ls', url: `${API_BASE}/api/v1/content/${projectId}/ls`, auth: true },
      { name: 'content/tree', url: `${API_BASE}/api/v1/content/${projectId}/tree`, auth: true },
      { name: 'content/commits', url: `${API_BASE}/api/v1/content/${projectId}/commits`, auth: true },
    ] : []),
    { name: 'sync/connectors', url: `${API_BASE}/api/v1/sync/connectors`, auth: true },
  ];

  const results = [];
  for (const ep of endpoints) {
    if (ep.auth && !TOKEN) continue;
    const h = ep.auth ? headers : {};
    const t = await timed(() => fetchUrl(ep.url, { headers: h }));
    results.push({ name: ep.name, ...t });
  }
  return results;
}

// ── 3. Next.js Page Timing ────────────────────────────────────────────────
async function measurePages() {
  const pages = [
    { name: 'login', path: '/login' },
    { name: 'home (unauthed)', path: '/home' },
  ];

  const results = [];
  for (const page of pages) {
    const url = `${FRONTEND_BASE}${page.path}`;
    const t = await timed(() => fetchUrl(url, { headers: { Accept: 'text/html' } }), 3);
    results.push({ name: page.name, ...t });
  }
  return results;
}

// ── 4. Request Waterfall Analysis (via HAR-style timing) ──────────────────
async function analyzeWaterfall() {
  if (!TOKEN) return null;

  const headers = { 'Authorization': `Bearer ${TOKEN}` };

  // Fire all typical page-load requests in parallel and serial to measure both
  const endpoints = [
    () => fetch(`${API_BASE}/api/v1/organizations/`, { headers }),
    () => fetch(`${API_BASE}/api/v1/projects/`, { headers }),
    () => fetch(`${API_BASE}/api/v1/sync/connectors`, { headers }),
  ];

  // Serial (current Next.js SSR waterfall)
  const serialStart = performance.now();
  for (const fn of endpoints) { try { await fn(); } catch {} }
  const serialMs = Math.round(performance.now() - serialStart);

  // Parallel (ideal)
  const parallelStart = performance.now();
  await Promise.allSettled(endpoints.map(fn => fn()));
  const parallelMs = Math.round(performance.now() - parallelStart);

  return { serialMs, parallelMs, potentialSaving: serialMs - parallelMs };
}

// ── Render ─────────────────────────────────────────────────────────────────
function bar(ms, scale = 20, maxMs = 1000) {
  const filled = Math.round((ms / maxMs) * scale);
  const color = ms < 200 ? '\x1b[32m' : ms < 500 ? '\x1b[33m' : '\x1b[31m';
  return color + '█'.repeat(Math.min(filled, scale)) + '\x1b[0m';
}

function printRow(name, t) {
  const nameStr = name.padEnd(22);
  const stats = `avg=${String(t.avg).padStart(4)}ms  min=${String(t.min).padStart(4)}ms  max=${String(t.max).padStart(4)}ms`;
  console.log(`  ${nameStr} ${stats}  ${bar(t.avg)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('\x1b[1m═══════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m  PuppyOne Frontend Performance Benchmark\x1b[0m');
  console.log(`  API:      ${API_BASE}`);
  console.log(`  Frontend: ${FRONTEND_BASE}`);
  console.log(`  Repeat:   ${REPEAT}x per endpoint`);
  if (!TOKEN) console.log('  \x1b[33m⚠ No --token: skipping auth-required endpoints\x1b[0m');
  console.log('\x1b[1m═══════════════════════════════════════════════════════\x1b[0m\n');

  // ── 1. Bundles ──
  console.log('\x1b[1m── 1. JS Bundle Sizes (.next/static/chunks) ────────────\x1b[0m');
  const bundles = await analyzeBundles();
  if (!bundles) {
    console.log('  ⚠ No .next dir found. Run: cd frontend && npm run build\n');
  } else {
    console.log(`  Total JS: ${bundles.totalKB}KB across ${bundles.fileCount} chunks`);
    console.log(`  Chunks >100KB: ${bundles.over100kb}   Chunks >500KB: ${bundles.over500kb}`);
    console.log('  Top 10 largest:');
    bundles.top10.forEach(c => {
      const sizeStr = String(c.kb).padStart(5) + 'KB';
      const flag = c.kb > 500 ? ' \x1b[31m⚠ LARGE\x1b[0m' : c.kb > 200 ? ' \x1b[33m△\x1b[0m' : '';
      console.log(`    ${sizeStr}  ${c.name}${flag}`);
    });
    console.log();
  }

  // ── 2. API Timing ──
  console.log('\x1b[1m── 2. Backend API Timing ───────────────────────────────\x1b[0m');
  const apiResults = await measureApi();
  apiResults.forEach(r => printRow(r.name, r));
  console.log();

  // ── 3. Page Timing ──
  console.log('\x1b[1m── 3. Next.js Page Response Time (SSR) ────────────────\x1b[0m');
  const pageResults = await measurePages();
  pageResults.forEach(r => printRow(r.name, r));
  console.log();

  // ── 4. Waterfall ──
  const waterfall = await analyzeWaterfall();
  if (waterfall) {
    console.log('\x1b[1m── 4. Request Waterfall Analysis ───────────────────────\x1b[0m');
    console.log(`  Serial (current SSR pattern):   ${waterfall.serialMs}ms`);
    console.log(`  Parallel (if all concurrent):   ${waterfall.parallelMs}ms`);
    const saving = waterfall.potentialSaving;
    if (saving > 100) {
      console.log(`  \x1b[33m⚠ Potential saving: ${saving}ms by parallelizing page-load requests\x1b[0m`);
    } else {
      console.log(`  ✓ Requests are well-parallelized (saving only ${saving}ms)`);
    }
    console.log();
  }

  // ── 5. Recommendations ──
  console.log('\x1b[1m── 5. Detected Issues ──────────────────────────────────\x1b[0m');
  const issues = [];

  if (bundles?.over500kb > 0)
    issues.push(`${bundles.over500kb} chunk(s) >500KB — split with dynamic import()`);
  if (bundles?.totalKB > 3000)
    issues.push(`Total JS ${bundles.totalKB}KB is large — tree-shake or split`);

  const slowApis = apiResults.filter(r => r.avg > 400);
  if (slowApis.length) issues.push(`Slow APIs: ${slowApis.map(r => `${r.name}(${r.avg}ms)`).join(', ')}`);

  const slowPages = pageResults.filter(r => r.avg > 1000);
  if (slowPages.length) issues.push(`Slow pages (SSR): ${slowPages.map(r => r.name).join(', ')}`);

  if (waterfall?.potentialSaving > 200)
    issues.push(`${waterfall.potentialSaving}ms wasted on serial requests — parallelize data fetching`);

  if (issues.length === 0) {
    console.log('  ✓ No major issues detected');
  } else {
    issues.forEach((iss, i) => console.log(`  ${i+1}. \x1b[33m${iss}\x1b[0m`));
  }

  console.log();
  console.log('  Next steps:');
  console.log('    • npx next build --profile  (bundle analysis)');
  console.log('    • Chrome DevTools → Performance tab → record page load');
  console.log('    • React DevTools Profiler → find re-render hotspots during streaming');
  console.log('\x1b[1m═══════════════════════════════════════════════════════\x1b[0m\n');
}

main().catch(e => { console.error(e); process.exit(1); });
