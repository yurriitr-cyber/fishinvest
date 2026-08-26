#!/usr/bin/env node
/**
 * Production API entry: migrate → optional seed → start Nest.
 * Set RUN_SEED=false to skip seeding (seed is idempotent upserts by default).
 */
import { spawnSync } from 'node:child_process';

function run(label, command, args) {
  console.log(`[start-api] ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('prisma migrate deploy', 'pnpm', [
  '--filter',
  '@rare-fish/db',
  'exec',
  'prisma',
  'migrate',
  'deploy',
]);

if (process.env.RUN_SEED !== 'false') {
  run('db seed', 'pnpm', ['--filter', '@rare-fish/db', 'seed']);
}

run('api start', 'pnpm', ['--filter', '@rare-fish/api', 'start']);
