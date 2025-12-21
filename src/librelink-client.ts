/**
 * LibreLink API Client - Fixed for v4.16.0 (October 2025)
 *
 * This client implements the required changes:
 * 1. API version header set to 4.16.0
 * 2. Account-Id header (SHA256 hash of userId) required for all authenticated requests
 * 3. Secure token persistence with automatic refresh
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { createHash } from 'crypto';
import {
  LibreLinkConfig,
  GlucoseReading,
  SensorInfo,
  RawGlucoseItem,
  GraphResponse,
  Connection,
  TREND_MAP,
  LIBRE_LINK_SERVERS,
  getGlucoseColor
} from './types.js';
import { ConfigManager } from './config.js';
import { StoredTokenData } from './secure-storage.js';

// Default client version - CRITICAL: Must be 4.16.0 or higher as of October 8, 2025
const DEFAULT_CLIENT_VERSION = '4.16.0';

// API endpoints
const ENDPOINTS = {
  login: '/llu/auth/login',
  connections: '/llu/connections',
  graph: (patientId: string) => `/llu/connections/${patientId}/graph`,
  logbook: (patientId: string) => `/llu/connections/${patientId}/logbook`
};

interface LoginResponse {
  status: number;
  data: {
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      country: string;
    };
    authTicket: {
      token: string;
      expires: number;
      duration: number;
    };
    redirect?: boolean;
    region?: string;
  };
}

interface ConnectionsResponse {
  status: number;
  data: Connection[];
}

/**
 * Generate Account-Id header from user ID
 * This is REQUIRED for API version 4.16.0+
 * The Account-Id is a SHA256 hash of the user's UUID
 */
function generateAccountId(userId: string): string {
  return createHash('sha256').update(userId).digest('hex');
}

/**
 * Convert raw glucose item to GlucoseReading
 */
function mapGlucoseItem(item: RawGlucoseItem, targetLow: number, targetHigh: number): GlucoseReading {
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
  private config: LibreLinkConfig;
  private configManager: ConfigManager | null = null;
  private baseUrl: string;
  private jwtToken: string | null = null;
  private userId: string | null = null;
  private accountId: string | null = null;
  private patientId: string | null = null;
  private tokenExpires: number = 0;

  constructor(config: LibreLinkConfig, configManager?: ConfigManager) {
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
  private createClient(): AxiosInstance {
    const headers: Record<string, string> = {
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
  private createAuthenticatedClient(): AxiosInstance {
    if (!this.jwtToken || !this.accountId) {
      throw new Error('Not authenticated. Call login() first.');
    }

    const headers: Record<string, string> = {
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
  private isTokenValid(): boolean {
    if (!this.jwtToken || !this.accountId) return false;
    // Add 5 minute buffer before expiration
    return Date.now() < (this.tokenExpires - 300000);
  }

  /**
   * Try to restore session from stored token
   */
  async tryRestoreSession(): Promise<boolean> {
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
    } catch (error) {
      console.error('Error restoring session:', error);
      return false;
    }
  }

  /**
   * Save current session token to secure storage
   */
  private async saveSession(): Promise<void> {
    if (!this.configManager || !this.jwtToken || !this.userId || !this.accountId) {
      return;
    }

    try {
      const tokenData: StoredTokenData = {
        token: this.jwtToken,
        expires: this.tokenExpires,
        userId: this.userId,
        accountId: this.accountId,
        region: this.config.region
      };

      await this.configManager.saveToken(tokenData);
      console.error('LibreLink: Session saved to secure storage');
    } catch (error) {
      console.error('Error saving session:', error);
    }
  }

  /**
   * Login to LibreLinkUp and get JWT token
   */
  async login(): Promise<void> {
    const client = this.createClient();

    try {
      const response = await client.post<LoginResponse>(ENDPOINTS.login, {
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
        } else {
          this.baseUrl = `https://api-${data.data.region}.libreview.io`;
        }

        // Update config region
        this.config.region = newRegion as LibreLinkConfig['region'];

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

    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ message?: string; status?: number; data?: { minimumVersion?: string } }>;

        if (axiosError.response?.status === 403) {
          const responseData = axiosError.response.data;

          if (responseData?.data?.minimumVersion) {
            throw new Error(
              `API requires minimum version ${responseData.data.minimumVersion}. ` +
              `Current version: ${this.config.clientVersion}. ` +
              `Please update to the latest version of librelink-mcp-server-fixed.`
            );
          }

          if (responseData?.message === 'RequiredHeaderMissing') {
            throw new Error(
              'Required header missing. This usually means the Account-Id header is not being sent. ' +
              'Please ensure you are using the fixed version of the library.'
            );
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
  private async ensureAuthenticated(): Promise<void> {
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
  async getConnections(): Promise<Connection[]> {
    await this.ensureAuthenticated();
    const client = this.createAuthenticatedClient();

    try {
      const response = await client.get<ConnectionsResponse>(ENDPOINTS.connections);
      return response.data.data || [];
    } catch (error) {
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
  private async getPatientId(): Promise<string> {
    if (this.patientId) {
      return this.patientId;
    }

    const connections = await this.getConnections();

    if (connections.length === 0) {
      throw new Error(
        'No connections found. Please ensure:\n' +
        '1. You are using LibreLinkUp credentials (not LibreLink)\n' +
        '2. Someone is sharing their data with you via LibreLinkUp\n' +
        '3. You have accepted the latest Terms and Conditions in the LibreLinkUp app'
      );
    }

    this.patientId = connections[0].patientId;
    return this.patientId;
  }

  /**
   * Get graph data (glucose readings for last 12 hours)
   */
  private async getGraphData(): Promise<GraphResponse> {
    await this.ensureAuthenticated();
    const patientId = await this.getPatientId();
    const client = this.createAuthenticatedClient();

    try {
      const response = await client.get<{ status: number; data: GraphResponse }>(
        ENDPOINTS.graph(patientId)
      );
      return response.data.data;
    } catch (error) {
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
  async getCurrentGlucose(): Promise<GlucoseReading> {
    const data = await this.getGraphData();
    const current = data.connection.glucoseMeasurement;

    return mapGlucoseItem(current, this.config.targetLow, this.config.targetHigh);
  }

  /**
   * Get glucose history for specified hours
   */
  async getGlucoseHistory(hours: number = 24): Promise<GlucoseReading[]> {
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
  async getSensorInfo(): Promise<SensorInfo[]> {
    const data = await this.getGraphData();

    return data.activeSensors.map(s => {
      // a is Unix timestamp in seconds (when sensor became active after warm-up)
      const activatedTimestamp = s.sensor.a * 1000; // Convert to milliseconds

      // Libre sensors last 14 days (Libre 2 and Libre 3)
      // The 'w' field is NOT the lifetime - it's something else (possibly warm-up related)
      // Libre 3 (pt=3) and Libre 2 (pt=2) both last 14 days
      const SENSOR_LIFETIME_DAYS = 14;
      const expiresTimestamp = activatedTimestamp + (SENSOR_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

      return {
        sn: s.sensor.sn,
        activatedOn: new Date(activatedTimestamp).toISOString(),
        expiresOn: new Date(expiresTimestamp).toISOString(),
        status: 'active'
      };
    });
  }

  /**
   * Validate connection by attempting to fetch data
   */
  async validateConnection(): Promise<boolean> {
    try {
      await this.getCurrentGlucose();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<LibreLinkConfig>): void {
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
  async clearSession(): Promise<void> {
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
  getSessionStatus(): { authenticated: boolean; tokenValid: boolean; expiresAt: Date | null } {
    return {
      authenticated: !!this.jwtToken,
      tokenValid: this.isTokenValid(),
      expiresAt: this.tokenExpires > 0 ? new Date(this.tokenExpires) : null
    };
  }
}
