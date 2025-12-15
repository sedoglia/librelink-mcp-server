/**
 * Configuration Manager for LibreLink MCP Server
 *
 * Handles loading, saving, and managing configuration.
 * Credentials are now stored securely using SecureStorage with
 * AES-256-GCM encryption and OS keychain for key storage.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { SecureStorage } from './secure-storage.js';
// Default configuration values
const DEFAULT_CONFIG = {
    region: 'EU',
    targetLow: 70,
    targetHigh: 180,
    clientVersion: '4.16.0' // CRITICAL: Must be 4.16.0+ as of October 2025
};
export class ConfigManager {
    constructor() {
        this.cachedCredentials = null;
        // Store config in user's home directory
        this.configDir = join(homedir(), '.librelink-mcp');
        this.configPath = join(this.configDir, 'config.json');
        this.secureStorage = new SecureStorage();
        this.config = this.loadConfig();
    }
    /**
     * Load configuration from file (non-sensitive data only)
     */
    loadConfig() {
        try {
            if (existsSync(this.configPath)) {
                const data = readFileSync(this.configPath, 'utf-8');
                const loaded = JSON.parse(data);
                // Merge with defaults to ensure all fields exist
                // IMPORTANT: Always use at least version 4.16.0
                const merged = { ...DEFAULT_CONFIG, ...loaded };
                // Remove any sensitive data that might be in old config
                delete merged.email;
                delete merged.password;
                // Ensure clientVersion is at least 4.16.0
                if (!merged.clientVersion || this.compareVersions(merged.clientVersion, '4.16.0') < 0) {
                    merged.clientVersion = '4.16.0';
                }
                return merged;
            }
        }
        catch (error) {
            console.error('Error loading config:', error);
        }
        return { ...DEFAULT_CONFIG };
    }
    /**
     * Compare version strings (e.g., "4.10.0" vs "4.16.0")
     */
    compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 < p2)
                return -1;
            if (p1 > p2)
                return 1;
        }
        return 0;
    }
    /**
     * Save configuration to file (non-sensitive data only)
     */
    saveConfig() {
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
            }
            catch {
                // Ignore chmod errors on Windows
            }
        }
        catch (error) {
            console.error('Error saving config:', error);
            throw new Error('Failed to save configuration');
        }
    }
    /**
     * Get current configuration (including credentials from secure storage)
     */
    async getConfig() {
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
    getConfigSync() {
        return {
            email: this.cachedCredentials?.email || '',
            password: this.cachedCredentials?.password || '',
            ...this.config
        };
    }
    /**
     * Load credentials from secure storage and cache them
     */
    async loadCredentials() {
        this.cachedCredentials = await this.secureStorage.getCredentials();
    }
    /**
     * Get credentials from secure storage
     */
    async getCredentials() {
        if (this.cachedCredentials) {
            return this.cachedCredentials;
        }
        this.cachedCredentials = await this.secureStorage.getCredentials();
        return this.cachedCredentials;
    }
    /**
     * Check if credentials are configured
     */
    async isConfigured() {
        const credentials = await this.getCredentials();
        return !!(credentials?.email && credentials?.password);
    }
    /**
     * Check if credentials are configured (sync, uses cache)
     */
    isConfiguredSync() {
        return !!(this.cachedCredentials?.email && this.cachedCredentials?.password);
    }
    /**
     * Update credentials (stored securely)
     */
    async updateCredentials(email, password) {
        await this.secureStorage.saveCredentials({ email, password });
        this.cachedCredentials = { email, password };
        // Clear any cached tokens when credentials change
        await this.secureStorage.clearToken();
    }
    /**
     * Update region
     */
    updateRegion(region) {
        this.config.region = region;
        this.saveConfig();
    }
    /**
     * Update target ranges
     */
    updateRanges(targetLow, targetHigh) {
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
    updateClientVersion(version) {
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
    getConfigPath() {
        return this.configPath;
    }
    /**
     * Get secure storage paths for diagnostics
     */
    getSecureStoragePaths() {
        return this.secureStorage.getStoragePaths();
    }
    /**
     * Get the secure storage instance for token management
     */
    getSecureStorage() {
        return this.secureStorage;
    }
    /**
     * Save authentication token
     */
    async saveToken(tokenData) {
        await this.secureStorage.saveToken(tokenData);
    }
    /**
     * Get stored authentication token
     */
    async getToken() {
        return this.secureStorage.getToken();
    }
    /**
     * Clear authentication token
     */
    async clearToken() {
        await this.secureStorage.clearToken();
    }
    /**
     * Clear all configuration and credentials
     */
    async clearConfig() {
        this.config = { ...DEFAULT_CONFIG };
        this.saveConfig();
        await this.secureStorage.clearAll();
        this.cachedCredentials = null;
    }
    /**
     * Migrate from legacy unencrypted config
     */
    async migrateFromLegacy() {
        return this.secureStorage.migrateFromLegacy();
    }
    /**
     * Get region
     */
    getRegion() {
        return this.config.region;
    }
    /**
     * Get target ranges
     */
    getTargetRanges() {
        return {
            targetLow: this.config.targetLow,
            targetHigh: this.config.targetHigh
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2NvbmZpZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7O0dBTUc7QUFFSCxPQUFPLEVBQUUsWUFBWSxFQUFFLGFBQWEsRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxNQUFNLElBQUksQ0FBQztBQUNuRixPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0sTUFBTSxDQUFDO0FBQzVCLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUM7QUFFN0IsT0FBTyxFQUFFLGFBQWEsRUFBc0MsTUFBTSxxQkFBcUIsQ0FBQztBQVV4RiwrQkFBK0I7QUFDL0IsTUFBTSxjQUFjLEdBQWlCO0lBQ25DLE1BQU0sRUFBRSxJQUFJO0lBQ1osU0FBUyxFQUFFLEVBQUU7SUFDYixVQUFVLEVBQUUsR0FBRztJQUNmLGFBQWEsRUFBRSxRQUFRLENBQUMsK0NBQStDO0NBQ3hFLENBQUM7QUFFRixNQUFNLE9BQU8sYUFBYTtJQU94QjtRQUZRLHNCQUFpQixHQUE2QixJQUFJLENBQUM7UUFHekQsd0NBQXdDO1FBQ3hDLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFDbkQsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxhQUFhLENBQUMsQ0FBQztRQUN0RCxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksYUFBYSxFQUFFLENBQUM7UUFDekMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7SUFDbEMsQ0FBQztJQUVEOztPQUVHO0lBQ0ssVUFBVTtRQUNoQixJQUFJLENBQUM7WUFDSCxJQUFJLFVBQVUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDaEMsTUFBTSxJQUFJLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBQ3BELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBRWhDLGlEQUFpRDtnQkFDakQsZ0RBQWdEO2dCQUNoRCxNQUFNLE1BQU0sR0FBRyxFQUFFLEdBQUcsY0FBYyxFQUFFLEdBQUcsTUFBTSxFQUFFLENBQUM7Z0JBRWhELHdEQUF3RDtnQkFDeEQsT0FBUSxNQUFrQyxDQUFDLEtBQUssQ0FBQztnQkFDakQsT0FBUSxNQUFrQyxDQUFDLFFBQVEsQ0FBQztnQkFFcEQsMENBQTBDO2dCQUMxQyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsSUFBSSxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxhQUFhLEVBQUUsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ3RGLE1BQU0sQ0FBQyxhQUFhLEdBQUcsUUFBUSxDQUFDO2dCQUNsQyxDQUFDO2dCQUVELE9BQU8sTUFBTSxDQUFDO1lBQ2hCLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsdUJBQXVCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDaEQsQ0FBQztRQUVELE9BQU8sRUFBRSxHQUFHLGNBQWMsRUFBRSxDQUFDO0lBQy9CLENBQUM7SUFFRDs7T0FFRztJQUNLLGVBQWUsQ0FBQyxFQUFVLEVBQUUsRUFBVTtRQUM1QyxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN6QyxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUV6QyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ2hFLE1BQU0sRUFBRSxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDMUIsTUFBTSxFQUFFLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUMxQixJQUFJLEVBQUUsR0FBRyxFQUFFO2dCQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDdkIsSUFBSSxFQUFFLEdBQUcsRUFBRTtnQkFBRSxPQUFPLENBQUMsQ0FBQztRQUN4QixDQUFDO1FBQ0QsT0FBTyxDQUFDLENBQUM7SUFDWCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxVQUFVO1FBQ2hCLElBQUksQ0FBQztZQUNILHVDQUF1QztZQUN2QyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO2dCQUNoQyxTQUFTLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1lBQ2pELENBQUM7WUFFRCwyQ0FBMkM7WUFDM0MsYUFBYSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBRXJFLDBDQUEwQztZQUMxQyxJQUFJLENBQUM7Z0JBQ0gsU0FBUyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDcEMsQ0FBQztZQUFDLE1BQU0sQ0FBQztnQkFDUCxpQ0FBaUM7WUFDbkMsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUM3QyxNQUFNLElBQUksS0FBSyxDQUFDLDhCQUE4QixDQUFDLENBQUM7UUFDbEQsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxTQUFTO1FBQ2IsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDaEQsT0FBTztZQUNMLEtBQUssRUFBRSxXQUFXLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDL0IsUUFBUSxFQUFFLFdBQVcsRUFBRSxRQUFRLElBQUksRUFBRTtZQUNyQyxHQUFHLElBQUksQ0FBQyxNQUFNO1NBQ2YsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILGFBQWE7UUFDWCxPQUFPO1lBQ0wsS0FBSyxFQUFFLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMxQyxRQUFRLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixFQUFFLFFBQVEsSUFBSSxFQUFFO1lBQ2hELEdBQUcsSUFBSSxDQUFDLE1BQU07U0FDZixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGVBQWU7UUFDbkIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQztJQUNyRSxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsY0FBYztRQUNsQixJQUFJLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQzNCLE9BQU8sSUFBSSxDQUFDLGlCQUFpQixDQUFDO1FBQ2hDLENBQUM7UUFDRCxJQUFJLENBQUMsaUJBQWlCLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ25FLE9BQU8sSUFBSSxDQUFDLGlCQUFpQixDQUFDO0lBQ2hDLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxZQUFZO1FBQ2hCLE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ2hELE9BQU8sQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLEtBQUssSUFBSSxXQUFXLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDekQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsZ0JBQWdCO1FBQ2QsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsS0FBSyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxRQUFRLENBQUMsQ0FBQztJQUMvRSxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsS0FBYSxFQUFFLFFBQWdCO1FBQ3JELE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUM5RCxJQUFJLENBQUMsaUJBQWlCLEdBQUcsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLENBQUM7UUFDN0Msa0RBQWtEO1FBQ2xELE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUN4QyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxZQUFZLENBQUMsTUFBK0M7UUFDMUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO1FBQzVCLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUNwQixDQUFDO0lBRUQ7O09BRUc7SUFDSCxZQUFZLENBQUMsU0FBaUIsRUFBRSxVQUFrQjtRQUNoRCxJQUFJLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUM1QixNQUFNLElBQUksS0FBSyxDQUFDLDBDQUEwQyxDQUFDLENBQUM7UUFDOUQsQ0FBQztRQUNELElBQUksU0FBUyxHQUFHLEVBQUUsSUFBSSxTQUFTLEdBQUcsR0FBRyxFQUFFLENBQUM7WUFDdEMsTUFBTSxJQUFJLEtBQUssQ0FBQyw2Q0FBNkMsQ0FBQyxDQUFDO1FBQ2pFLENBQUM7UUFDRCxJQUFJLFVBQVUsR0FBRyxHQUFHLElBQUksVUFBVSxHQUFHLEdBQUcsRUFBRSxDQUFDO1lBQ3pDLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLENBQUMsQ0FBQztRQUNuRSxDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQ2xDLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQztRQUNwQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7SUFDcEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsbUJBQW1CLENBQUMsT0FBZTtRQUNqQyxvQ0FBb0M7UUFDcEMsSUFBSSxJQUFJLENBQUMsZUFBZSxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNoRCxPQUFPLENBQUMsSUFBSSxDQUFDLG9CQUFvQixPQUFPLG9EQUFvRCxDQUFDLENBQUM7WUFDOUYsT0FBTyxHQUFHLFFBQVEsQ0FBQztRQUNyQixDQUFDO1FBQ0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLEdBQUcsT0FBTyxDQUFDO1FBQ3BDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUNwQixDQUFDO0lBRUQ7O09BRUc7SUFDSCxhQUFhO1FBQ1gsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDO0lBQ3pCLENBQUM7SUFFRDs7T0FFRztJQUNILHFCQUFxQjtRQUNuQixPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUM7SUFDOUMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsZ0JBQWdCO1FBQ2QsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDO0lBQzVCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsU0FBMEI7UUFDeEMsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNoRCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsUUFBUTtRQUNaLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRLEVBQUUsQ0FBQztJQUN2QyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsVUFBVTtRQUNkLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUN4QyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsV0FBVztRQUNmLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBRSxHQUFHLGNBQWMsRUFBRSxDQUFDO1FBQ3BDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUNsQixNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDcEMsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksQ0FBQztJQUNoQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCO1FBQ3JCLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0lBQ2hELENBQUM7SUFFRDs7T0FFRztJQUNILFNBQVM7UUFDUCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDO0lBQzVCLENBQUM7SUFFRDs7T0FFRztJQUNILGVBQWU7UUFDYixPQUFPO1lBQ0wsU0FBUyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUztZQUNoQyxVQUFVLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVO1NBQ25DLENBQUM7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENvbmZpZ3VyYXRpb24gTWFuYWdlciBmb3IgTGlicmVMaW5rIE1DUCBTZXJ2ZXJcbiAqXG4gKiBIYW5kbGVzIGxvYWRpbmcsIHNhdmluZywgYW5kIG1hbmFnaW5nIGNvbmZpZ3VyYXRpb24uXG4gKiBDcmVkZW50aWFscyBhcmUgbm93IHN0b3JlZCBzZWN1cmVseSB1c2luZyBTZWN1cmVTdG9yYWdlIHdpdGhcbiAqIEFFUy0yNTYtR0NNIGVuY3J5cHRpb24gYW5kIE9TIGtleWNoYWluIGZvciBrZXkgc3RvcmFnZS5cbiAqL1xuXG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgY2htb2RTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgaG9tZWRpciB9IGZyb20gJ29zJztcbmltcG9ydCB7IExpYnJlTGlua0NvbmZpZyB9IGZyb20gJy4vdHlwZXMuanMnO1xuaW1wb3J0IHsgU2VjdXJlU3RvcmFnZSwgU2VjdXJlQ3JlZGVudGlhbHMsIFN0b3JlZFRva2VuRGF0YSB9IGZyb20gJy4vc2VjdXJlLXN0b3JhZ2UuanMnO1xuXG4vLyBDb25maWd1cmF0aW9uIHN0b3JlZCBvbiBkaXNrIChub24tc2Vuc2l0aXZlIGRhdGEgb25seSlcbmludGVyZmFjZSBTdG9yZWRDb25maWcge1xuICByZWdpb246ICdVUycgfCAnRVUnIHwgJ0RFJyB8ICdGUicgfCAnQVAnIHwgJ0FVJztcbiAgdGFyZ2V0TG93OiBudW1iZXI7XG4gIHRhcmdldEhpZ2g6IG51bWJlcjtcbiAgY2xpZW50VmVyc2lvbjogc3RyaW5nO1xufVxuXG4vLyBEZWZhdWx0IGNvbmZpZ3VyYXRpb24gdmFsdWVzXG5jb25zdCBERUZBVUxUX0NPTkZJRzogU3RvcmVkQ29uZmlnID0ge1xuICByZWdpb246ICdFVScsXG4gIHRhcmdldExvdzogNzAsXG4gIHRhcmdldEhpZ2g6IDE4MCxcbiAgY2xpZW50VmVyc2lvbjogJzQuMTYuMCcgLy8gQ1JJVElDQUw6IE11c3QgYmUgNC4xNi4wKyBhcyBvZiBPY3RvYmVyIDIwMjVcbn07XG5cbmV4cG9ydCBjbGFzcyBDb25maWdNYW5hZ2VyIHtcbiAgcHJpdmF0ZSBjb25maWdEaXI6IHN0cmluZztcbiAgcHJpdmF0ZSBjb25maWdQYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgY29uZmlnOiBTdG9yZWRDb25maWc7XG4gIHByaXZhdGUgc2VjdXJlU3RvcmFnZTogU2VjdXJlU3RvcmFnZTtcbiAgcHJpdmF0ZSBjYWNoZWRDcmVkZW50aWFsczogU2VjdXJlQ3JlZGVudGlhbHMgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICAvLyBTdG9yZSBjb25maWcgaW4gdXNlcidzIGhvbWUgZGlyZWN0b3J5XG4gICAgdGhpcy5jb25maWdEaXIgPSBqb2luKGhvbWVkaXIoKSwgJy5saWJyZWxpbmstbWNwJyk7XG4gICAgdGhpcy5jb25maWdQYXRoID0gam9pbih0aGlzLmNvbmZpZ0RpciwgJ2NvbmZpZy5qc29uJyk7XG4gICAgdGhpcy5zZWN1cmVTdG9yYWdlID0gbmV3IFNlY3VyZVN0b3JhZ2UoKTtcbiAgICB0aGlzLmNvbmZpZyA9IHRoaXMubG9hZENvbmZpZygpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvYWQgY29uZmlndXJhdGlvbiBmcm9tIGZpbGUgKG5vbi1zZW5zaXRpdmUgZGF0YSBvbmx5KVxuICAgKi9cbiAgcHJpdmF0ZSBsb2FkQ29uZmlnKCk6IFN0b3JlZENvbmZpZyB7XG4gICAgdHJ5IHtcbiAgICAgIGlmIChleGlzdHNTeW5jKHRoaXMuY29uZmlnUGF0aCkpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHJlYWRGaWxlU3luYyh0aGlzLmNvbmZpZ1BhdGgsICd1dGYtOCcpO1xuICAgICAgICBjb25zdCBsb2FkZWQgPSBKU09OLnBhcnNlKGRhdGEpO1xuXG4gICAgICAgIC8vIE1lcmdlIHdpdGggZGVmYXVsdHMgdG8gZW5zdXJlIGFsbCBmaWVsZHMgZXhpc3RcbiAgICAgICAgLy8gSU1QT1JUQU5UOiBBbHdheXMgdXNlIGF0IGxlYXN0IHZlcnNpb24gNC4xNi4wXG4gICAgICAgIGNvbnN0IG1lcmdlZCA9IHsgLi4uREVGQVVMVF9DT05GSUcsIC4uLmxvYWRlZCB9O1xuXG4gICAgICAgIC8vIFJlbW92ZSBhbnkgc2Vuc2l0aXZlIGRhdGEgdGhhdCBtaWdodCBiZSBpbiBvbGQgY29uZmlnXG4gICAgICAgIGRlbGV0ZSAobWVyZ2VkIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5lbWFpbDtcbiAgICAgICAgZGVsZXRlIChtZXJnZWQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLnBhc3N3b3JkO1xuXG4gICAgICAgIC8vIEVuc3VyZSBjbGllbnRWZXJzaW9uIGlzIGF0IGxlYXN0IDQuMTYuMFxuICAgICAgICBpZiAoIW1lcmdlZC5jbGllbnRWZXJzaW9uIHx8IHRoaXMuY29tcGFyZVZlcnNpb25zKG1lcmdlZC5jbGllbnRWZXJzaW9uLCAnNC4xNi4wJykgPCAwKSB7XG4gICAgICAgICAgbWVyZ2VkLmNsaWVudFZlcnNpb24gPSAnNC4xNi4wJztcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBtZXJnZWQ7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGxvYWRpbmcgY29uZmlnOicsIGVycm9yKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyAuLi5ERUZBVUxUX0NPTkZJRyB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENvbXBhcmUgdmVyc2lvbiBzdHJpbmdzIChlLmcuLCBcIjQuMTAuMFwiIHZzIFwiNC4xNi4wXCIpXG4gICAqL1xuICBwcml2YXRlIGNvbXBhcmVWZXJzaW9ucyh2MTogc3RyaW5nLCB2Mjogc3RyaW5nKTogbnVtYmVyIHtcbiAgICBjb25zdCBwYXJ0czEgPSB2MS5zcGxpdCgnLicpLm1hcChOdW1iZXIpO1xuICAgIGNvbnN0IHBhcnRzMiA9IHYyLnNwbGl0KCcuJykubWFwKE51bWJlcik7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IE1hdGgubWF4KHBhcnRzMS5sZW5ndGgsIHBhcnRzMi5sZW5ndGgpOyBpKyspIHtcbiAgICAgIGNvbnN0IHAxID0gcGFydHMxW2ldIHx8IDA7XG4gICAgICBjb25zdCBwMiA9IHBhcnRzMltpXSB8fCAwO1xuICAgICAgaWYgKHAxIDwgcDIpIHJldHVybiAtMTtcbiAgICAgIGlmIChwMSA+IHAyKSByZXR1cm4gMTtcbiAgICB9XG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICAvKipcbiAgICogU2F2ZSBjb25maWd1cmF0aW9uIHRvIGZpbGUgKG5vbi1zZW5zaXRpdmUgZGF0YSBvbmx5KVxuICAgKi9cbiAgcHJpdmF0ZSBzYXZlQ29uZmlnKCk6IHZvaWQge1xuICAgIHRyeSB7XG4gICAgICAvLyBDcmVhdGUgZGlyZWN0b3J5IGlmIGl0IGRvZXNuJ3QgZXhpc3RcbiAgICAgIGlmICghZXhpc3RzU3luYyh0aGlzLmNvbmZpZ0RpcikpIHtcbiAgICAgICAgbWtkaXJTeW5jKHRoaXMuY29uZmlnRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gV3JpdGUgY29uZmlnIGZpbGUgd2l0aG91dCBzZW5zaXRpdmUgZGF0YVxuICAgICAgd3JpdGVGaWxlU3luYyh0aGlzLmNvbmZpZ1BhdGgsIEpTT04uc3RyaW5naWZ5KHRoaXMuY29uZmlnLCBudWxsLCAyKSk7XG5cbiAgICAgIC8vIFNldCBmaWxlIHBlcm1pc3Npb25zIHRvIHVzZXItb25seSAoNjAwKVxuICAgICAgdHJ5IHtcbiAgICAgICAgY2htb2RTeW5jKHRoaXMuY29uZmlnUGF0aCwgMG82MDApO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIElnbm9yZSBjaG1vZCBlcnJvcnMgb24gV2luZG93c1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzYXZpbmcgY29uZmlnOicsIGVycm9yKTtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIHNhdmUgY29uZmlndXJhdGlvbicpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgY3VycmVudCBjb25maWd1cmF0aW9uIChpbmNsdWRpbmcgY3JlZGVudGlhbHMgZnJvbSBzZWN1cmUgc3RvcmFnZSlcbiAgICovXG4gIGFzeW5jIGdldENvbmZpZygpOiBQcm9taXNlPExpYnJlTGlua0NvbmZpZz4ge1xuICAgIGNvbnN0IGNyZWRlbnRpYWxzID0gYXdhaXQgdGhpcy5nZXRDcmVkZW50aWFscygpO1xuICAgIHJldHVybiB7XG4gICAgICBlbWFpbDogY3JlZGVudGlhbHM/LmVtYWlsIHx8ICcnLFxuICAgICAgcGFzc3dvcmQ6IGNyZWRlbnRpYWxzPy5wYXNzd29yZCB8fCAnJyxcbiAgICAgIC4uLnRoaXMuY29uZmlnXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgbm9uLXNlbnNpdGl2ZSBjb25maWd1cmF0aW9uIHN5bmNocm9ub3VzbHlcbiAgICovXG4gIGdldENvbmZpZ1N5bmMoKTogU3RvcmVkQ29uZmlnICYgeyBlbWFpbDogc3RyaW5nOyBwYXNzd29yZDogc3RyaW5nIH0ge1xuICAgIHJldHVybiB7XG4gICAgICBlbWFpbDogdGhpcy5jYWNoZWRDcmVkZW50aWFscz8uZW1haWwgfHwgJycsXG4gICAgICBwYXNzd29yZDogdGhpcy5jYWNoZWRDcmVkZW50aWFscz8ucGFzc3dvcmQgfHwgJycsXG4gICAgICAuLi50aGlzLmNvbmZpZ1xuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogTG9hZCBjcmVkZW50aWFscyBmcm9tIHNlY3VyZSBzdG9yYWdlIGFuZCBjYWNoZSB0aGVtXG4gICAqL1xuICBhc3luYyBsb2FkQ3JlZGVudGlhbHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5jYWNoZWRDcmVkZW50aWFscyA9IGF3YWl0IHRoaXMuc2VjdXJlU3RvcmFnZS5nZXRDcmVkZW50aWFscygpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBjcmVkZW50aWFscyBmcm9tIHNlY3VyZSBzdG9yYWdlXG4gICAqL1xuICBhc3luYyBnZXRDcmVkZW50aWFscygpOiBQcm9taXNlPFNlY3VyZUNyZWRlbnRpYWxzIHwgbnVsbD4ge1xuICAgIGlmICh0aGlzLmNhY2hlZENyZWRlbnRpYWxzKSB7XG4gICAgICByZXR1cm4gdGhpcy5jYWNoZWRDcmVkZW50aWFscztcbiAgICB9XG4gICAgdGhpcy5jYWNoZWRDcmVkZW50aWFscyA9IGF3YWl0IHRoaXMuc2VjdXJlU3RvcmFnZS5nZXRDcmVkZW50aWFscygpO1xuICAgIHJldHVybiB0aGlzLmNhY2hlZENyZWRlbnRpYWxzO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGNyZWRlbnRpYWxzIGFyZSBjb25maWd1cmVkXG4gICAqL1xuICBhc3luYyBpc0NvbmZpZ3VyZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgY3JlZGVudGlhbHMgPSBhd2FpdCB0aGlzLmdldENyZWRlbnRpYWxzKCk7XG4gICAgcmV0dXJuICEhKGNyZWRlbnRpYWxzPy5lbWFpbCAmJiBjcmVkZW50aWFscz8ucGFzc3dvcmQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGNyZWRlbnRpYWxzIGFyZSBjb25maWd1cmVkIChzeW5jLCB1c2VzIGNhY2hlKVxuICAgKi9cbiAgaXNDb25maWd1cmVkU3luYygpOiBib29sZWFuIHtcbiAgICByZXR1cm4gISEodGhpcy5jYWNoZWRDcmVkZW50aWFscz8uZW1haWwgJiYgdGhpcy5jYWNoZWRDcmVkZW50aWFscz8ucGFzc3dvcmQpO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBjcmVkZW50aWFscyAoc3RvcmVkIHNlY3VyZWx5KVxuICAgKi9cbiAgYXN5bmMgdXBkYXRlQ3JlZGVudGlhbHMoZW1haWw6IHN0cmluZywgcGFzc3dvcmQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2VjdXJlU3RvcmFnZS5zYXZlQ3JlZGVudGlhbHMoeyBlbWFpbCwgcGFzc3dvcmQgfSk7XG4gICAgdGhpcy5jYWNoZWRDcmVkZW50aWFscyA9IHsgZW1haWwsIHBhc3N3b3JkIH07XG4gICAgLy8gQ2xlYXIgYW55IGNhY2hlZCB0b2tlbnMgd2hlbiBjcmVkZW50aWFscyBjaGFuZ2VcbiAgICBhd2FpdCB0aGlzLnNlY3VyZVN0b3JhZ2UuY2xlYXJUb2tlbigpO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSByZWdpb25cbiAgICovXG4gIHVwZGF0ZVJlZ2lvbihyZWdpb246ICdVUycgfCAnRVUnIHwgJ0RFJyB8ICdGUicgfCAnQVAnIHwgJ0FVJyk6IHZvaWQge1xuICAgIHRoaXMuY29uZmlnLnJlZ2lvbiA9IHJlZ2lvbjtcbiAgICB0aGlzLnNhdmVDb25maWcoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgdGFyZ2V0IHJhbmdlc1xuICAgKi9cbiAgdXBkYXRlUmFuZ2VzKHRhcmdldExvdzogbnVtYmVyLCB0YXJnZXRIaWdoOiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGFyZ2V0TG93ID49IHRhcmdldEhpZ2gpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVGFyZ2V0IGxvdyBtdXN0IGJlIGxlc3MgdGhhbiB0YXJnZXQgaGlnaCcpO1xuICAgIH1cbiAgICBpZiAodGFyZ2V0TG93IDwgNDAgfHwgdGFyZ2V0TG93ID4gMTAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RhcmdldCBsb3cgbXVzdCBiZSBiZXR3ZWVuIDQwIGFuZCAxMDAgbWcvZEwnKTtcbiAgICB9XG4gICAgaWYgKHRhcmdldEhpZ2ggPCAxMDAgfHwgdGFyZ2V0SGlnaCA+IDMwMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUYXJnZXQgaGlnaCBtdXN0IGJlIGJldHdlZW4gMTAwIGFuZCAzMDAgbWcvZEwnKTtcbiAgICB9XG5cbiAgICB0aGlzLmNvbmZpZy50YXJnZXRMb3cgPSB0YXJnZXRMb3c7XG4gICAgdGhpcy5jb25maWcudGFyZ2V0SGlnaCA9IHRhcmdldEhpZ2g7XG4gICAgdGhpcy5zYXZlQ29uZmlnKCk7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGNsaWVudCB2ZXJzaW9uXG4gICAqL1xuICB1cGRhdGVDbGllbnRWZXJzaW9uKHZlcnNpb246IHN0cmluZyk6IHZvaWQge1xuICAgIC8vIEVuc3VyZSB2ZXJzaW9uIGlzIGF0IGxlYXN0IDQuMTYuMFxuICAgIGlmICh0aGlzLmNvbXBhcmVWZXJzaW9ucyh2ZXJzaW9uLCAnNC4xNi4wJykgPCAwKSB7XG4gICAgICBjb25zb2xlLndhcm4oYFdhcm5pbmc6IFZlcnNpb24gJHt2ZXJzaW9ufSBpcyBiZWxvdyBtaW5pbXVtIHJlcXVpcmVkICg0LjE2LjApLiBVc2luZyA0LjE2LjAuYCk7XG4gICAgICB2ZXJzaW9uID0gJzQuMTYuMCc7XG4gICAgfVxuICAgIHRoaXMuY29uZmlnLmNsaWVudFZlcnNpb24gPSB2ZXJzaW9uO1xuICAgIHRoaXMuc2F2ZUNvbmZpZygpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBjb25maWd1cmF0aW9uIGZpbGUgcGF0aFxuICAgKi9cbiAgZ2V0Q29uZmlnUGF0aCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZ1BhdGg7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHNlY3VyZSBzdG9yYWdlIHBhdGhzIGZvciBkaWFnbm9zdGljc1xuICAgKi9cbiAgZ2V0U2VjdXJlU3RvcmFnZVBhdGhzKCk6IHsgY29uZmlnRGlyOiBzdHJpbmc7IGNyZWRlbnRpYWxzUGF0aDogc3RyaW5nOyB0b2tlblBhdGg6IHN0cmluZyB9IHtcbiAgICByZXR1cm4gdGhpcy5zZWN1cmVTdG9yYWdlLmdldFN0b3JhZ2VQYXRocygpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgc2VjdXJlIHN0b3JhZ2UgaW5zdGFuY2UgZm9yIHRva2VuIG1hbmFnZW1lbnRcbiAgICovXG4gIGdldFNlY3VyZVN0b3JhZ2UoKTogU2VjdXJlU3RvcmFnZSB7XG4gICAgcmV0dXJuIHRoaXMuc2VjdXJlU3RvcmFnZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlIGF1dGhlbnRpY2F0aW9uIHRva2VuXG4gICAqL1xuICBhc3luYyBzYXZlVG9rZW4odG9rZW5EYXRhOiBTdG9yZWRUb2tlbkRhdGEpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNlY3VyZVN0b3JhZ2Uuc2F2ZVRva2VuKHRva2VuRGF0YSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHN0b3JlZCBhdXRoZW50aWNhdGlvbiB0b2tlblxuICAgKi9cbiAgYXN5bmMgZ2V0VG9rZW4oKTogUHJvbWlzZTxTdG9yZWRUb2tlbkRhdGEgfCBudWxsPiB7XG4gICAgcmV0dXJuIHRoaXMuc2VjdXJlU3RvcmFnZS5nZXRUb2tlbigpO1xuICB9XG5cbiAgLyoqXG4gICAqIENsZWFyIGF1dGhlbnRpY2F0aW9uIHRva2VuXG4gICAqL1xuICBhc3luYyBjbGVhclRva2VuKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2VjdXJlU3RvcmFnZS5jbGVhclRva2VuKCk7XG4gIH1cblxuICAvKipcbiAgICogQ2xlYXIgYWxsIGNvbmZpZ3VyYXRpb24gYW5kIGNyZWRlbnRpYWxzXG4gICAqL1xuICBhc3luYyBjbGVhckNvbmZpZygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmNvbmZpZyA9IHsgLi4uREVGQVVMVF9DT05GSUcgfTtcbiAgICB0aGlzLnNhdmVDb25maWcoKTtcbiAgICBhd2FpdCB0aGlzLnNlY3VyZVN0b3JhZ2UuY2xlYXJBbGwoKTtcbiAgICB0aGlzLmNhY2hlZENyZWRlbnRpYWxzID0gbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBNaWdyYXRlIGZyb20gbGVnYWN5IHVuZW5jcnlwdGVkIGNvbmZpZ1xuICAgKi9cbiAgYXN5bmMgbWlncmF0ZUZyb21MZWdhY3koKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgcmV0dXJuIHRoaXMuc2VjdXJlU3RvcmFnZS5taWdyYXRlRnJvbUxlZ2FjeSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCByZWdpb25cbiAgICovXG4gIGdldFJlZ2lvbigpOiAnVVMnIHwgJ0VVJyB8ICdERScgfCAnRlInIHwgJ0FQJyB8ICdBVScge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5yZWdpb247XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRhcmdldCByYW5nZXNcbiAgICovXG4gIGdldFRhcmdldFJhbmdlcygpOiB7IHRhcmdldExvdzogbnVtYmVyOyB0YXJnZXRIaWdoOiBudW1iZXIgfSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHRhcmdldExvdzogdGhpcy5jb25maWcudGFyZ2V0TG93LFxuICAgICAgdGFyZ2V0SGlnaDogdGhpcy5jb25maWcudGFyZ2V0SGlnaFxuICAgIH07XG4gIH1cbn1cbiJdfQ==