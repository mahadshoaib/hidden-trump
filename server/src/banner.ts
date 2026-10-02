import { networkInterfaces } from 'node:os';

export interface LanAddress {
  /** Interface name, e.g. "Wi-Fi" or "Ethernet". */
  interface: string;
  address: string;
}

/**
 * Every non-internal IPv4 address, labelled with the interface it came from.
 * A laptop often has both Wi-Fi and Ethernet, and guessing wrong sends
 * someone to a URL that will not resolve on their phone.
 */
export function lanAddresses(): LanAddress[] {
  const found: LanAddress[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      // IPv4 only: link-local IPv6 would need a scope id, and no phone will
      // resolve a bare IPv6 literal typed into a browser address bar.
      if (entry.family !== 'IPv4' || entry.internal) continue;
      found.push({ interface: name, address: entry.address });
    }
  }
  return found;
}

/**
 * The banner points at the Vite dev server, not the Socket.IO port: the URL
 * people need is the one they open in a browser. With more than one
 * non-internal address we list them all rather than picking one.
 */
export function formatStartupBanner(addresses: LanAddress[], clientPort: number, serverPort: number): string {
  const lines = ['', '  Open the client in a browser:', '', `    Local:   http://localhost:${clientPort}`];

  if (addresses.length === 0) {
    lines.push('    Network: none found. Connect to Wi-Fi or Ethernet to test on a phone.');
  } else if (addresses.length === 1) {
    const only = addresses[0] as LanAddress;
    lines.push(`    Network: http://${only.address}:${clientPort}  (${only.interface})`);
  } else {
    lines.push('    Network: one per interface - use whichever your device is on:');
    for (const { interface: name, address } of addresses) {
      lines.push(`             http://${address}:${clientPort}  (${name})`);
    }
  }

  lines.push('', `  Socket.IO and /health are on port ${serverPort}.`, '');
  return lines.join('\n');
}
