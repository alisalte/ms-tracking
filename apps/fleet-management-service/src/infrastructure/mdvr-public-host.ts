/**
 * Resolve the host advertised in AB2 / A9A the same way md300 `live.js` does:
 * an explicit public IP wins; a missing or RFC1918 value is upgraded via
 * ipify so a cellular MDVR can push RTMP back to this machine.
 */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h || h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '::') return true;
  if (h === '127.0.0.1' || h.startsWith('127.')) return true;
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (h.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

async function lookupPublicIpOnce(): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    const res = await fetch('https://api.ipify.org', { signal: ac.signal });
    if (!res.ok) return null;
    const ip = (await res.text()).trim();
    return IPV4.test(ip) ? ip : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A cold container's network/DNS can take a moment to come up, so a single
 * ipify attempt right at boot can fail transiently and (before this retry)
 * left the service permanently without a usable AB2/A9A host for its whole
 * lifetime. Three attempts with short backoff absorbs that startup race.
 */
async function lookupPublicIp(attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const ip = await lookupPublicIpOnce();
    if (ip) return ip;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  return null;
}

/**
 * @param configured `MDVR_PUBLIC_HOST` from env (may be empty or a LAN address).
 * @returns a host the MDVR can dial — public IPv4 when lookup succeeds.
 */
export async function resolveMdvrPublicHost(configured: string): Promise<string> {
  const trimmed = configured.trim();
  if (trimmed && !isPrivateOrLoopbackHost(trimmed)) return trimmed;
  const looked = await lookupPublicIp();
  if (looked) return looked;
  return trimmed;
}
