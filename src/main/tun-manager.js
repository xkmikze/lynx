'use strict';

const { exec, execSync, spawn } = require('child_process');
const os   = require('os');
const fs   = require('fs');
const path = require('path');

const PLATFORM = process.platform;
const TUN_IP     = '10.88.0.1';
const TUN_MASK   = '255.255.255.0';
const TUN_REMOTE = '10.88.0.2';
const TUN_NAME   = 'LYNX-TUN';

class TunManager {
  constructor() {
    this._logCallback     = null;
    this._helperProcess   = null;
    this._active          = false;
    this._originalGateway = null;
    this._originalIface   = null;
    this._sshClient       = null;
    this._tunName         = null;
    this._tunIfIndex      = null;
  }

  onLog(cb) { this._logCallback = cb; }
  isActive() { return this._active; }

  _log(msg, level = 'info') {
    if (this._logCallback) this._logCallback(msg, level);
    console.log(`[TUN][${level}] ${msg}`);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async setup(sshClient) {
    this._sshClient = sshClient;
    this._log(`Setting up TUN adapter on ${PLATFORM}…`);
    try {
      await this._checkPermissions();
      await this._createTunInterface();
      await this._configureRoutes();
      this._active = true;
      this._log('TUN VPN active — all traffic routed through tunnel', 'success');
    } catch (err) {
      await this.teardown();
      throw err;
    }
  }

  async teardown() {
    this._active = false;
    await this._restoreRoutes();
    await this._destroyTunInterface();
    this._log('TUN adapter removed', 'info');
  }

  // ── Permissions ─────────────────────────────────────────────────────────────

  async _checkPermissions() {
    if (PLATFORM === 'win32') {
      try { execSync('net session', { stdio: 'ignore' }); }
      catch (_) {
        throw new Error(
          'TUN mode requires Administrator privileges.\n' +
          'Right-click LYNX and select "Run as administrator".'
        );
      }
    } else if (PLATFORM === 'linux') {
      if (!fs.existsSync('/dev/net/tun')) throw new Error('/dev/net/tun not found. Run: sudo modprobe tun');
      try { execSync('ip link show', { stdio: 'ignore' }); }
      catch (_) { throw new Error('TUN mode requires root or CAP_NET_ADMIN.'); }
    }
  }

  // ── TUN interface creation ──────────────────────────────────────────────────

  async _createTunInterface() {
    if      (PLATFORM === 'win32')  await this._createTunWindows();
    else if (PLATFORM === 'darwin') await this._createTunMac();
    else                            await this._createTunLinux();
  }

  _createTunWindows() {
    return new Promise((resolve, reject) => {
      const arch      = process.arch === 'arm64' ? 'arm64' : 'amd64';
      const wintunDll = path.join(__dirname, `../../assets/wintun/${arch}/wintun.dll`);

      if (!fs.existsSync(wintunDll)) {
        reject(new Error(
          'wintun.dll not found.\n\n' +
          'To enable TUN mode:\n' +
          '1. Go to https://wintun.net\n' +
          '2. Download and extract the zip\n' +
          '3. Copy wintun.dll to: assets/wintun/amd64/wintun.dll\n' +
          '4. Restart LYNX as Administrator\n\n' +
          'Use VPN mode (system proxy) as an alternative.'
        ));
        return;
      }

      this._log('Starting wintun helper process…', 'info');

      const helperPath = path.join(__dirname, 'wintun-helper/index.js');
      const helper = spawn(process.execPath, [helperPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this._helperProcess = helper;

      let resolved = false;
      let buffer = '';

      helper.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            this._log(`[helper] ${msg.message || msg.status}`, msg.status === 'error' ? 'error' : 'info');

            if (msg.status === 'ready' && !resolved) {
              resolved = true;
              this._tunName    = msg.name || TUN_NAME;
              this._tunIfIndex = msg.ifIndex || 0;
              this._log(`Adapter ready: ${this._tunName} (index: ${this._tunIfIndex})`, 'success');

              // Assign IP using interface index
              this._assignTunIP(this._tunName, this._tunIfIndex)
                .then(resolve)
                .catch(reject);
            }

            if (msg.status === 'error' && !resolved) {
              resolved = true;
              reject(new Error(msg.message));
            }
          } catch (_) {}
        }
      });

      helper.stderr.on('data', (d) => {
        this._log('[helper-err] ' + d.toString().trim(), 'warn');
      });

      helper.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          reject(new Error('wintun helper exited unexpectedly (code ' + code + ')'));
        }
      });

      helper.on('error', (err) => {
        if (!resolved) { resolved = true; reject(err); }
      });

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('wintun helper timed out after 20s'));
        }
      }, 20000);
    });
  }

  _assignTunIP(name, ifIndex) {
    return new Promise((resolve, reject) => {
      this._log(`Assigning IP ${TUN_IP} to ${name}…`, 'info');

      // Try by index first (most reliable for wintun)
      const cmd = ifIndex > 0
        ? `powershell -NoProfile -Command "New-NetIPAddress -InterfaceIndex ${ifIndex} -IPAddress ${TUN_IP} -PrefixLength 24 -Confirm:$false -ErrorAction Stop"`
        : `powershell -NoProfile -Command "New-NetIPAddress -InterfaceAlias '${name}' -IPAddress ${TUN_IP} -PrefixLength 24 -Confirm:$false -ErrorAction Stop"`;

      exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) {
          // Try netsh as fallback
          const netshCmd = ifIndex > 0
            ? `netsh interface ip set address ${ifIndex} static ${TUN_IP} ${TUN_MASK}`
            : `netsh interface ip set address name="${name}" source=static addr=${TUN_IP} mask=${TUN_MASK} gateway=none`;

          exec(netshCmd, { timeout: 10000 }, (err2) => {
            if (err2) {
              reject(new Error('Failed to assign TUN IP: ' + (stderr || err.message)));
            } else {
              this._log('TUN IP assigned via netsh', 'success');
              resolve();
            }
          });
        } else {
          this._log('TUN IP assigned successfully', 'success');
          resolve();
        }
      });
    });
  }

  _createTunMac() {
    return new Promise((resolve, reject) => {
      this._log('Creating utun interface on macOS…', 'info');
      let utunNum = 0;
      try {
        const nums = Object.keys(os.networkInterfaces())
          .filter(k => k.startsWith('utun'))
          .map(k => parseInt(k.replace('utun', ''), 10))
          .filter(n => !isNaN(n));
        if (nums.length > 0) utunNum = Math.max(...nums) + 1;
      } catch (_) {}

      this._tunName = `utun${utunNum}`;
      exec(`ifconfig ${this._tunName} ${TUN_IP} ${TUN_REMOTE} up`, (err) => {
        if (err) {
          exec(
            `osascript -e 'do shell script "ifconfig ${this._tunName} ${TUN_IP} ${TUN_REMOTE} up" with administrator privileges'`,
            (err2) => {
              if (err2) reject(new Error('Failed to configure utun: ' + err2.message));
              else resolve();
            }
          );
        } else resolve();
      });
    });
  }

  _createTunLinux() {
    return new Promise((resolve, reject) => {
      this._tunName = 'tun0';
      this._log('Creating tun0 on Linux…', 'info');
      const cmds = [
        'ip tuntap add dev tun0 mode tun',
        `ip addr add ${TUN_IP}/24 dev tun0`,
        'ip link set tun0 up',
      ];
      const run = (i) => {
        if (i >= cmds.length) { resolve(); return; }
        exec(cmds[i], (err) => {
          if (err && !err.message.includes('File exists')) {
            reject(new Error('TUN setup failed: ' + err.message));
          } else run(i + 1);
        });
      };
      run(0);
    });
  }

  // ── Route management ────────────────────────────────────────────────────────

  async _configureRoutes() {
    this._originalGateway = await this._getDefaultGateway();
    this._originalIface   = await this._getDefaultInterface();
    this._log(`Original gateway: ${this._originalGateway} via ${this._originalIface}`, 'info');

    if      (PLATFORM === 'win32')  await this._setRoutesWindows();
    else if (PLATFORM === 'darwin') await this._setRoutesMac();
    else                            await this._setRoutesLinux();
  }

  _setRoutesWindows() {
    return new Promise((resolve) => {
      const sshIp = this._sshClient && this._sshClient._host ? this._sshClient._host : '';
      const cmds = [
        sshIp ? `route add ${sshIp} mask 255.255.255.255 ${this._originalGateway}` : null,
        `route add 0.0.0.0 mask 0.0.0.0 ${TUN_REMOTE} metric 1`,
        `route add 128.0.0.0 mask 128.0.0.0 ${TUN_REMOTE} metric 1`,
      ].filter(Boolean);
      let done = 0;
      for (const cmd of cmds) {
        exec(cmd, (err) => {
          if (err) this._log('Route: ' + err.message.split('\n')[0], 'warn');
          if (++done === cmds.length) resolve();
        });
      }
    });
  }

  _setRoutesMac() {
    return new Promise((resolve) => {
      const sshIp = this._sshClient && this._sshClient._host ? this._sshClient._host : '';
      const cmds = [
        sshIp ? `route add ${sshIp}/32 ${this._originalGateway}` : null,
        `route add 0.0.0.0/1 ${TUN_REMOTE}`,
        `route add 128.0.0.0/1 ${TUN_REMOTE}`,
      ].filter(Boolean);
      const run = (i) => {
        if (i >= cmds.length) { resolve(); return; }
        exec(cmds[i], (err) => {
          if (err) this._log('Route: ' + err.message.split('\n')[0], 'warn');
          run(i + 1);
        });
      };
      run(0);
    });
  }

  _setRoutesLinux() {
    return new Promise((resolve) => {
      const sshIp = this._sshClient && this._sshClient._host ? this._sshClient._host : '';
      const cmds = [
        sshIp ? `ip route add ${sshIp}/32 via ${this._originalGateway} dev ${this._originalIface}` : null,
        'ip route add 0.0.0.0/1 dev tun0',
        'ip route add 128.0.0.0/1 dev tun0',
      ].filter(Boolean);
      const run = (i) => {
        if (i >= cmds.length) { resolve(); return; }
        exec(cmds[i], (err) => {
          if (err) this._log('Route: ' + err.message.split('\n')[0], 'warn');
          run(i + 1);
        });
      };
      run(0);
    });
  }

  async _restoreRoutes() {
    if (!this._originalGateway) return;
    this._log('Restoring original routes…', 'info');
    try {
      if (PLATFORM === 'win32') {
        execSync(`route delete 0.0.0.0 mask 0.0.0.0`, { stdio: 'ignore' });
        execSync(`route add 0.0.0.0 mask 0.0.0.0 ${this._originalGateway}`, { stdio: 'ignore' });
      } else if (PLATFORM === 'darwin') {
        execSync('route delete 0.0.0.0/1 2>/dev/null; route delete 128.0.0.0/1 2>/dev/null', { stdio: 'ignore', shell: true });
      } else {
        execSync('ip route del 0.0.0.0/1 2>/dev/null; ip route del 128.0.0.0/1 2>/dev/null', { stdio: 'ignore', shell: true });
      }
    } catch (_) {}
  }

  async _destroyTunInterface() {
    // Stop helper process (this automatically destroys wintun adapter)
    if (this._helperProcess) {
      try { this._helperProcess.stdin.write('STOP\n'); } catch (_) {}
      await new Promise((r) => setTimeout(r, 2000));
      try { this._helperProcess.kill(); } catch (_) {}
      this._helperProcess = null;
    }

    if (PLATFORM === 'darwin') {
      exec(`ifconfig ${this._tunName || 'utun0'} down 2>/dev/null`, () => {});
    } else if (PLATFORM === 'linux') {
      exec('ip link del tun0 2>/dev/null', () => {});
    }
    // Windows: adapter destroyed automatically when helper process exits
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _getDefaultGateway() {
    return new Promise((resolve) => {
      const cmd = PLATFORM === 'win32'
        ? 'powershell -NoProfile -Command "(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric | Select-Object -First 1).NextHop"'
        : PLATFORM === 'darwin'
          ? "route -n get default | grep gateway | awk '{print $2}'"
          : "ip route show default | awk '/default/ {print $3; exit}'";
      exec(cmd, (err, stdout) => resolve(err ? '192.168.1.1' : stdout.trim()));
    });
  }

  _getDefaultInterface() {
    return new Promise((resolve) => {
      const cmd = PLATFORM === 'win32'
        ? 'powershell -NoProfile -Command "(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric | Select-Object -First 1).InterfaceAlias"'
        : PLATFORM === 'darwin'
          ? "route -n get default | grep interface | awk '{print $2}'"
          : "ip route show default | awk '/default/ {print $5; exit}'";
      exec(cmd, (err, stdout) => resolve(err ? 'eth0' : stdout.trim()));
    });
  }
}

module.exports = TunManager;