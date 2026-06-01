'use strict';

const https = require('https');
const http = require('http');

class SpeedTestService {
  run() {
    return new Promise((resolve, reject) => {
      const url = 'https://speed.cloudflare.com/__down?bytes=5000000';
      const start = Date.now();
      let bytes = 0;

      const req = https.get(url, { timeout: 20000 }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.on('data', (chunk) => { bytes += chunk.length; });
        res.on('end', () => {
          const durationMs = Date.now() - start;
          const mbps = (bytes * 8) / (durationMs / 1000) / 1_000_000;
          resolve({ downloadMbps: Math.round(mbps * 100) / 100, durationMs, bytes });
        });
        res.on('error', reject);
      });

      req.on('error', (err) => reject(new Error('Speed test failed: ' + err.message)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Speed test timed out')); });
    });
  }
}

module.exports = SpeedTestService;