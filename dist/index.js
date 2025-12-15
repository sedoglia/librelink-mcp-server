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
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LibreLinkClient } from './librelink-client.js';
import { GlucoseAnalytics } from './glucose-analytics.js';
import { ConfigManager } from './config.js';
// Create MCP server
const server = new Server({
    name: 'librelink-mcp-server-fixed',
    version: '1.2.0'
}, {
    capabilities: {
        tools: {}
    }
});
// Configuration and clients
const configManager = new ConfigManager();
let client = null;
let analytics = null;
/**
 * Initialize LibreLink client if configured
 */
async function initializeClient() {
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
function handleError(error) {
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
        }
    },
    {
        name: 'get_sensor_info',
        description: 'Get information about your active FreeStyle Libre sensor including serial number, activation date, and status. Use this to check if sensor is working properly or needs replacement.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
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
                    enum: ['US', 'EU', 'DE', 'FR', 'AP', 'AU'],
                    description: 'Your LibreLinkUp account region. Default: EU'
                }
            },
            required: ['email', 'password']
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
        }
    },
    {
        name: 'validate_connection',
        description: 'Test the connection to LibreLinkUp servers and verify your credentials are working. Use this if you encounter errors or after updating credentials.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'get_session_status',
        description: 'Get the current authentication session status including whether authenticated, token validity, and expiration time.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'clear_session',
        description: 'Clear the current authentication session and stored tokens. Use this if you need to force a re-authentication.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
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
                const hours = args?.hours || 24;
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
                const days = args?.days || 7;
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
                const period = args?.period || 'weekly';
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
                const { email, password, region } = args;
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
                const { target_low, target_high } = args;
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
                }
                else {
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
    }
    catch (error) {
        return handleError(error);
    }
});
/**
 * Main entry point
 */
export async function main() {
    // Initialize client if already configured
    await initializeClient();
    // Create stdio transport
    const transport = new StdioServerTransport();
    // Connect server to transport
    await server.connect(transport);
    console.error('LibreLink MCP Server running on stdio (v1.2.0 - Secure credential storage)');
}
// Run if executed directly
// Fixed check for ESM modules on Windows
const isMainModule = process.argv[1] && (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` ||
    import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1].endsWith('index.js'));
if (isMainModule) {
    main().catch(console.error);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUVBOzs7Ozs7Ozs7Ozs7R0FZRztBQUVILE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSwyQ0FBMkMsQ0FBQztBQUNuRSxPQUFPLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSwyQ0FBMkMsQ0FBQztBQUNqRixPQUFPLEVBQ0wscUJBQXFCLEVBQ3JCLHNCQUFzQixFQUN2QixNQUFNLG9DQUFvQyxDQUFDO0FBQzVDLE9BQU8sRUFBRSxlQUFlLEVBQUUsTUFBTSx1QkFBdUIsQ0FBQztBQUN4RCxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSx3QkFBd0IsQ0FBQztBQUMxRCxPQUFPLEVBQUUsYUFBYSxFQUFFLE1BQU0sYUFBYSxDQUFDO0FBRzVDLG9CQUFvQjtBQUNwQixNQUFNLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FDdkI7SUFDRSxJQUFJLEVBQUUsNEJBQTRCO0lBQ2xDLE9BQU8sRUFBRSxPQUFPO0NBQ2pCLEVBQ0Q7SUFDRSxZQUFZLEVBQUU7UUFDWixLQUFLLEVBQUUsRUFBRTtLQUNWO0NBQ0YsQ0FDRixDQUFDO0FBRUYsNEJBQTRCO0FBQzVCLE1BQU0sYUFBYSxHQUFHLElBQUksYUFBYSxFQUFFLENBQUM7QUFDMUMsSUFBSSxNQUFNLEdBQTJCLElBQUksQ0FBQztBQUMxQyxJQUFJLFNBQVMsR0FBNEIsSUFBSSxDQUFDO0FBRTlDOztHQUVHO0FBQ0gsS0FBSyxVQUFVLGdCQUFnQjtJQUM3Qix1Q0FBdUM7SUFDdkMsTUFBTSxhQUFhLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztJQUV4Qyx1Q0FBdUM7SUFDdkMsTUFBTSxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUM7SUFFdEMsSUFBSSxNQUFNLGFBQWEsQ0FBQyxZQUFZLEVBQUUsRUFBRSxDQUFDO1FBQ3ZDLE1BQU0sTUFBTSxHQUFHLE1BQU0sYUFBYSxDQUFDLFNBQVMsRUFBRSxD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QyxDQUFDO0FBRUYsSUFBSSxZQUFZLEVBQUUsQ0FBQztJQUNqQixJQUFJLEVBQUUsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQzlCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5cbi8qKlxuICogTGlicmVMaW5rIE1DUCBTZXJ2ZXIgLSBGaXhlZCBmb3IgQVBJIHY0LjE2LjAgKE9jdG9iZXIgMjAyNSlcbiAqXG4gKiBUaGlzIE1DUCBzZXJ2ZXIgcHJvdmlkZXMgQ2xhdWRlIERlc2t0b3Agd2l0aCBhY2Nlc3MgdG8gRnJlZVN0eWxlIExpYnJlTGlua1xuICogY29udGludW91cyBnbHVjb3NlIG1vbml0b3JpbmcgKENHTSkgZGF0YS5cbiAqXG4gKiBLZXkgZmVhdHVyZXMgaW4gdGhpcyB2ZXJzaW9uOlxuICogLSBBUEkgdmVyc2lvbiA0LjE2LjAgc3VwcG9ydFxuICogLSBBY2NvdW50LUlkIGhlYWRlciAoU0hBMjU2IG9mIHVzZXJJZCkgZm9yIGF1dGhlbnRpY2F0ZWQgcmVxdWVzdHNcbiAqIC0gU2VjdXJlIGNyZWRlbnRpYWwgc3RvcmFnZSB3aXRoIEFFUy0yNTYtR0NNIGVuY3J5cHRpb25cbiAqIC0gRW5jcnlwdGlvbiBrZXlzIHN0b3JlZCBpbiBPUyBrZXljaGFpbiB2aWEgS2V5dGFyXG4gKiAtIEF1dG9tYXRpYyB0b2tlbiBwZXJzaXN0ZW5jZSBhbmQgcmVmcmVzaFxuICovXG5cbmltcG9ydCB7IFNlcnZlciB9IGZyb20gJ0Btb2RlbGNvbnRleHRwcm90b2NvbC9zZGsvc2VydmVyL2luZGV4LmpzJztcbmltcG9ydCB7IFN0ZGlvU2VydmVyVHJhbnNwb3J0IH0gZnJvbSAnQG1vZGVsY29udGV4dHByb3RvY29sL3Nkay9zZXJ2ZXIvc3RkaW8uanMnO1xuaW1wb3J0IHtcbiAgQ2FsbFRvb2xSZXF1ZXN0U2NoZW1hLFxuICBMaXN0VG9vbHNSZXF1ZXN0U2NoZW1hXG59IGZyb20gJ0Btb2RlbGNvbnRleHRwcm90b2NvbC9zZGsvdHlwZXMuanMnO1xuaW1wb3J0IHsgTGlicmVMaW5rQ2xpZW50IH0gZnJvbSAnLi9saWJyZWxpbmstY2xpZW50LmpzJztcbmltcG9ydCB7IEdsdWNvc2VBbmFseXRpY3MgfSBmcm9tICcuL2dsdWNvc2UtYW5hbHl0aWNzLmpzJztcbmltcG9ydCB7IENvbmZpZ01hbmFnZXIgfSBmcm9tICcuL2NvbmZpZy5qcyc7XG5pbXBvcnQgeyBMaWJyZUxpbmtDb25maWcgfSBmcm9tICcuL3R5cGVzLmpzJztcblxuLy8gQ3JlYXRlIE1DUCBzZXJ2ZXJcbmNvbnN0IHNlcnZlciA9IG5ldyBTZXJ2ZXIoXG4gIHtcbiAgICBuYW1lOiAnbGlicmVsaW5rLW1jcC1zZXJ2ZXItZml4ZWQnLFxuICAgIHZlcnNpb246ICcxLjIuMCdcbiAgfSxcbiAge1xuICAgIGNhcGFiaWxpdGllczoge1xuICAgICAgdG9vbHM6IHt9XG4gICAgfVxuICB9XG4pO1xuXG4vLyBDb25maWd1cmF0aW9uIGFuZCBjbGllbnRzXG5jb25zdCBjb25maWdNYW5hZ2VyID0gbmV3IENvbmZpZ01hbmFnZXIoKTtcbmxldCBjbGllbnQ6IExpYnJlTGlua0NsaWVudCB8IG51bGwgPSBudWxsO1xubGV0IGFuYWx5dGljczogR2x1Y29zZUFuYWx5dGljcyB8IG51bGwgPSBudWxsO1xuXG4vKipcbiAqIEluaXRpYWxpemUgTGlicmVMaW5rIGNsaWVudCBpZiBjb25maWd1cmVkXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVDbGllbnQoKTogUHJvbWlzZTx2b2lkPiB7XG4gIC8vIE1pZ3JhdGUgZnJvbSBsZWdhY3kgY29uZmlnIGlmIG5lZWRlZFxuICBhd2FpdCBjb25maWdNYW5hZ2VyLm1pZ3JhdGVGcm9tTGVnYWN5KCk7XG5cbiAgLy8gTG9hZCBjcmVkZW50aWFscyBmcm9tIHNlY3VyZSBzdG9yYWdlXG4gIGF3YWl0IGNvbmZpZ01hbmFnZXIubG9hZENyZWRlbnRpYWxzKCk7XG5cbiAgaWYgKGF3YWl0IGNvbmZpZ01hbmFnZXIuaXNDb25maWd1cmVkKCkpIHtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCBjb25maWdNYW5hZ2VyLmdldENvbmZpZygpO1xuICAgIGNsaWVudCA9IG5ldyBMaWJyZUxpbmtDbGllbnQoY29uZmlnLCBjb25maWdNYW5hZ2VyKTtcbiAgICBhbmFseXRpY3MgPSBuZXcgR2x1Y29zZUFuYWx5dGljcyhjb25maWcpO1xuICB9XG59XG5cbi8qKlxuICogRm9ybWF0IGVycm9yIGZvciBNQ1AgcmVzcG9uc2VcbiAqL1xuZnVuY3Rpb24gaGFuZGxlRXJyb3IoZXJyb3I6IHVua25vd24pOiB7IGNvbnRlbnQ6IEFycmF5PHsgdHlwZTogc3RyaW5nOyB0ZXh0OiBzdHJpbmcgfT4gfSB7XG4gIGNvbnNvbGUuZXJyb3IoJ0xpYnJlTGluayBNQ1AgRXJyb3I6JywgZXJyb3IpO1xuXG4gIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yIG9jY3VycmVkJztcblxuICByZXR1cm4ge1xuICAgIGNvbnRlbnQ6IFt7XG4gICAgICB0eXBlOiAndGV4dCcsXG4gICAgICB0ZXh0OiBgRXJyb3I6ICR7bWVzc2FnZX1gXG4gICAgfV1cbiAgfTtcbn1cblxuLy8gVG9vbCBkZWZpbml0aW9uc1xuY29uc3QgdG9vbHMgPSBbXG4gIHtcbiAgICBuYW1lOiAnZ2V0X2N1cnJlbnRfZ2x1Y29zZScsXG4gICAgZGVzY3JpcHRpb246ICdHZXQgdGhlIG1vc3QgcmVjZW50IGdsdWNvc2UgcmVhZGluZyBmcm9tIHlvdXIgRnJlZVN0eWxlIExpYnJlIHNlbnNvci4gUmV0dXJucyBjdXJyZW50IGdsdWNvc2UgdmFsdWUgaW4gbWcvZEwsIHRyZW5kIGRpcmVjdGlvbiAocmlzaW5nL2ZhbGxpbmcvc3RhYmxlKSwgYW5kIHdoZXRoZXIgdGhlIHZhbHVlIGlzIGluIHRhcmdldCByYW5nZS4gVXNlIHRoaXMgZm9yIHJlYWwtdGltZSBnbHVjb3NlIG1vbml0b3JpbmcuJyxcbiAgICBpbnB1dFNjaGVtYToge1xuICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICAgIHJlcXVpcmVkOiBbXVxuICAgIH1cbiAgfSxcbiAge1xuICAgIG5hbWU6ICdnZXRfZ2x1Y29zZV9oaXN0b3J5JyxcbiAgICBkZXNjcmlwdGlvbjogJ1JldHJpZXZlIGhpc3RvcmljYWwgZ2x1Y29zZSByZWFkaW5ncyBmb3IgYW5hbHlzaXMuIFJldHVybnMgYW4gYXJyYXkgb2YgdGltZXN0YW1wZWQgZ2x1Y29zZSB2YWx1ZXMuIFVzZWZ1bCBmb3IgcmV2aWV3aW5nIHBhc3QgZ2x1Y29zZSBsZXZlbHMsIGlkZW50aWZ5aW5nIHBhdHRlcm5zLCBvciBjaGVja2luZyBvdmVybmlnaHQgdmFsdWVzLiBEZWZhdWx0IHJldHJpZXZlcyAyNCBob3VycyBvZiBkYXRhLicsXG4gICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBob3Vyczoge1xuICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTnVtYmVyIG9mIGhvdXJzIG9mIGhpc3RvcnkgdG8gcmV0cmlldmUgKDEtMTY4KS4gRGVmYXVsdDogMjQuIEV4YW1wbGVzOiAxIGZvciBsYXN0IGhvdXIsIDggZm9yIG92ZXJuaWdodCwgMTY4IGZvciBvbmUgd2Vlay4gTm90ZTogTGlicmVMaW5rVXAgb25seSBzdG9yZXMgYXBwcm94aW1hdGVseSAxMiBob3VycyBvZiBkZXRhaWxlZCBkYXRhLidcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHJlcXVpcmVkOiBbXVxuICAgIH1cbiAgfSxcbiAge1xuICAgIG5hbWU6ICdnZXRfZ2x1Y29zZV9zdGF0cycsXG4gICAgZGVzY3JpcHRpb246ICdDYWxjdWxhdGUgY29tcHJlaGVuc2l2ZSBnbHVjb3NlIHN0YXRpc3RpY3MgaW5jbHVkaW5nIGF2ZXJhZ2UgZ2x1Y29zZSwgR01JIChlc3RpbWF0ZWQgQTFDKSwgdGltZS1pbi1yYW5nZSBwZXJjZW50YWdlcywgYW5kIHZhcmlhYmlsaXR5IG1ldHJpY3MuIEVzc2VudGlhbCBmb3IgZGlhYmV0ZXMgbWFuYWdlbWVudCBpbnNpZ2h0cyBhbmQgaWRlbnRpZnlpbmcgYXJlYXMgZm9yIGltcHJvdmVtZW50LicsXG4gICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBkYXlzOiB7XG4gICAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdOdW1iZXIgb2YgZGF5cyB0byBhbmFseXplICgxLTE0KS4gRGVmYXVsdDogNy4gTm90ZTogTGlicmVMaW5rVXAgZGF0YSBhdmFpbGFiaWxpdHkgbWF5IGJlIGxpbWl0ZWQuJ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgcmVxdWlyZWQ6IFtdXG4gICAgfVxuICB9LFxuICB7XG4gICAgbmFtZTogJ2dldF9nbHVjb3NlX3RyZW5kcycsXG4gICAgZGVzY3JpcHRpb246ICdBbmFseXplIGdsdWNvc2UgcGF0dGVybnMgaW5jbHVkaW5nIGRhd24gcGhlbm9tZW5vbiAoZWFybHkgbW9ybmluZyByaXNlKSwgbWVhbCByZXNwb25zZXMsIGFuZCBvdmVybmlnaHQgc3RhYmlsaXR5LiBIZWxwcyBpZGVudGlmeSByZWN1cnJpbmcgcGF0dGVybnMgdGhhdCBtYXkgbmVlZCBhdHRlbnRpb24gb3IgdHJlYXRtZW50IGFkanVzdG1lbnRzLicsXG4gICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBwZXJpb2Q6IHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICBlbnVtOiBbJ2RhaWx5JywgJ3dlZWtseScsICdtb250aGx5J10sXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdBbmFseXNpcyBwZXJpb2QgZm9yIHBhdHRlcm4gZGV0ZWN0aW9uLiBEZWZhdWx0OiB3ZWVrbHkuIFVzZSBkYWlseSBmb3IgZGV0YWlsZWQgcGF0dGVybnMsIHdlZWtseSBmb3IgdHlwaWNhbCBwYXR0ZXJucy4nXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICByZXF1aXJlZDogW11cbiAgICB9XG4gIH0sXG4gIHtcbiAgICBuYW1lOiAnZ2V0X3NlbnNvcl9pbmZvJyxcbiAgICBkZXNjcmlwdGlvbjogJ0dldCBpbmZvcm1hdGlvbiBhYm91dCB5b3VyIGFjdGl2ZSBGcmVlU3R5bGUgTGlicmUgc2Vuc29yIGluY2x1ZGluZyBzZXJpYWwgbnVtYmVyLCBhY3RpdmF0aW9uIGRhdGUsIGFuZCBzdGF0dXMuIFVzZSB0aGlzIHRvIGNoZWNrIGlmIHNlbnNvciBpcyB3b3JraW5nIHByb3Blcmx5IG9yIG5lZWRzIHJlcGxhY2VtZW50LicsXG4gICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgICByZXF1aXJlZDogW11cbiAgICB9XG4gIH0sXG4gIHtcbiAgICBuYW1lOiAnY29uZmlndXJlX2NyZWRlbnRpYWxzJyxcbiAgICBkZXNjcmlwdGlvbjogJ1NldCB1cCBvciB1cGRhdGUgeW91ciBMaWJyZUxpbmtVcCBhY2NvdW50IGNyZWRlbnRpYWxzIGZvciBkYXRhIGFjY2Vzcy4gUmVxdWlyZWQgYmVmb3JlIHVzaW5nIGFueSBnbHVjb3NlIHJlYWRpbmcgdG9vbHMuIENyZWRlbnRpYWxzIGFyZSBzdG9yZWQgc2VjdXJlbHkgdXNpbmcgQUVTLTI1Ni1HQ00gZW5jcnlwdGlvbiB3aXRoIGtleXMgaW4geW91ciBPUyBrZXljaGFpbi4nLFxuICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgZW1haWw6IHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1lvdXIgTGlicmVMaW5rVXAgYWNjb3VudCBlbWFpbCBhZGRyZXNzJ1xuICAgICAgICB9LFxuICAgICAgICBwYXNzd29yZDoge1xuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnWW91ciBMaWJyZUxpbmtVcCBhY2NvdW50IHBhc3N3b3JkJ1xuICAgICAgICB9LFxuICAgICAgICByZWdpb246IHtcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICBlbnVtOiBbJ1VTJywgJ0VVJywgJ0RFJywgJ0ZSJywgJ0FQJywgJ0FVJ10sXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdZb3VyIExpYnJlTGlua1VwIGFjY291bnQgcmVnaW9uLiBEZWZhdWx0OiBFVSdcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHJlcXVpcmVkOiBbJ2VtYWlsJywgJ3Bhc3N3b3JkJ11cbiAgICB9XG4gIH0sXG4gIHtcbiAgICBuYW1lOiAnY29uZmlndXJlX3JhbmdlcycsXG4gICAgZGVzY3JpcHRpb246ICdDdXN0b21pemUgeW91ciB0YXJnZXQgZ2x1Y29zZSByYW5nZSBmb3IgcGVyc29uYWxpemVkIHRpbWUtaW4tcmFuZ2UgY2FsY3VsYXRpb25zLiBTdGFuZGFyZCByYW5nZSBpcyA3MC0xODAgbWcvZEwsIGJ1dCB5b3VyIGhlYWx0aGNhcmUgcHJvdmlkZXIgbWF5IHJlY29tbWVuZCBkaWZmZXJlbnQgdGFyZ2V0cy4nLFxuICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgdGFyZ2V0X2xvdzoge1xuICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTG93ZXIgYm91bmQgb2YgdGFyZ2V0IHJhbmdlIGluIG1nL2RMICg0MC0xMDApLiBEZWZhdWx0OiA3MCdcbiAgICAgICAgfSxcbiAgICAgICAgdGFyZ2V0X2hpZ2g6IHtcbiAgICAgICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1VwcGVyIGJvdW5kIG9mIHRhcmdldCByYW5nZSBpbiBtZy9kTCAoMTAwLTMwMCkuIERlZmF1bHQ6IDE4MCdcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHJlcXVpcmVkOiBbJ3RhcmdldF9sb3cnLCAndGFyZ2V0X2hpZ2gnXVxuICAgIH1cbiAgfSxcbiAge1xuICAgIG5hbWU6ICd2YWxpZGF0ZV9jb25uZWN0aW9uJyxcbiAgICBkZXNjcmlwdGlvbjogJ1Rlc3QgdGhlIGNvbm5lY3Rpb24gdG8gTGlicmVMaW5rVXAgc2VydmVycyBhbmQgdmVyaWZ5IHlvdXIgY3JlZGVudGlhbHMgYXJlIHdvcmtpbmcuIFVzZSB0aGlzIGlmIHlvdSBlbmNvdW50ZXIgZXJyb3JzIG9yIGFmdGVyIHVwZGF0aW5nIGNyZWRlbnRpYWxzLicsXG4gICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgICByZXF1aXJlZDogW11cbiAgICB9XG4gIH0sXG4gIHtcbiAgICBuYW1lOiAnZ2V0X3Nlc3Npb25fc3RhdHVzJyxcbiAgICBkZXNjcmlwdGlvbjogJ0dldCB0aGUgY3VycmVudCBhdXRoZW50aWNhdGlvbiBzZXNzaW9uIHN0YXR1cyBpbmNsdWRpbmcgd2hldGhlciBhdXRoZW50aWNhdGVkLCB0b2tlbiB2YWxpZGl0eSwgYW5kIGV4cGlyYXRpb24gdGltZS4nLFxuICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgICAgcmVxdWlyZWQ6IFtdXG4gICAgfVxuICB9LFxuICB7XG4gICAgbmFtZTogJ2NsZWFyX3Nlc3Npb24nLFxuICAgIGRlc2NyaXB0aW9uOiAnQ2xlYXIgdGhlIGN1cnJlbnQgYXV0aGVudGljYXRpb24gc2Vzc2lvbiBhbmQgc3RvcmVkIHRva2Vucy4gVXNlIHRoaXMgaWYgeW91IG5lZWQgdG8gZm9yY2UgYSByZS1hdXRoZW50aWNhdGlvbi4nLFxuICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgICAgcmVxdWlyZWQ6IFtdXG4gICAgfVxuICB9XG5dO1xuXG4vLyBMaXN0IHRvb2xzIGhhbmRsZXJcbnNlcnZlci5zZXRSZXF1ZXN0SGFuZGxlcihMaXN0VG9vbHNSZXF1ZXN0U2NoZW1hLCBhc3luYyAoKSA9PiB7XG4gIHJldHVybiB7IHRvb2xzIH07XG59KTtcblxuLy8gQ2FsbCB0b29sIGhhbmRsZXJcbnNlcnZlci5zZXRSZXF1ZXN0SGFuZGxlcihDYWxsVG9vbFJlcXVlc3RTY2hlbWEsIGFzeW5jIChyZXF1ZXN0KSA9PiB7XG4gIGNvbnN0IHsgbmFtZSwgYXJndW1lbnRzOiBhcmdzIH0gPSByZXF1ZXN0LnBhcmFtcztcblxuICB0cnkge1xuICAgIHN3aXRjaCAobmFtZSkge1xuICAgICAgY2FzZSAnZ2V0X2N1cnJlbnRfZ2x1Y29zZSc6IHtcbiAgICAgICAgaWYgKCFjbGllbnQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpYnJlTGlua1VwIG5vdCBjb25maWd1cmVkLiBVc2UgY29uZmlndXJlX2NyZWRlbnRpYWxzIGZpcnN0LicpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVhZGluZyA9IGF3YWl0IGNsaWVudC5nZXRDdXJyZW50R2x1Y29zZSgpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29udGVudDogW3tcbiAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIHRleHQ6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgY3VycmVudF9nbHVjb3NlOiByZWFkaW5nLnZhbHVlLFxuICAgICAgICAgICAgICB0aW1lc3RhbXA6IHJlYWRpbmcudGltZXN0YW1wLFxuICAgICAgICAgICAgICB0cmVuZDogcmVhZGluZy50cmVuZCxcbiAgICAgICAgICAgICAgc3RhdHVzOiByZWFkaW5nLmlzSGlnaCA/ICdIaWdoJyA6IHJlYWRpbmcuaXNMb3cgPyAnTG93JyA6ICdOb3JtYWwnLFxuICAgICAgICAgICAgICBjb2xvcjogcmVhZGluZy5jb2xvclxuICAgICAgICAgICAgfSwgbnVsbCwgMilcbiAgICAgICAgICB9XVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBjYXNlICdnZXRfZ2x1Y29zZV9oaXN0b3J5Jzoge1xuICAgICAgICBpZiAoIWNsaWVudCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTGlicmVMaW5rVXAgbm90IGNvbmZpZ3VyZWQuIFVzZSBjb25maWd1cmVfY3JlZGVudGlhbHMgZmlyc3QuJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBob3VycyA9IChhcmdzPy5ob3VycyBhcyBudW1iZXIpIHx8IDI0O1xuICAgICAgICBjb25zdCBoaXN0b3J5ID0gYXdhaXQgY2xpZW50LmdldEdsdWNvc2VIaXN0b3J5KGhvdXJzKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbnRlbnQ6IFt7XG4gICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICB0ZXh0OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgIHBlcmlvZF9ob3VyczogaG91cnMsXG4gICAgICAgICAgICAgIHRvdGFsX3JlYWRpbmdzOiBoaXN0b3J5Lmxlbmd0aCxcbiAgICAgICAgICAgICAgcmVhZGluZ3M6IGhpc3RvcnlcbiAgICAgICAgICAgIH0sIG51bGwsIDIpXG4gICAgICAgICAgfV1cbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgY2FzZSAnZ2V0X2dsdWNvc2Vfc3RhdHMnOiB7XG4gICAgICAgIGlmICghY2xpZW50IHx8ICFhbmFseXRpY3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpYnJlTGlua1VwIG5vdCBjb25maWd1cmVkLiBVc2UgY29uZmlndXJlX2NyZWRlbnRpYWxzIGZpcnN0LicpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZGF5cyA9IChhcmdzPy5kYXlzIGFzIG51bWJlcikgfHwgNztcbiAgICAgICAgY29uc3QgcmVhZGluZ3MgPSBhd2FpdCBjbGllbnQuZ2V0R2x1Y29zZUhpc3RvcnkoZGF5cyAqIDI0KTtcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhbmFseXRpY3MuY2FsY3VsYXRlR2x1Y29zZVN0YXRzKHJlYWRpbmdzKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbnRlbnQ6IFt7XG4gICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICB0ZXh0OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgIGFuYWx5c2lzX3BlcmlvZF9kYXlzOiBkYXlzLFxuICAgICAgICAgICAgICBhdmVyYWdlX2dsdWNvc2U6IHN0YXRzLmF2ZXJhZ2UsXG4gICAgICAgICAgICAgIGdsdWNvc2VfbWFuYWdlbWVudF9pbmRpY2F0b3I6IHN0YXRzLmdtaSxcbiAgICAgICAgICAgICAgdGltZV9pbl9yYW5nZToge1xuICAgICAgICAgICAgICAgIHRhcmdldF83MF8xODA6IHN0YXRzLnRpbWVJblJhbmdlLFxuICAgICAgICAgICAgICAgIGJlbG93XzcwOiBzdGF0cy50aW1lQmVsb3dSYW5nZSxcbiAgICAgICAgICAgICAgICBhYm92ZV8xODA6IHN0YXRzLnRpbWVBYm92ZVJhbmdlXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHZhcmlhYmlsaXR5OiB7XG4gICAgICAgICAgICAgICAgc3RhbmRhcmRfZGV2aWF0aW9uOiBzdGF0cy5zdGFuZGFyZERldmlhdGlvbixcbiAgICAgICAgICAgICAgICBjb2VmZmljaWVudF9vZl92YXJpYXRpb246IHN0YXRzLmNvZWZmaWNpZW50T2ZWYXJpYXRpb25cbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcmVhZGluZ19jb3VudDogc3RhdHMucmVhZGluZ0NvdW50XG4gICAgICAgICAgICB9LCBudWxsLCAyKVxuICAgICAgICAgIH1dXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIGNhc2UgJ2dldF9nbHVjb3NlX3RyZW5kcyc6IHtcbiAgICAgICAgaWYgKCFjbGllbnQgfHwgIWFuYWx5dGljcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTGlicmVMaW5rVXAgbm90IGNvbmZpZ3VyZWQuIFVzZSBjb25maWd1cmVfY3JlZGVudGlhbHMgZmlyc3QuJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwZXJpb2QgPSAoYXJncz8ucGVyaW9kIGFzICdkYWlseScgfCAnd2Vla2x5JyB8ICdtb250aGx5JykgfHwgJ3dlZWtseSc7XG4gICAgICAgIGNvbnN0IGRheXNUb0FuYWx5emUgPSBwZXJpb2QgPT09ICdkYWlseScgPyAxIDogcGVyaW9kID09PSAnd2Vla2x5JyA/IDcgOiAzMDtcbiAgICAgICAgY29uc3QgcmVhZGluZ3MgPSBhd2FpdCBjbGllbnQuZ2V0R2x1Y29zZUhpc3RvcnkoZGF5c1RvQW5hbHl6ZSAqIDI0KTtcbiAgICAgICAgY29uc3QgdHJlbmRzID0gYW5hbHl0aWNzLmFuYWx5emVUcmVuZHMocmVhZGluZ3MsIHBlcmlvZCk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb250ZW50OiBbe1xuICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgdGV4dDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICBwZXJpb2Q6IHBlcmlvZCxcbiAgICAgICAgICAgICAgcGF0dGVybnM6IHRyZW5kcy5wYXR0ZXJucyxcbiAgICAgICAgICAgICAgZGF3bl9waGVub21lbm9uOiB0cmVuZHMuZGF3blBoZW5vbWVub24sXG4gICAgICAgICAgICAgIG1lYWxfcmVzcG9uc2VfYXZlcmFnZTogdHJlbmRzLm1lYWxSZXNwb25zZSxcbiAgICAgICAgICAgICAgb3Zlcm5pZ2h0X3N0YWJpbGl0eTogdHJlbmRzLm92ZXJuaWdodFN0YWJpbGl0eVxuICAgICAgICAgICAgfSwgbnVsbCwgMilcbiAgICAgICAgICB9XVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBjYXNlICdnZXRfc2Vuc29yX2luZm8nOiB7XG4gICAgICAgIGlmICghY2xpZW50KSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdMaWJyZUxpbmtVcCBub3QgY29uZmlndXJlZC4gVXNlIGNvbmZpZ3VyZV9jcmVkZW50aWFscyBmaXJzdC4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlbnNvcnMgPSBhd2FpdCBjbGllbnQuZ2V0U2Vuc29ySW5mbygpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29udGVudDogW3tcbiAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIHRleHQ6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgYWN0aXZlX3NlbnNvcnM6IHNlbnNvcnMsXG4gICAgICAgICAgICAgIHNlbnNvcl9jb3VudDogc2Vuc29ycy5sZW5ndGhcbiAgICAgICAgICAgIH0sIG51bGwsIDIpXG4gICAgICAgICAgfV1cbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgY2FzZSAnY29uZmlndXJlX2NyZWRlbnRpYWxzJzoge1xuICAgICAgICBjb25zdCB7IGVtYWlsLCBwYXNzd29yZCwgcmVnaW9uIH0gPSBhcmdzIGFzIHtcbiAgICAgICAgICBlbWFpbDogc3RyaW5nO1xuICAgICAgICAgIHBhc3N3b3JkOiBzdHJpbmc7XG4gICAgICAgICAgcmVnaW9uPzogJ1VTJyB8ICdFVScgfCAnREUnIHwgJ0ZSJyB8ICdBUCcgfCAnQVUnXG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgY29uZmlnTWFuYWdlci51cGRhdGVDcmVkZW50aWFscyhlbWFpbCwgcGFzc3dvcmQpO1xuXG4gICAgICAgIGlmIChyZWdpb24pIHtcbiAgICAgICAgICBjb25maWdNYW5hZ2VyLnVwZGF0ZVJlZ2lvbihyZWdpb24pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVpbml0aWFsaXplIGNsaWVudCB3aXRoIG5ldyBjcmVkZW50aWFsc1xuICAgICAgICBhd2FpdCBpbml0aWFsaXplQ2xpZW50KCk7XG5cbiAgICAgICAgY29uc3QgcGF0aHMgPSBjb25maWdNYW5hZ2VyLmdldFNlY3VyZVN0b3JhZ2VQYXRocygpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29udGVudDogW3tcbiAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIHRleHQ6IGBMaWJyZUxpbmtVcCBjcmVkZW50aWFscyBjb25maWd1cmVkIHN1Y2Nlc3NmdWxseS5cXG5cXG5DcmVkZW50aWFscyBhcmUgc3RvcmVkIHNlY3VyZWx5Olxcbi0gRW5jcnlwdGVkIGZpbGU6ICR7cGF0aHMuY3JlZGVudGlhbHNQYXRofVxcbi0gRW5jcnlwdGlvbiBrZXk6IFN0b3JlZCBpbiBPUyBrZXljaGFpblxcblxcblVzZSB2YWxpZGF0ZV9jb25uZWN0aW9uIHRvIHRlc3QuYFxuICAgICAgICAgIH1dXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIGNhc2UgJ2NvbmZpZ3VyZV9yYW5nZXMnOiB7XG4gICAgICAgIGNvbnN0IHsgdGFyZ2V0X2xvdywgdGFyZ2V0X2hpZ2ggfSA9IGFyZ3MgYXMgeyB0YXJnZXRfbG93OiBudW1iZXI7IHRhcmdldF9oaWdoOiBudW1iZXIgfTtcblxuICAgICAgICBjb25maWdNYW5hZ2VyLnVwZGF0ZVJhbmdlcyh0YXJnZXRfbG93LCB0YXJnZXRfaGlnaCk7XG5cbiAgICAgICAgLy8gUmVpbml0aWFsaXplIGFuYWx5dGljcyB3aXRoIG5ldyByYW5nZXNcbiAgICAgICAgaWYgKGFuYWx5dGljcykge1xuICAgICAgICAgIGFuYWx5dGljcy51cGRhdGVDb25maWcoYXdhaXQgY29uZmlnTWFuYWdlci5nZXRDb25maWcoKSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbnRlbnQ6IFt7XG4gICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICB0ZXh0OiBgVGFyZ2V0IGdsdWNvc2UgcmFuZ2VzIHVwZGF0ZWQ6ICR7dGFyZ2V0X2xvd30tJHt0YXJnZXRfaGlnaH0gbWcvZExgXG4gICAgICAgICAgfV1cbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgY2FzZSAndmFsaWRhdGVfY29ubmVjdGlvbic6IHtcbiAgICAgICAgaWYgKCFjbGllbnQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpYnJlTGlua1VwIG5vdCBjb25maWd1cmVkLiBVc2UgY29uZmlndXJlX2NyZWRlbnRpYWxzIGZpcnN0LicpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaXNWYWxpZCA9IGF3YWl0IGNsaWVudC52YWxpZGF0ZUNvbm5lY3Rpb24oKTtcblxuICAgICAgICBpZiAoaXNWYWxpZCkge1xuICAgICAgICAgIGNvbnN0IGdsdWNvc2UgPSBhd2FpdCBjbGllbnQuZ2V0Q3VycmVudEdsdWNvc2UoKTtcbiAgICAgICAgICBjb25zdCBzZXNzaW9uU3RhdHVzID0gY2xpZW50LmdldFNlc3Npb25TdGF0dXMoKTtcblxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb250ZW50OiBbe1xuICAgICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgIHRleHQ6IGBMaWJyZUxpbmtVcCBjb25uZWN0aW9uIHZhbGlkYXRlZCBzdWNjZXNzZnVsbHkhXFxuXFxuQ3VycmVudCBnbHVjb3NlOiAke2dsdWNvc2UudmFsdWV9IG1nL2RMICgke2dsdWNvc2UudHJlbmR9KVxcblxcblNlc3Npb24gc3RhdHVzOlxcbi0gQXV0aGVudGljYXRlZDogJHtzZXNzaW9uU3RhdHVzLmF1dGhlbnRpY2F0ZWR9XFxuLSBUb2tlbiB2YWxpZDogJHtzZXNzaW9uU3RhdHVzLnRva2VuVmFsaWR9XFxuLSBFeHBpcmVzOiAke3Nlc3Npb25TdGF0dXMuZXhwaXJlc0F0Py50b0lTT1N0cmluZygpIHx8ICdOL0EnfWBcbiAgICAgICAgICAgIH1dXG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29udGVudDogW3tcbiAgICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICB0ZXh0OiAnTGlicmVMaW5rVXAgY29ubmVjdGlvbiBmYWlsZWQuIFBsZWFzZSBjaGVjazpcXG4xLiBZb3VyIGNyZWRlbnRpYWxzIGFyZSBjb3JyZWN0XFxuMi4gWW91IGhhdmUgYWNjZXB0ZWQgVGVybXMgJiBDb25kaXRpb25zIGluIExpYnJlTGlua1VwIGFwcFxcbjMuIFNvbWVvbmUgaXMgc2hhcmluZyBkYXRhIHdpdGggeW91IChvciB5b3Ugc2hhcmVkIHlvdXIgb3duKSdcbiAgICAgICAgICAgIH1dXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjYXNlICdnZXRfc2Vzc2lvbl9zdGF0dXMnOiB7XG4gICAgICAgIGlmICghY2xpZW50KSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvbnRlbnQ6IFt7XG4gICAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgICAgdGV4dDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIGNvbmZpZ3VyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdMaWJyZUxpbmtVcCBub3QgY29uZmlndXJlZC4gVXNlIGNvbmZpZ3VyZV9jcmVkZW50aWFscyBmaXJzdC4nXG4gICAgICAgICAgICAgIH0sIG51bGwsIDIpXG4gICAgICAgICAgICB9XVxuICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzdGF0dXMgPSBjbGllbnQuZ2V0U2Vzc2lvblN0YXR1cygpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29udGVudDogW3tcbiAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIHRleHQ6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgY29uZmlndXJlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgYXV0aGVudGljYXRlZDogc3RhdHVzLmF1dGhlbnRpY2F0ZWQsXG4gICAgICAgICAgICAgIHRva2VuX3ZhbGlkOiBzdGF0dXMudG9rZW5WYWxpZCxcbiAgICAgICAgICAgICAgZXhwaXJlc19hdDogc3RhdHVzLmV4cGlyZXNBdD8udG9JU09TdHJpbmcoKSB8fCBudWxsXG4gICAgICAgICAgICB9LCBudWxsLCAyKVxuICAgICAgICAgIH1dXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIGNhc2UgJ2NsZWFyX3Nlc3Npb24nOiB7XG4gICAgICAgIGlmIChjbGllbnQpIHtcbiAgICAgICAgICBhd2FpdCBjbGllbnQuY2xlYXJTZXNzaW9uKCk7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgY29uZmlnTWFuYWdlci5jbGVhclRva2VuKCk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb250ZW50OiBbe1xuICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgdGV4dDogJ1Nlc3Npb24gY2xlYXJlZC4gWW91IHdpbGwgbmVlZCB0byByZS1hdXRoZW50aWNhdGUgb24gdGhlIG5leHQgcmVxdWVzdC4nXG4gICAgICAgICAgfV1cbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHRvb2w6ICR7bmFtZX1gKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIGhhbmRsZUVycm9yKGVycm9yKTtcbiAgfVxufSk7XG5cbi8qKlxuICogTWFpbiBlbnRyeSBwb2ludFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFpbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gSW5pdGlhbGl6ZSBjbGllbnQgaWYgYWxyZWFkeSBjb25maWd1cmVkXG4gIGF3YWl0IGluaXRpYWxpemVDbGllbnQoKTtcblxuICAvLyBDcmVhdGUgc3RkaW8gdHJhbnNwb3J0XG4gIGNvbnN0IHRyYW5zcG9ydCA9IG5ldyBTdGRpb1NlcnZlclRyYW5zcG9ydCgpO1xuXG4gIC8vIENvbm5lY3Qgc2VydmVyIHRvIHRyYW5zcG9ydFxuICBhd2FpdCBzZXJ2ZXIuY29ubmVjdCh0cmFuc3BvcnQpO1xuXG4gIGNvbnNvbGUuZXJyb3IoJ0xpYnJlTGluayBNQ1AgU2VydmVyIHJ1bm5pbmcgb24gc3RkaW8gKHYxLjIuMCAtIFNlY3VyZSBjcmVkZW50aWFsIHN0b3JhZ2UpJyk7XG59XG5cbi8vIFJ1biBpZiBleGVjdXRlZCBkaXJlY3RseVxuLy8gRml4ZWQgY2hlY2sgZm9yIEVTTSBtb2R1bGVzIG9uIFdpbmRvd3NcbmNvbnN0IGlzTWFpbk1vZHVsZSA9IHByb2Nlc3MuYXJndlsxXSAmJiAoXG4gIGltcG9ydC5tZXRhLnVybCA9PT0gYGZpbGU6Ly8vJHtwcm9jZXNzLmFyZ3ZbMV0ucmVwbGFjZSgvXFxcXC9nLCAnLycpfWAgfHxcbiAgaW1wb3J0Lm1ldGEudXJsID09PSBgZmlsZTovLyR7cHJvY2Vzcy5hcmd2WzFdLnJlcGxhY2UoL1xcXFwvZywgJy8nKX1gIHx8XG4gIHByb2Nlc3MuYXJndlsxXS5lbmRzV2l0aCgnaW5kZXguanMnKVxuKTtcblxuaWYgKGlzTWFpbk1vZHVsZSkge1xuICBtYWluKCkuY2F0Y2goY29uc29sZS5lcnJvcik7XG59XG4iXX0=