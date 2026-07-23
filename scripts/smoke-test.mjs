#!/usr/bin/env node
/**
 * Credential-free smoke test: starts the built server over stdio and checks it
 * speaks MCP. Only initialize and tools/list are exercised, so nothing touches
 * the keychain or the LibreLink API — this can run on CI with no secrets.
 *
 * Exits non-zero on any mismatch so a dependency bump that breaks the server
 * fails the build instead of reaching main.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'dist', 'index.js');

const EXPECTED_TOOLS = [
  'get_current_glucose',
  'get_glucose_history',
  'get_glucose_stats',
  'get_glucose_trends',
  'get_sensor_info',
  'configure_credentials',
  'configure_ranges',
  'validate_connection',
  'get_session_status',
  'clear_session'
];

const TIMEOUT_MS = 30000;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const child = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'pipe'],
  // Point config at a throwaway dir so a developer's real config is never read.
  env: { ...process.env, LOCALAPPDATA: undefined, XDG_CONFIG_HOME: join(root, '.smoke-tmp') }
});

const timer = setTimeout(() => {
  child.kill();
  fail(`server did not respond within ${TIMEOUT_MS}ms`);
}, TIMEOUT_MS);

let stdout = '';
let stderr = '';
child.stdout.on('data', (c) => (stdout += c));
child.stderr.on('data', (c) => (stderr += c));
child.on('error', (err) => fail(`failed to spawn server: ${err.message}`));

const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '1.0' }
  }
});
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
child.stdin.end();

child.on('close', (code) => {
  clearTimeout(timer);

  const responses = new Map();
  for (const line of stdout.split('\n').filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    } catch {
      // The server may interleave non-JSON output; ignore it here and let the
      // per-response assertions below decide whether the run was healthy.
    }
  }

  const init = responses.get(1);
  if (!init?.result?.serverInfo) {
    fail(`initialize failed (exit ${code})\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  console.log(`✓ initialize -> ${init.result.serverInfo.name} ${init.result.serverInfo.version}`);

  // The version reported over MCP must match package.json, or clients show a
  // version the maintainer never released.
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (init.result.serverInfo.version !== pkg.version) {
    fail(`version mismatch: MCP reports ${init.result.serverInfo.version}, package.json says ${pkg.version}`);
  }
  console.log(`✓ version matches package.json (${pkg.version})`);

  const tools = responses.get(2)?.result?.tools;
  if (!Array.isArray(tools)) {
    fail(`tools/list failed (exit ${code})\nstdout: ${stdout}\nstderr: ${stderr}`);
  }

  const names = tools.map((t) => t.name);
  const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t));
  if (missing.length) fail(`missing tools: ${missing.join(', ')}`);
  console.log(`✓ tools/list -> all ${EXPECTED_TOOLS.length} tools present`);

  console.log('\nSmoke test passed.');
});
