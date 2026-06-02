/**
 * wintun-helper — runs as a child process to hold the wintun adapter alive.
 * Started by tun-manager, communicates via stdin/stdout JSON messages.
 * 
 * This process:
 * 1. Loads wintun.dll
 * 2. Creates the LYNX-TUN adapter
 * 3. Sends {"status":"ready","name":"LYNX-TUN","ifIndex":N} to stdout
 * 4. Keeps running (holding the adapter alive) until killed
 * 5. On exit, wintun automatically destroys the adapter
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

const TUN_NAME = 'LYNX-TUN';
const TUN_TYPE = 'LYNX';

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sendError(msg) {
  send({ status: 'error', message: msg });
  process.exit(1);
}

async function main() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const dllPath = path.join(__dirname, '../../../assets/wintun', arch, 'wintun.dll');

  if (!fs.existsSync(dllPath)) {
    sendError('wintun.dll not found at: ' + dllPath);
    return;
  }

  send({ status: 'loading', message: 'Loading wintun.dll...' });

  // Use edge-js or ffi-napi if available, otherwise use PowerShell
  // Since we can't guarantee native modules, use a PowerShell script
  // that keeps a persistent session

  const psScript = path.join(os.tmpdir(), 'lynx-wintun-session.ps1');
  const readyFile = path.join(os.tmpdir(), 'lynx-wintun-ready.txt');
  const stopFile  = path.join(os.tmpdir(), 'lynx-wintun-stop.txt');

  // Clean up any leftover files
  try { fs.unlinkSync(readyFile); } catch(_) {}
  try { fs.unlinkSync(stopFile);  } catch(_) {}

  const escapedDll = dllPath.replace(/\\/g, '\\\\');

  const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Wintun {
  [DllImport(@"${escapedDll}", CharSet=CharSet.Unicode)]
  public static extern IntPtr WintunCreateAdapter(string Name, string TunnelType, IntPtr RequestedGUID);
  [DllImport(@"${escapedDll}", CharSet=CharSet.Unicode)]
  public static extern void WintunCloseAdapter(IntPtr Adapter);
  [DllImport(@"${escapedDll}", CharSet=CharSet.Unicode)]
  public static extern bool WintunDeleteDriver();
}
"@ -ErrorAction Stop

$adapter = [Wintun]::WintunCreateAdapter("${TUN_NAME}", "${TUN_TYPE}", [IntPtr]::Zero)
if ($adapter -eq [IntPtr]::Zero) {
  [System.IO.File]::WriteAllText("${readyFile.replace(/\\/g, '\\\\')}", "ERROR:Failed to create adapter")
  exit 1
}

# Signal ready
[System.IO.File]::WriteAllText("${readyFile.replace(/\\/g, '\\\\')}", "READY")

# Keep alive until stop file appears
while (-not (Test-Path "${stopFile.replace(/\\/g, '\\\\')}")) {
  Start-Sleep -Milliseconds 500
}

# Cleanup
[Wintun]::WintunCloseAdapter($adapter)
[Wintun]::WintunDeleteDriver()
`;

  fs.writeFileSync(psScript, ps, 'utf8');

  // Launch the PS session
  const { spawn } = require('child_process');
  const psProc = spawn('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  psProc.stderr.on('data', (d) => {
    send({ status: 'log', message: 'PS: ' + d.toString().trim() });
  });

  // Wait for ready file
  let waited = 0;
  const maxWait = 15000;
  const interval = 500;

  const waitForReady = () => {
    waited += interval;
    if (waited > maxWait) {
      psProc.kill();
      sendError('Timed out waiting for wintun adapter');
      return;
    }

    try {
      const content = fs.readFileSync(readyFile, 'utf8').trim();
      if (content.startsWith('ERROR:')) {
        psProc.kill();
        sendError(content.replace('ERROR:', ''));
        return;
      }
      if (content === 'READY') {
        // Adapter is alive — now get its interface index
        try {
          const idx = execSync(
            `powershell -NoProfile -Command "(Get-NetAdapter -Name '${TUN_NAME}').ifIndex"`,
            { timeout: 5000 }
          ).toString().trim();
          send({ status: 'ready', name: TUN_NAME, ifIndex: parseInt(idx) || 0 });
        } catch(_) {
          send({ status: 'ready', name: TUN_NAME, ifIndex: 0 });
        }
        return;
      }
    } catch(_) {}

    setTimeout(waitForReady, interval);
  };

  setTimeout(waitForReady, interval);

  // Handle stop signal from parent
  process.stdin.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg === 'STOP') {
      fs.writeFileSync(stopFile, 'stop');
      setTimeout(() => {
        try { psProc.kill(); } catch(_) {}
        try { fs.unlinkSync(psScript); } catch(_) {}
        try { fs.unlinkSync(readyFile); } catch(_) {}
        try { fs.unlinkSync(stopFile); } catch(_) {}
        process.exit(0);
      }, 1500);
    }
  });

  psProc.on('close', (code) => {
    if (code !== 0) send({ status: 'log', message: 'PS session ended with code ' + code });
  });

  process.on('exit', () => {
    try { fs.writeFileSync(stopFile, 'stop'); } catch(_) {}
    try { psProc.kill(); } catch(_) {}
  });
}

main().catch((e) => sendError(e.message));