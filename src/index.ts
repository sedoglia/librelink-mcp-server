#!/usr/bin/env node

/**
 * LibreLink MCP Server - Fixed for API v4.16.0 (October 2025)
 *
 * This MCP server provides Claude Desktop with access to FreeStyle LibreLink
 * continuous glucose monitoring (CGM) data.
 *
 * Key features in this version:
 * - API version 4.16.0 support
 * - Account-Id header (SHA256 of userId) for authenticated requests
 * - Secure credential storage with AES-256-GCM encryption
 * - Encryption keys stored in OS keychain via Keytar
 * - Automatic token persistence and refresh
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { LibreLinkClient } from './librelink-client.js';
import { GlucoseAnalytics } from './glucose-analytics.js';
import { ConfigManager } from './config.js';
import { LibreLinkConfig, LibreLinkRegion, VALID_REGIONS } from './types.js';

// Create MCP server
const server = new Server(
  {
    name: 'librelink-mcp-server-fixed',
    version: '1.3.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Configuration and clients
const configManager = new ConfigManager();
let client: LibreLinkClient | null = null;
let analytics: GlucoseAnalytics | null = null;

/**
 * Initialize LibreLink client if configured
 */
async function initializeClient(): Promise<void> {
  // Migrate from legacy config if needed
  await configManager.migrateFromLegacy();

  // Load credentials from secure storage
  await configManager.loadCredentials();

  if (await configManager.isConfigured()) {
    const config = await configManager.getConfig();
    client = new LibreLinkClient(config, configManager);
    analytics = new GlucoseAnalytics(config);
  }
}

/**
 * Format error for MCP response
 */
function handleError(error: unknown): { content: Array<{ type: string; text: string }> } {
  console.error('LibreLink MCP Error:', error);

  const message = error instanceof Error ? error.message : 'Unknown error occurred';

  return {
    content: [{
      type: 'text',
      text: `Error: ${message}`
    }]
  };
}

// Tool definitions
const tools = [
  {
    name: 'get_current_glucose',
    description: 'Get the most recent glucose reading from your FreeStyle Libre sensor. Returns current glucose value in mg/dL, trend direction (rising/falling/stable), and whether the value is in target range. Use this for real-time glucose monitoring.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: 'get_glucose_history',
    description: 'Retrieve historical glucose readings for analysis. Returns an array of timestamped glucose values. Useful for reviewing past glucose levels, identifying patterns, or checking overnight values. Default retrieves 24 hours of data.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: {
          type: 'number',
          description: 'Number of hours of history to retrieve (1-168). Default: 24. Examples: 1 for last hour, 8 for overnight, 168 for one week. Note: LibreLinkUp only stores approximately 12 hours of detailed data.'
        }
      },
      required: []
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: 'get_glucose_stats',
    description: 'Calculate comprehensive glucose statistics including average glucose, GMI (estimated A1C), time-in-range percentages, and variability metrics. Essential for diabetes management insights and identifying areas for improvement.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to analyze (1-14). Default: 7. Note: LibreLinkUp data availability may be limited.'
        }
      },
      required: []
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: 'get_glucose_trends',
    description: 'Analyze glucose patterns including dawn phenomenon (early morning rise), meal responses, and overnight stability. Helps identify recurring patterns that may need attention or treatment adjustments.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'Analysis period for pattern detection. Default: weekly. Use daily for detailed patterns, weekly for typical patterns.'
        }
      },
      required: []
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: 'get_sensor_info',
    description: 'Get information about your active FreeStyle Libre sensor including serial number, activation date, and status. Use this to check if sensor is working properly or needs replacement.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: 'configure_credentials',
    description: 'Set up or update your LibreLinkUp account credentials for data access. Required before using any glucose reading tools. Credentials are stored securely using AES-256-GCM encryption with keys in your OS keychain.',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Your LibreLinkUp account email address'
        },
        password: {
          type: 'string',
          description: 'Your LibreLinkUp account password'
        },
        region: {
          type: 'string',
          enum: ['AE', 'AP', 'AU', 'CA', 'CN', 'DE', 'EU', 'EU2', 'FR', 'JP', 'LA', 'RU', 'US'],
          description: 'Your LibreLinkUp account region. Available: AE, AP, AU, CA, CN, DE, EU, EU2, FR, JP, LA, RU, US. Default: EU'
        }
      },
      required: ['email', 'password']
    },
    annotations: {
      destructiveHint: true
    }
  },
  {
    name: 'configure_ranges',
    description: 'Customize your target glucose range for personalized time-in-range calculations. Standard range is 70-180 mg/dL, but your healthcare provider may recommend different targets.',
    inputSchema: {
      type: 'object',
      properties: {
        target_low: {
          type: 'number',
          description: 'Lower bound of target range in mg/dL (40-100). Default: 70'
        },
        target_high: {
          type: 'number',
          description: 'Upper bound of target range in mg/dL (100-300). Default: 180'
        }
      },
      required: ['target_low', 'target_high']
    },
    annotations: {
      destructiveHint: true
    }
  },
  {
    name: 'validate_connection',
    description: 'Test the connection to LibreLinkUp servers and verify your credentials are working. Use this if you encounter errors or after updating credentials.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: 'get_session_status',
    description: 'Get the current authentication session status including whether authenticated, token validity, and expiration time.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: 'clear_session',
    description: 'Clear the current authentication session and stored tokens. Use this if you need to force a re-authentication.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    annotations: {
      destructiveHint: true
    }
  }
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_current_glucose': {
        if (!client) {
          throw new Error('LibreLinkUp not configured. Use configure_credentials first.');
        }

        const reading = await client.getCurrentGlucose();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              current_glucose: reading.value,
              timestamp: reading.timestamp,
              trend: reading.trend,
              status: reading.isHigh ? 'High' : reading.isLow ? 'Low' : 'Normal',
              color: reading.color
            }, null, 2)
          }]
        };
      }

      case 'get_glucose_history': {
        if (!client) {
          throw new Error('LibreLinkUp not configured. Use configure_credentials first.');
        }

        const hours = (args?.hours as number) || 24;
        const history = await client.getGlucoseHistory(hours);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              period_hours: hours,
              total_readings: history.length,
              readings: history
            }, null, 2)
          }]
        };
      }

      case 'get_glucose_stats': {
        if (!client || !analytics) {
          throw new Error('LibreLinkUp not configured. Use configure_credentials first.');
        }

        const days = (args?.days as number) || 7;
        const readings = await client.getGlucoseHistory(days * 24);
        const stats = analytics.calculateGlucoseStats(readings);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              analysis_period_days: days,
              average_glucose: stats.average,
              glucose_management_indicator: stats.gmi,
              time_in_range: {
                target_70_180: stats.timeInRange,
                below_70: stats.timeBelowRange,
                above_180: stats.timeAboveRange
              },
              variability: {
                standard_deviation: stats.standardDeviation,
                coefficient_of_variation: stats.coefficientOfVariation
              },
              reading_count: stats.readingCount
            }, null, 2)
          }]
        };
      }

      case 'get_glucose_trends': {
        if (!client || !analytics) {
          throw new Error('LibreLinkUp not configured. Use configure_credentials first.');
        }

        const period = (args?.period as 'daily' | 'weekly' | 'monthly') || 'weekly';
        const daysToAnalyze = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
        const readings = await client.getGlucoseHistory(daysToAnalyze * 24);
        const trends = analytics.analyzeTrends(readings, period);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              period: period,
              patterns: trends.patterns,
              dawn_phenomenon: trends.dawnPhenomenon,
              meal_response_average: trends.mealResponse,
              overnight_stability: trends.overnightStability
            }, null, 2)
          }]
        };
      }

      case 'get_sensor_info': {
        if (!client) {
          throw new Error('LibreLinkUp not configured. Use configure_credentials first.');
        }

        const sensors = await client.getSensorInfo();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              active_sensors: sensors,
              sensor_count: sensors.length
            }, null, 2)
          }]
        };
      }

      case 'configure_credentials': {
        const { email, password, region } = args as {
          email: string;
          password: string;
          region?: LibreLinkRegion
        };

        await configManager.updateCredentials(email, password);

        if (region) {
          configManager.updateRegion(region);
        }

        // Reinitialize client with new credentials
        await initializeClient();

        const paths = configManager.getSecureStoragePaths();

        return {
          content: [{
            type: 'text',
            text: `LibreLinkUp credentials configured successfully.\n\nCredentials are stored securely:\n- Encrypted file: ${paths.credentialsPath}\n- Encryption key: Stored in OS keychain\n\nUse validate_connection to test.`
          }]
        };
      }

      case 'configure_ranges': {
        const { target_low, target_high } = args as { target_low: number; target_high: number };

        configManager.updateRanges(target_low, target_high);

        // Reinitialize analytics with new ranges
        if (analytics) {
          analytics.updateConfig(await configManager.getConfig());
        }

        return {
          content: [{
            type: 'text',
            text: `Target glucose ranges updated: ${target_low}-${target_high} mg/dL`
          }]
        };
      }

      case 'validate_connection': {
        if (!client) {
          throw new Error('LibreLinkUp not configured. Use configure_credentials first.');
        }

        const isValid = await client.validateConnection();

        if (isValid) {
          const glucose = await client.getCurrentGlucose();
          const sessionStatus = client.getSessionStatus();

          return {
            content: [{
              type: 'text',
              text: `LibreLinkUp connection validated successfully!\n\nCurrent glucose: ${glucose.value} mg/dL (${glucose.trend})\n\nSession status:\n- Authenticated: ${sessionStatus.authenticated}\n- Token valid: ${sessionStatus.tokenValid}\n- Expires: ${sessionStatus.expiresAt?.toISOString() || 'N/A'}`
            }]
          };
        } else {
          return {
            content: [{
              type: 'text',
              text: 'LibreLinkUp connection failed. Please check:\n1. Your credentials are correct\n2. You have accepted Terms & Conditions in LibreLinkUp app\n3. Someone is sharing data with you (or you shared your own)'
            }]
          };
        }
      }

      case 'get_session_status': {
        if (!client) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                configured: false,
                message: 'LibreLinkUp not configured. Use configure_credentials first.'
              }, null, 2)
            }]
          };
        }

        const status = client.getSessionStatus();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              configured: true,
              authenticated: status.authenticated,
              token_valid: status.tokenValid,
              expires_at: status.expiresAt?.toISOString() || null
            }, null, 2)
          }]
        };
      }

      case 'clear_session': {
        if (client) {
          await client.clearSession();
        }
        await configManager.clearToken();

        return {
          content: [{
            type: 'text',
            text: 'Session cleared. You will need to re-authenticate on the next request.'
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return handleError(error);
  }
});

/**
 * Main entry point
 */
export async function main(): Promise<void> {
  // Initialize client if already configured
  await initializeClient();

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);

  console.error('LibreLink MCP Server running on stdio (v1.3.0 - Secure credential storage)');
}

// Run if executed directly
// Fixed check for ESM modules on Windows
const isMainModule = process.argv[1] && (
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` ||
  import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
  process.argv[1].endsWith('index.js')
);

if (isMainModule) {
  main().catch(console.error);
}
