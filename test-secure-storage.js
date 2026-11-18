/**
 * Test script for Secure Storage Module
 *
 * This tests the encryption, decryption, and keychain functionality
 * without requiring actual LibreLink credentials.
 *
 * Isolation: the test writes to a fresh temporary directory and uses its own
 * keychain service name, so it never reads, overwrites or deletes the real
 * credentials.enc / token.enc or the real "librelink-mcp-server" keychain key.
 * Everything it creates is removed on exit, pass or fail.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { SecureStorage } from './dist/secure-storage.js';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'librelink-mcp-test-'));
const TEST_SERVICE = `librelink-mcp-server-test-${process.pid}`;
const MIGRATION_DIR = join(TEST_DIR, 'migration');
const MIGRATION_SERVICE = `${TEST_SERVICE}-migration`;

async function testSecureStorage() {
  console.log('Testing Secure Storage Module');
  console.log('==============================\n');

  const storage = new SecureStorage({ configDir: TEST_DIR, keychainService: TEST_SERVICE });
  const paths = storage.getStoragePaths();

  // Refuse to run unless every path is inside the throwaway directory: this
  // test calls clearAll(), which would wipe a real setup.
  for (const p of Object.values(paths)) {
    if (!resolve(p).startsWith(resolve(TEST_DIR) + sep) && resolve(p) !== resolve(TEST_DIR)) {
      throw new Error(`Refusing to run: ${p} is outside the test directory ${TEST_DIR}`);
    }
  }

  console.log('Storage paths:');
  console.log(`  Config dir: ${paths.configDir}`);
  console.log(`  Credentials: ${paths.credentialsPath}`);
  console.log(`  Token: ${paths.tokenPath}`);
  console.log('');

  // Test 1: Save and retrieve credentials
  console.log('Test 1: Save and retrieve credentials');
  console.log('-------------------------------------');

  const testCredentials = {
    email: 'test@example.com',
    password: 'test_password_123!'
  };

  try {
    await storage.saveCredentials(testCredentials);
    console.log('  [OK] Credentials saved successfully');
  } catch (error) {
    console.log(`  [FAIL] Error saving credentials: ${error.message}`);
    return false;
  }

  try {
    const retrieved = await storage.getCredentials();
    if (retrieved && retrieved.email === testCredentials.email && retrieved.password === testCredentials.password) {
      console.log('  [OK] Credentials retrieved and match original');
    } else {
      console.log('  [FAIL] Retrieved credentials do not match');
      return false;
    }
  } catch (error) {
    console.log(`  [FAIL] Error retrieving credentials: ${error.message}`);
    return false;
  }

  // Test 2: Save and retrieve token
  console.log('\nTest 2: Save and retrieve token');
  console.log('-------------------------------');

  const testToken = {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
    expires: Date.now() + (60 * 60 * 1000), // 1 hour from now
    userId: 'test-user-id-12345',
    accountId: 'abc123def456',
    region: 'EU'
  };

  try {
    await storage.saveToken(testToken);
    console.log('  [OK] Token saved successfully');
  } catch (error) {
    console.log(`  [FAIL] Error saving token: ${error.message}`);
    return false;
  }

  try {
    const retrievedToken = await storage.getToken();
    if (retrievedToken && retrievedToken.token === testToken.token && retrievedToken.userId === testToken.userId) {
      console.log('  [OK] Token retrieved and matches original');
    } else {
      console.log('  [FAIL] Retrieved token does not match');
      return false;
    }
  } catch (error) {
    console.log(`  [FAIL] Error retrieving token: ${error.message}`);
    return false;
  }

  // Test 3: Check token validity
  console.log('\nTest 3: Check token validity');
  console.log('----------------------------');

  const hasValid = await storage.hasValidToken();
  if (hasValid) {
    console.log('  [OK] Token is reported as valid (not expired)');
  } else {
    console.log('  [FAIL] Token should be valid but is not');
  }

  // Test 4: Clear token
  console.log('\nTest 4: Clear token');
  console.log('-------------------');

  try {
    await storage.clearToken();
    const afterClear = await storage.getToken();
    if (afterClear === null) {
      console.log('  [OK] Token cleared successfully');
    } else {
      console.log('  [FAIL] Token still exists after clearing');
      return false;
    }
  } catch (error) {
    console.log(`  [FAIL] Error clearing token: ${error.message}`);
    return false;
  }

  // Test 5: Expired token handling
  console.log('\nTest 5: Expired token handling');
  console.log('------------------------------');

  const expiredToken = {
    token: 'expired_token',
    expires: Date.now() - (60 * 60 * 1000), // 1 hour ago
    userId: 'test-user-id',
    accountId: 'abc123',
    region: 'EU'
  };

  try {
    await storage.saveToken(expiredToken);
    const retrievedExpired = await storage.getToken();
    if (retrievedExpired === null) {
      console.log('  [OK] Expired token correctly returned as null');
    } else {
      console.log('  [FAIL] Expired token should return null');
      return false;
    }
  } catch (error) {
    console.log(`  [FAIL] Error handling expired token: ${error.message}`);
    return false;
  }

  // Test 6: Clear all data
  console.log('\nTest 6: Clear all data');
  console.log('----------------------');

  try {
    await storage.clearAll();
    const afterClearAll = await storage.getCredentials();
    if (afterClearAll === null) {
      console.log('  [OK] All data cleared successfully');
    } else {
      console.log('  [FAIL] Credentials still exist after clearing all');
      return false;
    }
  } catch (error) {
    console.log(`  [FAIL] Error clearing all data: ${error.message}`);
    return false;
  }

  if (!(await keyMigrationTests())) {
    return false;
  }

  console.log('\n==============================');
  console.log('All tests passed!');
  console.log('==============================');

  return true;
}

/**
 * Tests 7-9: moving the master key from the fallback file to the keychain.
 * Skipped when keytar cannot load (no native module / no keychain).
 */
async function keyMigrationTests() {
  let keytar;
  try {
    keytar = createRequire(import.meta.url)('keytar');
    await keytar.getPassword(MIGRATION_SERVICE, 'probe');
  } catch {
    console.log('\nTests 7-9: keychain not available, skipped');
    return true;
  }

  const account = 'encryption-key';
  const keyFile = join(MIGRATION_DIR, '.encryption.key');
  const creds = { email: 'migrate@example.com', password: 'migrate_pw_456!' };
  const open = () => new SecureStorage({ configDir: MIGRATION_DIR, keychainService: MIGRATION_SERVICE });
  const check = (ok, msg) => {
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${msg}`);
    return ok;
  };

  // Encrypt credentials with a key that lands in the keychain, then capture it.
  await open().saveCredentials(creds);
  const key = await keytar.getPassword(MIGRATION_SERVICE, account);
  if (!check(Boolean(key), 'Fresh install stores its key in the keychain')) return false;

  console.log('\nTest 7: Key only in the fallback file (installs up to 1.6.1)');
  console.log('-------------------------------------------------------------');
  writeFileSync(keyFile, key);
  await keytar.deletePassword(MIGRATION_SERVICE, account);
  let got = await open().getCredentials();
  if (!check(got?.email === creds.email, 'Credentials still decrypt')) return false;
  if (!check((await keytar.getPassword(MIGRATION_SERVICE, account)) === key, 'Key moved into the keychain')) return false;
  if (!check(!existsSync(keyFile), 'Key file removed after the move')) return false;

  console.log('\nTest 8: Stale keychain key, working key in the file');
  console.log('---------------------------------------------------');
  writeFileSync(keyFile, key);
  await keytar.setPassword(MIGRATION_SERVICE, account, randomBytes(32).toString('hex'));
  got = await open().getCredentials();
  if (!check(got?.email === creds.email, 'Credentials decrypt with the file key')) return false;
  if (!check((await keytar.getPassword(MIGRATION_SERVICE, account)) === key, 'Keychain now holds the working key')) return false;
  if (!check(!existsSync(keyFile), 'Key file removed after the move')) return false;

  console.log('\nTest 9: Unrelated key file next to a working keychain key');
  console.log('---------------------------------------------------------');
  const unrelated = randomBytes(32).toString('hex');
  writeFileSync(keyFile, unrelated);
  got = await open().getCredentials();
  if (!check(got?.email === creds.email, 'Credentials decrypt with the keychain key')) return false;
  if (!check((await keytar.getPassword(MIGRATION_SERVICE, account)) === key, 'Keychain key unchanged')) return false;
  if (!check(existsSync(keyFile) && readFileSync(keyFile, 'utf8') === unrelated, 'Unrelated key file left untouched')) return false;

  return true;
}

// Remove the temp dir and the test keychain entries, whatever the outcome.
async function cleanup() {
  for (const [configDir, keychainService] of [[TEST_DIR, TEST_SERVICE], [MIGRATION_DIR, MIGRATION_SERVICE]]) {
    try {
      await new SecureStorage({ configDir, keychainService }).clearAll();
    } catch {
      // Best effort: the directory removal below still runs.
    }
  }
  rmSync(TEST_DIR, { recursive: true, force: true });
}

// Run tests
testSecureStorage()
  .catch((error) => {
    console.error('Test error:', error);
    return false;
  })
  .then(async (success) => {
    await cleanup();
    process.exit(success ? 0 : 1);
  });
