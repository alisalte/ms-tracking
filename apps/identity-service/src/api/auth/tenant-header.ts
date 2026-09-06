/**
 * Parse `X-Tenant-Id`. HTTP headers are a ByteString (ASCII). Browsers / Node
 * therefore either reject a Persian org name or store UTF-8 bytes as latin1
 * mojibake — login then looks up the wrong tenant and returns generic
 * "Invalid credentials". Clients percent-encode the name; we also recover
 * latin1-misdecoded UTF-8 so older clients keep working.
 */
export function tenantHeaderCandidates(raw: string | undefined): string[] {
  if (raw === undefined || raw === null) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const out: string[] = [];
  const add = (value: string): void => {
    const v = value.trim();
    if (v && !out.includes(v)) out.push(v);
  };

  add(trimmed);

  if (trimmed.includes('%')) {
    try {
      add(decodeURIComponent(trimmed));
    } catch {
      // malformed percent-encoding — keep the raw value only
    }
  }

  const recovered = recoverUtf8FromLatin1(trimmed);
  if (recovered) add(recovered);

  return out;
}

/** True when every code unit is a latin1 byte (typical Node header mis-decode). */
function recoverUtf8FromLatin1(value: string): string | null {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 255) return null;
  }
  const recovered = Buffer.from(value, 'latin1').toString('utf8');
  if (recovered === value || recovered.includes('\uFFFD')) return null;
  return recovered;
}
