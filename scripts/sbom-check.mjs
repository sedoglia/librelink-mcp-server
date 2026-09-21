#!/usr/bin/env node
/**
 * Fails when the committed sbom.cdx.json no longer describes package-lock.json.
 *
 * The SBOM is generated from the lockfile alone and in reproducible mode, so
 * regenerating it on the same lockfile yields the same inventory. CI runs
 * this on every push and PR: a dependency bump that lands without
 * `npm run sbom` is caught here instead of shipping a stale SBOM.
 *
 * metadata.tools records the npm and generator versions that produced the
 * file. Those differ between a maintainer's machine and the CI matrix (Node
 * 22 and 24 bundle different npm releases) without the inventory changing,
 * so they are left out of the comparison.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'sbom.cdx.json');

function inventory(json) {
  const bom = JSON.parse(json);
  delete bom.metadata?.tools;
  return JSON.stringify(bom);
}

if (!existsSync(file)) {
  console.error('✗ sbom.cdx.json is missing: run `npm run sbom` and commit the result.');
  process.exit(1);
}
const before = readFileSync(file, 'utf8');

// Overwrites sbom.cdx.json in place, which is the file `npm run sbom` targets.
const result = spawnSync('npm', ['run', 'sbom'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
const after = readFileSync(file, 'utf8');

if (inventory(before) !== inventory(after)) {
  console.error('\n✗ sbom.cdx.json is out of date: package-lock.json changed without `npm run sbom` being re-run. Commit the regenerated file.');
  process.exit(1);
}
console.log('\n✓ sbom.cdx.json matches package-lock.json');
