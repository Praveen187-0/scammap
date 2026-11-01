// Network buckets for anti-spoofing. Whatever the client sends ("49.36.12", "49.36.12.7", "49.36.12.0/24",
// "2409:40f2:1023::1") is reduced to a /24 (the "network" used by rule B) and a broader /16 block (rule B2), so
// cycling through individual addresses, or through /24s inside one block, does not create new "people".
// Only keyed hashes of these buckets are ever stored.
export interface NetBuckets {
  /** /24 for IPv4, first 3 groups (/48) for IPv6; the raw value when it isn't an address. */
  p24: string | null;
  /** /16 for IPv4, first 2 groups (/32) for IPv6; null when it can't be derived. */
  p16: string | null;
}

export function networkBuckets(raw: string | null | undefined): NetBuckets {
  const s = (raw ?? "").trim().toLowerCase().replace(/\/\d+$/, "");
  if (!s) return { p24: null, p16: null };
  const v4 = /^(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?(?:\.\d{1,3})?$/.exec(s);
  if (v4) {
    const [a, b, c] = [v4[1], v4[2], v4[3]];
    return { p24: c === undefined ? `${a}.${b}` : `${a}.${b}.${c}`, p16: `${a}.${b}` };
  }
  if (s.includes(":") && /^[0-9a-f:]+$/.test(s)) {
    const groups = s.split(":").filter((g) => g.length > 0);
    if (groups.length >= 2) return { p24: groups.slice(0, 3).join(":"), p16: groups.slice(0, 2).join(":") };
  }
  return { p24: s, p16: null };
}
