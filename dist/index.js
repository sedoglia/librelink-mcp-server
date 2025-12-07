#!/usr/bin/env node
/**
 * LibreLink MCP Server - Fixed for API v4.16.0 (October 2025)
 *
 * This MCP server provides Claude Desktop with access to FreeStyle LibreLink
 * continuous glucose monitoring (CGM) data.
 *
 * Key fixes in this version:
 * - API version 4.16.0 support
 * - Account-Id header (SHA256 of userId) for authenticated requests
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
    version: '1.1.0'
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
function initializeClient() {
    const config = configManager.getConfig();
    if (configManager.isConfigured()) {
        client = new LibreLinkClient(config);
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
        description: 'Set up or update your LibreLinkUp account credentials for data access. Required before using any glucose reading tools. Credentials are stored securely on your local machine only.',
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
                configManager.updateCredentials(email, password);
                if (region) {
                    configManager.updateRegion(region);
                }
                // Reinitialize client with new credentials
                initializeClient();
                return {
                    content: [{
                            type: 'text',
                            text: 'LibreLinkUp credentials configured successfully. Use validate_connection to test.'
                        }]
                };
            }
            case 'configure_ranges': {
                const { target_low, target_high } = args;
                configManager.updateRanges(target_low, target_high);
                // Reinitialize analytics with new ranges
                if (analytics) {
                    analytics.updateConfig(configManager.getConfig());
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
                    return {
                        content: [{
                                type: 'text',
                                text: `LibreLinkUp connection validated successfully!\n\nCurrent glucose: ${glucose.value} mg/dL (${glucose.trend})`
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
    initializeClient();
    // Create stdio transport
    const transport = new StdioServerTransport();
    // Connect server to transport
    await server.connect(transport);
    console.error('LibreLink MCP Server running on stdio (v1.1.0 - Fixed for API v4.16.0)');
}
// Run if executed directly
// Fixed check for ESM modules on Windows
const isMainModule = process.argv[1] && (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` ||
    import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1].endsWith('index.js'));
if (isMainModule) {
    main().catch(console.error);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUVBOzs7Ozs7Ozs7R0FTRztBQUVILE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSwyQ0FBMkMsQ0FBQztBQUNuRSxPQUFPLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSwyQ0FBMkMsQ0FBQztBQUNqRixPQUFPLEVBQ0wscUJBQXFCLEVBQ3JCLHNCQUFzQixFQUN2QixNQUFNLG9DQUFvQyxDQUFDO0FBQzVDLE9BQU8sRUFBRSxlQUFlLEVBQUUsTUFBTSx1QkFBdUIsQ0FBQztBQUN4RCxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSx3QkFBd0IsQ0FBQztBQUMxRCxPQUFPLEVBQUUsYUFBYSxFQUFFLE1BQU0sYUFBYSxDQUFDO0FBRTVDLG9CQUFvQjtBQUNwQixNQUFNLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FDdkI7SUFDRSxJQUFJLEVBQUUsNEJBQTRCO0lBQ2xDLE9BQU8sRUFBRSxPQUFPO0NBQ2pCLEVBQ0Q7SUFDRSxZQUFZLEVBQUU7UUFDWixLQUFLLEVBQUUsRUFBRTtLQUNWO0NBQ0YsQ0FDRixDQUFDO0FBRUYsNEJBQTRCO0FBQzVCLE1BQU0sYUFBYSxHQUFHLElBQUksYUFBYSxFQUFFLENBQUM7QUFDMUMsSUFBSSxNQUFNLEdBQTJCLElBQUksQ0FBQztBQUMxQyxJQUFJLFNBQVMsR0FBNEIsSUFBSSxDQUFDO0FBRTlDOztHQUVHO0FBQ0gsU0FBUyxnQkFBZ0I7SUFDdkIsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLFNBQVMsRUFBRSxDQUFDO0lBRXpDLElBQUksYUFBYSxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUM7UUFDakMsTUFBTSxHQUFHLElBQUksZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3JDLFNBQVMsR0FBRyxJQUFJLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQzNDLENBQUM7QUFDSCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLFdBQVcsQ0FBQyxLQUFjO0lBQ2pDLE9BQU8sQ0FBQyxLQUFLLENBQUMsc0JBQXNCLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFFN0MsTUFBTSxPQUFPLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7SUFFbEYsT0FBTztRQUNMLE9BQU8sRUFBRSxDQUFDO2dCQUNSLElBQUksRUFBRSxNQUFNO2dCQUNaLElBQUksRUFBRSxVQUFVLE9BQU8sRUFBRTthQUMxQixDQUFDO0tBQ0gsQ0FBQztBQUNKLENBQUM7QUFFRCxtQkFBbUI7QUFDbkIsTUFBTSxLQUFLLEdBQUc7SUFDWjtRQUNFLElBQUksRUFBRSxxQkFBcUI7UUFDM0IsV0FBVyxFQUFFLDZPQUE2TztRQUMxUCxXQUFXLEVBQUU7WUFDWCxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVUsRUFBRSxFQUFFO1lBQ2QsUUFBUSxFQUFFLEVBQUU7U0FDYjtLQUNGO0lBQ0Q7UUFDRSxJQUFJLEVBQUUscUJBQXFCO1FBQzNCLFdBQVcsRUFBRSxzT0FBc087UUFDblAsV0FBVyxFQUFFO1lBQ1gsSUFBSSxFQUFFLFFBQVE7WUFDZCxVQUFVLEVBQUU7Z0JBQ1YsS0FBSyxFQUFFO29CQUNMLElBQUksRUFBRSxRQUFRO29CQUNkLFdBQVcsRUFBRSxtTUFBbU07aUJBQ2pOO2FBQ0Y7WUFDRCxRQUFRLEVBQUUsRUFBRTtTQUNiO0tBQ0Y7SUFDRDtRQUNFLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLGtPQUFrTztRQUMvTyxXQUFXLEVBQUU7WUFDWCxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVUsRUFBRTtnQkFDVixJQUFJLEVBQUU7b0JBQ0osSUFBSSxFQUFFLFFBQVE7b0JBQ2QsV0FBVyxFQUFFLG1HQUFtRztpQkFDakg7YUFDRjtZQUNELFFBQVEsRUFBRSxFQUFFO1NBQ2I7S0FDRjtJQUNEO1FBQ0UsSUFBSSxFQUFFLG9CQUFvQjtRQUMxQixXQUFXLEVBQUUsdU1BQXVNO1FBQ3BOLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFO2dCQUNWLE1BQU0sRUFBRTtvQkFDTixJQUFJLEVBQUUsUUFBUTtvQkFDZCxJQUFJLEVBQUUsQ0FBQyxPQUFPLEVBQUUsUUFBUSxFQUFFLFNBQVMsQ0FBQztvQkFDcEMsV0FBVyxFQUFFLHVIQUF1SDtpQkFDckk7YUFDRjtZQUNELFFBQVEsRUFBRSxFQUFFO1NBQ2I7S0FDRjtJQUNEO1FBQ0UsSUFBSSxFQUFFLGlCQUFpQjtRQUN2QixXQUFXLEVBQUUsc0xBQXNMO1FBQ25NLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFLEVBQUU7WUFDZCxRQUFRLEVBQUUsRUFBRTtTQUNiO0tBQ0Y7SUFDRDtRQUNFLElBQUksRUFBRSx1QkFBdUI7UUFDN0IsV0FBVyxFQUFFLHFMQUFxTDtRQUNsTSxXQUFXLEVBQUU7WUFDWCxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVUsRUFBRTtnQkFDVixLQUFLLEVBQUU7b0JBQ0wsSUFBSSxFQUFFLFFBQVE7b0JBQ2QsV0FBVyxFQUFFLHdDQUF3QztpQkFDdEQ7Z0JBQ0QsUUFBUSxFQUFFO29CQUNSLElBQUksRUFBRSxRQUFRO29CQUNkLFdBQVcsRUFBRSxtQ0FBbUM7aUJBQ2pEO2dCQUNELE1BQU0sRUFBRTtvQkFDTixJQUFJLEVBQUUsUUFBUTtvQkFDZCxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQztvQkFDMUMsV0FBVyxFQUFFLDhDQUE4QztpQkFDNUQ7YUFDRjtZQUNELFFBQVEsRUFBRSxDQUFDLE9BQU8sRUFBRSxVQUFVLENBQUM7U0FDaEM7S0FDRjtJQUNEO1FBQ0UsSUFBSSxFQUFFLGtCQUFrQjtRQUN4QixXQUFXLEVBQUUsZ0xBQWdMO1FBQzdMLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFO2dCQUNWLFVBQVUsRUFBRTtvQkFDVixJQUFJLEVBQUUsUUFBUTtvQkFDZCxXQUFXLEVBQUUsNERBQTREO2lCQUMxRTtnQkFDRCxXQUFXLEVBQUU7b0JBQ1gsSUFBSSxFQUFFLFFBQVE7b0JBQ2QsV0FBVyxFQUFFLDhEQUE4RDtpQkFDNUU7YUFDRjtZQUNELFFBQVEsRUFBRSxDQUFDLFlBQVksRUFBRSxhQUFhLENBQUM7U0FDeEM7S0FDRjtJQUNEO1FBQ0UsSUFBSSxFQUFFLHFCQUFxQjtRQUMzQixXQUFXLEVBQUUscUpBQXFKO1FBQ2xLLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFLEVBQUU7WUFDZCxRQUFRLEVBQUUsRUFBRTtTQUNiO0tBQ0Y7Q0FDRixDQUFDO0FBRUYscUJBQXFCO0FBQ3JCLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxzQkFBc0IsRUFBRSxLQUFLLElBQUksRUFBRTtJQUMxRCxPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFDbkIsQ0FBQyxDQUFDLENBQUM7QUFFSCxvQkFBb0I7QUFDcEIsTUFBTSxDQUFDLGlCQUFpQixDQUFDLHFCQUFxQixFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsRUFBRTtJQUNoRSxNQUFNLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO0lBRWpELElBQUksQ0FBQztRQUNILFFBQVEsSUFBSSxFQUFFLENBQUM7WUFDYixLQUFLLHFCQUFxQixDQUFDLENBQUMsQ0FBQztnQkFDM0IsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO29CQUNaLE1BQU0sSUFBSSxLQUFLLENBQUMsOERBQThELENBQUMsQ0FBQztnQkFDbEYsQ0FBQztnQkFFRCxNQUFNLE9BQU8sR0FBRyxNQUFNLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO2dCQUVqRCxPQUFPO29CQUNMLE9BQU8sRUFBRSxDQUFDOzRCQUNSLElBQUksRUFBRSxNQUFNOzRCQUNaLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dDQUNuQixlQUFlLEVBQUUsT0FBTyxDQUFDLEtBQUs7Z0NBQzlCLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUztnQ0FDNUIsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLO2dDQUNwQixNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFFBQVE7Z0NBQ2xFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSzs2QkFDckIsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO3lCQUNaLENBQUM7aUJBQ0gsQ0FBQztZQUNKLENBQUM7WUFFRCxLQUFLLHFCQUFxQixDQUFDLENBQUMsQ0FBQztnQkFDM0IsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO29CQUNaLE1BQU0sSUFBSSxLQUFLLENBQUMsOERBQThELENBQUMsQ0FBQztnQkFDbEYsQ0FBQztnQkFFRCxNQUFNLEtBQUssR0FBSSxJQUFJLEVBQUUsS0FBZ0IsSUFBSSxFQUFFLENBQUM7Z0JBQzVDLE1BQU0sT0FBTyxHQUFHLE1BQU0sTUFBTSxDQUFDLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUV0RCxPQUFPO29CQUNMLE9BQU8sRUFBRSxDQUFDOzRCQUNSLElBQUksRUFBRSxNQUFNOzRCQUNaLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dDQUNuQixZQUFZLEVBQUUsS0FBSztnQ0FDbkIsY0FBYyxFQUFFLE9BQU8sQ0FBQyxNQUFNO2dDQUM5QixRQUFRLEVBQUUsT0FBTzs2QkFDbEIsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO3lCQUNaLENBQUM7aUJBQ0gsQ0FBQztZQUNKLENBQUM7WUFFRCxLQUFLLG1CQUFtQixDQUFDLENBQUMsQ0FBQztnQkFDekIsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO29CQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLDhEQUE4RCxDQUFDLENBQUM7Z0JBQ2xGLENBQUM7Z0JBRUQsTUFBTSxJQUFJLEdBQUksSUFBSSxFQUFFLElBQWUsSUFBSSxDQUFDLENBQUM7Z0JBQ3pDLE1BQU0sUUFBUSxHQUFHLE1BQU0sTUFBTSxDQUFDLGlCQUFpQixDQUFDLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQztnQkFDM0QsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFDLHFCQUFxQixDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUV4RCxPQUFPO29CQUNMLE9BQU8sRUFBRSxDQUFDOzRCQUNSLElBQUksRUFBRSxNQUFNOzRCQUNaLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dDQUNuQixvQkFBb0IsRUFBRSxJQUFJO2dDQUMxQixlQUFlLEVBQUUsS0FBSyxDQUFDLE9BQU87Z0NBQzlCLDRCQUE0QixFQUFFLEtBQUssQ0FBQyxHQUFHO2dDQUN2QyxhQUFhLEVBQUU7b0NBQ2IsYUFBYSxFQUFFLEtBQUssQ0FBQyxXQUFXO29DQUNoQyxRQUFRLEVBQUUsS0FBSyxDQUFDLGNBQWM7b0NBQzlCLFNBQVMsRUFBRSxLQUFLLENBQUMsY0FBYztpQ0FDaEM7Z0NBQ0QsV0FBVyxFQUFFO29DQUNYLGtCQUFrQixFQUFFLEtBQUssQ0FBQyxpQkFBaUI7b0NBQzNDLHdCQUF3QixFQUFFLEtBQUssQ0FBQyxzQkFBc0I7aUNBQ3ZEO2dDQUNELGFBQWEsRUFBRSxLQUFLLENBQUMsWUFBWTs2QkFDbEMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO3lCQUNaLENBQUM7aUJBQ0gsQ0FBQztZQUNKLENBQUM7WUFFRCxLQUFLLG9CQUFvQixDQUFDLENBQUMsQ0FBQztnQkFDMUIsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO29CQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLDhEQUE4RCxDQUFDLENBQUM7Z0JBQ2xGLENBQUM7Z0JBRUQsTUFBTSxNQUFNLEdBQUksSUFBSSxFQUFFLE1BQXlDLElBQUksUUFBUSxDQUFDO2dCQUM1RSxNQUFNLGFBQWEsR0FBRyxNQUFNLEtBQUssT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUM1RSxNQUFNLFFBQVEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxhQUFhLEdBQUcsRUFBRSxDQUFDLENBQUM7Z0JBQ3BFLE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxhQUFhLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUV6RCxPQUFPO29CQUNMLE9BQU8sRUFBRSxDQUFDOzRCQUNSLElBQUksRUFBRSxNQUFNOzRCQUNaLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dDQUNuQixNQUFNLEVBQUUsTUFBTTtnQ0FDZCxRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVE7Z0NBQ3pCLGVBQWUsRUFBRSxNQUFNLENBQUMsY0FBYztnQ0FDdEMscUJBQXFCLEVBQUUsTUFBTSxDQUFDLFlBQVk7Z0NBQzFDLG1CQUFtQixFQUFFLE1BQU0sQ0FBQyxrQkFBa0I7NkJBQy9DLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQzt5QkFDWixDQUFDO2lCQUNILENBQUM7WUFDSixDQUFDO1lBRUQsS0FBSyxpQkFBaUIsQ0FBQyxDQUFDLENBQUM7Z0JBQ3ZCLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztvQkFDWixNQUFNLElBQUksS0FBSyxDQUFDLDhEQUE4RCxDQUFDLENBQUM7Z0JBQ2xGLENBQUM7Z0JBRUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxNQUFNLENBQUMsYUFBYSxFQUFFLENBQUM7Z0JBRTdDLE9BQU87b0JBQ0wsT0FBTyxFQUFFLENBQUM7NEJBQ1IsSUFBSSxFQUFFLE1BQU07NEJBQ1osSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0NBQ25CLGNBQWMsRUFBRSxPQUFPO2dDQUN2QixZQUFZLEVBQUUsT0FBTyxDQUFDLE1BQU07NkJBQzdCLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQzt5QkFDWixDQUFDO2lCQUNILENBQUM7WUFDSixDQUFDO1lBRUQsS0FBSyx1QkFBdUIsQ0FBQyxDQUFDLENBQUM7Z0JBQzdCLE1BQU0sRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxHQUFHLElBSW5DLENBQUM7Z0JBRUYsYUFBYSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQztnQkFFakQsSUFBSSxNQUFNLEVBQUUsQ0FBQztvQkFDWCxhQUFhLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUNyQyxDQUFDO2dCQUVELDJDQUEyQztnQkFDM0MsZ0JBQWdCLEVBQUUsQ0FBQztnQkFFbkIsT0FBTztvQkFDTCxPQUFPLEVBQUUsQ0FBQzs0QkFDUixJQUFJLEVBQUUsTUFBTTs0QkFDWixJQUFJLEVBQUUsbUZBQW1GO3lCQUMxRixDQUFDO2lCQUNILENBQUM7WUFDSixDQUFDO1lBRUQsS0FBSyxrQkFBa0IsQ0FBQyxDQUFDLENBQUM7Z0JBQ3hCLE1BQU0sRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLEdBQUcsSUFBbUQsQ0FBQztnQkFFeEYsYUFBYSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsV0FBVyxDQUFDLENBQUM7Z0JBRXBELHlDQUF5QztnQkFDekMsSUFBSSxTQUFTLEVBQUUsQ0FBQztvQkFDZCxTQUFTLENBQUMsWUFBWSxDQUFDLGFBQWEsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO2dCQUNwRCxDQUFDO2dCQUVELE9BQU87b0JBQ0wsT0FBTyxFQUFFLENBQUM7NEJBQ1IsSUFBSSxFQUFFLE1BQU07NEJBQ1osSUFBSSxFQUFFLGtDQUFrQyxVQUFVLElBQUksV0FBVyxRQUFRO3lCQUMxRSxDQUFDO2lCQUNILENBQUM7WUFDSixDQUFDO1lBRUQsS0FBSyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7Z0JBQzNCLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztvQkFDWixNQUFNLElBQUksS0FBSyxDQUFDLDhEQUE4RCxDQUFDLENBQUM7Z0JBQ2xGLENBQUM7Z0JBRUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxNQUFNLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztnQkFFbEQsSUFBSSxPQUFPLEVBQUUsQ0FBQztvQkFDWixNQUFNLE9BQU8sR0FBRyxNQUFNLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO29CQUNqRCxPQUFPO3dCQUNMLE9BQU8sRUFBRSxDQUFDO2dDQUNSLElBQUksRUFBRSxNQUFNO2dDQUNaLElBQUksRUFBRSxzRUFBc0UsT0FBTyxDQUFDLEtBQUssV0FBVyxPQUFPLENBQUMsS0FBSyxHQUFHOzZCQUNySCxDQUFDO3FCQUNILENBQUM7Z0JBQ0osQ0FBQztxQkFBTSxDQUFDO29CQUNOLE9BQU87d0JBQ0wsT0FBTyxFQUFFLENBQUM7Z0NBQ1IsSUFBSSxFQUFFLE1BQU07Z0NBQ1osSUFBSSxFQUFFLHlNQUF5TTs2QkFDaE4sQ0FBQztxQkFDSCxDQUFDO2dCQUNKLENBQUM7WUFDSCxDQUFDO1lBRUQ7Z0JBQ0UsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUM3QyxDQUFDO0lBQ0gsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixPQUFPLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUM1QixDQUFDO0FBQ0gsQ0FBQyxDQUFDLENBQUM7QUFFSDs7R0FFRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsSUFBSTtJQUN4QiwwQ0FBMEM7SUFDMUMsZ0JBQWdCLEVBQUUsQ0FBQztJQUVuQix5QkFBeUI7SUFDekIsTUFBTSxTQUFTLEdBQUcsSUFBSSxvQkFBb0IsRUFBRSxDQUFDO0lBRTdDLDhCQUE4QjtJQUM5QixNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7SUFFaEMsT0FBTyxDQUFDLEtBQUssQ0FBQyx3RUFBd0UsQ0FBQyxDQUFDO0FBQzFGLENBQUM7QUFFRCwyQkFBMkI7QUFDM0IseUNBQXlDO0FBQ3pDLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FDdEMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssV0FBVyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7SUFDcEUsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssVUFBVSxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7SUFDbkUsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQ3JDLENBQUM7QUFFRixJQUFJLFlBQVksRUFBRSxDQUFDO0lBQ2pCLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDOUIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcblxuLyoqXG4gKiBMaWJyZUxpbmsgTUNQIFNlcnZlciAtIEZpeGVkIGZvciBBUEkgdjQuMTYuMCAoT2N0b2JlciAyMDI1KVxuICogXG4gKiBUaGlzIE1DUCBzZXJ2ZXIgcHJvdmlkZXMgQ2xhdWRlIERlc2t0b3Agd2l0aCBhY2Nlc3MgdG8gRnJlZVN0eWxlIExpYnJlTGlua1xuICogY29udGludW91cyBnbHVjb3NlIG1vbml0b3JpbmcgKENHTSkgZGF0YS5cbiAqIFxuICogS2V5IGZpeGVzIGluIHRoaXMgdmVyc2lvbjpcbiAqIC0gQVBJIHZlcnNpb24gNC4xNi4wIHN1cHBvcnRcbiAqIC0gQWNjb3VudC1JZCBoZWFkZXIgKFNIQTI1NiBvZiB1c2VySWQpIGZvciBhdXRoZW50aWNhdGVkIHJlcXVlc3RzXG4gKi9cblxuaW1wb3J0IHsgU2VydmVyIH0gZnJvbSAnQG1vZGVsY29udGV4dHByb3RvY29sL3Nkay9zZXJ2ZXIvaW5kZXguanMnO1xuaW1wb3J0IHsgU3RkaW9TZXJ2ZXJUcmFuc3BvcnQgfSBmcm9tICdAbW9kZWxjb250ZXh0cHJvdG9jb2wvc2RrL3NlcnZlci9zdGRpby5qcyc7XG5pbXBvcnQgeyBcbiAgQ2FsbFRvb2xSZXF1ZXN0U2NoZW1hLCBcbiAgTGlzdFRvb2xzUmVxdWVzdFNjaGVtYSBcbn0gZnJvbSAnQG1vZGVsY29udGV4dHByb3RvY29sL3Nkay90eXBlcy5qcyc7XG5pbXBvcnQgeyBMaWJyZUxpbmtDbGllbnQgfSBmcm9tICcuL2xpYnJlbGluay1jbGllbnQuanMnO1xuaW1wb3J0IHsgR2x1Y29zZUFuYWx5dGljcyB9IGZyb20gJy4vZ2x1Y29zZS1hbmFseXRpY3MuanMnO1xuaW1wb3J0IHsgQ29uZmlnTWFuYWdlciB9IGZyb20gJy4vY29uZmlnLmpzJztcblxuLy8gQ3JlYXRlIE1DUCBzZXJ2ZXJcbmNvbnN0IHNlcnZlciA9IG5ldyBTZXJ2ZXIoXG4gIHtcbiAgICBuYW1lOiAnbGlicmVsaW5rLW1jcC1zZXJ2ZXItZml4ZWQnLFxuICAgIHZlcnNpb246ICcxLjEuMCdcbiAgfSxcbiAge1xuICAgIGNhcGFiaWxpdGllczoge1xuICAgICAgdG9vbHM6IHt9XG4gICAgfVxuICB9XG4pO1xuXG4vLyBDb25maWd1cmF0aW9uIGFuZCBjbGllbnRzXG5jb25zdCBjb25maWdNYW5hZ2VyID0gbmV3IENvbmZpZ01hbmFnZXIoKTtcbmxldCBjbGllbnQ6IExpYnJlTGlua0NsaWVudCB8IG51bGwgPSBudWxsO1xubGV0IGFuYWx5dGljczogR2x1Y29zZUFuYWx5dGljcyB8IG51bGwgPSBudWxsO1xuXG4vKipcbiAqIEluaXRpYWxpemUgTGlicmVMaW5rIGNsaWVudCBpZiBjb25maWd1cmVkXG4gKi9cbmZ1bmN0aW9uIGluaXRpYWxpemVDbGllbnQoKTogdm9pZCB7XG4gIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ01hbmFnZXIuZ2V0Q29uZmlnKCk7XG4gIFxuICBpZiAoY29uZmlnTWFuYWdlci5pc0NvbmZpZ3VyZWQoKSkge1xuICAgIGNsaWVudCA9IG5ldyBMaWJyZUxpbmtDbGllbnQoY29uZmlnKTtcbiAgICBhbmFseXRpY3MgPSBuZXcgR2x1Y29zZUFuYWx5dGljcyhjb25maWcpO1xuICB9XG59XG5cbi8qKlxuICogRm9ybWF0IGVycm9yIGZvciBNQ1AgcmVzcG9uc2VcbiAqL1xuZnVuY3Rpb24gaGFuZGxlRXJyb3IoZXJyb3I6IHVua25vd24pOiB7IGNvbnRlbnQ6IEFycmF5PHsgdHlwZTogc3RyaW5nOyB0ZXh0OiBzdHJpbmcgfT4gfSB7XG4gIGNvbnNvbGUuZXJyb3IoJ0xpYnJlTGluayBNQ1AgRXJyb3I6JywgZXJyb3IpO1xuICBcbiAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xuICBcbiAgcmV0dXJuIHtcbiAgICBjb250ZW50OiBbe1xuICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgdGV4dDogYEVycm9yOiAke21lc3NhZ2V9YFxuICAgIH1dXG4gIH07XG59XG5cbi8vIFRvb2wgZGVmaW5pdGlvbnNcbmNvbnN0IHRvb2xzID0gW1xuICB7XG4gICAgbmFtZTogJ2dldF9jdXJyZW50X2dsdWNvc2UnLFxuICAgIGRlc2NyaXB0aW9uOiAnR2V0IHRoZSBtb3N0IHJlY2VudCBnbHVjb3NlIHJlYWRpbmcgZnJvbSB5b3VyIEZyZWVTdHlsZSBMaWJyZSBzZW5zb3IuIFJldHVybnMgY3VycmVudCBnbHVjb3NlIHZhbHVlIGluIG1nL2RMLCB0cmVuZCBkaXJlY3Rpb24gKHJpc2luZy9mYWxsaW5nL3N0YWJsZSksIGFuZCB3aGV0aGVyIHRoZSB2YWx1ZSBpcyBpbiB0YXJnZXQgcmFuZ2UuIFVzZSB0aGlzIGZvciByZWFsLXRpbWUgZ2x1Y29zZSBtb25pdG9yaW5nLicsXG4gICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgICByZXF1aXJlZDogW11cbiAgICB9XG4gIH0sXG4gIHtcbiAgICBuYW1lOiAnZ2V0X2dsdWNvc2VfaGlzdG9yeScsXG4gICAgZGVzY3JpcHRpb246ICdSZXRyaWV2ZSBoaXN0b3JpY2FsIGdsdWNvc2UgcmVhZGluZ3MgZm9yIGFuYWx5c2lzLiBSZXR1cm5zIGFuIGFycmF5IG9mIHRpbWVzdGFtcGVkIGdsdWNvc2UgdmFsdWVzLiBVc2VmdWwgZm9yIHJldmlld2luZyBwYXN0IGdsdWNvc2UgbGV2ZWxzLCBpZGVudGlmeWluZyBwYXR0ZXJucywgb3IgY2hlY2tpbmcgb3Zlcm5pZ2h0IHZhbHVlcy4gRGVmYXVsdCByZXRyaWV2ZXMgMjQgaG91cnMgb2YgZGF0YS4nLFxuICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgaG91cnM6IHtcbiAgICAgICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ051bWJlciBvZiBob3VycyBvZiBoaXN0b3J5IHRvIHJldHJpZXZlICgxLTE2OCkuIERlZmF1bHQ6IDI0LiBFeGFtcGxlczogMSBmb3IgbGFzdCBob3VyLCA4IGZvciBvdmVybmlnaHQsIDE2OCBmb3Igb25lIHdlZWsuIE5vdGU6IExpYnJlTGlua1VwIG9ubHkgc3RvcmVzIGFwcHJveGltYXRlbHkgMTIgaG91cnMgb2YgZGV0YWlsZWQgZGF0YS4nXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICByZXF1aXJlZDogW11cbiAgICB9XG4gIH0sXG4gIHtcbiAgICBuYW1lOiAnZ2V0X2dsdWNvc2Vfc3RhdHMnLFxuICAgIGRlc2NyaXB0aW9uOiAnQ2FsY3VsYXRlIGNvbXByZWhlbnNpdmUgZ2x1Y29zZSBzdGF0aXN0aWNzIGluY2x1ZGluZyBhdmVyYWdlIGdsdWNvc2UsIEdNSSAoZXN0aW1hdGVkIEExQyksIHRpbWUtaW4tcmFuZ2UgcGVyY2VudGFnZXMsIGFuZCB2YXJpYWJpbGl0eSBtZXRyaWNzLiBFc3NlbnRpYWwgZm9yIGRpYWJldGVzIG1hbmFnZW1lbnQgaW5zaWdodHMgYW5kIGlkZW50aWZ5aW5nIGFyZWFzIGZvciBpbXByb3ZlbWVudC4nLFxuICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgZGF5czoge1xuICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTnVtYmVyIG9mIGRheXMgdG8gYW5hbHl6ZSAoMS0xNCkuIERlZmF1bHQ6IDcuIE5vdGU6IExpYnJlTGlua1VwIGRhdGEgYXZhaWxhYmlsaXR5IG1heSBiZSBsaW1pdGVkLidcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHJlcXVpcmVkOiBbXVxuICAgIH1cbiAgfSxcbiAge1xuICAgIG5hbWU6ICdnZXRfZ2x1Y29zZV90cmVuZHMnLFxuICAgIGRlc2NyaXB0aW9uOiAnQW5hbHl6ZSBnbHVjb3NlIHBhdHRlcm5zIGluY2x1ZGluZyBkYXduIHBoZW5vbWVub24gKGVhcmx5IG1vcm5pbmcgcmlzZSksIG1lYWwgcmVzcG9uc2VzLCBhbmQgb3Zlcm5pZ2h0IHN0YWJpbGl0eS4gSGVscHMgaWRlbnRpZnkgcmVjdXJyaW5nIHBhdHRlcm5zIHRoYXQgbWF5IG5lZWQgYXR0ZW50aW9uIG9yIHRyZWF0bWVudCBhZGp1c3RtZW50cy4nLFxuICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgcGVyaW9kOiB7XG4gICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgZW51bTogWydkYWlseScsICd3ZWVrbHknLCAnbW9udGhseSddLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQW5hbHlzaXMgcGVyaW9kIGZvciBwYXR0ZXJuIGRldGVjdGlvbi4gRGVmYXVsdDogd2Vla2x5LiBVc2UgZGFpbHkgZm9yIGRldGFpbGVkIHBhdHRlcm5zLCB3ZWVrbHkgZm9yIHR5cGljYWwgcGF0dGVybnMuJ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgcmVxdWlyZWQ6IFtdXG4gICAgfVxuICB9LFxuICB7XG4gICAgbmFtZTogJ2dldF9zZW5zb3JfaW5mbycsXG4gICAgZGVzY3JpcHRpb246ICdHZXQgaW5mb3JtYXRpb24gYWJvdXQgeW91ciBhY3RpdmUgRnJlZVN0eWxlIExpYnJlIHNlbnNvciBpbmNsdWRpbmcgc2VyaWFsIG51bWJlciwgYWN0aXZhdGlvbiBkYXRlLCBhbmQgc3RhdHVzLiBVc2UgdGhpcyB0byBjaGVjayBpZiBzZW5zb3IgaXMgd29ya2luZyBwcm9wZXJseSBvciBuZWVkcyByZXBsYWNlbWVudC4nLFxuICAgIGlucHV0U2NoZW1hOiB7XG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgICAgcmVxdWlyZWQ6IFtdXG4gICAgfVxuICB9LFxuICB7XG4gICAgbmFtZTogJ2NvbmZpZ3VyZV9jcmVkZW50aWFscycsXG4gICAgZGVzY3JpcHRpb246ICdTZXQgdXAgb3IgdXBkYXRlIHlvdXIgTGlicmVMaW5rVXAgYWNjb3VudCBjcmVkZW50aWFscyBmb3IgZGF0YSBhY2Nlc3MuIFJlcXVpcmVkIGJlZm9yZSB1c2luZyBhbnkgZ2x1Y29zZSByZWFkaW5nIHRvb2xzLiBDcmVkZW50aWFscyBhcmUgc3RvcmVkIHNlY3VyZWx5IG9uIHlvdXIgbG9jYWwgbWFjaGluZSBvbmx5LicsXG4gICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBlbWFpbDoge1xuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnWW91ciBMaWJyZUxpbmtVcCBhY2NvdW50IGVtYWlsIGFkZHJlc3MnXG4gICAgICAgIH0sXG4gICAgICAgIHBhc3N3b3JkOiB7XG4gICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdZb3VyIExpYnJlTGlua1VwIGFjY291bnQgcGFzc3dvcmQnXG4gICAgICAgIH0sXG4gICAgICAgIHJlZ2lvbjoge1xuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgIGVudW06IFsnVVMnLCAnRVUnLCAnREUnLCAnRlInLCAnQVAnLCAnQVUnXSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1lvdXIgTGlicmVMaW5rVXAgYWNjb3VudCByZWdpb24uIERlZmF1bHQ6IEVVJ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgcmVxdWlyZWQ6IFsnZW1haWwnLCAncGFzc3dvcmQnXVxuICAgIH1cbiAgfSxcbiAge1xuICAgIG5hbWU6ICdjb25maWd1cmVfcmFuZ2VzJyxcbiAgICBkZXNjcmlwdGlvbjogJ0N1c3RvbWl6ZSB5b3VyIHRhcmdldCBnbHVjb3NlIHJhbmdlIGZvciBwZXJzb25hbGl6ZWQgdGltZS1pbi1yYW5nZSBjYWxjdWxhdGlvbnMuIFN0YW5kYXJkIHJhbmdlIGlzIDcwLTE4MCBtZy9kTCwgYnV0IHlvdXIgaGVhbHRoY2FyZSBwcm92aWRlciBtYXkgcmVjb21tZW5kIGRpZmZlcmVudCB0YXJnZXRzLicsXG4gICAgaW5wdXRTY2hlbWE6IHtcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICB0YXJnZXRfbG93OiB7XG4gICAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdMb3dlciBib3VuZCBvZiB0YXJnZXQgcmFuZ2UgaW4gbWcvZEwgKDQwLTEwMCkuIERlZmF1bHQ6IDcwJ1xuICAgICAgICB9LFxuICAgICAgICB0YXJnZXRfaGlnaDoge1xuICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVXBwZXIgYm91bmQgb2YgdGFyZ2V0IHJhbmdlIGluIG1nL2RMICgxMDAtMzAwKS4gRGVmYXVsdDogMTgwJ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgcmVxdWlyZWQ6IFsndGFyZ2V0X2xvdycsICd0YXJnZXRfaGlnaCddXG4gICAgfVxuICB9LFxuICB7XG4gICAgbmFtZTogJ3ZhbGlkYXRlX2Nvbm5lY3Rpb24nLFxuICAgIGRlc2NyaXB0aW9uOiAnVGVzdCB0aGUgY29ubmVjdGlvbiB0byBMaWJyZUxpbmtVcCBzZXJ2ZXJzIGFuZCB2ZXJpZnkgeW91ciBjcmVkZW50aWFscyBhcmUgd29ya2luZy4gVXNlIHRoaXMgaWYgeW91IGVuY291bnRlciBlcnJvcnMgb3IgYWZ0ZXIgdXBkYXRpbmcgY3JlZGVudGlhbHMuJyxcbiAgICBpbnB1dFNjaGVtYToge1xuICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICAgIHJlcXVpcmVkOiBbXVxuICAgIH1cbiAgfVxuXTtcblxuLy8gTGlzdCB0b29scyBoYW5kbGVyXG5zZXJ2ZXIuc2V0UmVxdWVzdEhhbmRsZXIoTGlzdFRvb2xzUmVxdWVzdFNjaGVtYSwgYXN5bmMgKCkgPT4ge1xuICByZXR1cm4geyB0b29scyB9O1xufSk7XG5cbi8vIENhbGwgdG9vbCBoYW5kbGVyXG5zZXJ2ZXIuc2V0UmVxdWVzdEhhbmRsZXIoQ2FsbFRvb2xSZXF1ZXN0U2NoZW1hLCBhc3luYyAocmVxdWVzdCkgPT4ge1xuICBjb25zdCB7IG5hbWUsIGFyZ3VtZW50czogYXJncyB9ID0gcmVxdWVzdC5wYXJhbXM7XG5cbiAgdHJ5IHtcbiAgICBzd2l0Y2ggKG5hbWUpIHtcbiAgICAgIGNhc2UgJ2dldF9jdXJyZW50X2dsdWNvc2UnOiB7XG4gICAgICAgIGlmICghY2xpZW50KSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdMaWJyZUxpbmtVcCBub3QgY29uZmlndXJlZC4gVXNlIGNvbmZpZ3VyZV9jcmVkZW50aWFscyBmaXJzdC4nKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3QgcmVhZGluZyA9IGF3YWl0IGNsaWVudC5nZXRDdXJyZW50R2x1Y29zZSgpO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb250ZW50OiBbe1xuICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgdGV4dDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICBjdXJyZW50X2dsdWNvc2U6IHJlYWRpbmcudmFsdWUsXG4gICAgICAgICAgICAgIHRpbWVzdGFtcDogcmVhZGluZy50aW1lc3RhbXAsXG4gICAgICAgICAgICAgIHRyZW5kOiByZWFkaW5nLnRyZW5kLFxuICAgICAgICAgICAgICBzdGF0dXM6IHJlYWRpbmcuaXNIaWdoID8gJ0hpZ2gnIDogcmVhZGluZy5pc0xvdyA/ICdMb3cnIDogJ05vcm1hbCcsXG4gICAgICAgICAgICAgIGNvbG9yOiByZWFkaW5nLmNvbG9yXG4gICAgICAgICAgICB9LCBudWxsLCAyKVxuICAgICAgICAgIH1dXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIGNhc2UgJ2dldF9nbHVjb3NlX2hpc3RvcnknOiB7XG4gICAgICAgIGlmICghY2xpZW50KSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdMaWJyZUxpbmtVcCBub3QgY29uZmlndXJlZC4gVXNlIGNvbmZpZ3VyZV9jcmVkZW50aWFscyBmaXJzdC4nKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3QgaG91cnMgPSAoYXJncz8uaG91cnMgYXMgbnVtYmVyKSB8fCAyNDtcbiAgICAgICAgY29uc3QgaGlzdG9yeSA9IGF3YWl0IGNsaWVudC5nZXRHbHVjb3NlSGlzdG9yeShob3Vycyk7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbnRlbnQ6IFt7XG4gICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICB0ZXh0OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgIHBlcmlvZF9ob3VyczogaG91cnMsXG4gICAgICAgICAgICAgIHRvdGFsX3JlYWRpbmdzOiBoaXN0b3J5Lmxlbmd0aCxcbiAgICAgICAgICAgICAgcmVhZGluZ3M6IGhpc3RvcnlcbiAgICAgICAgICAgIH0sIG51bGwsIDIpXG4gICAgICAgICAgfV1cbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgY2FzZSAnZ2V0X2dsdWNvc2Vfc3RhdHMnOiB7XG4gICAgICAgIGlmICghY2xpZW50IHx8ICFhbmFseXRpY3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpYnJlTGlua1VwIG5vdCBjb25maWd1cmVkLiBVc2UgY29uZmlndXJlX2NyZWRlbnRpYWxzIGZpcnN0LicpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBkYXlzID0gKGFyZ3M/LmRheXMgYXMgbnVtYmVyKSB8fCA3O1xuICAgICAgICBjb25zdCByZWFkaW5ncyA9IGF3YWl0IGNsaWVudC5nZXRHbHVjb3NlSGlzdG9yeShkYXlzICogMjQpO1xuICAgICAgICBjb25zdCBzdGF0cyA9IGFuYWx5dGljcy5jYWxjdWxhdGVHbHVjb3NlU3RhdHMocmVhZGluZ3MpO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb250ZW50OiBbe1xuICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgdGV4dDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICBhbmFseXNpc19wZXJpb2RfZGF5czogZGF5cyxcbiAgICAgICAgICAgICAgYXZlcmFnZV9nbHVjb3NlOiBzdGF0cy5hdmVyYWdlLFxuICAgICAgICAgICAgICBnbHVjb3NlX21hbmFnZW1lbnRfaW5kaWNhdG9yOiBzdGF0cy5nbWksXG4gICAgICAgICAgICAgIHRpbWVfaW5fcmFuZ2U6IHtcbiAgICAgICAgICAgICAgICB0YXJnZXRfNzBfMTgwOiBzdGF0cy50aW1lSW5SYW5nZSxcbiAgICAgICAgICAgICAgICBiZWxvd183MDogc3RhdHMudGltZUJlbG93UmFuZ2UsXG4gICAgICAgICAgICAgICAgYWJvdmVfMTgwOiBzdGF0cy50aW1lQWJvdmVSYW5nZVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB2YXJpYWJpbGl0eToge1xuICAgICAgICAgICAgICAgIHN0YW5kYXJkX2RldmlhdGlvbjogc3RhdHMuc3RhbmRhcmREZXZpYXRpb24sXG4gICAgICAgICAgICAgICAgY29lZmZpY2llbnRfb2ZfdmFyaWF0aW9uOiBzdGF0cy5jb2VmZmljaWVudE9mVmFyaWF0aW9uXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHJlYWRpbmdfY291bnQ6IHN0YXRzLnJlYWRpbmdDb3VudFxuICAgICAgICAgICAgfSwgbnVsbCwgMilcbiAgICAgICAgICB9XVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBjYXNlICdnZXRfZ2x1Y29zZV90cmVuZHMnOiB7XG4gICAgICAgIGlmICghY2xpZW50IHx8ICFhbmFseXRpY3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpYnJlTGlua1VwIG5vdCBjb25maWd1cmVkLiBVc2UgY29uZmlndXJlX2NyZWRlbnRpYWxzIGZpcnN0LicpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBwZXJpb2QgPSAoYXJncz8ucGVyaW9kIGFzICdkYWlseScgfCAnd2Vla2x5JyB8ICdtb250aGx5JykgfHwgJ3dlZWtseSc7XG4gICAgICAgIGNvbnN0IGRheXNUb0FuYWx5emUgPSBwZXJpb2QgPT09ICdkYWlseScgPyAxIDogcGVyaW9kID09PSAnd2Vla2x5JyA/IDcgOiAzMDtcbiAgICAgICAgY29uc3QgcmVhZGluZ3MgPSBhd2FpdCBjbGllbnQuZ2V0R2x1Y29zZUhpc3RvcnkoZGF5c1RvQW5hbHl6ZSAqIDI0KTtcbiAgICAgICAgY29uc3QgdHJlbmRzID0gYW5hbHl0aWNzLmFuYWx5emVUcmVuZHMocmVhZGluZ3MsIHBlcmlvZCk7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbnRlbnQ6IFt7XG4gICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICB0ZXh0OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgIHBlcmlvZDogcGVyaW9kLFxuICAgICAgICAgICAgICBwYXR0ZXJuczogdHJlbmRzLnBhdHRlcm5zLFxuICAgICAgICAgICAgICBkYXduX3BoZW5vbWVub246IHRyZW5kcy5kYXduUGhlbm9tZW5vbixcbiAgICAgICAgICAgICAgbWVhbF9yZXNwb25zZV9hdmVyYWdlOiB0cmVuZHMubWVhbFJlc3BvbnNlLFxuICAgICAgICAgICAgICBvdmVybmlnaHRfc3RhYmlsaXR5OiB0cmVuZHMub3Zlcm5pZ2h0U3RhYmlsaXR5XG4gICAgICAgICAgICB9LCBudWxsLCAyKVxuICAgICAgICAgIH1dXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIGNhc2UgJ2dldF9zZW5zb3JfaW5mbyc6IHtcbiAgICAgICAgaWYgKCFjbGllbnQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpYnJlTGlua1VwIG5vdCBjb25maWd1cmVkLiBVc2UgY29uZmlndXJlX2NyZWRlbnRpYWxzIGZpcnN0LicpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBzZW5zb3JzID0gYXdhaXQgY2xpZW50LmdldFNlbnNvckluZm8oKTtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29udGVudDogW3tcbiAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIHRleHQ6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgYWN0aXZlX3NlbnNvcnM6IHNlbnNvcnMsXG4gICAgICAgICAgICAgIHNlbnNvcl9jb3VudDogc2Vuc29ycy5sZW5ndGhcbiAgICAgICAgICAgIH0sIG51bGwsIDIpXG4gICAgICAgICAgfV1cbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgY2FzZSAnY29uZmlndXJlX2NyZWRlbnRpYWxzJzoge1xuICAgICAgICBjb25zdCB7IGVtYWlsLCBwYXNzd29yZCwgcmVnaW9uIH0gPSBhcmdzIGFzIHsgXG4gICAgICAgICAgZW1haWw6IHN0cmluZzsgXG4gICAgICAgICAgcGFzc3dvcmQ6IHN0cmluZzsgXG4gICAgICAgICAgcmVnaW9uPzogJ1VTJyB8ICdFVScgfCAnREUnIHwgJ0ZSJyB8ICdBUCcgfCAnQVUnIFxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgY29uZmlnTWFuYWdlci51cGRhdGVDcmVkZW50aWFscyhlbWFpbCwgcGFzc3dvcmQpO1xuICAgICAgICBcbiAgICAgICAgaWYgKHJlZ2lvbikge1xuICAgICAgICAgIGNvbmZpZ01hbmFnZXIudXBkYXRlUmVnaW9uKHJlZ2lvbik7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIFJlaW5pdGlhbGl6ZSBjbGllbnQgd2l0aCBuZXcgY3JlZGVudGlhbHNcbiAgICAgICAgaW5pdGlhbGl6ZUNsaWVudCgpO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb250ZW50OiBbe1xuICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgdGV4dDogJ0xpYnJlTGlua1VwIGNyZWRlbnRpYWxzIGNvbmZpZ3VyZWQgc3VjY2Vzc2Z1bGx5LiBVc2UgdmFsaWRhdGVfY29ubmVjdGlvbiB0byB0ZXN0LidcbiAgICAgICAgICB9XVxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICBjYXNlICdjb25maWd1cmVfcmFuZ2VzJzoge1xuICAgICAgICBjb25zdCB7IHRhcmdldF9sb3csIHRhcmdldF9oaWdoIH0gPSBhcmdzIGFzIHsgdGFyZ2V0X2xvdzogbnVtYmVyOyB0YXJnZXRfaGlnaDogbnVtYmVyIH07XG4gICAgICAgIFxuICAgICAgICBjb25maWdNYW5hZ2VyLnVwZGF0ZVJhbmdlcyh0YXJnZXRfbG93LCB0YXJnZXRfaGlnaCk7XG4gICAgICAgIFxuICAgICAgICAvLyBSZWluaXRpYWxpemUgYW5hbHl0aWNzIHdpdGggbmV3IHJhbmdlc1xuICAgICAgICBpZiAoYW5hbHl0aWNzKSB7XG4gICAgICAgICAgYW5hbHl0aWNzLnVwZGF0ZUNvbmZpZyhjb25maWdNYW5hZ2VyLmdldENvbmZpZygpKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb250ZW50OiBbe1xuICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgdGV4dDogYFRhcmdldCBnbHVjb3NlIHJhbmdlcyB1cGRhdGVkOiAke3RhcmdldF9sb3d9LSR7dGFyZ2V0X2hpZ2h9IG1nL2RMYFxuICAgICAgICAgIH1dXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIGNhc2UgJ3ZhbGlkYXRlX2Nvbm5lY3Rpb24nOiB7XG4gICAgICAgIGlmICghY2xpZW50KSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdMaWJyZUxpbmtVcCBub3QgY29uZmlndXJlZC4gVXNlIGNvbmZpZ3VyZV9jcmVkZW50aWFscyBmaXJzdC4nKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3QgaXNWYWxpZCA9IGF3YWl0IGNsaWVudC52YWxpZGF0ZUNvbm5lY3Rpb24oKTtcbiAgICAgICAgXG4gICAgICAgIGlmIChpc1ZhbGlkKSB7XG4gICAgICAgICAgY29uc3QgZ2x1Y29zZSA9IGF3YWl0IGNsaWVudC5nZXRDdXJyZW50R2x1Y29zZSgpO1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb250ZW50OiBbe1xuICAgICAgICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgIHRleHQ6IGBMaWJyZUxpbmtVcCBjb25uZWN0aW9uIHZhbGlkYXRlZCBzdWNjZXNzZnVsbHkhXFxuXFxuQ3VycmVudCBnbHVjb3NlOiAke2dsdWNvc2UudmFsdWV9IG1nL2RMICgke2dsdWNvc2UudHJlbmR9KWBcbiAgICAgICAgICAgIH1dXG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29udGVudDogW3tcbiAgICAgICAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICB0ZXh0OiAnTGlicmVMaW5rVXAgY29ubmVjdGlvbiBmYWlsZWQuIFBsZWFzZSBjaGVjazpcXG4xLiBZb3VyIGNyZWRlbnRpYWxzIGFyZSBjb3JyZWN0XFxuMi4gWW91IGhhdmUgYWNjZXB0ZWQgVGVybXMgJiBDb25kaXRpb25zIGluIExpYnJlTGlua1VwIGFwcFxcbjMuIFNvbWVvbmUgaXMgc2hhcmluZyBkYXRhIHdpdGggeW91IChvciB5b3Ugc2hhcmVkIHlvdXIgb3duKSdcbiAgICAgICAgICAgIH1dXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gdG9vbDogJHtuYW1lfWApO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4gaGFuZGxlRXJyb3IoZXJyb3IpO1xuICB9XG59KTtcblxuLyoqXG4gKiBNYWluIGVudHJ5IHBvaW50XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYWluKCk6IFByb21pc2U8dm9pZD4ge1xuICAvLyBJbml0aWFsaXplIGNsaWVudCBpZiBhbHJlYWR5IGNvbmZpZ3VyZWRcbiAgaW5pdGlhbGl6ZUNsaWVudCgpO1xuICBcbiAgLy8gQ3JlYXRlIHN0ZGlvIHRyYW5zcG9ydFxuICBjb25zdCB0cmFuc3BvcnQgPSBuZXcgU3RkaW9TZXJ2ZXJUcmFuc3BvcnQoKTtcbiAgXG4gIC8vIENvbm5lY3Qgc2VydmVyIHRvIHRyYW5zcG9ydFxuICBhd2FpdCBzZXJ2ZXIuY29ubmVjdCh0cmFuc3BvcnQpO1xuICBcbiAgY29uc29sZS5lcnJvcignTGlicmVMaW5rIE1DUCBTZXJ2ZXIgcnVubmluZyBvbiBzdGRpbyAodjEuMS4wIC0gRml4ZWQgZm9yIEFQSSB2NC4xNi4wKScpO1xufVxuXG4vLyBSdW4gaWYgZXhlY3V0ZWQgZGlyZWN0bHlcbi8vIEZpeGVkIGNoZWNrIGZvciBFU00gbW9kdWxlcyBvbiBXaW5kb3dzXG5jb25zdCBpc01haW5Nb2R1bGUgPSBwcm9jZXNzLmFyZ3ZbMV0gJiYgKFxuICBpbXBvcnQubWV0YS51cmwgPT09IGBmaWxlOi8vLyR7cHJvY2Vzcy5hcmd2WzFdLnJlcGxhY2UoL1xcXFwvZywgJy8nKX1gIHx8XG4gIGltcG9ydC5tZXRhLnVybCA9PT0gYGZpbGU6Ly8ke3Byb2Nlc3MuYXJndlsxXS5yZXBsYWNlKC9cXFxcL2csICcvJyl9YCB8fFxuICBwcm9jZXNzLmFyZ3ZbMV0uZW5kc1dpdGgoJ2luZGV4LmpzJylcbik7XG5cbmlmIChpc01haW5Nb2R1bGUpIHtcbiAgbWFpbigpLmNhdGNoKGNvbnNvbGUuZXJyb3IpO1xufVxuIl19