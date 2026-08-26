#!/usr/bin/env node
/**
 * Bundle apps/admin into apps/web/dist/admin for production (/admin/).
 * Works with Dockerfile.web and Railway Railpack (which ignores Dockerfile).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, '..');
const adminRoot = join(webRoot, '..', 'admin');
const adminDist = join(adminRoot, 'dist');
const outDir = join(webRoot, 'dist', 'admin');
const adminVite = join(adminRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const rootVite = join(webRoot, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js');

function run(cmd, args, cwd) {
  console.log(`[bundle-admin] $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (r.error) {
    console.error('[bundle-admin]', r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }
}

console.log('[bundle-admin] building admin UI…');
if (existsSync(adminVite)) {
  run(process.execPath, [adminVite, 'build'], adminRoot);
} else if (existsSync(rootVite)) {
  run(process.execPath, [rootVite, 'build'], adminRoot);
} else {
  run('npx', ['--yes', 'vite', 'build'], adminRoot);
}

if (!existsSync(join(adminDist, 'index.html'))) {
  console.error('[bundle-admin] missing', join(adminDist, 'index.html'));
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(adminDist, outDir, { recursive: true });
console.log('[bundle-admin] OK →', outDir);
