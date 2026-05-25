#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanRoots = [
  'app',
  'components',
  'lib',
  'styles',
  'tailwind.config.cjs',
].map((p) => path.join(root, p));

const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.cjs', '.mjs']);

const bannedFonts = [
  'Plus Jakarta Sans',
  'JetBrains Mono',
  'SFMono-Regular',
  'SF Mono',
  'Fira Code',
  'Cascadia Code',
  'Cascadia Mono',
  'Monaco',
  'Consolas',
  'Liberation Mono',
  'Courier New',
  'Inter',
  'SF Pro Text',
  'sans-serif',
  'ui-monospace',
  'monospace',
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
];

const declarationPattern = /(fontFamily|font-family|fontSans|fontMono|fontFamily\s*:|font-family\s*:)[^\n;}]*/i;
const bannedPattern = new RegExp(bannedFonts.map(escapeRegExp).join('|'), 'i');

const findings = [];

for (const file of collectFiles(scanRoots)) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    if (/\b(JetBrains_Mono|Plus_Jakarta_Sans)\b/.test(line)) {
      findings.push({ file: rel, line: index + 1, reason: 'non-Geist font import', text: trimmed });
      return;
    }

    if (declarationPattern.test(line) && bannedPattern.test(line)) {
      findings.push({ file: rel, line: index + 1, reason: 'non-standard font declaration', text: trimmed });
    }
  });
}

if (findings.length > 0) {
  console.error('Found non-standard font usage:');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}: ${finding.reason}: ${finding.text}`);
  }
  process.exit(1);
}

console.log('Font family audit passed.');

function collectFiles(entries) {
  const files = [];
  for (const entry of entries) {
    if (!fs.existsSync(entry)) continue;
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(entry)) {
        if (child === 'node_modules' || child === '.next') continue;
        files.push(...collectFiles([path.join(entry, child)]));
      }
    } else if (sourceExts.has(path.extname(entry))) {
      files.push(entry);
    }
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
