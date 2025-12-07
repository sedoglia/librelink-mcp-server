#!/usr/bin/env node

/**
 * CLI Configuration Tool for LibreLink MCP Server
 * 
 * Usage: npm run configure
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
  console.log('🩸 LibreLink MCP Server Configuration');
  console.log('=====================================');
  console.log('');
  console.log('This tool will configure your LibreLink credentials.');
  console.log('Your credentials are stored locally at ~/.librelink-mcp/config.json');
  console.log('');
  console.log('⚠️  IMPORTANT: Use your LibreLinkUp credentials (not LibreLink)');
  console.log('   - LibreLinkUp is the follower/sharing app');
  console.log('   - Make sure data sharing is enabled in the LibreLink app');
  console.log('');

  const configManager = new ConfigManager();
  const currentConfig = configManager.getConfig();

  // Get email
  const emailPrompt = currentConfig.email 
    ? `Email [${currentConfig.email}]: ` 
    : 'Email: ';
  let email = await question(emailPrompt);
  if (!email && currentConfig.email) {
    email = currentConfig.email;
  }

  if (!email) {
    console.log('❌ Email is required');
    rl.close();
    process.exit(1);
  }

  // Get password
  console.log('');
  const password = await questionHidden('Password: ');

  if (!password) {
    console.log('❌ Password is required');
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
  
  const regionPrompt = `Region [${currentConfig.region}]: `;
  let region = (await question(regionPrompt)).toUpperCase() as 'EU' | 'US' | 'DE' | 'FR' | 'AP' | 'AU';
  if (!region) {
    region = currentConfig.region;
  }

  const validRegions = ['EU', 'US', 'DE', 'FR', 'AP', 'AU'];
  if (!validRegions.includes(region)) {
    console.log(`❌ Invalid region. Must be one of: ${validRegions.join(', ')}`);
    rl.close();
    process.exit(1);
  }

  // Get target ranges
  console.log('');
  console.log('Target glucose ranges (mg/dL):');
  
  const lowPrompt = `Target Low [${currentConfig.targetLow}]: `;
  const lowInput = await question(lowPrompt);
  const targetLow = lowInput ? parseInt(lowInput, 10) : currentConfig.targetLow;

  const highPrompt = `Target High [${currentConfig.targetHigh}]: `;
  const highInput = await question(highPrompt);
  const targetHigh = highInput ? parseInt(highInput, 10) : currentConfig.targetHigh;

  if (targetLow >= targetHigh) {
    console.log('❌ Target low must be less than target high');
    rl.close();
    process.exit(1);
  }

  // Save configuration
  console.log('');
  console.log('Saving configuration...');
  
  try {
    configManager.updateCredentials(email, password);
    configManager.updateRegion(region);
    configManager.updateRanges(targetLow, targetHigh);
    console.log(`✅ Configuration saved to ${configManager.getConfigPath()}`);
  } catch (error) {
    console.log(`❌ Failed to save configuration: ${error}`);
    rl.close();
    process.exit(1);
  }

  // Test connection
  console.log('');
  console.log('Testing connection to LibreLinkUp...');
  
  try {
    const client = new LibreLinkClient(configManager.getConfig());
    await client.validateConnection();
    
    console.log('✅ Connection successful!');
    
    const glucose = await client.getCurrentGlucose();
    console.log('');
    console.log('Current glucose reading:');
    console.log(`  Value: ${glucose.value} mg/dL`);
    console.log(`  Trend: ${glucose.trend}`);
    console.log(`  Status: ${glucose.color === 'green' ? 'In Range' : glucose.color === 'red' ? 'Critical' : 'Out of Range'}`);
    
  } catch (error) {
    console.log(`❌ Connection failed: ${error}`);
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
  console.log('🎉 Configuration complete!');
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
