import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@hidden-trump/shared';
import { registerSockets, broadcast } from './events.js';
import { RoomStore } from './rooms.js';

export const defaultClientDir = fileURLToPath(new URL('../../client/dist/', import.meta.url));

export function createApplication({ clientDir = defaultClientDir } = {}) {
  const store = new RoomStore();
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, rooms: store.size });
  });
  app.use(express.static(clientDir, {
    index: false,
    dotfiles: 'deny',
    setHeaders(res, path) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', path.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
    },
  }));
  app.get('/', (_req, res) => {
    if (!existsSync(join(clientDir, 'index.html'))) {
      res.status(503).send('Frontend not built. Run npm run build, or use the Vite dev server.');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(clientDir, 'index.html'));
  });
  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });

  // Install the HTTP handler BEFORE Socket.IO wraps it. Registering another
  // request listener afterwards also handles /socket.io and breaks polling.
  const http = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http);
  registerSockets(io, store);
  const sweeper = setInterval(() => {
    for (const state of store.sweepIdle(Date.now())) broadcast(io, state, false);
  }, 60_000);
  sweeper.unref();

  return {
    http, io, store,
    close: () => new Promise<void>(resolve => {
      clearInterval(sweeper);
      io.close(() => resolve());
    }),
  };
}
