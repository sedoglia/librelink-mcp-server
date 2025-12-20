# Privacy Policy - LibreLink MCP Server

*Last updated: December 2024*

## Overview

LibreLink MCP Server is a local Model Context Protocol (MCP) server that enables Claude Desktop to access FreeStyle Libre continuous glucose monitoring (CGM) data. This privacy policy explains how your data is collected, used, and protected.

## Data Collection

### What We Collect

| Data Type | Description | Storage Location |
|-----------|-------------|------------------|
| **LibreLinkUp Credentials** | Your email and password | Local encrypted file |
| **Glucose Data** | Blood glucose readings, trends | Memory only (not persisted) |
| **Session Tokens** | JWT authentication tokens | Local encrypted file |
| **Configuration** | Region, target ranges | Local JSON file |

### What We Do NOT Collect

- No usage analytics or telemetry
- No crash reports sent externally
- No personal health data transmitted to third parties
- No browsing or usage patterns

## Data Usage

### How Your Data Is Used

1. **Authentication**: Credentials are used solely to authenticate with Abbott's LibreLinkUp API
2. **Data Retrieval**: Glucose data is fetched in real-time when you request it through Claude
3. **Local Processing**: All analytics and calculations are performed locally on your device

### Data Flow

```
Your Device                          Abbott Servers
┌─────────────────────┐              ┌─────────────────┐
│ Claude Desktop      │              │ LibreLinkUp API │
│   ↓                 │              │                 │
│ MCP Server          │─────────────→│ Authentication  │
│   ↓                 │←─────────────│ Glucose Data    │
│ Local Processing    │              │                 │
│   ↓                 │              └─────────────────┘
│ Display Results     │
└─────────────────────┘
```

**No data is sent anywhere except to Abbott's official LibreLinkUp servers.**

## Data Storage

### Encryption

All sensitive data is protected using industry-standard encryption:

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: scrypt with random salt
- **Key Storage**: Operating system's native credential manager
  - Windows: Credential Manager
  - macOS: Keychain
  - Linux: Secret Service (libsecret)

### Storage Locations

| Operating System | Path |
|-----------------|------|
| Windows | `%LOCALAPPDATA%\librelink-mcp\` |
| macOS | `~/Library/Application Support/librelink-mcp/` |
| Linux | `~/.config/librelink-mcp/` |

### Files Stored

| File | Contents | Encryption |
|------|----------|------------|
| `credentials.enc` | Email, password | AES-256-GCM |
| `token.enc` | JWT token, expiration | AES-256-GCM |
| `config.json` | Region, target ranges | None (non-sensitive) |

## Third-Party Sharing

### We Do NOT Share Your Data

- No data is sold to third parties
- No data is shared with advertisers
- No data is shared with analytics providers

### External Communications

The only external communication is with Abbott's LibreLinkUp API servers:
- `api-eu.libreview.io` (Europe)
- `api-us.libreview.io` (United States)
- Other regional endpoints as configured

## Data Retention

| Data Type | Retention Period |
|-----------|-----------------|
| Credentials | Until you run `clear_session` or delete files |
| Session Tokens | Automatic expiration (typically 1 hour) |
| Glucose Data | Not stored - exists only in memory during session |
| Configuration | Until manually deleted |

## Your Rights

You have full control over your data:

### View Your Data
All data is stored locally on your device in the paths listed above.

### Delete Your Data
Use the `clear_session` MCP tool or manually delete the storage folder:
- Windows: `%LOCALAPPDATA%\librelink-mcp\`
- macOS: `~/Library/Application Support/librelink-mcp/`
- Linux: `~/.config/librelink-mcp/`

### Export Your Data
Configuration can be found in `config.json`. Encrypted files require the OS keychain key to decrypt.

## Security Measures

### Implementation

1. **No Plaintext Storage**: Credentials are never stored in plaintext
2. **OS-Level Security**: Encryption keys stored in OS credential manager
3. **Automatic Token Expiration**: Session tokens expire automatically
4. **Local Processing**: All data processing happens on your device
5. **Open Source**: Full source code available for security audit

### Recommendations

- Keep your operating system updated
- Use strong LibreLinkUp passwords
- Periodically run `clear_session` to rotate credentials
- Review the source code if you have security concerns

## Children's Privacy

This software is intended for adults managing their own health data or caregivers with authorized access to LibreLinkUp data. We do not knowingly collect data from children under 13.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be documented in the repository's commit history and reflected in the "Last updated" date above.

## Open Source Transparency

This project is open source under the MIT License. You can:
- Review all source code on [GitHub](https://github.com/sedoglia/librelink-mcp-server-fixed)
- Verify exactly what data is collected and how it's used
- Fork and modify the code for your own needs

## Contact

For privacy-related questions or concerns:
- **GitHub Issues**: [https://github.com/sedoglia/librelink-mcp-server-fixed/issues](https://github.com/sedoglia/librelink-mcp-server-fixed/issues)
- **Email**: sedoglia@gmail.com

## Legal Disclaimer

This is an unofficial project, not affiliated with Abbott Laboratories or FreeStyle Libre. Use of this software is at your own risk. Always consult healthcare professionals for medical decisions.

---

*This privacy policy is effective as of December 2024.*
