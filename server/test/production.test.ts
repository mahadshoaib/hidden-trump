import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import type { Ack, GameView } from '@hidden-trump/shared';
import { createApplication } from '../src/app.js';

let app: ReturnType<typeof createApplication>;
let dir: string;
let url: string;
const sockets: Socket[] = [];

function call<T = unknown>(socket: Socket, event: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => socket.timeout(3000).emit(event, payload,
    (error: Error | null, ack: Ack<T>) => error ? reject(error) : ack.ok ? resolve(ack.data) : reject(new Error(ack.error))));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hidden-trump-production-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Hidden Trump</title><script src="/app.js"></script>');
  await writeFile(join(dir, 'app.js'), 'console.log("built frontend")');
  app = createApplication({ clientDir: dir });
  await new Promise<void>(resolve => app.http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  sockets.forEach(socket => socket.disconnect());
  await app.close();
  await unlink(join(dir, 'index.html'));
  await unlink(join(dir, 'app.js'));
  await rmdir(dir);
});

describe('single-origin production server', () => {
  it('serves the built frontend, JavaScript and health from one port', async () => {
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(await page.text()).toContain('<title>Hidden Trump</title>');
    const script = await fetch(`${url}/app.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toMatch(/javascript/);
    expect(await script.text()).toContain('built frontend');
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ ok: true, rooms: 0 });
  });

  it.each(['/server/src/engine/game.ts', '/.env', '/package.json', '/missing.js'])('does not expose %s', async path => {
    expect((await fetch(url + path)).status).toBe(404);
  });

  it('hosts four independent devices using both polling and WebSockets, with private hands and refresh recovery', async () => {
    const views = new Map<number, GameView>();
    for (let i = 0; i < 4; i++) {
      const socket = io(url, { transports: [i % 2 ? 'polling' : 'websocket'], forceNew: true, autoConnect: false });
      sockets.push(socket);
      socket.on('state', (view: GameView) => views.set(i, view));
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
        socket.connect();
      });
      expect(await call(socket, 'join_room', { roomCode: 'DEVICES', name: `Device ${i}`, token: `independent-device-${i}` })).toEqual({ seat: i });
    }
    await call(sockets[0]!, 'start_round');
    await expect.poll(() => [...views.values()].filter(v => v.phase === 'bidding').length).toBe(4);
    const handIds = [...views.values()].flatMap(v => v.you!.hand.map(c => c.id));
    expect(new Set(handIds).size).toBe(20);
    for (let i = 0; i < 4; i++) {
      const view = views.get(i)!;
      expect(view.you!.seat).toBe(i);
      expect(view.you!.hand).toHaveLength(5);
      expect(view.seats.every(s => s.cardCount === 5)).toBe(true);
      for (const [other, theirView] of views) {
        if (other === i) continue;
        for (const card of theirView.you!.hand) expect(JSON.stringify(view)).not.toContain(`"id":"${card.id}"`);
      }
    }
    const hand = views.get(1)!.you!.hand;
    sockets[1]!.disconnect();
    const recovered = io(url, { transports: ['polling'], forceNew: true, autoConnect: false });
    sockets.push(recovered);
    recovered.on('state', (view: GameView) => views.set(1, view));
    await new Promise<void>((resolve, reject) => {
      recovered.once('connect', resolve); recovered.once('connect_error', reject); recovered.connect();
    });
    expect(await call(recovered, 'join_room', { roomCode: 'DEVICES', name: 'Device 1', token: 'independent-device-1' })).toEqual({ seat: 1 });
    await call(recovered, 'place_bid', { value: 13 });
    await expect.poll(() => views.get(1)!.phase).toBe('trumpSelection');
    expect(views.get(1)!.you!.hand).toEqual(hand);
  });
});
