#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const storiesArg = process.argv[2];
if (!storiesArg) {
  console.error('usage: publish.mjs <stories.json>');
  process.exit(1);
}

const root = resolve('.');
const cloudPath = resolve(root, 'data/cloud.json');
if (!existsSync(cloudPath)) {
  console.error('cloud not configured, skip');
  process.exit(0);
}

function extractWorkersUrl(stdout) {
  const match = String(stdout).match(/https:\/\/[^\s"'<>]+\.workers\.dev/);
  if (!match) throw new Error('wrangler deploy output did not include a workers.dev URL');
  return match[0].replace(/\/+$/, '');
}

try {
  const storiesPath = resolve(root, storiesArg);
  const stories = JSON.parse(readFileSync(storiesPath, 'utf8'));
  const date = String(stories.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('stories.json date must be YYYY-MM-DD');

  const outputRoot = resolve(root, 'output');
  mkdirSync(outputRoot, { recursive: true });

  const assetsIgnorePath = join(outputRoot, '.assetsignore');
  if (!existsSync(assetsIgnorePath)) {
    writeFileSync(assetsIgnorePath, '*.json\n*.md\n.DS_Store\n');
  }

  if (!existsSync(join(outputRoot, 'index.html'))) {
    execFileSync(process.execPath, ['scripts/index.mjs'], {
      cwd: root,
      stdio: 'inherit'
    });
  }

  const stdout = execFileSync('npx', ['wrangler', 'deploy'], {
    cwd: resolve(root, 'cloud'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const baseUrl = extractWorkersUrl(stdout);
  console.log(JSON.stringify({ ok: true, url: `${baseUrl}/${date}/report.html` }));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
