/**
 * Configuration Manager for LibreLink MCP Server
 *
 * Handles loading, saving, and managing configuration.
 * Credentials are now stored securely using SecureStorage with
 * AES-256-GCM encryption and OS keychain for key storage.
 */
import { LibreLinkConfig } from './types.js';
import { SecureStorage, SecureCredentials, StoredTokenData } from './secure-storage.js';
interface StoredConfig {
    region: 'US' | 'EU' | 'DE' | 'FR' | 'AP' | 'AU';
    targetLow: number;
    targetHigh: number;
    clientVersion: string;
}
export declare class ConfigManager {
    private configDir;
    private configPath;
    private config;
    private secureStorage;
    private cachedCredentials;
    constructor();
    /**
     * Load configuration from file (non-sensitive data only)
     */
    private loadConfig;
    /**
     * Compare version strings (e.g., "4.10.0" vs "4.16.0")
     */
    private compareVersions;
    /**
     * Save configuration to file (non-sensitive data only)
     */
    private saveConfig;
    /**
     * Get current configuration (including credentials from secure storage)
     */
    getConfig(): Promise<LibreLinkConfig>;
    /**
     * Get non-sensitive configuration synchronously
     */
    getConfigSync(): StoredConfig & {
        email: string;
        password: string;
    };
    /**
     * Load credentials from secure storage and cache them
     */
    loadCredentials(): Promise<void>;
    /**
     * Get credentials from secure storage
     */
    getCredentials(): Promise<SecureCredentials | null>;
    /**
     * Check if credentials are configured
     */
    isConfigured(): Promise<boolean>;
    /**
     * Check if credentials are configured (sync, uses cache)
     */
    isConfiguredSync(): boolean;
    /**
     * Update credentials (stored securely)
     */
    updateCredentials(email: string, password: string): Promise<void>;
    /**
     * Update region
     */
    updateRegion(region: 'US' | 'EU' | 'DE' | 'FR' | 'AP' | 'AU'): void;
    /**
     * Update target ranges
     */
    updateRanges(targetLow: number, targetHigh: number): void;
    /**
     * Update client version
     */
    updateClientVersion(version: string): void;
    /**
     * Get configuration file path
     */
    getConfigPath(): string;
    /**
     * Get secure storage paths for diagnostics
     */
    getSecureStoragePaths(): {
        configDir: string;
        credentialsPath: string;
        tokenPath: string;
    };
    /**
     * Get the secure storage instance for token management
     */
    getSecureStorage(): SecureStorage;
    /**
     * Save authentication token
     */
    saveToken(tokenData: StoredTokenData): Promise<void>;
    /**
     * Get stored authentication token
     */
    getToken(): Promise<StoredTokenData | null>;
    /**
     * Clear authentication token
     */
    clearToken(): Promise<void>;
    /**
     * Clear all configuration and credentials
     */
    clearConfig(): Promise<void>;
    /**
     * Migrate from legacy unencrypted config
     */
    migrateFromLegacy(): Promise<boolean>;
    /**
     * Get region
     */
    getRegion(): 'US' | 'EU' | 'DE' | 'FR' | 'AP' | 'AU';
    /**
     * Get target ranges
     */
    getTargetRanges(): {
        targetLow: number;
        targetHigh: number;
    };
}
export {};
