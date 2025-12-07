/**
 * Configuration Manager for LibreLink MCP Server
 *
 * Handles loading, saving, and managing configuration
 */
import { LibreLinkConfig } from './types.js';
export declare class ConfigManager {
    private configDir;
    private configPath;
    private config;
    constructor();
    /**
     * Load configuration from file
     */
    private loadConfig;
    /**
     * Compare version strings (e.g., "4.10.0" vs "4.16.0")
     */
    private compareVersions;
    /**
     * Save configuration to file
     */
    private saveConfig;
    /**
     * Get current configuration
     */
    getConfig(): LibreLinkConfig;
    /**
     * Check if credentials are configured
     */
    isConfigured(): boolean;
    /**
     * Update credentials
     */
    updateCredentials(email: string, password: string): void;
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
     * Clear all configuration
     */
    clearConfig(): void;
}
