# LYNX

> Open-source SSH tunnel VPN & Proxy client — Windows · macOS · Linux

A lightweight, minimal desktop application for creating secure SOCKS5 proxy tunnels through any SSH server using the NPVT-SSH protocol. Built with Electron and ssh2.

![License](https://img.shields.io/badge/license-MIT-white)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-white)
![Electron](https://img.shields.io/badge/electron-28-47848F)
![Version](https://img.shields.io/github/v/release/xkmikze/lynx)

---

## Screenshots

<p align="center">
  <img src="docs/screenshot-home.png" width="280" alt="Home Screen" />
  <img src="docs/screenshot-configs.png" width="280" alt="Configs Screen" />
</p>

---

## Download

Grab the latest release for your platform:

| Platform | Architecture | File |
|---|---|---|
| Windows | x64 | `LYNX-1.0.3-windows-x64-setup.exe` |
| macOS | x64 (Intel) | `LYNX-1.0.3-mac-x64.dmg` |
| macOS | arm64 (M1/M2/M3/M4) | `LYNX-1.0.3-mac-arm64.dmg` |
| Linux | x64 | `LYNX-1.0.3-linux-x64.AppImage` / `lynx-1.0.3-linux-x64.deb` |
| Linux | arm64 (Pi 4/5) | `LYNX-1.0.3-linux-arm64.AppImage` / `lynx-1.0.3-linux-arm64.deb` |
| Linux | armv7l (Pi 2/3) | `LYNX-1.0.3-linux-armv7l.AppImage` / `lynx-1.0.3-linux-armv7l.deb` |

→ [Latest Release](https://github.com/xkmikze/lynx/releases/latest)

---

## Features

- **NPVT-SSH Protocol** — Import configs via `npvt-ssh://` URI or paste JSON directly
- **Manual SSH Config** — Add servers manually (host, port, user, password)
- **SOCKS5 Proxy** — Exposes `127.0.0.1:10805` as a local SOCKS5 proxy
- **VPN Mode** — System-wide proxy routing (Windows, macOS, Linux)
- **TUN Mode** — Full system traffic routing via virtual network adapter (macOS & Linux)
- **Real-time Log** — Live connection log with timestamps
- **Ping Configs** — Real TCP latency for each server
- **Speed Test** — Measures download speed through the active tunnel
- **Auto-reconnect** — Automatically reconnects if connection drops
- **Run in Background** — System tray support, stays alive when window is closed
- **Dark UI** — Clean black/white minimal interface
- **Auto Connect** — Optionally connect on app launch
- **Encrypted Storage** — Credentials stored encrypted on disk

---

## Quick Start

### Build from Source

```bash
# Requirements: Node.js 18+, npm
git clone https://github.com/xkmikze/lynx.git
cd lynx
npm install

# Development
npm run dev

# Build for your platform
npm run build        # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
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

---

## Proxy Usage

Once connected in **Proxy Mode**, configure your browser or system to use:

| Setting | Value |
|---|---|
| Protocol | SOCKS5 |
| Host | `127.0.0.1` |
| Port | `10805` (configurable) |

In **Firefox**: Preferences → Network → Manual proxy → SOCKS Host: `127.0.0.1`, Port: `10805`, SOCKS v5.

In **Chrome**: Use an extension like [Proxy SwitchyOmega](https://chrome.google.com/webstore/detail/proxy-switchyomega/padekgcemlokbadohgkifijomclgjgif).

---

## TUN Mode

TUN mode routes **all system traffic** through the tunnel — not just browser traffic.

| Platform | Status | Requirements |
|---|---|---|
| macOS | ✅ Supported | Admin password on first use |
| Linux | ✅ Supported | Root or `CAP_NET_ADMIN` |
| Windows | 🔜 Coming Soon | Requires native driver (v1.1.0) |

### Linux TUN setup
```bash
# Run with sudo
sudo ./LYNX.AppImage

# Or grant capability (no sudo needed after)
sudo setcap cap_net_admin+ep LYNX.AppImage
```

---

## Project Structure

```
lynx/
├── src/
│   ├── main/
│   │   ├── main.js                  # Electron main process
│   │   ├── tunnel-manager.js        # SSH + SOCKS5 tunnel
│   │   ├── tun-manager.js           # TUN virtual adapter (macOS/Linux)
│   │   ├── wintun-helper/           # Windows TUN helper (coming soon)
│   │   ├── proxy-server.js          # Proxy lifecycle
│   │   ├── ping-service.js          # TCP latency measurement
│   │   └── speed-test.js            # Download speed test
│   ├── renderer/
│   │   ├── index.html               # UI layout
│   │   ├── app.js                   # UI logic
│   │   └── preload.js               # Secure IPC bridge
│   └── shared/
│       └── config-utils.js          # Config parsing & validation
├── assets/
│   ├── icons/                       # App icons
│   └── wintun/                      # wintun.dll (user-provided)
├── docs/                            # Screenshots
├── package.json
├── .github/
│   └── workflows/
│       └── build.yml                # CI/CD — builds all platforms
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
- [x] macOS support
- [x] Linux support
- [x] NPVT-SSH URI import
- [x] SOCKS5 proxy mode
- [x] System-wide VPN proxy mode
- [x] TUN mode (macOS & Linux)
- [x] Real-time connection log
- [x] Ping & speed test
- [x] Auto-reconnect on disconnect
- [x] System tray
- [ ] TUN mode for Windows (v1.1.0)
- [ ] SSH key authentication
- [ ] Config groups / tags
- [ ] DNS over HTTPS support
- [ ] Dark/light theme toggle
- [ ] Mobile companion app

---

## Contributing

Pull requests are welcome. For major changes, open an issue first.

```bash
npm run lint   # Lint
npm run pack   # Test build without installer
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT © [LYNX Contributors](https://github.com/xkmikze/lynx)
