'use strict';

const net = require('net');

class PingService {
  ping(host, port = 22, timeout = 5000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      let done = false;

      const finish = (latency, error) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve({ latency, error });
      };

      socket.setTimeout(timeout);

      socket.connect({ host, port: parseInt(port, 10) }, () => {
        finish(Date.now() - start, null);
      });

      socket.on('timeout', () => finish(-1, 'Timeout'));
      socket.on('error', (err) => {
        const msg = err.message.includes('ECONNREFUSED') ? 'Refused'
          : err.message.includes('ENOTFOUND') ? 'Not found'
          : err.message.includes('EHOSTUNREACH') ? 'Unreachable'
          : err.code || 'Error';
        finish(-1, msg);
      });
    });
  }

  async pingAll(configs) {
    return Promise.all(
      configs.map((cfg) =>
        this.ping(cfg.sshHost, cfg.sshPort).then((r) => ({ id: cfg.id, ...r }))
      )
    );
  }
}

module.exports = PingService;