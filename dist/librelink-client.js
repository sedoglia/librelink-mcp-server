/**
 * LibreLink API Client - Fixed for v4.16.0 (October 2025)
 *
 * This client implements the required changes:
 * 1. API version header set to 4.16.0
 * 2. Account-Id header (SHA256 hash of userId) required for all authenticated requests
 * 3. Secure token persistence with automatic refresh
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
    constructor(config, configManager) {
        this.configManager = null;
        this.jwtToken = null;
        this.userId = null;
        this.accountId = null;
        this.patientId = null;
        this.tokenExpires = 0;
        this.config = {
            ...config,
            clientVersion: config.clientVersion || DEFAULT_CLIENT_VERSION
        };
        this.configManager = configManager || null;
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
     * Try to restore session from stored token
     */
    async tryRestoreSession() {
        if (!this.configManager) {
            return false;
        }
        try {
            const storedToken = await this.configManager.getToken();
            if (!storedToken) {
                return false;
            }
            // Check if stored token matches current region
            if (storedToken.region !== this.config.region) {
                await this.configManager.clearToken();
                return false;
            }
            // Restore session from stored token
            this.jwtToken = storedToken.token;
            this.tokenExpires = storedToken.expires;
            this.userId = storedToken.userId;
            this.accountId = storedToken.accountId;
            // Update base URL for the region
            this.baseUrl = LIBRE_LINK_SERVERS[storedToken.region] || LIBRE_LINK_SERVERS['GLOBAL'];
            console.error('LibreLink: Restored session from secure storage');
            return true;
        }
        catch (error) {
            console.error('Error restoring session:', error);
            return false;
        }
    }
    /**
     * Save current session token to secure storage
     */
    async saveSession() {
        if (!this.configManager || !this.jwtToken || !this.userId || !this.accountId) {
            return;
        }
        try {
            const tokenData = {
                token: this.jwtToken,
                expires: this.tokenExpires,
                userId: this.userId,
                accountId: this.accountId,
                region: this.config.region
            };
            await this.configManager.saveToken(tokenData);
            console.error('LibreLink: Session saved to secure storage');
        }
        catch (error) {
            console.error('Error saving session:', error);
        }
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
                // Update config region
                this.config.region = newRegion;
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
            // Save session to secure storage
            await this.saveSession();
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
        // First try to restore from stored token
        if (!this.isTokenValid()) {
            const restored = await this.tryRestoreSession();
            if (restored && this.isTokenValid()) {
                return;
            }
        }
        // If still not valid, login
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
                // Token expired, clear stored token and re-login
                if (this.configManager) {
                    await this.configManager.clearToken();
                }
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
                if (this.configManager) {
                    await this.configManager.clearToken();
                }
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
    /**
     * Clear stored session
     */
    async clearSession() {
        this.jwtToken = null;
        this.accountId = null;
        this.userId = null;
        this.patientId = null;
        this.tokenExpires = 0;
        if (this.configManager) {
            await this.configManager.clearToken();
        }
    }
    /**
     * Get session status
     */
    getSessionStatus() {
        return {
            authenticated: !!this.jwtToken,
            tokenValid: this.isTokenValid(),
            expiresAt: this.tokenExpires > 0 ? new Date(this.tokenExpires) : null
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGlicmVsaW5rLWNsaWVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9saWJyZWxpbmstY2xpZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7O0dBT0c7QUFFSCxPQUFPLEtBQW9DLE1BQU0sT0FBTyxDQUFDO0FBQ3pELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUM7QUFDcEMsT0FBTyxFQU9MLFNBQVMsRUFDVCxrQkFBa0IsRUFDbEIsZUFBZSxFQUNoQixNQUFNLFlBQVksQ0FBQztBQUlwQixvRkFBb0Y7QUFDcEYsTUFBTSxzQkFBc0IsR0FBRyxRQUFRLENBQUM7QUFFeEMsZ0JBQWdCO0FBQ2hCLE1BQU0sU0FBUyxHQUFHO0lBQ2hCLEtBQUssRUFBRSxpQkFBaUI7SUFDeEIsV0FBVyxFQUFFLGtCQUFrQjtJQUMvQixLQUFLLEVBQUUsQ0FBQyxTQUFpQixFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsU0FBUyxRQUFRO0lBQ25FLE9BQU8sRUFBRSxDQUFDLFNBQWlCLEVBQUUsRUFBRSxDQUFDLG9CQUFvQixTQUFTLFVBQVU7Q0FDeEUsQ0FBQztBQTJCRjs7OztHQUlHO0FBQ0gsU0FBUyxpQkFBaUIsQ0FBQyxNQUFjO0lBQ3ZDLE9BQU8sVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDM0QsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxjQUFjLENBQUMsSUFBb0IsRUFBRSxTQUFpQixFQUFFLFVBQWtCO0lBQ2pGLE9BQU87UUFDTCxLQUFLLEVBQUUsSUFBSSxDQUFDLGNBQWM7UUFDMUIsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO1FBQ3pCLEtBQUssRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxDQUFDLENBQUMsSUFBSSxNQUFNO1FBQ2hELFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVSxJQUFJ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SUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSTtTQUN0RSxDQUFDO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBMaWJyZUxpbmsgQVBJIENsaWVudCAtIEZpeGVkIGZvciB2NC4xNi4wIChPY3RvYmVyIDIwMjUpXG4gKlxuICogVGhpcyBjbGllbnQgaW1wbGVtZW50cyB0aGUgcmVxdWlyZWQgY2hhbmdlczpcbiAqIDEuIEFQSSB2ZXJzaW9uIGhlYWRlciBzZXQgdG8gNC4xNi4wXG4gKiAyLiBBY2NvdW50LUlkIGhlYWRlciAoU0hBMjU2IGhhc2ggb2YgdXNlcklkKSByZXF1aXJlZCBmb3IgYWxsIGF1dGhlbnRpY2F0ZWQgcmVxdWVzdHNcbiAqIDMuIFNlY3VyZSB0b2tlbiBwZXJzaXN0ZW5jZSB3aXRoIGF1dG9tYXRpYyByZWZyZXNoXG4gKi9cblxuaW1wb3J0IGF4aW9zLCB7IEF4aW9zSW5zdGFuY2UsIEF4aW9zRXJyb3IgfSBmcm9tICdheGlvcyc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7XG4gIExpYnJlTGlua0NvbmZpZyxcbiAgR2x1Y29zZVJlYWRpbmcsXG4gIFNlbnNvckluZm8sXG4gIFJhd0dsdWNvc2VJdGVtLFxuICBHcmFwaFJlc3BvbnNlLFxuICBDb25uZWN0aW9uLFxuICBUUkVORF9NQVAsXG4gIExJQlJFX0xJTktfU0VSVkVSUyxcbiAgZ2V0R2x1Y29zZUNvbG9yXG59IGZyb20gJy4vdHlwZXMuanMnO1xuaW1wb3J0IHsgQ29uZmlnTWFuYWdlciB9IGZyb20gJy4vY29uZmlnLmpzJztcbmltcG9ydCB7IFN0b3JlZFRva2VuRGF0YSB9IGZyb20gJy4vc2VjdXJlLXN0b3JhZ2UuanMnO1xuXG4vLyBEZWZhdWx0IGNsaWVudCB2ZXJzaW9uIC0gQ1JJVElDQUw6IE11c3QgYmUgNC4xNi4wIG9yIGhpZ2hlciBhcyBvZiBPY3RvYmVyIDgsIDIwMjVcbmNvbnN0IERFRkFVTFRfQ0xJRU5UX1ZFUlNJT04gPSAnNC4xNi4wJztcblxuLy8gQVBJIGVuZHBvaW50c1xuY29uc3QgRU5EUE9JTlRTID0ge1xuICBsb2dpbjogJy9sbHUvYXV0aC9sb2dpbicsXG4gIGNvbm5lY3Rpb25zOiAnL2xsdS9jb25uZWN0aW9ucycsXG4gIGdyYXBoOiAocGF0aWVudElkOiBzdHJpbmcpID0+IGAvbGx1L2Nvbm5lY3Rpb25zLyR7cGF0aWVudElkfS9ncmFwaGAsXG4gIGxvZ2Jvb2s6IChwYXRpZW50SWQ6IHN0cmluZykgPT4gYC9sbHUvY29ubmVjdGlvbnMvJHtwYXRpZW50SWR9L2xvZ2Jvb2tgXG59O1xuXG5pbnRlcmZhY2UgTG9naW5SZXNwb25zZSB7XG4gIHN0YXR1czogbnVtYmVyO1xuICBkYXRhOiB7XG4gICAgdXNlcjoge1xuICAgICAgaWQ6IHN0cmluZztcbiAgICAgIGZpcnN0TmFtZTogc3RyaW5nO1xuICAgICAgbGFzdE5hbWU6IHN0cmluZztcbiAgICAgIGVtYWlsOiBzdHJpbmc7XG4gICAgICBjb3VudHJ5OiBzdHJpbmc7XG4gICAgfTtcbiAgICBhdXRoVGlja2V0OiB7XG4gICAgICB0b2tlbjogc3RyaW5nO1xuICAgICAgZXhwaXJlczogbnVtYmVyO1xuICAgICAgZHVyYXRpb246IG51bWJlcjtcbiAgICB9O1xuICAgIHJlZGlyZWN0PzogYm9vbGVhbjtcbiAgICByZWdpb24/OiBzdHJpbmc7XG4gIH07XG59XG5cbmludGVyZmFjZSBDb25uZWN0aW9uc1Jlc3BvbnNlIHtcbiAgc3RhdHVzOiBudW1iZXI7XG4gIGRhdGE6IENvbm5lY3Rpb25bXTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBBY2NvdW50LUlkIGhlYWRlciBmcm9tIHVzZXIgSURcbiAqIFRoaXMgaXMgUkVRVUlSRUQgZm9yIEFQSSB2ZXJzaW9uIDQuMTYuMCtcbiAqIFRoZSBBY2NvdW50LUlkIGlzIGEgU0hBMjU2IGhhc2ggb2YgdGhlIHVzZXIncyBVVUlEXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlQWNjb3VudElkKHVzZXJJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZSh1c2VySWQpLmRpZ2VzdCgnaGV4Jyk7XG59XG5cbi8qKlxuICogQ29udmVydCByYXcgZ2x1Y29zZSBpdGVtIHRvIEdsdWNvc2VSZWFkaW5nXG4gKi9cbmZ1bmN0aW9uIG1hcEdsdWNvc2VJdGVtKGl0ZW06IFJhd0dsdWNvc2VJdGVtLCB0YXJnZXRMb3c6IG51bWJlciwgdGFyZ2V0SGlnaDogbnVtYmVyKTogR2x1Y29zZVJlYWRpbmcge1xuICByZXR1cm4ge1xuICAgIHZhbHVlOiBpdGVtLlZhbHVlSW5NZ1BlckRsLFxuICAgIHRpbWVzdGFtcDogaXRlbS5UaW1lc3RhbXAsXG4gICAgdHJlbmQ6IFRSRU5EX01BUFtpdGVtLlRyZW5kQXJyb3cgfHwgM10gfHwgJ0ZsYXQnLFxuICAgIHRyZW5kQXJyb3c6IGl0ZW0uVHJlbmRBcnJvdyB8fCAzLFxuICAgIGlzSGlnaDogaXRlbS5pc0hpZ2gsXG4gICAgaXNMb3c6IGl0ZW0uaXNMb3csXG4gICAgY29sb3I6IGdldEdsdWNvc2VDb2xvcihpdGVtLlZhbHVlSW5NZ1BlckRsLCB0YXJnZXRMb3csIHRhcmdldEhpZ2gpXG4gIH07XG59XG5cbmV4cG9ydCBjbGFzcyBMaWJyZUxpbmtDbGllbnQge1xuICBwcml2YXRlIGNvbmZpZzogTGlicmVMaW5rQ29uZmlnO1xuICBwcml2YXRlIGNvbmZpZ01hbmFnZXI6IENvbmZpZ01hbmFnZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBiYXNlVXJsOiBzdHJpbmc7XG4gIHByaXZhdGUgand0VG9rZW46IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHVzZXJJZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgYWNjb3VudElkOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwYXRpZW50SWQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRva2VuRXhwaXJlczogbnVtYmVyID0gMDtcblxuICBjb25zdHJ1Y3Rvcihjb25maWc6IExpYnJlTGlua0NvbmZpZywgY29uZmlnTWFuYWdlcj86IENvbmZpZ01hbmFnZXIpIHtcbiAgICB0aGlzLmNvbmZpZyA9IHtcbiAgICAgIC4uLmNvbmZpZyxcbiAgICAgIGNsaWVudFZlcnNpb246IGNvbmZpZy5jbGllbnRWZXJzaW9uIHx8IERFRkFVTFRfQ0xJRU5UX1ZFUlNJT05cbiAgICB9O1xuICAgIHRoaXMuY29uZmlnTWFuYWdlciA9IGNvbmZpZ01hbmFnZXIgfHwgbnVsbDtcbiAgICB0aGlzLmJhc2VVcmwgPSBMSUJSRV9MSU5LX1NFUlZFUlNbY29uZmlnLnJlZ2lvbl0gfHwgTElCUkVfTElOS19TRVJWRVJTWydHTE9CQUwnXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYXhpb3MgaW5zdGFuY2Ugd2l0aCBkZWZhdWx0IGhlYWRlcnNcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlQ2xpZW50KCk6IEF4aW9zSW5zdGFuY2Uge1xuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAnQWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdBY2NlcHQtRW5jb2RpbmcnOiAnZ3ppcCcsXG4gICAgICAnQ2FjaGUtQ29udHJvbCc6ICduby1jYWNoZScsXG4gICAgICAnQ29ubmVjdGlvbic6ICdLZWVwLUFsaXZlJyxcbiAgICAgICdwcm9kdWN0JzogJ2xsdS5hbmRyb2lkJyxcbiAgICAgICd2ZXJzaW9uJzogdGhpcy5jb25maWcuY2xpZW50VmVyc2lvblxuICAgIH07XG5cbiAgICByZXR1cm4gYXhpb3MuY3JlYXRlKHtcbiAgICAgIGJhc2VVUkw6IHRoaXMuYmFzZVVybCxcbiAgICAgIGhlYWRlcnMsXG4gICAgICB0aW1lb3V0OiAzMDAwMFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhdXRoZW50aWNhdGVkIGF4aW9zIGluc3RhbmNlIHdpdGggSldUIHRva2VuIGFuZCBBY2NvdW50LUlkXG4gICAqIENSSVRJQ0FMOiBBY2NvdW50LUlkIGhlYWRlciBpcyBSRVFVSVJFRCBmb3IgdjQuMTYuMCtcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlQXV0aGVudGljYXRlZENsaWVudCgpOiBBeGlvc0luc3RhbmNlIHtcbiAgICBpZiAoIXRoaXMuand0VG9rZW4gfHwgIXRoaXMuYWNjb3VudElkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCBhdXRoZW50aWNhdGVkLiBDYWxsIGxvZ2luKCkgZmlyc3QuJyk7XG4gICAgfVxuXG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgICdBY2NlcHQnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2VwdC1FbmNvZGluZyc6ICdnemlwJyxcbiAgICAgICdDYWNoZS1Db250cm9sJzogJ25vLWNhY2hlJyxcbiAgICAgICdDb25uZWN0aW9uJzogJ0tlZXAtQWxpdmUnLFxuICAgICAgJ3Byb2R1Y3QnOiAnbGx1LmFuZHJvaWQnLFxuICAgICAgJ3ZlcnNpb24nOiB0aGlzLmNvbmZpZy5jbGllbnRWZXJzaW9uLFxuICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7dGhpcy5qd3RUb2tlbn1gLFxuICAgICAgJ0FjY291bnQtSWQnOiB0aGlzLmFjY291bnRJZCAvLyBDUklUSUNBTDogUmVxdWlyZWQgZm9yIHY0LjE2LjArXG4gICAgfTtcblxuICAgIHJldHVybiBheGlvcy5jcmVhdGUoe1xuICAgICAgYmFzZVVSTDogdGhpcy5iYXNlVXJsLFxuICAgICAgaGVhZGVycyxcbiAgICAgIHRpbWVvdXQ6IDMwMDAwXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgaWYgY3VycmVudCB0b2tlbiBpcyB2YWxpZFxuICAgKi9cbiAgcHJpdmF0ZSBpc1Rva2VuVmFsaWQoKTogYm9vbGVhbiB7XG4gICAgaWYgKCF0aGlzLmp3dFRva2VuIHx8ICF0aGlzLmFjY291bnRJZCkgcmV0dXJuIGZhbHNlO1xuICAgIC8vIEFkZCA1IG1pbnV0ZSBidWZmZXIgYmVmb3JlIGV4cGlyYXRpb25cbiAgICByZXR1cm4gRGF0ZS5ub3coKSA8ICh0aGlzLnRva2VuRXhwaXJlcyAtIDMwMDAwMCk7XG4gIH1cblxuICAvKipcbiAgICogVHJ5IHRvIHJlc3RvcmUgc2Vzc2lvbiBmcm9tIHN0b3JlZCB0b2tlblxuICAgKi9cbiAgYXN5bmMgdHJ5UmVzdG9yZVNlc3Npb24oKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ01hbmFnZXIpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RvcmVkVG9rZW4gPSBhd2FpdCB0aGlzLmNvbmZpZ01hbmFnZXIuZ2V0VG9rZW4oKTtcblxuICAgICAgaWYgKCFzdG9yZWRUb2tlbikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIC8vIENoZWNrIGlmIHN0b3JlZCB0b2tlbiBtYXRjaGVzIGN1cnJlbnQgcmVnaW9uXG4gICAgICBpZiAoc3RvcmVkVG9rZW4ucmVnaW9uICE9PSB0aGlzLmNvbmZpZy5yZWdpb24pIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jb25maWdNYW5hZ2VyLmNsZWFyVG9rZW4oKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICAvLyBSZXN0b3JlIHNlc3Npb24gZnJvbSBzdG9yZWQgdG9rZW5cbiAgICAgIHRoaXMuand0VG9rZW4gPSBzdG9yZWRUb2tlbi50b2tlbjtcbiAgICAgIHRoaXMudG9rZW5FeHBpcmVzID0gc3RvcmVkVG9rZW4uZXhwaXJlcztcbiAgICAgIHRoaXMudXNlcklkID0gc3RvcmVkVG9rZW4udXNlcklkO1xuICAgICAgdGhpcy5hY2NvdW50SWQgPSBzdG9yZWRUb2tlbi5hY2NvdW50SWQ7XG5cbiAgICAgIC8vIFVwZGF0ZSBiYXNlIFVSTCBmb3IgdGhlIHJlZ2lvblxuICAgICAgdGhpcy5iYXNlVXJsID0gTElCUkVfTElOS19TRVJWRVJTW3N0b3JlZFRva2VuLnJlZ2lvbl0gfHwgTElCUkVfTElOS19TRVJWRVJTWydHTE9CQUwnXTtcblxuICAgICAgY29uc29sZS5lcnJvcignTGlicmVMaW5rOiBSZXN0b3JlZCBzZXNzaW9uIGZyb20gc2VjdXJlIHN0b3JhZ2UnKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciByZXN0b3Jpbmcgc2Vzc2lvbjonLCBlcnJvcik7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNhdmUgY3VycmVudCBzZXNzaW9uIHRva2VuIHRvIHNlY3VyZSBzdG9yYWdlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHNhdmVTZXNzaW9uKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5jb25maWdNYW5hZ2VyIHx8ICF0aGlzLmp3dFRva2VuIHx8ICF0aGlzLnVzZXJJZCB8fCAhdGhpcy5hY2NvdW50SWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdG9rZW5EYXRhOiBTdG9yZWRUb2tlbkRhdGEgPSB7XG4gICAgICAgIHRva2VuOiB0aGlzLmp3dFRva2VuLFxuICAgICAgICBleHBpcmVzOiB0aGlzLnRva2VuRXhwaXJlcyxcbiAgICAgICAgdXNlcklkOiB0aGlzLnVzZXJJZCxcbiAgICAgICAgYWNjb3VudElkOiB0aGlzLmFjY291bnRJZCxcbiAgICAgICAgcmVnaW9uOiB0aGlzLmNvbmZpZy5yZWdpb25cbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnTWFuYWdlci5zYXZlVG9rZW4odG9rZW5EYXRhKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0xpYnJlTGluazogU2Vzc2lvbiBzYXZlZCB0byBzZWN1cmUgc3RvcmFnZScpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzYXZpbmcgc2Vzc2lvbjonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvZ2luIHRvIExpYnJlTGlua1VwIGFuZCBnZXQgSldUIHRva2VuXG4gICAqL1xuICBhc3luYyBsb2dpbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNyZWF0ZUNsaWVudCgpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2xpZW50LnBvc3Q8TG9naW5SZXNwb25zZT4oRU5EUE9JTlRTLmxvZ2luLCB7XG4gICAgICAgIGVtYWlsOiB0aGlzLmNvbmZpZy5lbWFpbCxcbiAgICAgICAgcGFzc3dvcmQ6IHRoaXMuY29uZmlnLnBhc3N3b3JkXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZGF0YSA9IHJlc3BvbnNlLmRhdGE7XG5cbiAgICAgIC8vIENoZWNrIGZvciByZWdpb24gcmVkaXJlY3RcbiAgICAgIGlmIChkYXRhLmRhdGEucmVkaXJlY3QgJiYgZGF0YS5kYXRhLnJlZ2lvbikge1xuICAgICAgICBjb25zdCBuZXdSZWdpb24gPSBkYXRhLmRhdGEucmVnaW9uLnRvVXBwZXJDYXNlKCk7XG5cbiAgICAgICAgLy8gVXBkYXRlIGJhc2UgVVJMIGZvciB0aGUgY29ycmVjdCByZWdpb25cbiAgICAgICAgaWYgKExJQlJFX0xJTktfU0VSVkVSU1tuZXdSZWdpb25dKSB7XG4gICAgICAgICAgdGhpcy5iYXNlVXJsID0gTElCUkVfTElOS19TRVJWRVJTW25ld1JlZ2lvbl07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5iYXNlVXJsID0gYGh0dHBzOi8vYXBpLSR7ZGF0YS5kYXRhLnJlZ2lvbn0ubGlicmV2aWV3LmlvYDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVwZGF0ZSBjb25maWcgcmVnaW9uXG4gICAgICAgIHRoaXMuY29uZmlnLnJlZ2lvbiA9IG5ld1JlZ2lvbiBhcyBMaWJyZUxpbmtDb25maWdbJ3JlZ2lvbiddO1xuXG4gICAgICAgIC8vIFJldHJ5IGxvZ2luIHdpdGggY29ycmVjdCByZWdpb25cbiAgICAgICAgcmV0dXJuIHRoaXMubG9naW4oKTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgZm9yIHN1Y2Nlc3NmdWwgbG9naW5cbiAgICAgIGlmIChkYXRhLnN0YXR1cyAhPT0gMCB8fCAhZGF0YS5kYXRhLmF1dGhUaWNrZXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdMb2dpbiBmYWlsZWQ6IEludmFsaWQgcmVzcG9uc2UgZnJvbSBMaWJyZUxpbmsgQVBJJyk7XG4gICAgICB9XG5cbiAgICAgIC8vIFN0b3JlIGF1dGhlbnRpY2F0aW9uIGRhdGFcbiAgICAgIHRoaXMuand0VG9rZW4gPSBkYXRhLmRhdGEuYXV0aFRpY2tldC50b2tlbjtcbiAgICAgIHRoaXMudG9rZW5FeHBpcmVzID0gZGF0YS5kYXRhLmF1dGhUaWNrZXQuZXhwaXJlcyAqIDEwMDA7IC8vIENvbnZlcnQgdG8gbWlsbGlzZWNvbmRzXG4gICAgICB0aGlzLnVzZXJJZCA9IGRhdGEuZGF0YS51c2VyLmlkO1xuXG4gICAgICAvLyBDUklUSUNBTDogR2VuZXJhdGUgQWNjb3VudC1JZCBmcm9tIHVzZXIgSUQgKHJlcXVpcmVkIGZvciB2NC4xNi4wKylcbiAgICAgIHRoaXMuYWNjb3VudElkID0gZ2VuZXJhdGVBY2NvdW50SWQodGhpcy51c2VySWQpO1xuXG4gICAgICBjb25zb2xlLmVycm9yKGBMaWJyZUxpbms6IExvZ2dlZCBpbiBhcyAke2RhdGEuZGF0YS51c2VyLmZpcnN0TmFtZX0gJHtkYXRhLmRhdGEudXNlci5sYXN0TmFtZX1gKTtcblxuICAgICAgLy8gU2F2ZSBzZXNzaW9uIHRvIHNlY3VyZSBzdG9yYWdlXG4gICAgICBhd2FpdCB0aGlzLnNhdmVTZXNzaW9uKCk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGF4aW9zLmlzQXhpb3NFcnJvcihlcnJvcikpIHtcbiAgICAgICAgY29uc3QgYXhpb3NFcnJvciA9IGVycm9yIGFzIEF4aW9zRXJyb3I8eyBtZXNzYWdlPzogc3RyaW5nOyBzdGF0dXM/OiBudW1iZXI7IGRhdGE/OiB7IG1pbmltdW1WZXJzaW9uPzogc3RyaW5nIH0gfT47XG5cbiAgICAgICAgaWYgKGF4aW9zRXJyb3IucmVzcG9uc2U/LnN0YXR1cyA9PT0gNDAzKSB7XG4gICAgICAgICAgY29uc3QgcmVzcG9uc2VEYXRhID0gYXhpb3NFcnJvci5yZXNwb25zZS5kYXRhO1xuXG4gICAgICAgICAgaWYgKHJlc3BvbnNlRGF0YT8uZGF0YT8ubWluaW11bVZlcnNpb24pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgYEFQSSByZXF1aXJlcyBtaW5pbXVtIHZlcnNpb24gJHtyZXNwb25zZURhdGEuZGF0YS5taW5pbXVtVmVyc2lvbn0uIGAgK1xuICAgICAgICAgICAgICBgQ3VycmVudCB2ZXJzaW9uOiAke3RoaXMuY29uZmlnLmNsaWVudFZlcnNpb259LiBgICtcbiAgICAgICAgICAgICAgYFBsZWFzZSB1cGRhdGUgdG8gdGhlIGxhdGVzdCB2ZXJzaW9uIG9mIGxpYnJlbGluay1tY3Atc2VydmVyLWZpeGVkLmBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHJlc3BvbnNlRGF0YT8ubWVzc2FnZSA9PT0gJ1JlcXVpcmVkSGVhZGVyTWlzc2luZycpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgJ1JlcXVpcmVkIGhlYWRlciBtaXNzaW5nLiBUaGlzIHVzdWFsbHkgbWVhbnMgdGhlIEFjY291bnQtSWQgaGVhZGVyIGlzIG5vdCBiZWluZyBzZW50LiAnICtcbiAgICAgICAgICAgICAgJ1BsZWFzZSBlbnN1cmUgeW91IGFyZSB1c2luZyB0aGUgZml4ZWQgdmVyc2lvbiBvZiB0aGUgbGlicmFyeS4nXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChheGlvc0Vycm9yLnJlc3BvbnNlPy5zdGF0dXMgPT09IDQwMSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQXV0aGVudGljYXRpb24gZmFpbGVkLiBQbGVhc2UgY2hlY2sgeW91ciBlbWFpbCBhbmQgcGFzc3dvcmQuJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExvZ2luIGZhaWxlZDogJHtheGlvc0Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlIHdlIGhhdmUgYSB2YWxpZCBhdXRoZW50aWNhdGVkIHNlc3Npb25cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlQXV0aGVudGljYXRlZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBGaXJzdCB0cnkgdG8gcmVzdG9yZSBmcm9tIHN0b3JlZCB0b2tlblxuICAgIGlmICghdGhpcy5pc1Rva2VuVmFsaWQoKSkge1xuICAgICAgY29uc3QgcmVzdG9yZWQgPSBhd2FpdCB0aGlzLnRyeVJlc3RvcmVTZXNzaW9uKCk7XG4gICAgICBpZiAocmVzdG9yZWQgJiYgdGhpcy5pc1Rva2VuVmFsaWQoKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgc3RpbGwgbm90IHZhbGlkLCBsb2dpblxuICAgIGlmICghdGhpcy5pc1Rva2VuVmFsaWQoKSkge1xuICAgICAgYXdhaXQgdGhpcy5sb2dpbigpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYWxsIGNvbm5lY3Rpb25zIChwYXRpZW50cyBzaGFyaW5nIGRhdGEpXG4gICAqL1xuICBhc3luYyBnZXRDb25uZWN0aW9ucygpOiBQcm9taXNlPENvbm5lY3Rpb25bXT4ge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlQXV0aGVudGljYXRlZCgpO1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY3JlYXRlQXV0aGVudGljYXRlZENsaWVudCgpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2xpZW50LmdldDxDb25uZWN0aW9uc1Jlc3BvbnNlPihFTkRQT0lOVFMuY29ubmVjdGlvbnMpO1xuICAgICAgcmV0dXJuIHJlc3BvbnNlLmRhdGEuZGF0YSB8fCBbXTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGF4aW9zLmlzQXhpb3NFcnJvcihlcnJvcikgJiYgZXJyb3IucmVzcG9uc2U/LnN0YXR1cyA9PT0gNDAxKSB7XG4gICAgICAgIC8vIFRva2VuIGV4cGlyZWQsIGNsZWFyIHN0b3JlZCB0b2tlbiBhbmQgcmUtbG9naW5cbiAgICAgICAgaWYgKHRoaXMuY29uZmlnTWFuYWdlcikge1xuICAgICAgICAgIGF3YWl0IHRoaXMuY29uZmlnTWFuYWdlci5jbGVhclRva2VuKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5qd3RUb2tlbiA9IG51bGw7XG4gICAgICAgIGF3YWl0IHRoaXMuZW5zdXJlQXV0aGVudGljYXRlZCgpO1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRDb25uZWN0aW9ucygpO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBwYXRpZW50IElEIChmaXJzdCBjb25uZWN0aW9uKVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBnZXRQYXRpZW50SWQoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAodGhpcy5wYXRpZW50SWQpIHtcbiAgICAgIHJldHVybiB0aGlzLnBhdGllbnRJZDtcbiAgICB9XG5cbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGlvbnMoKTtcblxuICAgIGlmIChjb25uZWN0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ05vIGNvbm5lY3Rpb25zIGZvdW5kLiBQbGVhc2UgZW5zdXJlOlxcbicgK1xuICAgICAgICAnMS4gWW91IGFyZSB1c2luZyBMaWJyZUxpbmtVcCBjcmVkZW50aWFscyAobm90IExpYnJlTGluaylcXG4nICtcbiAgICAgICAgJzIuIFNvbWVvbmUgaXMgc2hhcmluZyB0aGVpciBkYXRhIHdpdGggeW91IHZpYSBMaWJyZUxpbmtVcFxcbicgK1xuICAgICAgICAnMy4gWW91IGhhdmUgYWNjZXB0ZWQgdGhlIGxhdGVzdCBUZXJtcyBhbmQgQ29uZGl0aW9ucyBpbiB0aGUgTGlicmVMaW5rVXAgYXBwJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICB0aGlzLnBhdGllbnRJZCA9IGNvbm5lY3Rpb25zWzBdLnBhdGllbnRJZDtcbiAgICByZXR1cm4gdGhpcy5wYXRpZW50SWQ7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGdyYXBoIGRhdGEgKGdsdWNvc2UgcmVhZGluZ3MgZm9yIGxhc3QgMTIgaG91cnMpXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGdldEdyYXBoRGF0YSgpOiBQcm9taXNlPEdyYXBoUmVzcG9uc2U+IHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUF1dGhlbnRpY2F0ZWQoKTtcbiAgICBjb25zdCBwYXRpZW50SWQgPSBhd2FpdCB0aGlzLmdldFBhdGllbnRJZCgpO1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY3JlYXRlQXV0aGVudGljYXRlZENsaWVudCgpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2xpZW50LmdldDx7IHN0YXR1czogbnVtYmVyOyBkYXRhOiBHcmFwaFJlc3BvbnNlIH0+KFxuICAgICAgICBFTkRQT0lOVFMuZ3JhcGgocGF0aWVudElkKVxuICAgICAgKTtcbiAgICAgIHJldHVybiByZXNwb25zZS5kYXRhLmRhdGE7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChheGlvcy5pc0F4aW9zRXJyb3IoZXJyb3IpICYmIGVycm9yLnJlc3BvbnNlPy5zdGF0dXMgPT09IDQwMSkge1xuICAgICAgICBpZiAodGhpcy5jb25maWdNYW5hZ2VyKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5jb25maWdNYW5hZ2VyLmNsZWFyVG9rZW4oKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmp3dFRva2VuID0gbnVsbDtcbiAgICAgICAgYXdhaXQgdGhpcy5lbnN1cmVBdXRoZW50aWNhdGVkKCk7XG4gICAgICAgIHJldHVybiB0aGlzLmdldEdyYXBoRGF0YSgpO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBjdXJyZW50IGdsdWNvc2UgcmVhZGluZ1xuICAgKi9cbiAgYXN5bmMgZ2V0Q3VycmVudEdsdWNvc2UoKTogUHJvbWlzZTxHbHVjb3NlUmVhZGluZz4ge1xuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCB0aGlzLmdldEdyYXBoRGF0YSgpO1xuICAgIGNvbnN0IGN1cnJlbnQgPSBkYXRhLmNvbm5lY3Rpb24uZ2x1Y29zZU1lYXN1cmVtZW50O1xuXG4gICAgcmV0dXJuIG1hcEdsdWNvc2VJdGVtKGN1cnJlbnQsIHRoaXMuY29uZmlnLnRhcmdldExvdywgdGhpcy5jb25maWcudGFyZ2V0SGlnaCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGdsdWNvc2UgaGlzdG9yeSBmb3Igc3BlY2lmaWVkIGhvdXJzXG4gICAqL1xuICBhc3luYyBnZXRHbHVjb3NlSGlzdG9yeShob3VyczogbnVtYmVyID0gMjQpOiBQcm9taXNlPEdsdWNvc2VSZWFkaW5nW10+IHtcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgdGhpcy5nZXRHcmFwaERhdGEoKTtcbiAgICBjb25zdCBjdXRvZmZUaW1lID0gRGF0ZS5ub3coKSAtIChob3VycyAqIDYwICogNjAgKiAxMDAwKTtcblxuICAgIC8vIEZpbHRlciByZWFkaW5ncyB3aXRoaW4gdGhlIHRpbWUgcmFuZ2VcbiAgICBjb25zdCByZWFkaW5ncyA9IGRhdGEuZ3JhcGhEYXRhXG4gICAgICAuZmlsdGVyKGl0ZW0gPT4gbmV3IERhdGUoaXRlbS5UaW1lc3RhbXApLmdldFRpbWUoKSA+IGN1dG9mZlRpbWUpXG4gICAgICAubWFwKGl0ZW0gPT4gbWFwR2x1Y29zZUl0ZW0oaXRlbSwgdGhpcy5jb25maWcudGFyZ2V0TG93LCB0aGlzLmNvbmZpZy50YXJnZXRIaWdoKSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBuZXcgRGF0ZShhLnRpbWVzdGFtcCkuZ2V0VGltZSgpIC0gbmV3IERhdGUoYi50aW1lc3RhbXApLmdldFRpbWUoKSk7XG5cbiAgICByZXR1cm4gcmVhZGluZ3M7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHNlbnNvciBpbmZvcm1hdGlvblxuICAgKi9cbiAgYXN5bmMgZ2V0U2Vuc29ySW5mbygpOiBQcm9taXNlPFNlbnNvckluZm9bXT4ge1xuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCB0aGlzLmdldEdyYXBoRGF0YSgpO1xuXG4gICAgcmV0dXJuIGRhdGEuYWN0aXZlU2Vuc29ycy5tYXAocyA9PiAoe1xuICAgICAgc246IHMuc2Vuc29yLnNuLFxuICAgICAgYWN0aXZhdGVkT246IHMuc2Vuc29yLmEsXG4gICAgICBleHBpcmVzT246IHMuc2Vuc29yLmEgKyAocy5zZW5zb3IudyAqIDI0ICogNjAgKiA2MCksIC8vIHcgaXMgbGlmZXRpbWUgaW4gZGF5c1xuICAgICAgc3RhdHVzOiAnYWN0aXZlJ1xuICAgIH0pKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZSBjb25uZWN0aW9uIGJ5IGF0dGVtcHRpbmcgdG8gZmV0Y2ggZGF0YVxuICAgKi9cbiAgYXN5bmMgdmFsaWRhdGVDb25uZWN0aW9uKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmdldEN1cnJlbnRHbHVjb3NlKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHVwZGF0ZUNvbmZpZyhuZXdDb25maWc6IFBhcnRpYWw8TGlicmVMaW5rQ29uZmlnPik6IHZvaWQge1xuICAgIHRoaXMuY29uZmlnID0geyAuLi50aGlzLmNvbmZpZywgLi4ubmV3Q29uZmlnIH07XG5cbiAgICAvLyBSZXNldCBhdXRoZW50aWNhdGlvbiBpZiBjcmVkZW50aWFscyBjaGFuZ2VkXG4gICAgaWYgKG5ld0NvbmZpZy5lbWFpbCB8fCBuZXdDb25maWcucGFzc3dvcmQgfHwgbmV3Q29uZmlnLnJlZ2lvbikge1xuICAgICAgdGhpcy5qd3RUb2tlbiA9IG51bGw7XG4gICAgICB0aGlzLmFjY291bnRJZCA9IG51bGw7XG4gICAgICB0aGlzLnBhdGllbnRJZCA9IG51bGw7XG5cbiAgICAgIGlmIChuZXdDb25maWcucmVnaW9uKSB7XG4gICAgICAgIHRoaXMuYmFzZVVybCA9IExJQlJFX0xJTktfU0VSVkVSU1tuZXdDb25maWcucmVnaW9uXSB8fCBMSUJSRV9MSU5LX1NFUlZFUlNbJ0dMT0JBTCddO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhciBzdG9yZWQgc2Vzc2lvblxuICAgKi9cbiAgYXN5bmMgY2xlYXJTZXNzaW9uKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuand0VG9rZW4gPSBudWxsO1xuICAgIHRoaXMuYWNjb3VudElkID0gbnVsbDtcbiAgICB0aGlzLnVzZXJJZCA9IG51bGw7XG4gICAgdGhpcy5wYXRpZW50SWQgPSBudWxsO1xuICAgIHRoaXMudG9rZW5FeHBpcmVzID0gMDtcblxuICAgIGlmICh0aGlzLmNvbmZpZ01hbmFnZXIpIHtcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlnTWFuYWdlci5jbGVhclRva2VuKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBzZXNzaW9uIHN0YXR1c1xuICAgKi9cbiAgZ2V0U2Vzc2lvblN0YXR1cygpOiB7IGF1dGhlbnRpY2F0ZWQ6IGJvb2xlYW47IHRva2VuVmFsaWQ6IGJvb2xlYW47IGV4cGlyZXNBdDogRGF0ZSB8IG51bGwgfSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGF1dGhlbnRpY2F0ZWQ6ICEhdGhpcy5qd3RUb2tlbixcbiAgICAgIHRva2VuVmFsaWQ6IHRoaXMuaXNUb2tlblZhbGlkKCksXG4gICAgICBleHBpcmVzQXQ6IHRoaXMudG9rZW5FeHBpcmVzID4gMCA/IG5ldyBEYXRlKHRoaXMudG9rZW5FeHBpcmVzKSA6IG51bGxcbiAgICB9O1xuICB9XG59XG4iXX0=