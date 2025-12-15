/**
 * Test script for Secure Storage Module
 *
 * This tests the encryption, decryption, and keychain functionality
 * without requiring actual LibreLink credentials.
 */

import { SecureStorage } from './dist/secure-storage.js';

async function testSecureStorage() {
  console.log('Testing Secure Storage Module');
  console.log('==============================\n');

  const storage = new SecureStorage();
  const paths = storage.getStoragePaths();

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

  console.log('\n==============================');
  console.log('All tests passed!');
  console.log('==============================');

  return true;
}

// Run tests
testSecureStorage()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Test error:', error);
    process.exit(1);
  });
