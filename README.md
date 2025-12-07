# LibreLink MCP Server - Fixed for API v4.16.0

🩸 Server MCP per accedere ai dati glicemici FreeStyle Libre tramite Claude Desktop.

**Questa è una versione corretta** che supporta le modifiche API introdotte l'8 ottobre 2025:
- ✅ Supporto per la versione API 4.16.0+
- ✅ Header `Account-Id` obbligatorio (SHA256 hash dell'userId)
- ✅ Gestione automatica del redirect regionale
- ✅ Refresh automatico del token

## 🚀 Installazione Rapida

```bash
# Installa dipendenze
npm install

# Compila TypeScript
npm run build

# Configura credenziali
npm run configure

# Testa la connessione
node test-real-connection.js
```

## 📋 Prerequisiti

- **Node.js**: Versione 18.0.0 o superiore
- **Account LibreLinkUp**: Account attivo con dati condivisi
- **Sensore**: FreeStyle Libre 2 o 3 attivo
- **Claude Desktop**: Per l'integrazione MCP

## 🔧 Configurazione

### 1. Configura le credenziali

```bash
npm run configure
```

Ti verrà chiesto:
- **Email**: Email del tuo account LibreLinkUp
- **Password**: Password del tuo account
- **Regione**: EU, US, DE, FR, AP, AU
- **Range target**: Valori glicemici target (default: 70-180 mg/dL)

### 2. Testa la connessione

```bash
node test-real-connection.js
```

### 3. Configura Claude Desktop

Aggiungi al file di configurazione di Claude Desktop:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "librelink": {
      "command": "node",
      "args": ["C:/percorso/librelink-mcp-server-fixed/dist/index.js"]
    }
  }
}
```

### 4. Riavvia Claude Desktop

Riavvia Claude Desktop per caricare il server MCP.

## 🛠 Strumenti MCP Disponibili

| Strumento | Descrizione |
|-----------|-------------|
| `get_current_glucose` | Lettura glicemica attuale con trend |
| `get_glucose_history` | Storico glicemico (default: 24 ore) |
| `get_glucose_stats` | Statistiche: media, GMI, time-in-range |
| `get_glucose_trends` | Analisi pattern: dawn phenomenon, stabilità |
| `get_sensor_info` | Info sensore attivo |
| `configure_credentials` | Configura credenziali LibreLinkUp |
| `configure_ranges` | Imposta range target personalizzati |
| `validate_connection` | Testa la connessione |

## 💬 Esempi di Utilizzo

Una volta integrato con Claude Desktop, puoi chiedere:

- *"Qual è la mia glicemia attuale?"*
- *"Mostrami lo storico glicemico delle ultime 6 ore"*
- *"Calcola il mio time-in-range di questa settimana"*
- *"Analizza i miei pattern glicemici"*
- *"Ho il fenomeno dell'alba?"*

## 📊 Output di Esempio

### Lettura Attuale

```json
{
  "current_glucose": 105,
  "timestamp": "2025-12-06T16:30:00.000Z",
  "trend": "Flat",
  "status": "Normal",
  "color": "green"
}
```

### Statistiche

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

## 🔒 Sicurezza e Privacy

- **Elaborazione locale** - Nessun dato inviato a server esterni
- **Credenziali locali** - Salvate in `~/.librelink-mcp/config.json`
- **Permessi file** - Automaticamente impostati a 600 (solo utente)
- **Nessun tracking** - Zero telemetria

## ⚠️ Fix API v4.16.0 (Ottobre 2025)

### Il Problema

L'8 ottobre 2025, Abbott ha reso obbligatori:
1. Header `version` con valore minimo `4.16.0`
2. Header `Account-Id` contenente l'hash SHA256 dell'userId

### La Soluzione

Questo fork genera automaticamente l'`Account-Id` dopo il login:

```typescript
import { createHash } from 'crypto';

// L'userId viene dalla risposta del login
const userId = loginResponse.data.user.id;
const accountId = createHash('sha256').update(userId).digest('hex');

// L'header viene aggiunto a tutte le richieste autenticate
headers['Account-Id'] = accountId;
```

## 🐛 Troubleshooting

### Errore 403 con `minimumVersion`

```json
{"data":{"minimumVersion":"4.16.0"},"status":920}
```

**Soluzione:** Stai usando una versione vecchia. Usa questo fork aggiornato.

### Errore `RequiredHeaderMissing`

**Soluzione:** L'header `Account-Id` non viene inviato. Usa questo fork che lo include automaticamente.

### Nessuna connessione trovata

**Soluzioni:**
1. Apri l'app LibreLinkUp e accetta i nuovi Termini e Condizioni
2. Verifica che qualcuno stia condividendo i dati con te
3. Controlla di usare le credenziali LibreLinkUp (non LibreLink)

### Errore di autenticazione

**Soluzioni:**
1. Verifica email e password
2. Prova ad accedere dall'app ufficiale LibreLinkUp
3. Controlla la regione (EU vs US)

## 📁 Struttura Progetto

```
librelink-mcp-server-fixed/
├── src/
│   ├── index.ts              # Server MCP principale
│   ├── librelink-client.ts   # Client API con fix v4.16.0
│   ├── glucose-analytics.ts  # Analisi e statistiche
│   ├── config.ts             # Gestione configurazione
│   ├── configure.ts          # Tool CLI configurazione
│   └── types.ts              # Definizioni TypeScript
├── config/
│   └── default.json          # Configurazione default
├── dist/                     # File compilati
├── test-real-connection.js   # Test connessione
├── package.json
└── README.md
```

## 📜 Licenza

MIT License

## 🙏 Crediti

- Fork originale: [amansk/librelink-mcp-server](https://github.com/amansk/librelink-mcp-server)
- Documentazione API: [khskekec/libre-link-up-http-dump](https://gist.github.com/khskekec/6c13ba01b10d3018d816706a32ae8ab2)
- MCP Protocol: [Anthropic](https://modelcontextprotocol.io)

---

**Disclaimer**: Questo è un progetto non ufficiale, non affiliato con Abbott o FreeStyle Libre. Usalo responsabilmente e consulta sempre i professionisti sanitari per decisioni mediche.
