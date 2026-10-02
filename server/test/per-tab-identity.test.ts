import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The session token identifies a player. It has to be per tab, because
 * localStorage is shared by every tab of an origin: stored there, four tabs
 * present one identity and fight over a single seat instead of filling four.
 * sessionStorage is per tab yet survives a reload, so a refresh still keeps
 * your seat and your hand.
 *
 * These tests need the DOM lib purely to import client modules from here.
 */

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function newStore(): Store {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/**
 * Open a tab: its own sessionStorage, but the same shared localStorage.
 * Reassigning `window` between calls is exactly the difference between tabs.
 */
function openTab(session: Store, shared: Store): void {
  vi.stubGlobal('window', { sessionStorage: session, localStorage: shared });
}

async function loadSocket() {
  vi.resetModules();
  return import('../../client/src/socket.js');
}

describe('per-tab identity', () => {
  it('isolates four separate devices without any shared browser storage', async () => {
    const { sessionToken, rememberIdentity, rememberedName, rememberedRoom } = await loadSocket();
    const devices = Array.from({ length: 4 }, () => ({ session: newStore(), local: newStore() }));
    const tokens = devices.map((device, i) => {
      openTab(device.session, device.local);
      expect(rememberedName()).toBe('');
      rememberIdentity(`Friend ${i}`, 'PLAY');
      return sessionToken();
    });
    expect(new Set(tokens).size).toBe(4);
    devices.forEach((device, i) => {
      openTab(device.session, device.local);
      expect(sessionToken()).toBe(tokens[i]);
      expect(rememberedName()).toBe(`Friend ${i}`);
      expect(rememberedRoom()).toBe('PLAY');
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives four tabs four different tokens', async () => {
    const { sessionToken } = await loadSocket();
    const shared = newStore();
    const tokens: string[] = [];

    for (let seat = 0; seat < 4; seat += 1) {
      openTab(newStore(), shared);
      tokens.push(sessionToken());
    }

    expect(new Set(tokens).size).toBe(4);
  });

  it('keeps the same token when one tab reloads', async () => {
    const { sessionToken } = await loadSocket();
    const shared = newStore();
    const tab = newStore();

    openTab(tab, shared);
    const before = sessionToken();

    // A reload: same tab, same sessionStorage, fresh module instance.
    openTab(tab, shared);
    expect(sessionToken()).toBe(before);
  });

  it('shares the name and room across tabs, but not the token', async () => {
    const { sessionToken, rememberIdentity, rememberedName, rememberedRoom } = await loadSocket();
    const shared = newStore();

    openTab(newStore(), shared);
    rememberIdentity('Alex', 'ABCD');
    const firstToken = sessionToken();

    // A second tab inherits who you are and where the table is...
    openTab(newStore(), shared);
    expect(rememberedName()).toBe('Alex');
    expect(rememberedRoom()).toBe('ABCD');
    // ...but sits down as a separate player.
    expect(sessionToken()).not.toBe(firstToken);
  });

  it('lets a tab forget the room while keeping the name', async () => {
    const { rememberIdentity, rememberedName, rememberedRoom, forgetRoom } = await loadSocket();
    const shared = newStore();
    openTab(newStore(), shared);

    rememberIdentity('Alex', 'ABCD');
    forgetRoom();

    expect(rememberedRoom()).toBe('');
    expect(rememberedName()).toBe('Alex');
  });
});
