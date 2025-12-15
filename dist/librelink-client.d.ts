/**
 * LibreLink API Client - Fixed for v4.16.0 (October 2025)
 *
 * This client implements the required changes:
 * 1. API version header set to 4.16.0
 * 2. Account-Id header (SHA256 hash of userId) required for all authenticated requests
 * 3. Secure token persistence with automatic refresh
 */
import { LibreLinkConfig, GlucoseReading, SensorInfo, Connection } from './types.js';
import { ConfigManager } from './config.js';
export declare class LibreLinkClient {
    private config;
    private configManager;
    private baseUrl;
    private jwtToken;
    private userId;
    private accountId;
    private patientId;
    private tokenExpires;
    constructor(config: LibreLinkConfig, configManager?: ConfigManager);
    /**
     * Create axios instance with default headers
     */
    private createClient;
    /**
     * Create authenticated axios instance with JWT token and Account-Id
     * CRITICAL: Account-Id header is REQUIRED for v4.16.0+
     */
    private createAuthenticatedClient;
    /**
     * Check if current token is valid
     */
    private isTokenValid;
    /**
     * Try to restore session from stored token
     */
    tryRestoreSession(): Promise<boolean>;
    /**
     * Save current session token to secure storage
     */
    private saveSession;
    /**
     * Login to LibreLinkUp and get JWT token
     */
    login(): Promise<void>;
    /**
     * Ensure we have a valid authenticated session
     */
    private ensureAuthenticated;
    /**
     * Get all connections (patients sharing data)
     */
    getConnections(): Promise<Connection[]>;
    /**
     * Get patient ID (first connection)
     */
    private getPatientId;
    /**
     * Get graph data (glucose readings for last 12 hours)
     */
    private getGraphData;
    /**
     * Get current glucose reading
     */
    getCurrentGlucose(): Promise<GlucoseReading>;
    /**
     * Get glucose history for specified hours
     */
    getGlucoseHistory(hours?: number): Promise<GlucoseReading[]>;
    /**
     * Get sensor information
     */
    getSensorInfo(): Promise<SensorInfo[]>;
    /**
     * Validate connection by attempting to fetch data
     */
    validateConnection(): Promise<boolean>;
    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<LibreLinkConfig>): void;
    /**
     * Clear stored session
     */
    clearSession(): Promise<void>;
    /**
     * Get session status
     */
    getSessionStatus(): {
        authenticated: boolean;
        tokenValid: boolean;
        expiresAt: Date | null;
    };
}
