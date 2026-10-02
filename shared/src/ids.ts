/**
 * The subset of the Web Crypto surface we rely on, declared locally so this
 * module needs no DOM or Node typings.
 */
interface MaybeCrypto {
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

/**
 * Random hex for a session id.
 *
 * Deliberately avoids `crypto.randomUUID`: it exists only in a secure context,
 * and serving the dev client over the LAN (http://192.168.1.20:5173) to test
 * on a phone is not one. There the property is `undefined` and calling it
 * throws "crypto.randomUUID is not a function", which leaves nobody able to
 * join a room. `getRandomValues` is available over plain HTTP.
 */
export function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  const source = (globalThis as { crypto?: MaybeCrypto }).crypto;

  if (source?.getRandomValues) {
    source.getRandomValues(buffer);
  } else {
    // Last resort, so an exotic runtime degrades instead of throwing. A session
    // id only has to be unique per browser, never secret.
    for (let i = 0; i < bytes; i += 1) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A per-browser id the server uses to hand the same seat back after a refresh
 * or a dropped connection. 34 characters, inside the server's 8..64 limit.
 */
export function newSessionToken(): string {
  return `t-${randomHex(16)}`;
}
