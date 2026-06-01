'use strict';

const { Client } = require('ssh2');
const net = require('net');
const { exec } = require('child_process');

class TunnelManager {
  constructor(store) {
    this.store = store;
    this._client = null;
    this._connected = false;
    this._currentConfig = null;
    this._socksServer = null;
    this._logCallback = null;
    this._statusCallback = null;
    this._reconnectTimer = null;
    this._destroyed = false;
  }

  isConnected() { return this._connected; }
  onLog(cb) { this._logCallback = cb; }
  onStatus(cb) { this._statusCallback = cb; }

  _log(msg, level = 'info') {
    if (this._logCallback) this._logCallback(msg, level);
    console.log(`[LYNX][${level}] ${msg}`);
  }

  _emitStatus(s) {
    if (this._statusCallback) this._statusCallback(s);
  }

  connect(config) {
    return new Promise((resolve, reject) => {
      if (this._connected) { reject(new Error('Already connected')); return; }
      this._destroyed = false;
      this._currentConfig = config;

      const client = new Client();
      this._client = client;

      this._log(`Connecting to ${config.sshHost}:${config.sshPort} as ${config.sshUsername}…`);

      const timeout = setTimeout(() => {
        this._log('Connection timed out', 'error');
        client.destroy();
        reject(new Error('Connection timed out after 15s'));
      }, 15000);

      client.on('ready', async () => {
        clearTimeout(timeout);
        this._connected = true;
        this._log('SSH handshake complete — tunnel established', 'success');

        try {
          await this._startSocksProxy(client);
          const port = this.store.get('proxyPort');
          this._log(`SOCKS5 proxy listening on 127.0.0.1:${port}`, 'success');

          const mode = this.store.get('mode');
          if (mode === 'vpn') {
            await this._enableSystemProxy(port);
          }

          resolve();
        } catch (err) {
          this._connected = false;
          client.end();
          reject(err);
        }
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        this._connected = false;
        this._client = null;
        const msg = this._humanizeError(err);
        this._log(`Connection error: ${msg}`, 'error');
        if (!this._destroyed) reject(new Error(msg));
      });

      client.on('close', () => {
        if (!this._connected) return; // already handled
        this._connected = false;
        this._log('SSH connection closed', 'warn');
        this._emitStatus('disconnected');
        this._stopSocksProxy();
        this._disableSystemProxy();

        if (!this._destroyed && this._currentConfig) {
          this._log('Reconnecting in 5s…', 'warn');
          this._reconnectTimer = setTimeout(() => {
            if (this._destroyed) return;
            this._client = null;
            this._emitStatus('connecting');
            this.connect(this._currentConfig)
              .then(() => this._emitStatus('connected'))
              .catch((e) => {
                this._log(`Reconnect failed: ${e.message}`, 'error');
                this._emitStatus('disconnected');
              });
          }, 5000);
        }
      });

      // NOTE: No custom keepalive exec — ssh2's built-in keepaliveInterval handles
      // it at the protocol level (SSH_MSG_GLOBAL_REQUEST) without opening a channel.
      // Using exec() for keepalive causes servers to close the session.

      try {
        client.connect(this._buildSshConfig(config));
      } catch (err) {
        clearTimeout(timeout);
        reject(new Error('Failed to initiate: ' + err.message));
      }
    });
  }

  async disconnect() {
    this._destroyed = true;
    clearTimeout(this._reconnectTimer);

    const mode = this.store.get('mode');
    if (mode === 'vpn') await this._disableSystemProxy();

    await this._stopSocksProxy();

    if (this._client) {
      try { this._client.end(); } catch (_) {}
      this._client = null;
    }
    this._connected = false;
    this._log('Disconnected', 'info');
  }

  // ── SOCKS5 ────────────────────────────────────────────────────────────────

  _startSocksProxy(client) {
    return new Promise((resolve, reject) => {
      const port = this.store.get('proxyPort');
      const host = this.store.get('proxyHost');

      if (this._socksServer) {
        try { this._socksServer.close(); } catch (_) {}
        this._socksServer = null;
      }

      const server = net.createServer((socket) => {
        socket.on('error', () => {});
        this._handleSocks5(socket, client);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') reject(new Error(`Port ${port} already in use. Change it in Settings.`));
        else reject(new Error(`Proxy error: ${err.message}`));
      });

      server.listen(port, host, () => {
        this._socksServer = server;
        resolve();
      });
    });
  }

  _stopSocksProxy() {
    return new Promise((resolve) => {
      if (!this._socksServer) { resolve(); return; }
      const s = this._socksServer;
      this._socksServer = null;
      s.close(() => resolve());
      setTimeout(resolve, 800); // force-resolve after 800ms
    });
  }

  _handleSocks5(socket, client) {
    // Guard: reject immediately if SSH is gone
    if (!this._connected || !this._client) { socket.destroy(); return; }

    let step = 'auth';

    const onData = (buf) => {
      if (step === 'auth') {
        if (buf[0] !== 0x05) { socket.destroy(); return; }
        socket.write(Buffer.from([0x05, 0x00]));
        step = 'request';
        return;
      }

      if (step === 'request') {
        step = 'done'; // prevent double-handling
        socket.removeListener('data', onData);

        if (buf[0] !== 0x05 || buf[1] !== 0x01) {
          socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0,0,0,0, 0,0]));
          socket.destroy(); return;
        }

        let host, port;
        try { ({ host, port } = this._parseSocks5Req(buf)); }
        catch {
          socket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0,0,0,0, 0,0]));
          socket.destroy(); return;
        }

        // Guard: check SSH still alive before forwarding
        if (!this._connected || !this._client) {
          socket.write(Buffer.from([0x05, 0x04, 0x00, 0x01, 0,0,0,0, 0,0]));
          socket.destroy(); return;
        }

        this._client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
          if (err) {
            try { socket.write(Buffer.from([0x05, 0x04, 0x00, 0x01, 0,0,0,0, 0,0])); } catch(_) {}
            socket.destroy(); return;
          }
          try { socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0])); }
          catch(_) { stream.destroy(); return; }

          stream.pipe(socket);
          socket.pipe(stream);
          stream.on('close', () => { try { socket.destroy(); } catch(_) {} });
          socket.on('close', () => { try { stream.destroy(); } catch(_) {} });
          stream.on('error', () => { try { socket.destroy(); } catch(_) {} });
          socket.on('error', () => { try { stream.destroy(); } catch(_) {} });
        });
      }
    };

    socket.on('data', onData);
    socket.setTimeout(30000, () => socket.destroy());
  }

  _parseSocks5Req(buf) {
    const type = buf[3];
    let host, offset;
    if (type === 0x01) { host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`; offset = 8; }
    else if (type === 0x03) { const l = buf[4]; host = buf.slice(5, 5+l).toString(); offset = 5+l; }
    else if (type === 0x04) {
      const p = []; for (let i=0;i<8;i++) p.push(buf.readUInt16BE(4+i*2).toString(16));
      host = p.join(':'); offset = 20;
    } else throw new Error('Bad addr type');
    return { host, port: buf.readUInt16BE(offset) };
  }

  // ── VPN mode: Windows Internet Settings (affects all apps/browsers) ────────

  _enableSystemProxy(port) {
    return new Promise((resolve) => {
      const proxyStr = `socks=127.0.0.1:${port}`;
      this._log(`Enabling system-wide proxy: ${proxyStr}`, 'info');

      // Set via Windows registry — affects ALL traffic (browsers, apps, system)
      const cmds = [
        // Internet Settings (IE/Edge/Chrome/system)
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`,
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "socks=127.0.0.1:${port}" /f`,
        // Also set WinHTTP for system services
        `netsh winhttp set proxy proxy-server="socks=127.0.0.1:${port}"`,
      ];

      let done = 0;
      for (const cmd of cmds) {
        exec(cmd, (err) => {
          if (err) this._log(`Proxy cmd warn: ${err.message.split('\n')[0]}`, 'warn');
          done++;
          if (done === cmds.length) {
            this._log('System proxy enabled — all traffic routed through tunnel', 'success');
            resolve();
          }
        });
      }
    });
  }

  _disableSystemProxy() {
    return new Promise((resolve) => {
      const cmds = [
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`,
        `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /f`,
        `netsh winhttp reset proxy`,
      ];
      let done = 0;
      for (const cmd of cmds) {
        exec(cmd, () => { done++; if (done === cmds.length) { this._log('System proxy disabled', 'info'); resolve(); } });
      }
    });
  }

  // ── SSH config ─────────────────────────────────────────────────────────────

  _buildSshConfig(config) {
    return {
      host: config.sshHost,
      port: parseInt(config.sshPort, 10) || 22,
      username: config.sshUsername,
      password: config.sshPassword || undefined,
      privateKey: config.publicKey || undefined,
      readyTimeout: 15000,
      // ssh2 built-in keepalive — sends SSH protocol-level pings, NOT exec commands
      // This keeps the connection alive without triggering server session limits
      keepaliveInterval: 10000,
      keepaliveCountMax: 6,
      algorithms: {
        kex: ['ecdh-sha2-nistp256','ecdh-sha2-nistp384','ecdh-sha2-nistp521','diffie-hellman-group14-sha256','diffie-hellman-group14-sha1'],
        serverHostKey: ['ssh-rsa','ecdsa-sha2-nistp256','ssh-ed25519'],
        cipher: ['aes128-ctr','aes192-ctr','aes256-ctr','aes128-gcm','aes256-gcm'],
        hmac: ['hmac-sha2-256','hmac-sha2-512','hmac-sha1'],
        compress: ['none','zlib@openssh.com','zlib'],
      },
    };
  }

  _humanizeError(err) {
    const m = err.message || '';
    if (m.includes('ECONNREFUSED')) return 'Connection refused — check host/port';
    if (m.includes('ETIMEDOUT') || m.includes('ECONNRESET')) return 'Connection timed out';
    if (m.includes('ENOTFOUND')) return 'Host not found';
    if (m.includes('auth') || m.includes('Authentication')) return 'Authentication failed — check username/password';
    if (m.includes('EHOSTUNREACH')) return 'Host unreachable';
    return m || 'Unknown error';
  }
}

module.exports = TunnelManager;