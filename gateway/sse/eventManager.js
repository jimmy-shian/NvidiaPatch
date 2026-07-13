const eventManager = {
  clients: new Set(),
  subscribe(res) {
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  },
  broadcast(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch (_) {
        this.clients.delete(client);
      }
    }
  }
};

module.exports = eventManager;
