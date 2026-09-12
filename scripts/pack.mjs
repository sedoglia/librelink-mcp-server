#!/usr/bin/env node
/**
 * Builds the release bundle: releases/librelink-mcp-server.mcpb plus its
 * .sha256, in the format `sha256sum -c` expects (the README tells users to
 * verify the download that way).
 *
 * `mcpb pack` zips whatever is in node_modules, so the bundle is packed after
 * an `npm ci --omit=dev`: v1.5.0 shipped typescript and @types/* and weighed
 * 8.3 MB, the prod-only v1.5.1 bundle 4.5 MB. The smoke test runs against that
 * prod-only tree, so a runtime import of a dev dependency fails here rather
 * than on a user's machine. Dev dependencies are reinstalled at the end
 * (also on failure), leaving the working tree as it was.
 *
 * Wrapped in Node rather than a shell one-liner so it behaves the same on
 * Windows, where npm scripts run under cmd.exe and sha256sum does not exist.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'releases');
const bundleName = 'librelink-mcp-server.mcpb';
const bundle = join(outDir, bundleName);

// Pinned so two maintainers packing the same commit get the same layout.
const MCPB = '@anthropic-ai/mcpb@2.1.2';

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
  }
}

let failed = false;
try {
  // Full install first: tsc is a dev dependency.
  run('npm', ['ci']);
  run('npm', ['run', 'build']);

  run('npm', ['ci', '--omit=dev']);
  run('node', ['scripts/smoke-test.mjs']);

  mkdirSync(outDir, { recursive: true });
  rmSync(bundle, { force: true });
  rmSync(`${bundle}.sha256`, { force: true });
  run('npx', ['--yes', MCPB, 'pack', '.', `releases/${bundleName}`]);

  const digest = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  // Binary-mode marker (`*`), same line sha256sum itself prints.
  writeFileSync(`${bundle}.sha256`, `${digest} *${bundleName}\n`);

  console.log(`\n✓ ${bundle}`);
  console.log(`✓ sha256 ${digest}`);
} catch (error) {
  failed = true;
  console.error(`\n✗ ${error.message}`);
} finally {
  run('npm', ['ci']);
}

process.exit(failed ? 1 : 0);
