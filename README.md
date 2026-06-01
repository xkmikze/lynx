# LYNX

> Open-source SSH tunnel VPN/Proxy client for Windows (macOS & Linux coming soon)

A lightweight, minimal desktop application for creating SOCKS5 proxy tunnels using the NPVT-SSH protocol. Built with Electron and ssh2.

![License](https://img.shields.io/badge/license-MIT-white) ![Platform](https://img.shields.io/badge/platform-Windows-blue) ![Electron](https://img.shields.io/badge/electron-29-47848F)

---

## Features

- **NPVT-SSH Protocol** — Import configs via `npvt-ssh://` URI or paste JSON directly
- **Manual SSH Config** — Add servers manually (host, port, user, password)
- **SOCKS5 Proxy** — Exposes `127.0.0.1:10805` as a local SOCKS5 proxy
- **VPN Mode** — System-level routing (coming soon)
- **Ping Configs** — Real TCP latency for each server
- **Speed Test** — Measures download speed through the active tunnel
- **Run in Background** — System tray support, stays alive when window is closed
- **Dark UI** — Clean black/white minimal interface
- **Auto Connect** — Optionally connect on app launch
- **Encrypted Storage** — Credentials stored encrypted on disk

---

## Quick Start

### Download

Grab the latest installer from [Releases](https://github.com/your-org/lynx/releases).

### Build from Source

```bash
# Requirements: Node.js 18+, npm
git clone https://github.com/your-org/lynx.git
cd lynx
npm install

# Development
npm run dev

# Build Windows installer
npm run build
```

---

## NPVT-SSH URI Format

The app accepts `npvt-ssh://` URIs — a base64-encoded JSON config:

```
npvt-ssh://<base64(JSON)>
```

Example JSON structure:
```json
{
  "sshConfigType": "SSH-Direct",
  "remarks": "My Server",
  "sshHost": "1.2.3.4",
  "sshPort": 22,
  "sshUsername": "user",
  "sshPassword": "pass",
  "dnsTTMode": "UDP",
  "udpgwTransparentDNS": true
}
```

Encode it to a URI:
```js
const uri = "npvt-ssh://" + Buffer.from(JSON.stringify(config)).toString("base64");
```

---

## Proxy Usage

Once connected in **Proxy Mode**, configure your browser or system to use:

| Setting | Value |
|---|---|
| Protocol | SOCKS5 |
| Host | `127.0.0.1` |
| Port | `10805` (configurable) |

In **Firefox**: Preferences → Network → Manual proxy → SOCKS Host: `127.0.0.1`, Port: `10805`, SOCKS v5.

---

## Project Structure

```
lynx/
├── src/
│   ├── main/
│   │   ├── main.js              # Electron main process
│   │   ├── tunnel-manager.js    # SSH + SOCKS5 tunnel
│   │   ├── proxy-server.js      # Proxy lifecycle
│   │   ├── ping-service.js      # TCP latency measurement
│   │   └── speed-test.js        # Download speed test
│   ├── renderer/
│   │   ├── index.html           # UI layout
│   │   ├── app.js               # UI logic
│   │   └── preload.js           # Secure IPC bridge
│   └── shared/
│       └── config-utils.js      # Config parsing & validation
├── assets/
│   └── icons/                   # App icons
├── docs/                        # Documentation
├── scripts/                     # Build scripts
├── package.json
├── .github/
│   └── workflows/
│       └── build.yml            # CI/CD
└── README.md
```

---

## Security

- **Context Isolation** — Renderer has no access to Node.js APIs directly
- **Preload bridge** — All IPC channels are allowlisted
- **Encrypted store** — Credentials encrypted at rest via `electron-store`
- **No telemetry** — Zero data sent anywhere except your SSH server
- **Input validation** — All config fields validated before use
- **Single instance** — Prevents multiple conflicting tunnels

---

## Roadmap

- [x] Windows support
- [x] NPVT-SSH URI import
- [x] SOCKS5 proxy mode
- [x] Ping & speed test
- [x] System tray
- [ ] macOS support
- [ ] Linux support
- [ ] VPN mode (TUN adapter)
- [ ] SSH key authentication
- [ ] Config groups / tags
- [ ] Auto-reconnect on disconnect
- [ ] DNS over HTTPS support
- [ ] Dark/light theme toggle

---

## Contributing

Pull requests are welcome. For major changes, open an issue first.

```bash
# Lint
npm run lint

# Test build
npm run pack
```

---

## License

MIT © NPVT-SSH Contributors
