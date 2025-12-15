#!/usr/bin/env node
/**
 * LibreLink MCP Server - Fixed for API v4.16.0 (October 2025)
 *
 * This MCP server provides Claude Desktop with access to FreeStyle LibreLink
 * continuous glucose monitoring (CGM) data.
 *
 * Key features in this version:
 * - API version 4.16.0 support
 * - Account-Id header (SHA256 of userId) for authenticated requests
 * - Secure credential storage with AES-256-GCM encryption
 * - Encryption keys stored in OS keychain via Keytar
 * - Automatic token persistence and refresh
 */
/**
 * Main entry point
 */
export declare function main(): Promise<void>;
