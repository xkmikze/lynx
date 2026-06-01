'use strict';

function parseNpvtUri(uri) {
  if (!uri.startsWith('npvt-ssh://')) throw new Error('Not a valid npvt-ssh:// URI');
  const encoded = uri.slice('npvt-ssh://'.length).trim();
  if (!encoded) throw new Error('Empty NPVT-SSH URI');
  let decoded;
  try { decoded = Buffer.from(encoded, 'base64').toString('utf8'); }
  catch { throw new Error('Failed to decode base64 payload'); }
  let config;
  try { config = JSON.parse(decoded); }
  catch { throw new Error('Invalid JSON in NPVT-SSH payload'); }
  return normalizeConfig(config);
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') return 'Config must be an object';
  for (const field of ['sshHost', 'sshPort', 'sshUsername']) {
    if (!config[field]) return `Missing required field: ${field}`;
  }
  const port = parseInt(config.sshPort, 10);
  if (isNaN(port) || port < 1 || port > 65535) return 'SSH port must be between 1 and 65535';
  if (!config.sshPassword && !config.publicKey) return 'Either sshPassword or publicKey must be provided';
  if (!config.sshHost.trim() || config.sshHost.length > 253) return 'Invalid SSH host';
  return null;
}

function normalizeConfig(raw) {
  return {
    sshConfigType: raw.sshConfigType || 'SSH-Direct',
    sni: raw.sni || '',
    tlsVersion: raw.tlsVersion || 'DEFAULT',
    httpProxy: raw.httpProxy || '',
    authenticateProxy: raw.authenticateProxy || false,
    proxyUsername: raw.proxyUsername || '',
    proxyPassword: raw.proxyPassword || '',
    payload: raw.payload || '',
    dnsTTMode: raw.dnsTTMode || 'UDP',
    dnsServer: raw.dnsServer || '',
    nameserver: raw.nameserver || '',
    publicKey: raw.publicKey || '',
    udpgwPort: raw.udpgwPort || 0,
    remarks: raw.remarks || raw.sshHost || 'Unnamed',
    sshHost: (raw.sshHost || '').trim(),
    sshPort: parseInt(raw.sshPort, 10) || 22,
    sshUsername: (raw.sshUsername || '').trim(),
    sshPassword: raw.sshPassword || '',
    udpgwTransparentDNS: raw.udpgwTransparentDNS !== undefined ? raw.udpgwTransparentDNS : true,
  };
}

function encodeNpvtUri(config) {
  return 'npvt-ssh://' + Buffer.from(JSON.stringify(config, null, 4)).toString('base64');
}

function configLabel(config) {
  return config.remarks || `${config.sshUsername}@${config.sshHost}:${config.sshPort}`;
}

module.exports = { parseNpvtUri, validateConfig, normalizeConfig, encodeNpvtUri, configLabel };