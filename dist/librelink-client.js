/**
 * LibreLink API Client - Fixed for v4.16.0 (October 2025)
 *
 * This client implements the required changes:
 * 1. API version header set to 4.16.0
 * 2. Account-Id header (SHA256 hash of userId) required for all authenticated requests
 */
import axios from 'axios';
import { createHash } from 'crypto';
import { TREND_MAP, LIBRE_LINK_SERVERS, getGlucoseColor } from './types.js';
// Default client version - CRITICAL: Must be 4.16.0 or higher as of October 8, 2025
const DEFAULT_CLIENT_VERSION = '4.16.0';
// API endpoints
const ENDPOINTS = {
    login: '/llu/auth/login',
    connections: '/llu/connections',
    graph: (patientId) => `/llu/connections/${patientId}/graph`,
    logbook: (patientId) => `/llu/connections/${patientId}/logbook`
};
/**
 * Generate Account-Id header from user ID
 * This is REQUIRED for API version 4.16.0+
 * The Account-Id is a SHA256 hash of the user's UUID
 */
function generateAccountId(userId) {
    return createHash('sha256').update(userId).digest('hex');
}
/**
 * Convert raw glucose item to GlucoseReading
 */
function mapGlucoseItem(item, targetLow, targetHigh) {
    return {
        value: item.ValueInMgPerDl,
        timestamp: item.Timestamp,
        trend: TREND_MAP[item.TrendArrow || 3] || 'Flat',
        trendArrow: item.TrendArrow || 3,
        isHigh: item.isHigh,
        isLow: item.isLow,
        color: getGlucoseColor(item.ValueInMgPerDl, targetLow, targetHigh)
    };
}
export class LibreLinkClient {
    constructor(config) {
        this.jwtToken = null;
        this.userId = null;
        this.accountId = null;
        this.patientId = null;
        this.tokenExpires = 0;
        this.config = {
            ...config,
            clientVersion: config.clientVersion || DEFAULT_CLIENT_VERSION
        };
        this.baseUrl = LIBRE_LINK_SERVERS[config.region] || LIBRE_LINK_SERVERS['GLOBAL'];
    }
    /**
     * Create axios instance with default headers
     */
    createClient() {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip',
            'Cache-Control': 'no-cache',
            'Connection': 'Keep-Alive',
            'product': 'llu.android',
            'version': this.config.clientVersion
        };
        return axios.create({
            baseURL: this.baseUrl,
            headers,
            timeout: 30000
        });
    }
    /**
     * Create authenticated axios instance with JWT token and Account-Id
     * CRITICAL: Account-Id header is REQUIRED for v4.16.0+
     */
    createAuthenticatedClient() {
        if (!this.jwtToken || !this.accountId) {
            throw new Error('Not authenticated. Call login() first.');
        }
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Accept-Encoding': 'gzip',
            'Cache-Control': 'no-cache',
            'Connection': 'Keep-Alive',
            'product': 'llu.android',
            'version': this.config.clientVersion,
            'Authorization': `Bearer ${this.jwtToken}`,
            'Account-Id': this.accountId // CRITICAL: Required for v4.16.0+
        };
        return axios.create({
            baseURL: this.baseUrl,
            headers,
            timeout: 30000
        });
    }
    /**
     * Check if current token is valid
     */
    isTokenValid() {
        if (!this.jwtToken || !this.accountId)
            return false;
        // Add 5 minute buffer before expiration
        return Date.now() < (this.tokenExpires - 300000);
    }
    /**
     * Login to LibreLinkUp and get JWT token
     */
    async login() {
        const client = this.createClient();
        try {
            const response = await client.post(ENDPOINTS.login, {
                email: this.config.email,
                password: this.config.password
            });
            const data = response.data;
            // Check for region redirect
            if (data.data.redirect && data.data.region) {
                const newRegion = data.data.region.toUpperCase();
                // Update base URL for the correct region
                if (LIBRE_LINK_SERVERS[newRegion]) {
                    this.baseUrl = LIBRE_LINK_SERVERS[newRegion];
                }
                else {
                    this.baseUrl = `https://api-${data.data.region}.libreview.io`;
                }
                // Retry login with correct region
                return this.login();
            }
            // Check for successful login
            if (data.status !== 0 || !data.data.authTicket) {
                throw new Error('Login failed: Invalid response from LibreLink API');
            }
            // Store authentication data
            this.jwtToken = data.data.authTicket.token;
            this.tokenExpires = data.data.authTicket.expires * 1000; // Convert to milliseconds
            this.userId = data.data.user.id;
            // CRITICAL: Generate Account-Id from user ID (required for v4.16.0+)
            this.accountId = generateAccountId(this.userId);
            console.error(`LibreLink: Logged in as ${data.data.user.firstName} ${data.data.user.lastName}`);
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error;
                if (axiosError.response?.status === 403) {
                    const responseData = axiosError.response.data;
                    if (responseData?.data?.minimumVersion) {
                        throw new Error(`API requires minimum version ${responseData.data.minimumVersion}. ` +
                            `Current version: ${this.config.clientVersion}. ` +
                            `Please update to the latest version of librelink-mcp-server-fixed.`);
                    }
                    if (responseData?.message === 'RequiredHeaderMissing') {
                        throw new Error('Required header missing. This usually means the Account-Id header is not being sent. ' +
                            'Please ensure you are using the fixed version of the library.');
                    }
                }
                if (axiosError.response?.status === 401) {
                    throw new Error('Authentication failed. Please check your email and password.');
                }
                throw new Error(`Login failed: ${axiosError.message}`);
            }
            throw error;
        }
    }
    /**
     * Ensure we have a valid authenticated session
     */
    async ensureAuthenticated() {
        if (!this.isTokenValid()) {
            await this.login();
        }
    }
    /**
     * Get all connections (patients sharing data)
     */
    async getConnections() {
        await this.ensureAuthenticated();
        const client = this.createAuthenticatedClient();
        try {
            const response = await client.get(ENDPOINTS.connections);
            return response.data.data || [];
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                // Token expired, re-login and retry
                this.jwtToken = null;
                await this.ensureAuthenticated();
                return this.getConnections();
            }
            throw error;
        }
    }
    /**
     * Get patient ID (first connection)
     */
    async getPatientId() {
        if (this.patientId) {
            return this.patientId;
        }
        const connections = await this.getConnections();
        if (connections.length === 0) {
            throw new Error('No connections found. Please ensure:\n' +
                '1. You are using LibreLinkUp credentials (not LibreLink)\n' +
                '2. Someone is sharing their data with you via LibreLinkUp\n' +
                '3. You have accepted the latest Terms and Conditions in the LibreLinkUp app');
        }
        this.patientId = connections[0].patientId;
        return this.patientId;
    }
    /**
     * Get graph data (glucose readings for last 12 hours)
     */
    async getGraphData() {
        await this.ensureAuthenticated();
        const patientId = await this.getPatientId();
        const client = this.createAuthenticatedClient();
        try {
            const response = await client.get(ENDPOINTS.graph(patientId));
            return response.data.data;
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                this.jwtToken = null;
                await this.ensureAuthenticated();
                return this.getGraphData();
            }
            throw error;
        }
    }
    /**
     * Get current glucose reading
     */
    async getCurrentGlucose() {
        const data = await this.getGraphData();
        const current = data.connection.glucoseMeasurement;
        return mapGlucoseItem(current, this.config.targetLow, this.config.targetHigh);
    }
    /**
     * Get glucose history for specified hours
     */
    async getGlucoseHistory(hours = 24) {
        const data = await this.getGraphData();
        const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
        // Filter readings within the time range
        const readings = data.graphData
            .filter(item => new Date(item.Timestamp).getTime() > cutoffTime)
            .map(item => mapGlucoseItem(item, this.config.targetLow, this.config.targetHigh))
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return readings;
    }
    /**
     * Get sensor information
     */
    async getSensorInfo() {
        const data = await this.getGraphData();
        return data.activeSensors.map(s => ({
            sn: s.sensor.sn,
            activatedOn: s.sensor.a,
            expiresOn: s.sensor.a + (s.sensor.w * 24 * 60 * 60), // w is lifetime in days
            status: 'active'
        }));
    }
    /**
     * Validate connection by attempting to fetch data
     */
    async validateConnection() {
        try {
            await this.getCurrentGlucose();
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        // Reset authentication if credentials changed
        if (newConfig.email || newConfig.password || newConfig.region) {
            this.jwtToken = null;
            this.accountId = null;
            this.patientId = null;
            if (newConfig.region) {
                this.baseUrl = LIBRE_LINK_SERVERS[newConfig.region] || LIBRE_LINK_SERVERS['GLOBAL'];
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGlicmVsaW5rLWNsaWVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9saWJyZWxpbmstY2xpZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7R0FNRztBQUVILE9BQU8sS0FBb0MsTUFBTSxPQUFPLENBQUM7QUFDekQsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUNwQyxPQUFPLEVBT0wsU0FBUyxFQUNULGtCQUFrQixFQUNsQixlQUFlLEVBQ2hCLE1BQU0sWUFBWSxDQUFDO0FBRXBCLG9GQUFvRjtBQUNwRixNQUFNLHNCQUFzQixHQUFHLFFBQVEsQ0FBQztBQUV4QyxnQkFBZ0I7QUFDaEIsTUFBTSxTQUFTLEdBQUc7SUFDaEIsS0FBSyxFQUFFLGlCQUFpQjtJQUN4QixXQUFXLEVBQUUsa0JBQWtCO0lBQy9CLEtBQUssRUFBRSxDQUFDLFNBQWlCLEVBQUUsRUFBRSxDQUFDLG9CQUFvQixTQUFTLFFBQVE7SUFDbkUsT0FBTyxFQUFFLENBQUMsU0FBaUIsRUFBRSxFQUFFLENBQUMsb0JBQW9CLFNBQVMsVUFBVTtDQUN4RSxDQUFDO0FBMkJGOzs7O0dBSUc7QUFDSCxTQUFTLGlCQUFpQixDQUFDLE1BQWM7SUFDdkMsT0FBTyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUMzRCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLGNBQWMsQ0FBQyxJQUFvQixFQUFFLFNBQWlCLEVBQUUsVUFBa0I7SUFDakYsT0FBTztRQUNMLEtBQUssRUFBRSxJQUFJLENBQUMsY0FBYztRQUMxQixTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7UUFDekIsS0FBSyxFQUFFLFNBQVMsQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLENBQUMsQ0FBQyxJQUFJLE1BQU07UUFDaEQsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQztRQUNoQyxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07UUFDbkIsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLO1FBQ2pCLEtBQUssRUFBRSxlQUFlLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxTQUFTLEVBQUUsVUFBVSxDQUFDO0tBQ25FLENBQUM7QUFDSixDQUFDO0FBRUQsTUFBTSxPQUFPLGVBQWU7SUFTMUIsWUFBWSxNQUF1QjtRQU4zQixhQUFRLEdBQWtCLElBQUksQ0FBQztRQUMvQixXQUFNLEdBQWtCLElBQUksQ0FBQztRQUM3QixjQUFTLEdBQWtCLElBQUksQ0FBQztRQUNoQyxjQUFTLEdBQWtCLElBQUksQ0FBQztRQUNoQyxpQkFBWSxHQUFXLENBQUMsQ0FBQztRQUcvQixJQUFJLENBQUMsTUFBTSxHQUFHO1lBQ1osR0FBRyxNQUFNO1lBQ1QsYUFBYSxFQUFFLE1BQU0sQ0FBQyxhQUFhLElBQUksc0JBQXNCO1NBQzlELENBQUM7UUFDRixJQUFJLENBQUMsT0FBTyxHQUFHLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNuRixDQUFDO0lBRUQ7O09BRUc7SUFDSyxZQUFZO1FBQ2xCLE1BQU0sT0FBTyxHQUEyQjtZQUN0QyxRQUFRLEVBQUUsa0JBQWtCO1lBQzVCLGNBQWMsRUFBRSxrQkFBa0I7WUFDbEMsaUJBQWlCLEVBQUUsTUFBTTtZQUN6QixlQUFlLEVBQUUsVUFBVTtZQUMzQixZQUFZLEVBQUUsWUFBWTtZQUMxQixTQUFTLEVBQUUsYUFBYTtZQUN4QixTQUFTLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhO1NBQ3JDLENBQUM7UUFFRixPQUFPLEtBQUssQ0FBQyxNQUFNLENBQUM7WUFDbEIsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLE9BQU87WUFDUCxPQUFPLEVBQUUsS0FBSztTQUNmLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7O09BR0c7SUFDSyx5QkFBeUI7UUFDL0IsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDdEMsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO1FBQzVELENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBMkI7WUFDdEMsUUFBUSxFQUFFLGtCQUFrQjtZQUM1QixjQUFjLEVBQUUsa0JBQWtCO1lBQ2xDLGlCQUFpQixFQUFFLE1BQU07WUFDekIsZUFBZSxFQUFFLFVBQVU7WUFDM0IsWUFBWSxFQUFFLFlBQVk7WUFDMUIsU0FBUyxFQUFFLGFBQWE7WUFDeEIsU0FBUyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYTtZQUNwQyxlQUFlLEVBQUUsVUFBVSxJQUFJLENBQUMsUUFBUSxFQUFFO1lBQzFDLFlBQVksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFFLGtDQUFrQztTQUNqRSxDQUFDO1FBRUYsT0FBTyxLQUFLLENBQUMsTUFBTSxDQUFDO1lBQ2xCLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztZQUNyQixPQUFPO1lBQ1AsT0FBTyxFQUFFLEtBQUs7U0FDZixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxZQUFZO1FBQ2xCLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVM7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUNwRCx3Q0FBd0M7UUFDeEMsT0FBTyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxLQUFLO1FBQ1QsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBRW5DLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLE1BQU0sTUFBTSxDQUFDLElBQUksQ0FBZ0IsU0FBUyxDQUFDLEtBQUssRUFBRTtnQkFDakUsS0FBSyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSztnQkFDeEIsUUFBUSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUTthQUMvQixDQUFDLENBQUM7WUFFSCxNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDO1lBRTNCLDRCQUE0QjtZQUM1QixJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQzNDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDO2dCQUVqRCx5Q0FBeUM7Z0JBQ3pDLElBQUksa0JBQWtCLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztvQkFDbEMsSUFBSSxDQUFDLE9BQU8sR0FBRyxrQkFBa0IsQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDL0MsQ0FBQztxQkFBTSxDQUFDO29CQUNOLElBQUksQ0FBQyxPQUFPLEdBQUcsZUFBZSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sZUFBZSxDQUFDO2dCQUNoRSxDQUFDO2dCQUVELGtDQUFrQztnQkFDbEMsT0FBTyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDdEIsQ0FBQztZQUVELDZCQUE2QjtZQUM3QixJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDL0MsTUFBTSxJQUFJLEtBQUssQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO1lBQ3ZFLENBQUM7WUFFRCw0QkFBNEI7WUFDNUIsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUM7WUFDM0MsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLENBQUMsMEJBQTBCO1lBQ25GLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBRWhDLHFFQUFxRTtZQUNyRSxJQUFJLENBQUMsU0FBUyxHQUFHLGlCQUFpQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUVoRCxPQUFPLENBQUMsS0FBSyxDQUFDLDJCQUEyQixJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUVsRyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUM5QixNQUFNLFVBQVUsR0FBRyxLQUE4RixDQUFDO2dCQUVsSCxJQUFJLFVBQVUsQ0FBQyxRQUFRLEVBQUUsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFDO29CQUN4QyxNQUFNLFlBQVksR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztvQkFFOUMsSUFBSSxZQUFZLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxDQUFDO3dCQUN2QyxNQUFNLElBQUksS0FBSyxDQUNiLGdDQUFnQyxZQUFZLENBQUMsSUFBSSxDQUFDLGNBQWMsSUFBSTs0QkFDcEUsb0JBQW9CLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxJQUFJOzRCQUNqRCxvRUFBb0UsQ0FDckUsQ0FBQztvQkFDSixDQUFDO29CQUVELElBQUksWUFBWSxFQUFFLE9BQU8sS0FBSyx1QkFBdUIsRUFBRSxDQUFDO3dCQUN0RCxNQUFNLElBQUksS0FBSyxDQUNiLHVGQUF1Rjs0QkFDdkYsK0RBQStELENBQ2hFLENBQUM7b0JBQ0osQ0FBQztnQkFDSCxDQUFDO2dCQUVELElBQUksVUFBVSxDQUFDLFFBQVEsRUFBRSxNQUFNLEtBQUssR0FBRyxFQUFFLENBQUM7b0JBQ3hDLE1BQU0sSUFBSSxLQUFLLENBQUMsOERBQThELENBQUMsQ0FBQztnQkFDbEYsQ0FBQztnQkFFRCxNQUFNLElBQUksS0FBSyxDQUFDLGlCQUFpQixVQUFVLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztZQUN6RCxDQUFDO1lBQ0QsTUFBTSxLQUFLLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0ssS0FBSyxDQUFDLG1CQUFtQjtRQUMvQixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUM7WUFDekIsTUFBTSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDckIsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxjQUFjO1FBQ2xCLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7UUFDakMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUM7UUFFaEQsSUFBSSxDQUFDO1lBQ0gsTUFBTSxRQUFRLEdBQUcsTUFBTSxNQUFNLENBQUMsR0FBRyxDQUFzQixTQUFTLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDOUUsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLFFBQVEsRUFBRSxNQUFNLEtBQUssR0FBRyxFQUFFLENBQUM7Z0JBQ2hFLG9DQUFvQztnQkFDcEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUM7Z0JBQ3JCLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7Z0JBQ2pDLE9BQU8sSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQy9CLENBQUM7WUFDRCxNQUFNLEtBQUssQ0FBQztRQUNkLENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxLQUFLLENBQUMsWUFBWTtRQUN4QixJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNuQixPQUFPLElBQUksQ0FBQyxTQUFTLENBQUM7UUFDeEIsQ0FBQztRQUVELE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBRWhELElBQUksV0FBVyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUM3QixNQUFNLElBQUksS0FBSyxDQUNiLHdDQUF3QztnQkFDeEMsNERBQTREO2dCQUM1RCw2REFBNkQ7Z0JBQzdELDZFQUE2RSxDQUM5RSxDQUFDO1FBQ0osQ0FBQztRQUVELElBQUksQ0FBQyxTQUFTLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUMxQyxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUM7SUFDeEIsQ0FBQztJQUVEOztPQUVHO0lBQ0ssS0FBSyxDQUFDLFlBQVk7UUFDeEIsTUFBTSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztRQUNqQyxNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztRQUM1QyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQztRQUVoRCxJQUFJLENBQUM7WUFDSCxNQUFNLFFBQVEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxHQUFHLENBQy9CLFNBQVMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQzNCLENBQUM7WUFDRixPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQzVCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxLQUFLLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUNoRSxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQztnQkFDckIsTUFBTSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztnQkFDakMsT0FBTyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDN0IsQ0FBQztZQUNELE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxpQkFBaUI7UUFDckIsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDdkMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQztRQUVuRCxPQUFPLGNBQWMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUNoRixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsUUFBZ0IsRUFBRTtRQUN4QyxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztRQUN2QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQztRQUV6RCx3Q0FBd0M7UUFDeEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFNBQVM7YUFDNUIsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxHQUFHLFVBQVUsQ0FBQzthQUMvRCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7YUFDaEYsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxHQUFHLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1FBRXJGLE9BQU8sUUFBUSxDQUFDO0lBQ2xCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxhQUFhO1FBQ2pCLE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBRXZDLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ2xDLEVBQUUsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLEVBQUU7WUFDZixXQUFXLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3ZCLFNBQVMsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsd0JBQXdCO1lBQzdFLE1BQU0sRUFBRSxRQUFRO1NBQ2pCLENBQUMsQ0FBQyxDQUFDO0lBQ04sQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQjtRQUN0QixJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQy9CLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLE9BQU8sS0FBSyxDQUFDO1FBQ2YsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNILFlBQVksQ0FBQyxTQUFtQztRQUM5QyxJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsU0FBUyxFQUFFLENBQUM7UUFFL0MsOENBQThDO1FBQzlDLElBQUksU0FBUyxDQUFDLEtBQUssSUFBSSxTQUFTLENBQUMsUUFBUSxJQUFJLFNBQVMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUM5RCxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQztZQUNyQixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQztZQUN0QixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQztZQUV0QixJQUFJLFNBQVMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDckIsSUFBSSxDQUFDLE9BQU8sR0FBRyxrQkFBa0IsQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLElBQUksa0JBQWtCLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDdEYsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIExpYnJlTGluayBBUEkgQ2xpZW50IC0gRml4ZWQgZm9yIHY0LjE2LjAgKE9jdG9iZXIgMjAyNSlcbiAqIFxuICogVGhpcyBjbGllbnQgaW1wbGVtZW50cyB0aGUgcmVxdWlyZWQgY2hhbmdlczpcbiAqIDEuIEFQSSB2ZXJzaW9uIGhlYWRlciBzZXQgdG8gNC4xNi4wXG4gKiAyLiBBY2NvdW50LUlkIGhlYWRlciAoU0hBMjU2IGhhc2ggb2YgdXNlcklkKSByZXF1aXJlZCBmb3IgYWxsIGF1dGhlbnRpY2F0ZWQgcmVxdWVzdHNcbiAqL1xuXG5pbXBvcnQgYXhpb3MsIHsgQXhpb3NJbnN0YW5jZSwgQXhpb3NFcnJvciB9IGZyb20gJ2F4aW9zJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHtcbiAgTGlicmVMaW5rQ29uZmlnLFxuICBHbHVjb3NlUmVhZGluZyxcbiAgU2Vuc29ySW5mbyxcbiAgUmF3R2x1Y29zZUl0ZW0sXG4gIEdyYXBoUmVzcG9uc2UsXG4gIENvbm5lY3Rpb24sXG4gIFRSRU5EX01BUCxcbiAgTElCUkVfTElOS19TRVJWRVJTLFxuICBnZXRHbHVjb3NlQ29sb3Jcbn0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8vIERlZmF1bHQgY2xpZW50IHZlcnNpb24gLSBDUklUSUNBTDogTXVzdCBiZSA0LjE2LjAgb3IgaGlnaGVyIGFzIG9mIE9jdG9iZXIgOCwgMjAyNVxuY29uc3QgREVGQVVMVF9DTElFTlRfVkVSU0lPTiA9ICc0LjE2LjAnO1xuXG4vLyBBUEkgZW5kcG9pbnRzXG5jb25zdCBFTkRQT0lOVFMgPSB7XG4gIGxvZ2luOiAnL2xsdS9hdXRoL2xvZ2luJyxcbiAgY29ubmVjdGlvbnM6ICcvbGx1L2Nvbm5lY3Rpb25zJyxcbiAgZ3JhcGg6IChwYXRpZW50SWQ6IHN0cmluZykgPT4gYC9sbHUvY29ubmVjdGlvbnMvJHtwYXRpZW50SWR9L2dyYXBoYCxcbiAgbG9nYm9vazogKHBhdGllbnRJZDogc3RyaW5nKSA9PiBgL2xsdS9jb25uZWN0aW9ucy8ke3BhdGllbnRJZH0vbG9nYm9va2Bcbn07XG5cbmludGVyZmFjZSBMb2dpblJlc3BvbnNlIHtcbiAgc3RhdHVzOiBudW1iZXI7XG4gIGRhdGE6IHtcbiAgICB1c2VyOiB7XG4gICAgICBpZDogc3RyaW5nO1xuICAgICAgZmlyc3ROYW1lOiBzdHJpbmc7XG4gICAgICBsYXN0TmFtZTogc3RyaW5nO1xuICAgICAgZW1haWw6IHN0cmluZztcbiAgICAgIGNvdW50cnk6IHN0cmluZztcbiAgICB9O1xuICAgIGF1dGhUaWNrZXQ6IHtcbiAgICAgIHRva2VuOiBzdHJpbmc7XG4gICAgICBleHBpcmVzOiBudW1iZXI7XG4gICAgICBkdXJhdGlvbjogbnVtYmVyO1xuICAgIH07XG4gICAgcmVkaXJlY3Q/OiBib29sZWFuO1xuICAgIHJlZ2lvbj86IHN0cmluZztcbiAgfTtcbn1cblxuaW50ZXJmYWNlIENvbm5lY3Rpb25zUmVzcG9uc2Uge1xuICBzdGF0dXM6IG51bWJlcjtcbiAgZGF0YTogQ29ubmVjdGlvbltdO1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIEFjY291bnQtSWQgaGVhZGVyIGZyb20gdXNlciBJRFxuICogVGhpcyBpcyBSRVFVSVJFRCBmb3IgQVBJIHZlcnNpb24gNC4xNi4wK1xuICogVGhlIEFjY291bnQtSWQgaXMgYSBTSEEyNTYgaGFzaCBvZiB0aGUgdXNlcidzIFVVSURcbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVBY2NvdW50SWQodXNlcklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHVzZXJJZCkuZGlnZXN0KCdoZXgnKTtcbn1cblxuLyoqXG4gKiBDb252ZXJ0IHJhdyBnbHVjb3NlIGl0ZW0gdG8gR2x1Y29zZVJlYWRpbmdcbiAqL1xuZnVuY3Rpb24gbWFwR2x1Y29zZUl0ZW0oaXRlbTogUmF3R2x1Y29zZUl0ZW0sIHRhcmdldExvdzogbnVtYmVyLCB0YXJnZXRIaWdoOiBudW1iZXIpOiBHbHVjb3NlUmVhZGluZyB7XG4gIHJldHVybiB7XG4gICAgdmFsdWU6IGl0ZW0uVmFsdWVJbk1nUGVyRGwsXG4gICAgdGltZXN0YW1wOiBpdGVtLlRpbWVzdGFtcCxcbiAgICB0cmVuZDogVFJFTkRfTUFQW2l0ZW0uVHJlbmRBcnJvdyB8fCAzXSB8fCAnRmxhdCcsXG4gICAgdHJlbmRBcnJvdzogaXRlbS5UcmVuZEFycm93IHx8IDMsXG4gICAgaXNIaWdoOiBpdGVtLmlzSGlnaCxcbiAgICBpc0xvdzogaXRlbS5pc0xvdyxcbiAgICBjb2xvcjogZ2V0R2x1Y29zZUNvbG9yKGl0ZW0uVmFsdWVJbk1nUGVyRGwsIHRhcmdldExvdywgdGFyZ2V0SGlnaClcbiAgfTtcbn1cblxuZXhwb3J0IGNsYXNzIExpYnJlTGlua0NsaWVudCB7XG4gIHByaXZhdGUgY29uZmlnOiBMaWJyZUxpbmtDb25maWc7XG4gIHByaXZhdGUgYmFzZVVybDogc3RyaW5nO1xuICBwcml2YXRlIGp3dFRva2VuOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB1c2VySWQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGFjY291bnRJZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcGF0aWVudElkOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB0b2tlbkV4cGlyZXM6IG51bWJlciA9IDA7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBMaWJyZUxpbmtDb25maWcpIHtcbiAgICB0aGlzLmNvbmZpZyA9IHtcbiAgICAgIC4uLmNvbmZpZyxcbiAgICAgIGNsaWVudFZlcnNpb246IGNvbmZpZy5jbGllbnRWZXJzaW9uIHx8IERFRkFVTFRfQ0xJRU5UX1ZFUlNJT05cbiAgICB9O1xuICAgIHRoaXMuYmFzZVVybCA9IExJQlJFX0xJTktfU0VSVkVSU1tjb25maWcucmVnaW9uXSB8fCBMSUJSRV9MSU5LX1NFUlZFUlNbJ0dMT0JBTCddO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBheGlvcyBpbnN0YW5jZSB3aXRoIGRlZmF1bHQgaGVhZGVyc1xuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVDbGllbnQoKTogQXhpb3NJbnN0YW5jZSB7XG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgICdBY2NlcHQnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2VwdC1FbmNvZGluZyc6ICdnemlwJyxcbiAgICAgICdDYWNoZS1Db250cm9sJzogJ25vLWNhY2hlJyxcbiAgICAgICdDb25uZWN0aW9uJzogJ0tlZXAtQWxpdmUnLFxuICAgICAgJ3Byb2R1Y3QnOiAnbGx1LmFuZHJvaWQnLFxuICAgICAgJ3ZlcnNpb24nOiB0aGlzLmNvbmZpZy5jbGllbnRWZXJzaW9uXG4gICAgfTtcblxuICAgIHJldHVybiBheGlvcy5jcmVhdGUoe1xuICAgICAgYmFzZVVSTDogdGhpcy5iYXNlVXJsLFxuICAgICAgaGVhZGVycyxcbiAgICAgIHRpbWVvdXQ6IDMwMDAwXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGF1dGhlbnRpY2F0ZWQgYXhpb3MgaW5zdGFuY2Ugd2l0aCBKV1QgdG9rZW4gYW5kIEFjY291bnQtSWRcbiAgICogQ1JJVElDQUw6IEFjY291bnQtSWQgaGVhZGVyIGlzIFJFUVVJUkVEIGZvciB2NC4xNi4wK1xuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVBdXRoZW50aWNhdGVkQ2xpZW50KCk6IEF4aW9zSW5zdGFuY2Uge1xuICAgIGlmICghdGhpcy5qd3RUb2tlbiB8fCAhdGhpcy5hY2NvdW50SWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTm90IGF1dGhlbnRpY2F0ZWQuIENhbGwgbG9naW4oKSBmaXJzdC4nKTtcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgJ0FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQWNjZXB0LUVuY29kaW5nJzogJ2d6aXAnLFxuICAgICAgJ0NhY2hlLUNvbnRyb2wnOiAnbm8tY2FjaGUnLFxuICAgICAgJ0Nvbm5lY3Rpb24nOiAnS2VlcC1BbGl2ZScsXG4gICAgICAncHJvZHVjdCc6ICdsbHUuYW5kcm9pZCcsXG4gICAgICAndmVyc2lvbic6IHRoaXMuY29uZmlnLmNsaWVudFZlcnNpb24sXG4gICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHt0aGlzLmp3dFRva2VufWAsXG4gICAgICAnQWNjb3VudC1JZCc6IHRoaXMuYWNjb3VudElkICAvLyBDUklUSUNBTDogUmVxdWlyZWQgZm9yIHY0LjE2LjArXG4gICAgfTtcblxuICAgIHJldHVybiBheGlvcy5jcmVhdGUoe1xuICAgICAgYmFzZVVSTDogdGhpcy5iYXNlVXJsLFxuICAgICAgaGVhZGVycyxcbiAgICAgIHRpbWVvdXQ6IDMwMDAwXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgaWYgY3VycmVudCB0b2tlbiBpcyB2YWxpZFxuICAgKi9cbiAgcHJpdmF0ZSBpc1Rva2VuVmFsaWQoKTogYm9vbGVhbiB7XG4gICAgaWYgKCF0aGlzLmp3dFRva2VuIHx8ICF0aGlzLmFjY291bnRJZCkgcmV0dXJuIGZhbHNlO1xuICAgIC8vIEFkZCA1IG1pbnV0ZSBidWZmZXIgYmVmb3JlIGV4cGlyYXRpb25cbiAgICByZXR1cm4gRGF0ZS5ub3coKSA8ICh0aGlzLnRva2VuRXhwaXJlcyAtIDMwMDAwMCk7XG4gIH1cblxuICAvKipcbiAgICogTG9naW4gdG8gTGlicmVMaW5rVXAgYW5kIGdldCBKV1QgdG9rZW5cbiAgICovXG4gIGFzeW5jIGxvZ2luKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY3JlYXRlQ2xpZW50KCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQucG9zdDxMb2dpblJlc3BvbnNlPihFTkRQT0lOVFMubG9naW4sIHtcbiAgICAgICAgZW1haWw6IHRoaXMuY29uZmlnLmVtYWlsLFxuICAgICAgICBwYXNzd29yZDogdGhpcy5jb25maWcucGFzc3dvcmRcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBkYXRhID0gcmVzcG9uc2UuZGF0YTtcblxuICAgICAgLy8gQ2hlY2sgZm9yIHJlZ2lvbiByZWRpcmVjdFxuICAgICAgaWYgKGRhdGEuZGF0YS5yZWRpcmVjdCAmJiBkYXRhLmRhdGEucmVnaW9uKSB7XG4gICAgICAgIGNvbnN0IG5ld1JlZ2lvbiA9IGRhdGEuZGF0YS5yZWdpb24udG9VcHBlckNhc2UoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFVwZGF0ZSBiYXNlIFVSTCBmb3IgdGhlIGNvcnJlY3QgcmVnaW9uXG4gICAgICAgIGlmIChMSUJSRV9MSU5LX1NFUlZFUlNbbmV3UmVnaW9uXSkge1xuICAgICAgICAgIHRoaXMuYmFzZVVybCA9IExJQlJFX0xJTktfU0VSVkVSU1tuZXdSZWdpb25dO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuYmFzZVVybCA9IGBodHRwczovL2FwaS0ke2RhdGEuZGF0YS5yZWdpb259LmxpYnJldmlldy5pb2A7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXRyeSBsb2dpbiB3aXRoIGNvcnJlY3QgcmVnaW9uXG4gICAgICAgIHJldHVybiB0aGlzLmxvZ2luKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIENoZWNrIGZvciBzdWNjZXNzZnVsIGxvZ2luXG4gICAgICBpZiAoZGF0YS5zdGF0dXMgIT09IDAgfHwgIWRhdGEuZGF0YS5hdXRoVGlja2V0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTG9naW4gZmFpbGVkOiBJbnZhbGlkIHJlc3BvbnNlIGZyb20gTGlicmVMaW5rIEFQSScpO1xuICAgICAgfVxuXG4gICAgICAvLyBTdG9yZSBhdXRoZW50aWNhdGlvbiBkYXRhXG4gICAgICB0aGlzLmp3dFRva2VuID0gZGF0YS5kYXRhLmF1dGhUaWNrZXQudG9rZW47XG4gICAgICB0aGlzLnRva2VuRXhwaXJlcyA9IGRhdGEuZGF0YS5hdXRoVGlja2V0LmV4cGlyZXMgKiAxMDAwOyAvLyBDb252ZXJ0IHRvIG1pbGxpc2Vjb25kc1xuICAgICAgdGhpcy51c2VySWQgPSBkYXRhLmRhdGEudXNlci5pZDtcbiAgICAgIFxuICAgICAgLy8gQ1JJVElDQUw6IEdlbmVyYXRlIEFjY291bnQtSWQgZnJvbSB1c2VyIElEIChyZXF1aXJlZCBmb3IgdjQuMTYuMCspXG4gICAgICB0aGlzLmFjY291bnRJZCA9IGdlbmVyYXRlQWNjb3VudElkKHRoaXMudXNlcklkKTtcblxuICAgICAgY29uc29sZS5lcnJvcihgTGlicmVMaW5rOiBMb2dnZWQgaW4gYXMgJHtkYXRhLmRhdGEudXNlci5maXJzdE5hbWV9ICR7ZGF0YS5kYXRhLnVzZXIubGFzdE5hbWV9YCk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGF4aW9zLmlzQXhpb3NFcnJvcihlcnJvcikpIHtcbiAgICAgICAgY29uc3QgYXhpb3NFcnJvciA9IGVycm9yIGFzIEF4aW9zRXJyb3I8eyBtZXNzYWdlPzogc3RyaW5nOyBzdGF0dXM/OiBudW1iZXI7IGRhdGE/OiB7IG1pbmltdW1WZXJzaW9uPzogc3RyaW5nIH0gfT47XG4gICAgICAgIFxuICAgICAgICBpZiAoYXhpb3NFcnJvci5yZXNwb25zZT8uc3RhdHVzID09PSA0MDMpIHtcbiAgICAgICAgICBjb25zdCByZXNwb25zZURhdGEgPSBheGlvc0Vycm9yLnJlc3BvbnNlLmRhdGE7XG4gICAgICAgICAgXG4gICAgICAgICAgaWYgKHJlc3BvbnNlRGF0YT8uZGF0YT8ubWluaW11bVZlcnNpb24pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgYEFQSSByZXF1aXJlcyBtaW5pbXVtIHZlcnNpb24gJHtyZXNwb25zZURhdGEuZGF0YS5taW5pbXVtVmVyc2lvbn0uIGAgK1xuICAgICAgICAgICAgICBgQ3VycmVudCB2ZXJzaW9uOiAke3RoaXMuY29uZmlnLmNsaWVudFZlcnNpb259LiBgICtcbiAgICAgICAgICAgICAgYFBsZWFzZSB1cGRhdGUgdG8gdGhlIGxhdGVzdCB2ZXJzaW9uIG9mIGxpYnJlbGluay1tY3Atc2VydmVyLWZpeGVkLmBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIGlmIChyZXNwb25zZURhdGE/Lm1lc3NhZ2UgPT09ICdSZXF1aXJlZEhlYWRlck1pc3NpbmcnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICdSZXF1aXJlZCBoZWFkZXIgbWlzc2luZy4gVGhpcyB1c3VhbGx5IG1lYW5zIHRoZSBBY2NvdW50LUlkIGhlYWRlciBpcyBub3QgYmVpbmcgc2VudC4gJyArXG4gICAgICAgICAgICAgICdQbGVhc2UgZW5zdXJlIHlvdSBhcmUgdXNpbmcgdGhlIGZpeGVkIHZlcnNpb24gb2YgdGhlIGxpYnJhcnkuJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChheGlvc0Vycm9yLnJlc3BvbnNlPy5zdGF0dXMgPT09IDQwMSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQXV0aGVudGljYXRpb24gZmFpbGVkLiBQbGVhc2UgY2hlY2sgeW91ciBlbWFpbCBhbmQgcGFzc3dvcmQuJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExvZ2luIGZhaWxlZDogJHtheGlvc0Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlIHdlIGhhdmUgYSB2YWxpZCBhdXRoZW50aWNhdGVkIHNlc3Npb25cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlQXV0aGVudGljYXRlZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuaXNUb2tlblZhbGlkKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMubG9naW4oKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IGFsbCBjb25uZWN0aW9ucyAocGF0aWVudHMgc2hhcmluZyBkYXRhKVxuICAgKi9cbiAgYXN5bmMgZ2V0Q29ubmVjdGlvbnMoKTogUHJvbWlzZTxDb25uZWN0aW9uW10+IHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUF1dGhlbnRpY2F0ZWQoKTtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNyZWF0ZUF1dGhlbnRpY2F0ZWRDbGllbnQoKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNsaWVudC5nZXQ8Q29ubmVjdGlvbnNSZXNwb25zZT4oRU5EUE9JTlRTLmNvbm5lY3Rpb25zKTtcbiAgICAgIHJldHVybiByZXNwb25zZS5kYXRhLmRhdGEgfHwgW107XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChheGlvcy5pc0F4aW9zRXJyb3IoZXJyb3IpICYmIGVycm9yLnJlc3BvbnNlPy5zdGF0dXMgPT09IDQwMSkge1xuICAgICAgICAvLyBUb2tlbiBleHBpcmVkLCByZS1sb2dpbiBhbmQgcmV0cnlcbiAgICAgICAgdGhpcy5qd3RUb2tlbiA9IG51bGw7XG4gICAgICAgIGF3YWl0IHRoaXMuZW5zdXJlQXV0aGVudGljYXRlZCgpO1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRDb25uZWN0aW9ucygpO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBwYXRpZW50IElEIChmaXJzdCBjb25uZWN0aW9uKVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBnZXRQYXRpZW50SWQoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAodGhpcy5wYXRpZW50SWQpIHtcbiAgICAgIHJldHVybiB0aGlzLnBhdGllbnRJZDtcbiAgICB9XG5cbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGlvbnMoKTtcblxuICAgIGlmIChjb25uZWN0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ05vIGNvbm5lY3Rpb25zIGZvdW5kLiBQbGVhc2UgZW5zdXJlOlxcbicgK1xuICAgICAgICAnMS4gWW91IGFyZSB1c2luZyBMaWJyZUxpbmtVcCBjcmVkZW50aWFscyAobm90IExpYnJlTGluaylcXG4nICtcbiAgICAgICAgJzIuIFNvbWVvbmUgaXMgc2hhcmluZyB0aGVpciBkYXRhIHdpdGggeW91IHZpYSBMaWJyZUxpbmtVcFxcbicgK1xuICAgICAgICAnMy4gWW91IGhhdmUgYWNjZXB0ZWQgdGhlIGxhdGVzdCBUZXJtcyBhbmQgQ29uZGl0aW9ucyBpbiB0aGUgTGlicmVMaW5rVXAgYXBwJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICB0aGlzLnBhdGllbnRJZCA9IGNvbm5lY3Rpb25zWzBdLnBhdGllbnRJZDtcbiAgICByZXR1cm4gdGhpcy5wYXRpZW50SWQ7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGdyYXBoIGRhdGEgKGdsdWNvc2UgcmVhZGluZ3MgZm9yIGxhc3QgMTIgaG91cnMpXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGdldEdyYXBoRGF0YSgpOiBQcm9taXNlPEdyYXBoUmVzcG9uc2U+IHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUF1dGhlbnRpY2F0ZWQoKTtcbiAgICBjb25zdCBwYXRpZW50SWQgPSBhd2FpdCB0aGlzLmdldFBhdGllbnRJZCgpO1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY3JlYXRlQXV0aGVudGljYXRlZENsaWVudCgpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2xpZW50LmdldDx7IHN0YXR1czogbnVtYmVyOyBkYXRhOiBHcmFwaFJlc3BvbnNlIH0+KFxuICAgICAgICBFTkRQT0lOVFMuZ3JhcGgocGF0aWVudElkKVxuICAgICAgKTtcbiAgICAgIHJldHVybiByZXNwb25zZS5kYXRhLmRhdGE7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChheGlvcy5pc0F4aW9zRXJyb3IoZXJyb3IpICYmIGVycm9yLnJlc3BvbnNlPy5zdGF0dXMgPT09IDQwMSkge1xuICAgICAgICB0aGlzLmp3dFRva2VuID0gbnVsbDtcbiAgICAgICAgYXdhaXQgdGhpcy5lbnN1cmVBdXRoZW50aWNhdGVkKCk7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEdyYXBoRGF0YSgpO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBjdXJyZW50IGdsdWNvc2UgcmVhZGluZ1xuICAgKi9cbiAgYXN5bmMgZ2V0Q3VycmVudEdsdWNvc2UoKTogUHJvbWlzZTxHbHVjb3NlUmVhZGluZz4ge1xuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCB0aGlzLmdldEdyYXBoRGF0YSgpO1xuICAgIGNvbnN0IGN1cnJlbnQgPSBkYXRhLmNvbm5lY3Rpb24uZ2x1Y29zZU1lYXN1cmVtZW50O1xuICAgIFxuICAgIHJldHVybiBtYXBHbHVjb3NlSXRlbShjdXJyZW50LCB0aGlzLmNvbmZpZy50YXJnZXRMb3csIHRoaXMuY29uZmlnLnRhcmdldEhpZ2gpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBnbHVjb3NlIGhpc3RvcnkgZm9yIHNwZWNpZmllZCBob3Vyc1xuICAgKi9cbiAgYXN5bmMgZ2V0R2x1Y29zZUhpc3RvcnkoaG91cnM6IG51bWJlciA9IDI0KTogUHJvbWlzZTxHbHVjb3NlUmVhZGluZ1tdPiB7XG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHRoaXMuZ2V0R3JhcGhEYXRhKCk7XG4gICAgY29uc3QgY3V0b2ZmVGltZSA9IERhdGUubm93KCkgLSAoaG91cnMgKiA2MCAqIDYwICogMTAwMCk7XG5cbiAgICAvLyBGaWx0ZXIgcmVhZGluZ3Mgd2l0aGluIHRoZSB0aW1lIHJhbmdlXG4gICAgY29uc3QgcmVhZGluZ3MgPSBkYXRhLmdyYXBoRGF0YVxuICAgICAgLmZpbHRlcihpdGVtID0+IG5ldyBEYXRlKGl0ZW0uVGltZXN0YW1wKS5nZXRUaW1lKCkgPiBjdXRvZmZUaW1lKVxuICAgICAgLm1hcChpdGVtID0+IG1hcEdsdWNvc2VJdGVtKGl0ZW0sIHRoaXMuY29uZmlnLnRhcmdldExvdywgdGhpcy5jb25maWcudGFyZ2V0SGlnaCkpXG4gICAgICAuc29ydCgoYSwgYikgPT4gbmV3IERhdGUoYS50aW1lc3RhbXApLmdldFRpbWUoKSAtIG5ldyBEYXRlKGIudGltZXN0YW1wKS5nZXRUaW1lKCkpO1xuXG4gICAgcmV0dXJuIHJlYWRpbmdzO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBzZW5zb3IgaW5mb3JtYXRpb25cbiAgICovXG4gIGFzeW5jIGdldFNlbnNvckluZm8oKTogUHJvbWlzZTxTZW5zb3JJbmZvW10+IHtcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgdGhpcy5nZXRHcmFwaERhdGEoKTtcbiAgICBcbiAgICByZXR1cm4gZGF0YS5hY3RpdmVTZW5zb3JzLm1hcChzID0+ICh7XG4gICAgICBzbjogcy5zZW5zb3Iuc24sXG4gICAgICBhY3RpdmF0ZWRPbjogcy5zZW5zb3IuYSxcbiAgICAgIGV4cGlyZXNPbjogcy5zZW5zb3IuYSArIChzLnNlbnNvci53ICogMjQgKiA2MCAqIDYwKSwgLy8gdyBpcyBsaWZldGltZSBpbiBkYXlzXG4gICAgICBzdGF0dXM6ICdhY3RpdmUnXG4gICAgfSkpO1xuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlIGNvbm5lY3Rpb24gYnkgYXR0ZW1wdGluZyB0byBmZXRjaCBkYXRhXG4gICAqL1xuICBhc3luYyB2YWxpZGF0ZUNvbm5lY3Rpb24oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuZ2V0Q3VycmVudEdsdWNvc2UoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgY29uZmlndXJhdGlvblxuICAgKi9cbiAgdXBkYXRlQ29uZmlnKG5ld0NvbmZpZzogUGFydGlhbDxMaWJyZUxpbmtDb25maWc+KTogdm9pZCB7XG4gICAgdGhpcy5jb25maWcgPSB7IC4uLnRoaXMuY29uZmlnLCAuLi5uZXdDb25maWcgfTtcbiAgICBcbiAgICAvLyBSZXNldCBhdXRoZW50aWNhdGlvbiBpZiBjcmVkZW50aWFscyBjaGFuZ2VkXG4gICAgaWYgKG5ld0NvbmZpZy5lbWFpbCB8fCBuZXdDb25maWcucGFzc3dvcmQgfHwgbmV3Q29uZmlnLnJlZ2lvbikge1xuICAgICAgdGhpcy5qd3RUb2tlbiA9IG51bGw7XG4gICAgICB0aGlzLmFjY291bnRJZCA9IG51bGw7XG4gICAgICB0aGlzLnBhdGllbnRJZCA9IG51bGw7XG4gICAgICBcbiAgICAgIGlmIChuZXdDb25maWcucmVnaW9uKSB7XG4gICAgICAgIHRoaXMuYmFzZVVybCA9IExJQlJFX0xJTktfU0VSVkVSU1tuZXdDb25maWcucmVnaW9uXSB8fCBMSUJSRV9MSU5LX1NFUlZFUlNbJ0dMT0JBTCddO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuIl19