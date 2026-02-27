/**
 * E2E Scenario Runner (Stagehand)
 *
 *   node run.mjs                          # run all scenarios
 *   node run.mjs --scenario connect-gmail # run one
 *   node run.mjs --publish                # run all + copy to puppydoc
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStagehand } from './lib/browser.mjs';
import { parseMarkdownScenario } from './lib/parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(__dirname, 'scenarios');
const RESULTS_DIR = path.join(__dirname, 'results');
const PUBLISH_DIR = path.join(__dirname, '../puppydoc/public/screenshots');

async function loadScenarios(filter) {
  const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.md') || f.endsWith('.mjs'));
  const scenarios = [];
  for (const file of files) {
    const ext = path.extname(file);
    const name = file.replace(ext, '');
    if (filter && name !== filter) continue;

    if (ext === '.md') {
      const parsed = parseMarkdownScenario(path.join(SCENARIOS_DIR, file));
      scenarios.push({ name, ...parsed });
    } else {
      const mod = await import(path.join(SCENARIOS_DIR, file));
      scenarios.push({ name, ...mod.default });
    }
  }
  return scenarios;
}

async function runScenario(scenario, scenarioDir) {
  console.log(`\n▶ ${scenario.name}: ${scenario.description}`);
  const { stagehand, page } = await createStagehand();
  const results = [];

  try {
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const stepNum = String(i + 1).padStart(2, '0');
      const screenshotPath = path.join(scenarioDir, `${stepNum}-${step.name}.png`);

      console.log(`  ${stepNum}. ${step.name}...`);
      const t = Date.now();

      try {
        await step.action({ stagehand, page });
        await page.waitForTimeout(step.waitAfter || 1000);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        const elapsed = Date.now() - t;
        console.log(`     📸 ${elapsed}ms`);
        results.push({ step: step.name, screenshot: screenshotPath, elapsed, ok: true });
      } catch (err) {
        const elapsed = Date.now() - t;
        console.log(`     ❌ ${elapsed}ms — ${err.message}`);
        try { await page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
        results.push({ step: step.name, screenshot: screenshotPath, elapsed, ok: false, error: err.message });
      }
    }
  } finally {
    await stagehand.close();
  }

  return results;
}

function publishResults(allResults) {
  console.log('\n📤 Publishing to puppydoc/public/screenshots/...');
  for (const [scenarioName, results] of Object.entries(allResults)) {
    const destDir = path.join(PUBLISH_DIR, scenarioName);
    fs.mkdirSync(destDir, { recursive: true });
    for (const r of results) {
      if (!r.ok) continue;
      const filename = path.basename(r.screenshot);
      const dest = path.join(destDir, filename);
      fs.copyFileSync(r.screenshot, dest);
      console.log(`   ${scenarioName}/${filename}`);
    }
  }
  console.log('✅ Published. MDX: /screenshots/<scenario>/<step>.png');
}

async function main() {
  const args = process.argv.slice(2);
  const scenarioFilter = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null;
  const shouldPublish = args.includes('--publish');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultsDir = path.join(RESULTS_DIR, timestamp);

  const scenarios = await loadScenarios(scenarioFilter);
  if (!scenarios.length) {
    console.error('No scenarios found.');
    process.exit(1);
  }

  console.log(`🧪 ${scenarios.length} scenario(s)`);

  const allResults = {};

  for (const scenario of scenarios) {
    const scenarioDir = path.join(resultsDir, scenario.name);
    fs.mkdirSync(scenarioDir, { recursive: true });
    allResults[scenario.name] = await runScenario(scenario, scenarioDir);
  }

  fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(allResults, null, 2));

  console.log('\n' + '='.repeat(50));
  let totalPass = 0, totalFail = 0;
  for (const [name, results] of Object.entries(allResults)) {
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    totalPass += passed;
    totalFail += failed;
    console.log(`${failed === 0 ? '✅' : '❌'} ${name}: ${passed}/${results.length}`);
  }
  console.log(`\n${totalPass} passed, ${totalFail} failed`);
  console.log(`📁 ${resultsDir}`);

  if (shouldPublish && totalFail === 0) {
    publishResults(allResults);
  } else if (shouldPublish && totalFail > 0) {
    console.log('\n⚠️  Skipped publish — fix failures first.');
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
