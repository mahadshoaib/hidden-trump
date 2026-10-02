import { describe, expect, it } from 'vitest';
import { formatStartupBanner, lanAddresses, type LanAddress } from '../src/banner.js';

const WIFI: LanAddress = { interface: 'Wi-Fi', address: '192.168.18.233' };
const ETHERNET: LanAddress = { interface: 'Ethernet', address: '10.0.0.42' };

describe('startup banner', () => {
  it('points at the client port, not the socket port', () => {
    const banner = formatStartupBanner([WIFI], 5173, 3001);
    expect(banner).toContain('http://localhost:5173');
    // The only mention of 3001 is the informational line at the bottom.
    expect(banner.match(/5173/)).not.toBeNull();
    expect(banner).toContain('Socket.IO and /health are on port 3001.');
  });

  it('prints one network line for a single address, labelled', () => {
    const banner = formatStartupBanner([WIFI], 5173, 3001);
    expect(banner).toContain('    Network: http://192.168.18.233:5173  (Wi-Fi)');
    expect(banner).not.toContain('one per interface');
  });

  it('lists every address when there are several, rather than guessing', () => {
    const banner = formatStartupBanner([WIFI, ETHERNET], 5173, 3001);
    expect(banner).toContain('one per interface');
    expect(banner).toContain('http://192.168.18.233:5173  (Wi-Fi)');
    expect(banner).toContain('http://10.0.0.42:5173  (Ethernet)');
  });

  it('keeps the Local and Network labels aligned', () => {
    const lines = formatStartupBanner([WIFI], 5173, 3001).split('\n');
    const local = lines.find((l) => l.includes('Local:')) as string;
    const network = lines.find((l) => l.includes('Network:')) as string;
    const localUrlAt = local.indexOf('http');
    expect(network.indexOf('http')).toBe(localUrlAt);
  });

  it('says so plainly when there is no network to print', () => {
    const banner = formatStartupBanner([], 5173, 3001);
    expect(banner).toContain('Network: none found');
    expect(banner).toContain('http://localhost:5173');
  });

  it('honours a non-default client port', () => {
    expect(formatStartupBanner([WIFI], 4321, 3001)).toContain('http://localhost:4321');
  });

  describe('lanAddresses', () => {
    it('returns only non-internal IPv4 addresses', () => {
      const found = lanAddresses();
      expect(Array.isArray(found)).toBe(true);
      for (const entry of found) {
        expect(entry.address).not.toBe('127.0.0.1');
        expect(entry.address).not.toBe('::1');
        expect(entry.interface.length).toBeGreaterThan(0);
        // Must be a dotted quad: no bare IPv6, no scope-id suffix.
        expect(entry.address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
      }
    });
  });
});
