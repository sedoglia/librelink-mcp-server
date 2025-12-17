# LibreLink MCP Server - Fixed for API v4.16.0

🇬🇧 [English](README.en.md) | 🇮🇹 [Italiano](README.md)

🩸 Server MCP per accedere ai dati glicemici FreeStyle Libre tramite Claude Desktop.

**Questa è una versione corretta** che supporta le modifiche API introdotte l'8 ottobre 2025:
- ✅ Supporto per la versione API 4.16.0+
- ✅ Header `Account-Id` obbligatorio (SHA256 hash dell'userId)
- ✅ Gestione automatica del redirect regionale
- ✅ Refresh automatico del token
- ✅ Storage sicuro delle credenziali con crittografia AES-256-GCM
- ✅ Chiavi di crittografia salvate nel keychain del sistema operativo (Keytar)
- ✅ Persistenza sicura dei token JWT
- ✅ **v1.3.0**: Supporto completo per tutte le 13 regioni LibreLinkUp

## 📋 Prerequisiti

- **Node.js**: Versione 18.0.0 o superiore
- **Account LibreLinkUp**: Account attivo con dati condivisi
- **Sensore**: FreeStyle Libre 2 o 3 attivo
- **Claude Desktop**: Per l'integrazione MCP

## 🚀 Installazione Rapida (Bundle Precompilato)

### Passaggi:

### 1. Installa Keytar (Raccomandato per sicurezza massima)

Per utilizzare il vault nativo del sistema operativo (Windows Credential Manager, macOS Keychain, Linux Secret Service), installa `keytar`:

```bash
npm install keytar
```

> **Nota:** Se `keytar` non può essere installato, il sistema userà automaticamente un file criptato come fallback.

### 2. Scarica il bundle

Usa il browser oppure:

```bash
wget https://github.com/sedoglia/librelink-mcp-server-fixed/releases/download/v1.3.0/librelink-mcp-server-fixed.mcpb
```

### 3. Verifica l'integrità

Verifica l'integrità (opzionale ma consigliato):

```bash
wget https://github.com/sedoglia/librelink-mcp-server-fixed/releases/download/v1.3.0/librelink-mcp-server-fixed.mcpb.sha256
sha256sum -c librelink-mcp-server-fixed.mcpb
```

### 4. Installa l'estensione in Claude Desktop (Metodo Consigliato)

**Installazione tramite Custom Desktop Extensions:**

1. Apri **Claude Desktop**
2. Vai su **Impostazioni** (Settings)
3. Seleziona la scheda **Estensioni** (Extensions)
4. Clicca su **Impostazioni Avanzate** (Advanced settings) e trova la sezione **Extension Developer**
5. Clicca su **"Installa Estensione..."** (Install Extension…)
6. Seleziona il file `.mcpb` (`librelink-mcp-server-fixed.mcpb` scaricato al passaggio 1)
7. Segui le indicazioni a schermo per completare l'installazione

> **Nota:** Questo è il metodo più semplice e consigliato. L'estensione sarà automaticamente integrata in Claude Desktop senza necessità di configurazione manuale.

---

### 5. Configura le Credenziali LibreLink (Metodo Sicuro - Raccomandato)

Apri una **nuova chat su Claude Desktop** e scrivi il seguente prompt:

```
Configura le credenziali di accesso per LibreLink
```

Rispondi al messaggio fornendo:
- **Utente:** la tua email LibreLink
- **Password:** la tua password LibreLink

L'estensione provvederà automaticamente a criptare e salvare le credenziali in modo sicuro nel vault nativo del sistema operativo (Windows Credential Manager, macOS Keychain, Linux Secret Service).

> **Nota:** Le credenziali NON verranno salvate in file di testo. Saranno sempre crittografate e gestite dal vault nativo del SO.


### 6. Riavvia Claude Desktop

- Chiudi completamente l'applicazione
- Riapri Claude Desktop
- Verifica in Impostazioni → Sviluppatore lo stato della connessione ✅


## 🚀 Installazione (clonando il repository con GIT)

### 1. Clona il Repository

```bash
# Clona il repository
git clone https://github.com/sedoglia/librelink-mcp-server-fixed.git
cd librelink-mcp-server-fixed
```

### 2. Installa le Dipendenze

```bash
# Installa dipendenze
npm install
```

### 3. Installa Keytar

Keytar richiede alcune dipendenze di sistema per funzionare:

**Windows**: Nessuna dipendenza aggiuntiva richiesta (usa Windows Credential Manager)

**macOS**: Nessuna dipendenza aggiuntiva richiesta (usa Keychain)

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

### 4. Compila il Progetto

```bash
# Compila TypeScript
npm run build
```

### 5. Configura le credenziali

```bash
npm run configure
```

Ti verrà chiesto:
- **Email**: Email del tuo account LibreLinkUp
- **Password**: Password del tuo account
- **Regione**: Una delle 13 regioni supportate (vedi sotto)
- **Range target**: Valori glicemici target (default: 70-180 mg/dL)

### Regioni Supportate

| Codice | Regione |
|--------|---------|
| AE | Emirati Arabi Uniti |
| AP | Asia Pacifico |
| AU | Australia |
| CA | Canada |
| CN | Cina |
| DE | Germania |
| EU | Europa (default) |
| EU2 | Europa 2 |
| FR | Francia |
| JP | Giappone |
| LA | America Latina |
| RU | Russia |
| US | Stati Uniti |

Le credenziali vengono salvate in modo sicuro:
- **Crittografia**: AES-256-GCM con salt e IV casuali
- **Chiave di crittografia**: Salvata nel keychain del sistema operativo
- **Token JWT**: Persistito in modo sicuro per evitare login ripetuti

### 6. Testa la connessione

```bash
npm run test:connection
```

### 7. Configura Claude Desktop

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

### 8. Riavvia Claude Desktop

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
| `get_session_status` | Stato della sessione di autenticazione |
| `clear_session` | Pulisce la sessione e forza re-autenticazione |

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

### Posizioni di Storage

I file di configurazione sono salvati in posizioni specifiche per ogni sistema operativo:

| Sistema | Percorso |
|---------|----------|
| Windows | `%LOCALAPPDATA%\librelink-mcp\` |
| macOS | `~/Library/Application Support/librelink-mcp/` |
| Linux | `~/.config/librelink-mcp/` |

### Architettura di Sicurezza

```
┌─────────────────────────────────────────────────────────────┐
│                    OS Keychain (Keytar)                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Chiave AES-256 (32 byte random)                        ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│         [Percorso specifico per OS]/librelink-mcp/          │
│  ┌───────────────────┐  ┌────────────────────┐              │
│  │ credentials.enc   │  │ token.enc          │              │
│  │ (AES-256-GCM)     │  │ (AES-256-GCM)      │              │
│  │ - email           │  │ - JWT token        │              │
│  │ - password        │  │ - expiration       │              │
│  └───────────────────┘  │ - userId           │              │
│                         │ - accountId        │              │
│  ┌───────────────────┐  └────────────────────┘              │
│  │ config.json       │                                      │
│  │ (non sensibile)   │                                      │
│  │ - region          │                                      │
│  │ - targetLow/High  │                                      │
│  └───────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
```

### Caratteristiche di Sicurezza

- **Crittografia AES-256-GCM**: Le credenziali sono crittografate con algoritmo AES-256 in modalità GCM con authentication tag
- **Salt e IV casuali**: Ogni operazione di crittografia usa salt e IV unici
- **Chiavi nel Keychain**: La chiave master è salvata nel keychain del sistema operativo:
  - Windows: Credential Manager
  - macOS: Keychain
  - Linux: Secret Service (libsecret)
- **Token persistenti**: I JWT token sono salvati crittografati per evitare login ripetuti
- **Migrazione automatica**: Le credenziali dalla vecchia versione vengono migrate automaticamente e le password in chiaro eliminate
- **Permessi file**: Automaticamente impostati a 600 (solo utente)
- **Nessun tracking**: Zero telemetria
- **Elaborazione locale**: Nessun dato inviato a server esterni

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
3. Controlla la regione (EU vs US, ecc.)

### Errore Keytar/Keychain

Se riscontri errori con il keychain:
1. Assicurati che il servizio keychain del sistema sia attivo
2. Su Linux, installa `libsecret-1-dev` e `gnome-keyring`
3. Se il problema persiste, le credenziali saranno comunque crittografate con una chiave derivata

## 📁 Struttura Progetto

```
librelink-mcp-server-fixed/
├── src/
│   ├── index.ts              # Server MCP principale
│   ├── librelink-client.ts   # Client API con fix v4.16.0
│   ├── glucose-analytics.ts  # Analisi e statistiche
│   ├── config.ts             # Gestione configurazione
│   ├── configure.ts          # Tool CLI configurazione
│   ├── secure-storage.ts     # Storage sicuro con Keytar
│   └── types.ts              # Definizioni TypeScript
├── test-real-connection.js   # Test connessione
├── test-secure-storage.js    # Test modulo sicurezza
├── package.json
├── tsconfig.json
└── README.md
```

## 📜 Licenza

MIT License

## 🙏 Crediti

- Fork originale: [amansk/librelink-mcp-server](https://github.com/amansk/librelink-mcp-server)
- Documentazione API: [khskekec/libre-link-up-http-dump](https://gist.github.com/khskekec/6c13ba01b10d3018d816706a32ae8ab2)
- MCP Protocol: [Anthropic](https://modelcontextprotocol.io)
- Secure Storage: [Keytar](https://github.com/atom/node-keytar)

## ☕ Supporta il Progetto

Se questo progetto ti è utile, considera di fare una donazione per supportarne lo sviluppo:

[![PayPal](https://img.shields.io/badge/PayPal-Dona-blue?style=for-the-badge&logo=paypal)](https://paypal.me/sedoglia)

---

**Disclaimer**: Questo è un progetto non ufficiale, non affiliato con Abbott o FreeStyle Libre. Usalo responsabilmente e consulta sempre i professionisti sanitari per decisioni mediche.
