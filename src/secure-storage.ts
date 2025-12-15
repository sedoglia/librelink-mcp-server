/**
 * Secure Storage Module for LibreLink MCP Server
 *
 * Implements secure credential storage with:
 * - AES-256-GCM encryption for data at rest
 * - Encryption keys stored in OS keychain via Keytar
 * - JWT tokens stored encrypted in user profile folder
 * - Automatic token refresh and persistence
 *
 * Storage locations:
 * - Windows: %LOCALAPPDATA%\librelink-mcp\
 * - macOS: ~/Library/Application Support/librelink-mcp/
 * - Linux: ~/.config/librelink-mcp/
 */

import keytar from 'keytar';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

// Service name for keytar
const SERVICE_NAME = 'librelink-mcp-server';
const ENCRYPTION_KEY_ACCOUNT = 'encryption-key';
const AUTH_TOKEN_ACCOUNT = 'auth-token';

// Encryption constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/**
 * Get the appropriate config directory based on the operating system
 * - Windows: %LOCALAPPDATA%\librelink-mcp\
 * - macOS: ~/Library/Application Support/librelink-mcp/
 * - Linux: ~/.config/librelink-mcp/
 */
function getConfigDir(): string {
  const os = platform();

  if (os === 'win32') {
    // Windows: use LOCALAPPDATA
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(localAppData, 'librelink-mcp');
  } else if (os === 'darwin') {
    // macOS: use ~/Library/Application Support
    return join(homedir(), 'Library', 'Application Support', 'librelink-mcp');
  } else {
    // Linux and others: use ~/.config
    const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(configHome, 'librelink-mcp');
  }
}

/**
 * Get the legacy config directory path for migration
 */
function getLegacyConfigDir(): string {
  return join(homedir(), '.librelink-mcp');
}

export interface SecureCredentials {
  email: string;
  password: string;
}

export interface StoredTokenData {
  token: string;
  expires: number; // timestamp in ms
  userId: string;
  accountId: string; // SHA256 hash of userId
  region: string;
}

export interface EncryptedData {
  encrypted: string; // base64
  iv: string; // base64
  authTag: string; // base64
  salt: string; // base64
}

/**
 * SecureStorage class for managing encrypted credentials and tokens
 */
export class SecureStorage {
  private configDir: string;
  private legacyConfigDir: string;
  private credentialsPath: string;
  private tokenPath: string;
  private encryptionKey: Buffer | null = null;

  constructor() {
    this.configDir = getConfigDir();
    this.legacyConfigDir = getLegacyConfigDir();
    this.credentialsPath = join(this.configDir, 'credentials.enc');
    this.tokenPath = join(this.configDir, 'token.enc');
  }

  /**
   * Ensure config directory exists with proper permissions
   */
  private ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
      try {
        chmodSync(this.configDir, 0o700);
      } catch {
        // Ignore chmod errors on Windows
      }
    }
  }

  /**
   * Get or create the encryption key from the OS keychain
   */
  private async getEncryptionKey(): Promise<Buffer> {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    try {
      // Try to get existing key from keychain
      const existingKey = await keytar.getPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT);

      if (existingKey) {
        this.encryptionKey = Buffer.from(existingKey, 'hex');
        return this.encryptionKey;
      }
    } catch (error) {
      console.error('Error accessing keychain:', error);
    }

    // Generate new encryption key
    const newKey = randomBytes(KEY_LENGTH);

    try {
      await keytar.setPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT, newKey.toString('hex'));
    } catch (error) {
      console.error('Error storing key in keychain:', error);
      throw new Error('Failed to store encryption key in system keychain. Please ensure your system supports secure credential storage.');
    }

    this.encryptionKey = newKey;
    return this.encryptionKey;
  }

  /**
   * Derive a key from the master key and salt using scrypt
   */
  private deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
    return scryptSync(masterKey, salt, KEY_LENGTH);
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  private async encrypt(data: string): Promise<EncryptedData> {
    const masterKey = await this.getEncryptionKey();
    const salt = randomBytes(SALT_LENGTH);
    const derivedKey = this.deriveKey(masterKey, salt);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, derivedKey, iv);

    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      salt: salt.toString('base64')
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  private async decrypt(encryptedData: EncryptedData): Promise<string> {
    const masterKey = await this.getEncryptionKey();
    const salt = Buffer.from(encryptedData.salt, 'base64');
    const derivedKey = this.deriveKey(masterKey, salt);
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');

    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData.encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Save encrypted data to file
   */
  private saveEncryptedFile(path: string, data: EncryptedData): void {
    this.ensureConfigDir();
    writeFileSync(path, JSON.stringify(data, null, 2));
    try {
      chmodSync(path, 0o600);
    } catch {
      // Ignore chmod errors on Windows
    }
  }

  /**
   * Load encrypted data from file
   */
  private loadEncryptedFile(path: string): EncryptedData | null {
    if (!existsSync(path)) {
      return null;
    }

    try {
      const data = readFileSync(path, 'utf-8');
      return JSON.parse(data) as EncryptedData;
    } catch {
      return null;
    }
  }

  /**
   * Store credentials securely
   */
  async saveCredentials(credentials: SecureCredentials): Promise<void> {
    const encrypted = await this.encrypt(JSON.stringify(credentials));
    this.saveEncryptedFile(this.credentialsPath, encrypted);
  }

  /**
   * Retrieve stored credentials
   */
  async getCredentials(): Promise<SecureCredentials | null> {
    const encryptedData = this.loadEncryptedFile(this.credentialsPath);
    if (!encryptedData) {
      return null;
    }

    try {
      const decrypted = await this.decrypt(encryptedData);
      return JSON.parse(decrypted) as SecureCredentials;
    } catch (error) {
      console.error('Error decrypting credentials:', error);
      return null;
    }
  }

  /**
   * Check if credentials are stored
   */
  hasCredentials(): boolean {
    return existsSync(this.credentialsPath);
  }

  /**
   * Store authentication token securely
   */
  async saveToken(tokenData: StoredTokenData): Promise<void> {
    const encrypted = await this.encrypt(JSON.stringify(tokenData));
    this.saveEncryptedFile(this.tokenPath, encrypted);

    // Also store a quick-access token hash in keychain for validation
    try {
      await keytar.setPassword(SERVICE_NAME, AUTH_TOKEN_ACCOUNT, tokenData.accountId);
    } catch {
      // Non-critical, continue without keychain token storage
    }
  }

  /**
   * Retrieve stored authentication token
   */
  async getToken(): Promise<StoredTokenData | null> {
    const encryptedData = this.loadEncryptedFile(this.tokenPath);
    if (!encryptedData) {
      return null;
    }

    try {
      const decrypted = await this.decrypt(encryptedData);
      const tokenData = JSON.parse(decrypted) as StoredTokenData;

      // Check if token is still valid (with 5 minute buffer)
      if (Date.now() < (tokenData.expires - 300000)) {
        return tokenData;
      }

      // Token expired, remove it
      await this.clearToken();
      return null;
    } catch (error) {
      console.error('Error decrypting token:', error);
      return null;
    }
  }

  /**
   * Check if a valid token exists
   */
  async hasValidToken(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }

  /**
   * Clear stored token
   */
  async clearToken(): Promise<void> {
    if (existsSync(this.tokenPath)) {
      unlinkSync(this.tokenPath);
    }

    try {
      await keytar.deletePassword(SERVICE_NAME, AUTH_TOKEN_ACCOUNT);
    } catch {
      // Ignore keychain errors
    }
  }

  /**
   * Clear all stored data (credentials, tokens, and keychain entries)
   */
  async clearAll(): Promise<void> {
    // Clear files
    if (existsSync(this.credentialsPath)) {
      unlinkSync(this.credentialsPath);
    }
    await this.clearToken();

    // Clear keychain entries
    try {
      await keytar.deletePassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT);
      await keytar.deletePassword(SERVICE_NAME, AUTH_TOKEN_ACCOUNT);
    } catch {
      // Ignore keychain errors
    }

    this.encryptionKey = null;
  }

  /**
   * Get storage paths for diagnostics
   */
  getStoragePaths(): { configDir: string; credentialsPath: string; tokenPath: string } {
    return {
      configDir: this.configDir,
      credentialsPath: this.credentialsPath,
      tokenPath: this.tokenPath
    };
  }

  /**
   * Migrate from old unencrypted config.json to new secure storage
   * Checks both new location and legacy ~/.librelink-mcp/ location
   */
  async migrateFromLegacy(): Promise<boolean> {
    // Try new location first, then legacy location
    const pathsToCheck = [
      join(this.configDir, 'config.json'),
      join(this.legacyConfigDir, 'config.json')
    ];

    for (const legacyPath of pathsToCheck) {
      if (!existsSync(legacyPath)) {
        continue;
      }

      try {
        const legacyData = JSON.parse(readFileSync(legacyPath, 'utf-8'));

        // Check for password in root or nested credentials object
        const email = legacyData.email || legacyData.credentials?.email;
        const password = legacyData.password || legacyData.credentials?.password;

        if (email && password) {
          // Save credentials to new secure storage
          await this.saveCredentials({ email, password });

          console.error(`Migrated credentials from ${legacyPath} to secure storage`);

          // Remove all sensitive data from legacy file
          delete legacyData.password;
          delete legacyData.email;
          delete legacyData.credentials;

          // Keep only non-sensitive settings
          const cleanConfig = {
            region: legacyData.region || 'EU',
            targetLow: legacyData.targetLow || legacyData.ranges?.target_low || 70,
            targetHigh: legacyData.targetHigh || legacyData.ranges?.target_high || 180,
            clientVersion: legacyData.clientVersion || '4.16.0'
          };

          // Save cleaned config to new location
          this.ensureConfigDir();
          const newConfigPath = join(this.configDir, 'config.json');
          writeFileSync(newConfigPath, JSON.stringify(cleanConfig, null, 2));

          // If migrating from legacy location, update that file too
          if (legacyPath !== newConfigPath) {
            writeFileSync(legacyPath, JSON.stringify(cleanConfig, null, 2));
          }

          return true;
        }
      } catch (error) {
        console.error(`Error migrating legacy config from ${legacyPath}:`, error);
      }
    }

    return false;
  }

  /**
   * Get the legacy config directory path
   */
  getLegacyConfigDir(): string {
    return this.legacyConfigDir;
  }
}
