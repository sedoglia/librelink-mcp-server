/**
 * Secure Storage Module for LibreLink MCP Server
 *
 * Implements secure credential storage with:
 * - AES-256-GCM encryption for data at rest
 * - Encryption keys stored in OS keychain via Keytar
 * - JWT tokens stored encrypted in user profile folder
 * - Automatic token refresh and persistence
 */
export interface SecureCredentials {
    email: string;
    password: string;
}
export interface StoredTokenData {
    token: string;
    expires: number;
    userId: string;
    accountId: string;
    region: string;
}
export interface EncryptedData {
    encrypted: string;
    iv: string;
    authTag: string;
    salt: string;
}
/**
 * SecureStorage class for managing encrypted credentials and tokens
 */
export declare class SecureStorage {
    private configDir;
    private credentialsPath;
    private tokenPath;
    private encryptionKey;
    constructor();
    /**
     * Ensure config directory exists with proper permissions
     */
    private ensureConfigDir;
    /**
     * Get or create the encryption key from the OS keychain
     */
    private getEncryptionKey;
    /**
     * Derive a key from the master key and salt using scrypt
     */
    private deriveKey;
    /**
     * Encrypt data using AES-256-GCM
     */
    private encrypt;
    /**
     * Decrypt data using AES-256-GCM
     */
    private decrypt;
    /**
     * Save encrypted data to file
     */
    private saveEncryptedFile;
    /**
     * Load encrypted data from file
     */
    private loadEncryptedFile;
    /**
     * Store credentials securely
     */
    saveCredentials(credentials: SecureCredentials): Promise<void>;
    /**
     * Retrieve stored credentials
     */
    getCredentials(): Promise<SecureCredentials | null>;
    /**
     * Check if credentials are stored
     */
    hasCredentials(): boolean;
    /**
     * Store authentication token securely
     */
    saveToken(tokenData: StoredTokenData): Promise<void>;
    /**
     * Retrieve stored authentication token
     */
    getToken(): Promise<StoredTokenData | null>;
    /**
     * Check if a valid token exists
     */
    hasValidToken(): Promise<boolean>;
    /**
     * Clear stored token
     */
    clearToken(): Promise<void>;
    /**
     * Clear all stored data (credentials, tokens, and keychain entries)
     */
    clearAll(): Promise<void>;
    /**
     * Get storage paths for diagnostics
     */
    getStoragePaths(): {
        configDir: string;
        credentialsPath: string;
        tokenPath: string;
    };
    /**
     * Migrate from old unencrypted config.json to new secure storage
     */
    migrateFromLegacy(): Promise<boolean>;
}
