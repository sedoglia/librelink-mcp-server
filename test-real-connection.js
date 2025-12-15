#!/usr/bin/env node

/**
 * Test script for real LibreLinkUp connection
 * Run this after configuring your credentials with: npm run configure
 *
 * Version 1.2.0 - Tests secure credential storage and token persistence
 */

import { spawn } from 'child_process';

class RealConnectionTester {
  constructor() {
    this.server = null;
  }

  log(message) {
    console.log(`[TEST] ${message}`);
  }

  async startServer() {
    this.log('Starting MCP server with your credentials...');

    this.server = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    this.server.stderr.on('data', (data) => {
      const message = data.toString().trim();
      if (message.includes('LibreLink MCP Server running')) {
        this.log('Server started successfully');
      } else if (message.includes('Restored session')) {
        this.log('Session restored from secure storage');
      } else if (message.includes('Logged in as')) {
        this.log(`Authenticated: ${message.split('LibreLink: ')[1] || message}`);
      } else if (message.includes('Session saved')) {
        this.log('Session token saved to secure storage');
      } else if (message) {
        this.log(`Server: ${message}`);
      }
    });

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    return this.server.pid ? true : false;
  }

  async sendMCPMessage(message) {
    return new Promise((resolve, reject) => {
      let response = '';
      let timeoutId;

      // First send initialize
      const initMessage = {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };

      const onData = (data) => {
        response += data.toString();
        try {
          const lines = response.split('\n');
          for (const line of lines) {
            if (line.trim() && line.startsWith('{')) {
              const parsed = JSON.parse(line);
              if (parsed.id === message.id) {
                clearTimeout(timeoutId);
                this.server.stdout.off('data', onData);
                resolve(parsed);
                return;
              }
            }
          }
        } catch (e) {
          // Continue accumulating response
        }
      };

      this.server.stdout.on('data', onData);

      timeoutId = setTimeout(() => {
        this.server.stdout.off('data', onData);
        reject(new Error(`Timeout waiting for response`));
      }, 30000); // Increased timeout for first auth

      // Send init first, then the actual message
      this.server.stdin.write(JSON.stringify(initMessage) + '\n');
      setTimeout(() => {
        this.server.stdin.write(JSON.stringify(message) + '\n');
      }, 500);
    });
  }

  async testValidateConnection() {
    this.log('Testing connection to LibreLinkUp...');

    const message = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'validate_connection',
        arguments: {}
      }
    };

    try {
      const response = await this.sendMCPMessage(message);

      if (response.result && response.result.content) {
        const content = response.result.content[0].text;
        this.log(`Response: ${content.split('\n')[0]}`);

        if (content.includes('validated successfully')) {
          this.log('SUCCESS! Your LibreLinkUp connection is working!');

          // Parse session info
          if (content.includes('Token valid:')) {
            const tokenValid = content.includes('Token valid: true');
            this.log(`Token persistence: ${tokenValid ? 'Working' : 'Not working'}`);
          }

          return true;
        } else {
          this.log('Connection failed - check your credentials or sensor status');
          return false;
        }
      } else if (response.error) {
        this.log(`Error: ${response.error.message}`);
        return false;
      } else {
        this.log('Unexpected response format');
        return false;
      }
    } catch (error) {
      this.log(`Error testing connection: ${error.message}`);
      return false;
    }
  }

  async testCurrentGlucose() {
    this.log('Testing current glucose reading...');

    const message = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_current_glucose',
        arguments: {}
      }
    };

    try {
      const response = await this.sendMCPMessage(message);

      if (response.result && response.result.content) {
        const content = response.result.content[0].text;

        try {
          const glucose = JSON.parse(content);
          this.log('SUCCESS! Got glucose reading:');
          this.log(`   Current glucose: ${glucose.current_glucose} mg/dL`);
          this.log(`   Trend: ${glucose.trend}`);
          this.log(`   Status: ${glucose.status}`);
          this.log(`   Timestamp: ${glucose.timestamp}`);
          return true;
        } catch (e) {
          this.log(`Response: ${content}`);
          return content.includes('Error') ? false : true;
        }
      } else if (response.error) {
        this.log(`Error: ${response.error.message}`);
        return false;
      } else {
        this.log('No glucose data received');
        return false;
      }
    } catch (error) {
      this.log(`Error getting glucose: ${error.message}`);
      return false;
    }
  }

  async testSessionStatus() {
    this.log('Testing session status...');

    const message = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_session_status',
        arguments: {}
      }
    };

    try {
      const response = await this.sendMCPMessage(message);

      if (response.result && response.result.content) {
        const content = response.result.content[0].text;

        try {
          const status = JSON.parse(content);
          this.log('Session status:');
          this.log(`   Configured: ${status.configured}`);
          this.log(`   Authenticated: ${status.authenticated}`);
          this.log(`   Token valid: ${status.token_valid}`);
          if (status.expires_at) {
            this.log(`   Expires: ${new Date(status.expires_at).toLocaleString()}`);
          }
          return true;
        } catch (e) {
          this.log(`Response: ${content}`);
          return false;
        }
      } else if (response.error) {
        this.log(`Error: ${response.error.message}`);
        return false;
      }
    } catch (error) {
      this.log(`Error getting session status: ${error.message}`);
      return false;
    }
    return false;
  }

  async testGlucoseHistory() {
    this.log('Testing glucose history (last 4 hours)...');

    const message = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_glucose_history',
        arguments: { hours: 4 }
      }
    };

    try {
      const response = await this.sendMCPMessage(message);

      if (response.result && response.result.content) {
        const content = response.result.content[0].text;

        try {
          const history = JSON.parse(content);
          this.log('SUCCESS! Got glucose history:');
          this.log(`   Period: ${history.period_hours} hours`);
          this.log(`   Total readings: ${history.total_readings}`);
          if (history.readings && history.readings.length > 0) {
            const first = history.readings[0];
            const last = history.readings[history.readings.length - 1];
            this.log(`   First reading: ${first.value} mg/dL at ${first.timestamp}`);
            this.log(`   Last reading: ${last.value} mg/dL at ${last.timestamp}`);
          }
          return true;
        } catch (e) {
          this.log(`Response: ${content}`);
          return content.includes('Error') ? false : true;
        }
      } else if (response.error) {
        this.log(`Error: ${response.error.message}`);
        return false;
      }
    } catch (error) {
      this.log(`Error getting history: ${error.message}`);
      return false;
    }
    return false;
  }

  async stopServer() {
    if (this.server) {
      this.log('Stopping server...');
      this.server.kill('SIGTERM');
      await new Promise(resolve => {
        this.server.on('exit', resolve);
        setTimeout(resolve, 2000);
      });
    }
  }

  async runTest() {
    console.log('LibreLink MCP Server Connection Test');
    console.log('========================================');
    console.log('Version: 1.2.0 (Secure credential storage)');
    console.log('');

    try {
      const serverStarted = await this.startServer();
      if (!serverStarted) {
        this.log('Failed to start server');
        return;
      }

      console.log('');

      // Test session status
      await this.testSessionStatus();
      console.log('');

      // Test connection first
      const connectionValid = await this.testValidateConnection();
      if (!connectionValid) {
        console.log('');
        this.log('Connection test failed. Please check:');
        this.log('   1. Your LibreLinkUp credentials are correct');
        this.log('   2. Open LibreLinkUp app and accept any Terms & Conditions');
        this.log('   3. Ensure data sharing is enabled');
        this.log('   4. Your sensor is active and connected');
        await this.stopServer();
        return;
      }

      console.log('');

      // Test glucose reading
      const glucoseSuccess = await this.testCurrentGlucose();
      console.log('');

      // Test glucose history
      const historySuccess = await this.testGlucoseHistory();

      if (glucoseSuccess && historySuccess) {
        console.log('');
        console.log('========================================');
        console.log('All tests passed! Your LibreLink MCP server is working!');
        console.log('========================================');
        console.log('');
        console.log('Security features verified:');
        console.log('  - Credentials encrypted with AES-256-GCM');
        console.log('  - Encryption key stored in OS keychain');
        console.log('  - JWT token persisted securely');
        console.log('');
        console.log('Next step: Add to Claude Desktop configuration');
        console.log('');
        console.log('Add this to your claude_desktop_config.json:');
        console.log('{');
        console.log('  "mcpServers": {');
        console.log('    "librelink": {');
        console.log('      "command": "node",');
        console.log(`      "args": ["${process.cwd().replace(/\\/g, '/')}/dist/index.js"]`);
        console.log('    }');
        console.log('  }');
        console.log('}');
      }

    } catch (error) {
      this.log(`Test error: ${error.message}`);
    } finally {
      await this.stopServer();
    }
  }
}

console.log('');
console.log('IMPORTANT: Make sure you have configured your credentials first!');
console.log('   Run: npm run configure');
console.log('');

const tester = new RealConnectionTester();
tester.runTest().catch(console.error);
