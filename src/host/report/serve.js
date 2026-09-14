// Serve exactly one report document plus its figures, on loopback, for as short a time
// as possible.
//
// file:// navigation was measured refused by Aside, so a local HTTP origin is the only way
// to print assembled HTML. Two rules keep that from becoming a file server:
//   1. Every asset is registered by the HOST under a generated name. A request path is a
//      MAP LOOKUP, never a join onto a directory, so there is no traversal to defend against
//      and a caller-controlled figure src can never reach an arbitrary file.
//   2. The listener is loopback-only and lives only for the print.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export function createReportServer() {
  const routes = new Map();

  function register(buf, mime) {
    const name = `${randomUUID()}`;
    routes.set('/' + name, { buf: Buffer.from(buf), mime: mime || 'application/octet-stream' });
    return name;
  }

  function setDocument(html) {
    routes.set('/', { buf: Buffer.from(String(html), 'utf8'), mime: 'text/html; charset=utf-8' });
  }

  async function listen() {
    const server = http.createServer((req, res) => {
      const key = String(req.url || '').split('?')[0];
      const hit = routes.get(key);
      if (!hit) { res.statusCode = 404; res.end('not found'); return; }
      res.setHeader('content-type', hit.mime);
      res.setHeader('content-length', String(hit.buf.length));
      res.end(hit.buf);
    });
    // The browser holds the connection open after the page loads, and server.close() waits
    // for existing sockets — so without this the close in report.build's finally never
    // resolves and the whole call hangs. Measured: the print finished, the close did not.
    const sockets = new Set();
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    return {
      origin: `http://127.0.0.1:${port}`,
      close: () => new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        else for (const s of sockets) { try { s.destroy(); } catch (_) {} }
        server.close(() => resolve());
      }),
    };
  }

  return Object.freeze({ register, setDocument, listen, routes });
}
