/**
 * Configuration Manager for LibreLink MCP Server
 * 
 * Handles loading, saving, and managing configuration
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { LibreLinkConfig } from './types.js';

// Default configuration values
const DEFAULT_CONFIG: LibreLinkConfig = {
  email: '',
  password: '',
  region: 'EU',
  targetLow: 70,
  targetHigh: 180,
  clientVersion: '4.16.0'  // CRITICAL: Must be 4.16.0+ as of October 2025
};

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private config: LibreLinkConfig;

  constructor() {
    // Store config in user's home directory
    this.configDir = join(homedir(), '.librelink-mcp');
    this.configPath = join(this.configDir, 'config.json');
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): LibreLinkConfig {
    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(data);
        
        // Merge with defaults to ensure all fields exist
        // IMPORTANT: Always use at least version 4.16.0
        const merged = { ...DEFAULT_CONFIG, ...loaded };
        
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
   * Save configuration to file
   */
  private saveConfig(): void {
    try {
      // Create directory if it doesn't exist
      if (!existsSync(this.configDir)) {
        mkdirSync(this.configDir, { recursive: true });
      }

      // Write config file
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
   * Get current configuration
   */
  getConfig(): LibreLinkConfig {
    return { ...this.config };
  }

  /**
   * Check if credentials are configured
   */
  isConfigured(): boolean {
    return !!(this.config.email && this.config.password);
  }

  /**
   * Update credentials
   */
  updateCredentials(email: string, password: string): void {
    this.config.email = email;
    this.config.password = password;
    this.saveConfig();
  }

  /**
   * Update region
   */
  updateRegion(region: 'US' | 'EU' | 'DE' | 'FR' | 'AP' | 'AU'): void {
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
   * Clear all configuration
   */
  clearConfig(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.saveConfig();
  }
}
