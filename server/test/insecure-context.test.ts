import { afterEach, describe, expect, it, vi } from 'vitest';
import { newSessionToken, randomHex } from '@hidden-trump/shared';

/**
 * `crypto.randomUUID` exists only in a secure context. Serving the dev client
 * over the LAN to test on a phone (http://192.168.1.20:5173) is not one, so
 * any use of it throws "crypto.randomUUID is not a function" and nobody can
 * join a room. These pin token minting to APIs that work over plain HTTP.
 */
describe('session tokens in a non-secure context', () => {
  // Stubbed globals persist until restored, so one test's fake CSPRNG would
  // otherwise hand the next test 50 identical tokens.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mints a token when crypto.randomUUID is missing', () => {
    // Exactly what an insecure context exposes: getRandomValues, no randomUUID.
    vi.stubGlobal('crypto', {
      getRandomValues: (buf: Uint8Array) => {
        for (let i = 0; i < buf.length; i += 1) buf[i] = (i * 37 + 11) % 256;
        return buf;
      },
    });

    const token = newSessionToken();
    expect(token).toMatch(/^t-[0-9a-f]{32}$/);
    // The server's cleanToken accepts 8..64 characters.
    expect(token.length).toBeGreaterThanOrEqual(8);
    expect(token.length).toBeLessThanOrEqual(64);
  });

  it('degrades instead of throwing when there is no Web Crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newSessionToken()).toMatch(/^t-[0-9a-f]{32}$/);
  });

  it('uses the CSPRNG when one is available', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (buf: Uint8Array) => {
        buf.fill(0xab);
        return buf;
      },
    });
    // Deterministic stub output must show up, i.e. we are not quietly using Math.random.
    expect(randomHex(4)).toBe('abababab');
  });

  it('produces distinct tokens', () => {
    expect(new Set(Array.from({ length: 50 }, newSessionToken)).size).toBe(50);
  });
});
