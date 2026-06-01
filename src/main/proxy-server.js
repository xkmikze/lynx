'use strict';

class ProxyServer {
  constructor(store) {
    this.store = store;
    this._server = null;
  }

  async start(tunnelStream) {
    this._tunnelStream = tunnelStream;
    return true;
  }

  async stop() {
    if (this._server) {
      return new Promise((resolve) => {
        this._server.close(() => { this._server = null; resolve(); });
      });
    }
  }

  isRunning() {
    return this._server !== null && this._server.listening;
  }
}

module.exports = ProxyServer;