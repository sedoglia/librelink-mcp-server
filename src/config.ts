/**
 * Configuration Manager for LibreLink MCP Server
 *
 * Handles loading, saving, and managing configuration.
 * Credentials are now stored securely using SecureStorage with
 * AES-256-GCM encryption and OS keychain for key storage.
 *
 * Storage locations:
 * - Windows: %LOCALAPPDATA%\librelink-mcp\
 * - macOS: ~/Library/Application Support/librelink-mcp/
 * - Linux: ~/.config/librelink-mcp/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { LibreLinkConfig, LibreLinkRegion, VALID_REGIONS } from './types.js';
import { SecureStorage, SecureCredentials, StoredTokenData } from './secure-storage.js';

// Configuration stored on disk (non-sensitive data only)
interface StoredConfig {
  region: LibreLinkRegion;
  targetLow: number;
  targetHigh: number;
  clientVersion: string;
}

// Default configuration values
const DEFAULT_CONFIG: StoredConfig = {
  region: 'EU',
  targetLow: 70,
  targetHigh: 180,
  clientVersion: '4.16.0' // CRITICAL: Must be 4.16.0+ as of October 2025
};

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private config: StoredConfig;
  private secureStorage: SecureStorage;
  private cachedCredentials: SecureCredentials | null = null;

  constructor() {
    // Use SecureStorage to get the correct OS-specific config directory
    this.secureStorage = new SecureStorage();
    const paths = this.secureStorage.getStoragePaths();
    this.configDir = paths.configDir;
    this.configPath = join(this.configDir, 'config.json');
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file (non-sensitive data only)
   */
  private loadConfig(): StoredConfig {
    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(data);

        // Merge with defaults to ensure all fields exist
        // IMPORTANT: Always use at least version 4.16.0
        const merged = { ...DEFAULT_CONFIG, ...loaded };

        // Remove any sensitive data that might be in old config
        delete (merged as Record<string, unknown>).email;
        delete (merged as Record<string, unknown>).password;

        // Ensure clientVersion is at least 4.16.0
        if (!merged.clientVersion || this.compareVersions(merged.clientVersion, '4.16.0') < 0) {
          merged.clientVersion = '4.16.0';
        }

        return merged;
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }

    return { ...DEFAULT_CONFIG };
  }

  /**
   * Compare version strings (e.g., "4.10.0" vs "4.16.0")
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    return 0;
  }

  /**
   * Save configuration to file (non-sensitive data only)
   */
  private saveConfig(): void {
    try {
      // Create directory if it doesn't exist
      if (!existsSync(this.configDir)) {
        mkdirSync(this.configDir, { recursive: true });
      }

      // Write config file without sensitive data
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));

      // Set file permissions to user-only (600)
      try {
        chmodSync(this.configPath, 0o600);
      } catch {
        // Ignore chmod errors on Windows
      }
    } catch (error) {
      console.error('Error saving config:', error);
      throw new Error('Failed to save configuration');
    }
  }

  /**
   * Get current configuration (including credentials from secure storage)
   */
  async getConfig(): Promise<LibreLinkConfig> {
    const credentials = await this.getCredentials();
    return {
      email: credentials?.email || '',
      password: credentials?.password || '',
      ...this.config
    };
  }

  /**
   * Get non-sensitive configuration synchronously
   */
  getConfigSync(): StoredConfig & { email: string; password: string } {
    return {
      email: this.cachedCredentials?.email || '',
      password: this.cachedCredentials?.password || '',
      ...this.config
    };
  }

  /**
   * Load credentials from secure storage and cache them
   */
  async loadCredentials(): Promise<void> {
    this.cachedCredentials = await this.secureStorage.getCredentials();
  }

  /**
   * Get credentials from secure storage
   */
  async getCredentials(): Promise<SecureCredentials | null> {
    if (this.cachedCredentials) {
      return this.cachedCredentials;
    }
    this.cachedCredentials = await this.secureStorage.getCredentials();
    return this.cachedCredentials;
  }

  /**
   * Check if credentials are configured
   */
  async isConfigured(): Promise<boolean> {
    const credentials = await this.getCredentials();
    return !!(credentials?.email && credentials?.password);
  }

  /**
   * Check if credentials are configured (sync, uses cache)
   */
  isConfiguredSync(): boolean {
    return !!(this.cachedCredentials?.email && this.cachedCredentials?.password);
  }

  /**
   * Update credentials (stored securely)
   */
  async updateCredentials(email: string, password: string): Promise<void> {
    await this.secureStorage.saveCredentials({ email, password });
    this.cachedCredentials = { email, password };
    // Clear any cached tokens when credentials change
    await this.secureStorage.clearToken();
  }

  /**
   * Update region
   */
  updateRegion(region: LibreLinkRegion): void {
    if (!VALID_REGIONS.includes(region)) {
      throw new Error(`Invalid region: ${region}. Valid regions are: ${VALID_REGIONS.join(', ')}`);
    }
    this.config.region = region;
    this.saveConfig();
  }

  /**
   * Update target ranges
   */
  updateRanges(targetLow: number, targetHigh: number): void {
    if (targetLow >= targetHigh) {
      throw new Error('Target low must be less than target high');
    }
    if (targetLow < 40 || targetLow > 100) {
      throw new Error('Target low must be between 40 and 100 mg/dL');
    }
    if (targetHigh < 100 || targetHigh > 300) {
      throw new Error('Target high must be between 100 and 300 mg/dL');
    }

    this.config.targetLow = targetLow;
    this.config.targetHigh = targetHigh;
    this.saveConfig();
  }

  /**
   * Update client version
   */
  updateClientVersion(version: string): void {
    // Ensure version is at least 4.16.0
    if (this.compareVersions(version, '4.16.0') < 0) {
      console.warn(`Warning: Version ${version} is below minimum required (4.16.0). Using 4.16.0.`);
      version = '4.16.0';
    }
    this.config.clientVersion = version;
    this.saveConfig();
  }

  /**
   * Get configuration file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get secure storage paths for diagnostics
   */
  getSecureStoragePaths(): { configDir: string; credentialsPath: string; tokenPath: string } {
    return this.secureStorage.getStoragePaths();
  }

  /**
   * Get the secure storage instance for token management
   */
  getSecureStorage(): SecureStorage {
    return this.secureStorage;
  }

  /**
   * Save authentication token
   */
  async saveToken(tokenData: StoredTokenData): Promise<void> {
    await this.secureStorage.saveToken(tokenData);
  }

  /**
   * Get stored authentication token
   */
  async getToken(): Promise<StoredTokenData | null> {
    return this.secureStorage.getToken();
  }

  /**
   * Clear authentication token
   */
  async clearToken(): Promise<void> {
    await this.secureStorage.clearToken();
  }

  /**
   * Clear all configuration and credentials
   */
  async clearConfig(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    this.saveConfig();
    await this.secureStorage.clearAll();
    this.cachedCredentials = null;
  }

  /**
   * Migrate from legacy unencrypted config
   */
  async migrateFromLegacy(): Promise<boolean> {
    return this.secureStorage.migrateFromLegacy();
  }

  /**
   * Get region
   */
  getRegion(): LibreLinkRegion {
    return this.config.region;
  }

  /**
   * Get target ranges
   */
  getTargetRanges(): { targetLow: number; targetHigh: number } {
    return {
      targetLow: this.config.targetLow,
      targetHigh: this.config.targetHigh
    };
  }
}
