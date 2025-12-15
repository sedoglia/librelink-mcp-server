#!/usr/bin/env node

/**
 * CLI Configuration Tool for LibreLink MCP Server
 *
 * Usage: npm run configure
 *
 * Credentials are stored securely using:
 * - AES-256-GCM encryption for data at rest
 * - Encryption keys stored in OS keychain via Keytar
 */

import * as readline from 'readline';
import { ConfigManager } from './config.js';
import { LibreLinkClient } from './librelink-client.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

function questionHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let password = '';

    const onData = (char: Buffer) => {
      const c = char.toString('utf8');

      switch (c) {
        case '\n':
        case '\r':
        case '\u0004':
          if (stdin.isTTY) {
            stdin.setRawMode(wasRaw);
          }
          stdin.removeListener('data', onData);
          console.log('');
          resolve(password);
          break;
        case '\u0003':
          process.exit();
          break;
        case '\u007F':
        case '\b':
          password = password.slice(0, -1);
          break;
        default:
          password += c;
          process.stdout.write('*');
          break;
      }
    };

    stdin.on('data', onData);
    stdin.resume();
  });
}

async function main() {
  console.log('');
  console.log('LibreLink MCP Server Configuration');
  console.log('===================================');
  console.log('');
  console.log('This tool will configure your LibreLink credentials.');
  console.log('');
  console.log('SECURITY: Your credentials are stored securely using:');
  console.log('  - AES-256-GCM encryption for data at rest');
  console.log('  - Encryption keys stored in your OS keychain');
  console.log('');
  console.log('IMPORTANT: Use your LibreLinkUp credentials (not LibreLink)');
  console.log('  - LibreLinkUp is the follower/sharing app');
  console.log('  - Make sure data sharing is enabled in the LibreLink app');
  console.log('');

  const configManager = new ConfigManager();

  // Try to migrate legacy config
  const migrated = await configManager.migrateFromLegacy();
  if (migrated) {
    console.log('Migrated existing credentials to secure storage.');
    console.log('');
  }

  // Load existing credentials
  await configManager.loadCredentials();
  const existingCredentials = await configManager.getCredentials();
  const ranges = configManager.getTargetRanges();
  const region = configManager.getRegion();

  // Get email
  const emailPrompt = existingCredentials?.email
    ? `Email [${existingCredentials.email}]: `
    : 'Email: ';
  let email = await question(emailPrompt);
  if (!email && existingCredentials?.email) {
    email = existingCredentials.email;
  }

  if (!email) {
    console.log('Email is required');
    rl.close();
    process.exit(1);
  }

  // Get password
  console.log('');
  const passwordPrompt = existingCredentials?.password
    ? 'Password (press Enter to keep existing): '
    : 'Password: ';
  let password = await questionHidden(passwordPrompt);
  if (!password && existingCredentials?.password) {
    password = existingCredentials.password;
    console.log('(keeping existing password)');
  }

  if (!password) {
    console.log('Password is required');
    rl.close();
    process.exit(1);
  }

  // Get region
  console.log('');
  console.log('Region options:');
  console.log('  EU - Europe (default)');
  console.log('  US - United States');
  console.log('  DE - Germany');
  console.log('  FR - France');
  console.log('  AP - Asia Pacific');
  console.log('  AU - Australia');
  console.log('');

  const regionPrompt = `Region [${region}]: `;
  let newRegion = (await question(regionPrompt)).toUpperCase() as 'EU' | 'US' | 'DE' | 'FR' | 'AP' | 'AU';
  if (!newRegion) {
    newRegion = region;
  }

  const validRegions = ['EU', 'US', 'DE', 'FR', 'AP', 'AU'];
  if (!validRegions.includes(newRegion)) {
    console.log(`Invalid region. Must be one of: ${validRegions.join(', ')}`);
    rl.close();
    process.exit(1);
  }

  // Get target ranges
  console.log('');
  console.log('Target glucose ranges (mg/dL):');

  const lowPrompt = `Target Low [${ranges.targetLow}]: `;
  const lowInput = await question(lowPrompt);
  const targetLow = lowInput ? parseInt(lowInput, 10) : ranges.targetLow;

  const highPrompt = `Target High [${ranges.targetHigh}]: `;
  const highInput = await question(highPrompt);
  const targetHigh = highInput ? parseInt(highInput, 10) : ranges.targetHigh;

  if (targetLow >= targetHigh) {
    console.log('Target low must be less than target high');
    rl.close();
    process.exit(1);
  }

  // Save configuration
  console.log('');
  console.log('Saving configuration...');

  try {
    // Save credentials securely
    await configManager.updateCredentials(email, password);

    // Save other settings
    configManager.updateRegion(newRegion);
    configManager.updateRanges(targetLow, targetHigh);

    const paths = configManager.getSecureStoragePaths();
    console.log('Configuration saved!');
    console.log('');
    console.log('Storage locations:');
    console.log(`  Encrypted credentials: ${paths.credentialsPath}`);
    console.log(`  Encryption key: Stored in OS keychain`);
    console.log(`  Settings: ${configManager.getConfigPath()}`);
  } catch (error) {
    console.log(`Failed to save configuration: ${error}`);
    rl.close();
    process.exit(1);
  }

  // Test connection
  console.log('');
  console.log('Testing connection to LibreLinkUp...');

  try {
    const config = await configManager.getConfig();
    const client = new LibreLinkClient(config, configManager);
    await client.validateConnection();

    console.log('Connection successful!');

    const glucose = await client.getCurrentGlucose();
    const sessionStatus = client.getSessionStatus();

    console.log('');
    console.log('Current glucose reading:');
    console.log(`  Value: ${glucose.value} mg/dL`);
    console.log(`  Trend: ${glucose.trend}`);
    console.log(`  Status: ${glucose.color === 'green' ? 'In Range' : glucose.color === 'red' ? 'Critical' : 'Out of Range'}`);
    console.log('');
    console.log('Session info:');
    console.log(`  Token valid until: ${sessionStatus.expiresAt?.toLocaleString() || 'N/A'}`);

  } catch (error) {
    console.log(`Connection failed: ${error}`);
    console.log('');
    console.log('Troubleshooting:');
    console.log('  1. Verify your email and password are correct');
    console.log('  2. Make sure you are using LibreLinkUp credentials');
    console.log('  3. Open the LibreLinkUp app and accept any Terms & Conditions');
    console.log('  4. Ensure someone is sharing data with you (or share your own data)');
    console.log('  5. Check that your region setting is correct');
    rl.close();
    process.exit(1);
  }

  console.log('');
  console.log('Configuration complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Add the server to Claude Desktop configuration');
  console.log('  2. Restart Claude Desktop');
  console.log('  3. Ask Claude about your glucose levels!');

  rl.close();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
