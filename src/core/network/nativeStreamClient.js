/**
 * NativeStreamClient - Bridges SSE stream reading between Android Java & Web JS
 * Bypasses WebView CORS completely on Android and provides real-time SSE streaming.
 */
export const NativeStreamClient = {
  isAvailable() {
    return typeof window !== 'undefined' && Boolean(window.NativeStreamBridge);
  },

  async *stream({ url, headers = {}, body = {}, signal = null }) {
    if (!this.isAvailable()) {
      throw new Error('NativeStreamBridge not available');
    }

    const streamId = 'stream_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const queue = [];
    let isFinished = false;
    let streamError = null;
    let resolver = null;

    const notify = () => {
      if (resolver) {
        const r = resolver;
        resolver = null;
        r();
      }
    };

    if (!window.__streamHandlers) {
      window.__streamHandlers = new Map();
      window.__onNativeStreamChunk = (id, line) => {
        const handler = window.__streamHandlers.get(id);
        if (handler) handler.onChunk(line);
      };
      window.__onNativeStreamDone = (id) => {
        const handler = window.__streamHandlers.get(id);
        if (handler) handler.onDone();
      };
      window.__onNativeStreamError = (id, err) => {
        const handler = window.__streamHandlers.get(id);
        if (handler) handler.onError(err);
      };
    }

    window.__streamHandlers.set(streamId, {
      onChunk: (line) => {
        queue.push({ type: 'chunk', line });
        notify();
      },
      onDone: () => {
        isFinished = true;
        notify();
      },
      onError: (err) => {
        streamError = err;
        isFinished = true;
        notify();
      }
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        try {
          window.NativeStreamBridge.abortStream(streamId);
        } catch (_) {}
      });
    }

    window.NativeStreamBridge.startStream(
      streamId,
      url,
      JSON.stringify(headers),
      typeof body === 'string' ? body : JSON.stringify(body)
    );

    try {
      while (true) {
        if (queue.length > 0) {
          const item = queue.shift();
          yield item.line;
        } else if (isFinished) {
          if (streamError) {
            throw new Error(streamError);
          }
          break;
        } else {
          await new Promise(r => { resolver = r; });
        }
      }
    } finally {
      window.__streamHandlers.delete(streamId);
    }
  }
};
