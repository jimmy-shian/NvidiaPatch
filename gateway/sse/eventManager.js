const crypto = require('crypto');

class SseConnectionPool {
  constructor(options = {}) {
    this.maxClients = options.maxClients || 50;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 15000;
    this.connections = new Map(); // id -> { id, res, req, connectedAt, ip, lastActive }
    this.heartbeatTimer = null;
    this._startHeartbeat();
  }

  // 為了向後相容部分直接存取 clients 的邏輯
  get clients() {
    return new Set(Array.from(this.connections.values()).map(c => c.res));
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, this.heartbeatIntervalMs);
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * 註冊新的 SSE 連線
   */
  subscribe(res, req) {
    if (this.connections.size >= this.maxClients) {
      // 若超過最大限制，關閉最舊的一個連線以騰出空間
      const oldestId = this.connections.keys().next().value;
      if (oldestId) {
        this.dropConnection(oldestId, 'Max SSE clients limit exceeded');
      }
    }

    const connectionId = crypto.randomUUID();
    const clientInfo = {
      id: connectionId,
      res,
      req,
      ip: req?.socket?.remoteAddress || req?.ip || 'unknown',
      connectedAt: Date.now(),
      lastActive: Date.now()
    };

    this.connections.set(connectionId, clientInfo);

    const cleanup = () => {
      this.connections.delete(connectionId);
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);
    if (req?.socket) {
      req.socket.on('error', cleanup);
    }

    return connectionId;
  }

  /**
   * 移除並關閉指定連線
   */
  dropConnection(id, reason = 'Closed') {
    const conn = this.connections.get(id);
    if (!conn) return;
    this.connections.delete(id);
    try {
      if (!conn.res.writableEnded) {
        conn.res.write(`event: error\ndata: ${JSON.stringify({ message: reason })}\n\n`);
        conn.res.end();
      }
    } catch (_) {
      // ignore
    }
  }

  /**
   * 廣播事件至所有連線
   */
  broadcast(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    const toDelete = [];

    for (const [id, conn] of this.connections.entries()) {
      try {
        if (conn.res.writableEnded || conn.res.destroyed) {
          toDelete.push(id);
          continue;
        }
        conn.res.write(payload);
        conn.lastActive = Date.now();
      } catch (err) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.connections.delete(id);
    }
  }

  /**
   * 發送 Keep-Alive 心跳與清理殭屍連線
   */
  heartbeat() {
    const pingPayload = `: heartbeat\n\n`;
    const toDelete = [];

    for (const [id, conn] of this.connections.entries()) {
      try {
        if (conn.res.writableEnded || conn.res.destroyed) {
          toDelete.push(id);
          continue;
        }
        conn.res.write(pingPayload);
      } catch (err) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.connections.delete(id);
    }
  }

  /**
   * 優雅關閉所有 SSE 連線並停止定時器
   */
  closeAll() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const [id, conn] of this.connections.entries()) {
      try {
        if (!conn.res.writableEnded) {
          conn.res.write(`event: shutdown\ndata: ${JSON.stringify({ message: 'Server is restarting or shutting down' })}\n\n`);
          conn.res.end();
        }
      } catch (_) {
        // ignore
      }
    }
    this.connections.clear();
  }

  /**
   * 取得目前連線池統計
   */
  getStats() {
    return {
      activeConnections: this.connections.size,
      maxClients: this.maxClients
    };
  }
}

const eventManager = new SseConnectionPool();

module.exports = eventManager;
