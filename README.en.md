# LibreLink MCP Server - Fixed for API v4.16.0

🇬🇧 [English](README.en.md) | 🇮🇹 [Italiano](README.md)

🩸 MCP Server to access FreeStyle Libre glucose data through Claude Desktop.

**This is a fixed version** that supports the API changes introduced on October 8, 2025:
- ✅ Support for API version 4.16.0+
- ✅ Required `Account-Id` header (SHA256 hash of userId)
- ✅ Automatic regional redirect handling
- ✅ Automatic token refresh
- ✅ Secure credential storage with AES-256-GCM encryption
- ✅ Encryption keys stored in OS keychain (Keytar)
- ✅ Secure JWT token persistence
- ✅ **v1.3.0**: Full support for all 13 LibreLinkUp regions

## 📋 Prerequisites

- **Node.js**: Version 18.0.0 or higher
- **LibreLinkUp Account**: Active account with shared data
- **Sensor**: Active FreeStyle Libre 2 or 3
- **Claude Desktop**: For MCP integration

## 🚀 Quick Installation (Precompiled Bundle)

### Steps:

### 1. Install Keytar (Recommended for maximum security)

To use the native operating system vault (Windows Credential Manager, macOS Keychain, Linux Secret Service), install `keytar`:

```bash
npm install keytar
```

> **Note:** If `keytar` cannot be installed, the system will automatically use an encrypted file as a fallback.

### 2. Download the bundle

Use your browser or:

```bash
wget https://github.com/sedoglia/librelink-mcp-server-fixed/releases/download/v1.3.0/librelink-mcp-server-fixed.mcpb
```

### 3. Verify integrity

Verify the integrity (optional but recommended):

```bash
wget https://github.com/sedoglia/librelink-mcp-server-fixed/releases/download/v1.3.0/librelink-mcp-server-fixed.mcpb.sha256
sha256sum -c librelink-mcp-server-fixed.mcpb
```

### 4. Install the extension in Claude Desktop (Recommended Method)

**Installation via Custom Desktop Extensions:**

1. Open **Claude Desktop**
2. Go to **Settings**
3. Select the **Extensions** tab
4. Click on **Advanced settings** and find the **Extension Developer** section
5. Click on **"Install Extension…"**
6. Select the `.mcpb` file (`librelink-mcp-server-fixed.mcpb` downloaded in step 1)
7. Follow the on-screen instructions to complete the installation

> **Note:** This is the simplest and recommended method. The extension will be automatically integrated into Claude Desktop without requiring any manual configuration.

---

### 5. Configure LibreLink Credentials (Secure Method - Recommended)

Open a **new chat on Claude Desktop** and write the following prompt:

```
Configure LibreLink login credentials
```

Respond to the message by providing:
- **Username:** your LibreLink email
- **Password:** your LibreLink password

The extension will automatically encrypt and securely save the credentials in the native operating system vault (Windows Credential Manager, macOS Keychain, Linux Secret Service).

> **Note:** Credentials will NOT be saved in text files. They will always be encrypted and managed by the OS native vault.

### 6. Restart Claude Desktop

- Close the application completely
- Reopen Claude Desktop
- Verify in Settings → Developer the connection status ✅

## 🚀 Installation (by cloning the repository with GIT)

### 1. Clone the Repository

```bash
# Clone the repository
git clone https://github.com/sedoglia/librelink-mcp-server-fixed.git
cd librelink-mcp-server-fixed
```

### 2. Install Dependencies

```bash
# Install dependencies
npm install
```

### 3. Install Keytar

Keytar requires some system dependencies to work:

**Windows**: No additional dependencies required (uses Windows Credential Manager)

**macOS**: No additional dependencies required (uses Keychain)

**Linux** (Debian/Ubuntu):
```bash
sudo apt-get install libsecret-1-dev gnome-keyring
```

**Linux** (Fedora/RHEL):
```bash
sudo dnf install libsecret-devel gnome-keyring
```

```bash
# Installa Keytar
npm install keytar
```

### 4. Build the Project

```bash
# Build TypeScript
npm run build
```

### 5. Configure credentials

```bash
npm run configure
```

You will be asked for:
- **Email**: Your LibreLinkUp account email
- **Password**: Your account password
- **Region**: One of 13 supported regions (see below)
- **Target range**: Target glucose values (default: 70-180 mg/dL)

### Supported Regions

| Code | Region |
|------|--------|
| AE | United Arab Emirates |
| AP | Asia Pacific |
| AU | Australia |
| CA | Canada |
| CN | China |
| DE | Germany |
| EU | Europe (default) |
| EU2 | Europe 2 |
| FR | France |
| JP | Japan |
| LA | Latin America |
| RU | Russia |
| US | United States |

Credentials are stored securely:
- **Encryption**: AES-256-GCM with random salt and IV
- **Encryption key**: Stored in the OS keychain
- **JWT token**: Persisted securely to avoid repeated logins

### 6. Test the connection

```bash
npm run test:connection
```

### 7. Configure Claude Desktop

Add to your Claude Desktop configuration file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "librelink": {
      "command": "node",
      "args": ["C:/path/to/librelink-mcp-server-fixed/dist/index.js"]
    }
  }
}
```

### 8. Restart Claude Desktop

Restart Claude Desktop to load the MCP server.

## 🛠 Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_current_glucose` | Current glucose reading with trend |
| `get_glucose_history` | Glucose history (default: 24 hours) |
| `get_glucose_stats` | Statistics: average, GMI, time-in-range |
| `get_glucose_trends` | Pattern analysis: dawn phenomenon, stability |
| `get_sensor_info` | Active sensor info |
| `configure_credentials` | Configure LibreLinkUp credentials |
| `configure_ranges` | Set custom target ranges |
| `validate_connection` | Test the connection |
| `get_session_status` | Authentication session status |
| `clear_session` | Clear session and force re-authentication |

## 💬 Usage Examples

Once integrated with Claude Desktop, you can ask:

- *"What's my current glucose level?"*
- *"Show me my glucose history for the last 6 hours"*
- *"Calculate my time-in-range for this week"*
- *"Analyze my glucose patterns"*
- *"Do I have dawn phenomenon?"*

## 📊 Sample Output

### Current Reading

```json
{
  "current_glucose": 105,
  "timestamp": "2025-12-06T16:30:00.000Z",
  "trend": "Flat",
  "status": "Normal",
  "color": "green"
}
```

### Statistics

```json
{
  "analysis_period_days": 7,
  "average_glucose": 112.5,
  "glucose_management_indicator": 5.94,
  "time_in_range": {
    "target_70_180": 85.2,
    "below_70": 2.1,
    "above_180": 12.7
  },
  "variability": {
    "standard_deviation": 28.4,
    "coefficient_of_variation": 25.2
  }
}
```

## 🔒 Security & Privacy

### Storage Locations

Configuration files are stored in OS-specific locations:

| System | Path |
|--------|------|
| Windows | `%LOCALAPPDATA%\librelink-mcp\` |
| macOS | `~/Library/Application Support/librelink-mcp/` |
| Linux | `~/.config/librelink-mcp/` |

### Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OS Keychain (Keytar)                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  AES-256 Key (32 random bytes)                          ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           [OS-specific path]/librelink-mcp/                 │
│  ┌───────────────────┐  ┌────────────────────┐              │
│  │ credentials.enc   │  │ token.enc          │              │
│  │ (AES-256-GCM)     │  │ (AES-256-GCM)      │              │
│  │ - email           │  │ - JWT token        │              │
│  │ - password        │  │ - expiration       │              │
│  └───────────────────┘  │ - userId           │              │
│                         │ - accountId        │              │
│  ┌───────────────────┐  └────────────────────┘              │
│  │ config.json       │                                      │
│  │ (non-sensitive)   │                                      │
│  │ - region          │                                      │
│  │ - targetLow/High  │                                      │
│  └───────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
```

### Security Features

- **AES-256-GCM encryption**: Credentials are encrypted with AES-256 in GCM mode with authentication tag
- **Random salt and IV**: Each encryption operation uses unique salt and IV
- **Keys in Keychain**: The master key is stored in the OS keychain:
  - Windows: Credential Manager
  - macOS: Keychain
  - Linux: Secret Service (libsecret)
- **Persistent tokens**: JWT tokens are saved encrypted to avoid repeated logins
- **Automatic migration**: Credentials from old version are automatically migrated and plaintext passwords removed
- **File permissions**: Automatically set to 600 (user only)
- **No tracking**: Zero telemetry
- **Local processing**: No data sent to external servers

## ⚠️ API v4.16.0 Fix (October 2025)

### The Problem

On October 8, 2025, Abbott made mandatory:
1. `version` header with minimum value `4.16.0`
2. `Account-Id` header containing the SHA256 hash of the userId

### The Solution

This fork automatically generates the `Account-Id` after login:

```typescript
import { createHash } from 'crypto';

// userId comes from the login response
const userId = loginResponse.data.user.id;
const accountId = createHash('sha256').update(userId).digest('hex');

// The header is added to all authenticated requests
headers['Account-Id'] = accountId;
```

## 🐛 Troubleshooting

### Error 403 with `minimumVersion`

```json
{"data":{"minimumVersion":"4.16.0"},"status":920}
```

**Solution:** You're using an old version. Use this updated fork.

### Error `RequiredHeaderMissing`

**Solution:** The `Account-Id` header is not being sent. Use this fork which includes it automatically.

### No connections found

**Solutions:**
1. Open the LibreLinkUp app and accept the new Terms and Conditions
2. Verify that someone is sharing data with you
3. Make sure you're using LibreLinkUp credentials (not LibreLink)

### Authentication error

**Solutions:**
1. Verify email and password
2. Try logging in from the official LibreLinkUp app
3. Check the region (EU vs US, etc.)

### Keytar/Keychain error

If you encounter keychain errors:
1. Make sure the system keychain service is active
2. On Linux, install `libsecret-1-dev` and `gnome-keyring`
3. If the problem persists, credentials will still be encrypted with a derived key

## 📁 Project Structure

```
librelink-mcp-server-fixed/
├── src/
│   ├── index.ts              # Main MCP server
│   ├── librelink-client.ts   # API client with v4.16.0 fix
│   ├── glucose-analytics.ts  # Analytics and statistics
│   ├── config.ts             # Configuration management
│   ├── configure.ts          # CLI configuration tool
│   ├── secure-storage.ts     # Secure storage with Keytar
│   └── types.ts              # TypeScript definitions
├── test-real-connection.js   # Connection test
├── test-secure-storage.js    # Security module test
├── package.json
├── tsconfig.json
└── README.md
```

## 🔐 Privacy Policy

This MCP server respects your privacy:

### Data Collected
- **LibreLinkUp Credentials**: Email and password stored locally with AES-256-GCM encryption
- **Glucose Data**: Retrieved in real-time from LibreLinkUp, never permanently stored
- **Session Tokens**: Temporary JWTs stored locally encrypted

### Data Usage
- All data is processed **exclusively locally** on your device
- No data is sent to external servers except LibreLinkUp (Abbott API)
- No telemetry, analytics, or tracking

### Data Storage
- Credentials: Local encrypted file + key in OS keychain
- Token: Local encrypted file with automatic expiration
- Configuration: Local non-sensitive JSON file

### Third-Party Sharing
- **No data sharing** with third parties
- Communication only with official Abbott LibreLinkUp APIs

### Retention
- Credentials: Until manual deletion (`clear_session`)
- Token: Automatic expiration after JWT validity
- Glucose data: Not persisted, only in memory during session

### Contact
For privacy questions: [GitHub Issues](https://github.com/sedoglia/librelink-mcp-server-fixed/issues)

## 📜 License

MIT License

## 🙏 Credits

- Original fork: [amansk/librelink-mcp-server](https://github.com/amansk/librelink-mcp-server)
- API Documentation: [khskekec/libre-link-up-http-dump](https://gist.github.com/khskekec/6c13ba01b10d3018d816706a32ae8ab2)
- MCP Protocol: [Anthropic](https://modelcontextprotocol.io)
- Secure Storage: [Keytar](https://github.com/atom/node-keytar)

## ☕ Support the Project

If you find this project useful, consider making a donation to support its development:

[![PayPal](https://img.shields.io/badge/PayPal-Donate-blue?style=for-the-badge&logo=paypal)](https://paypal.me/sedoglia)

---

**Disclaimer**: This is an unofficial project, not affiliated with Abbott or FreeStyle Libre. Use responsibly and always consult healthcare professionals for medical decisions.
