import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, loadPublicKey, signLicence, verifyLicence } from "../src/licence/licence.js";
import { LicenceManager, type LicenceStore } from "../src/licence/manager.js";
import { formatIst, parseIsoTime } from "../src/lib/time.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = loadPublicKey(publicKey.export({ type: "spki", format: "pem" }).toString());
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const T0 = Date.UTC(2026, 10, 15, 4, 30);

function memoryStore(): LicenceStore & { hw: number | null } {
  let lic: unknown = null;
  const s = {
    hw: null as number | null,
    loadLicence: async () => lic,
    saveLicence: async (l: unknown) => {
      lic = l;
    },
    loadHighWater: async () => s.hw,
    saveHighWater: async (ms: number) => {
      s.hw = Math.max(s.hw ?? 0, ms);
    },
  };
  return s;
}

describe("licence file", () => {
  it("canonical JSON sorts keys", () => expect(canonicalJson({ b: 1, a: { d: 2, c: [3] } })).toBe('{"a":{"c":[3],"d":2},"b":1}'));
  it("verifies a good signature and rejects an edited date or licensee", () => {
    const lic = signLicence({ licensee: "Demo Bank", expires_at: "2026-11-15T10:05:00+05:30" }, PRIV);
    expect(verifyLicence(lic, PUB).ok).toBe(true);
    expect(verifyLicence({ ...lic, expires_at: "2027-11-15T10:05:00+05:30" }, PUB)).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
    expect(verifyLicence({ ...lic, licensee: "Other Bank" }, PUB)).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
    expect(verifyLicence({ licensee: "x" }, PUB)).toEqual({ ok: false, error: "INVALID_LICENCE_FORMAT" });
  });
  it("rejects a licence signed by a different key", () => {
    const other = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(verifyLicence(signLicence({ licensee: "A", expires_at: formatIst(T0) }, other), PUB).ok).toBe(false);
  });
});

describe("licence manager", () => {
  it("valid -> expired -> renewed without restart", async () => {
    let now = T0;
    const m = new LicenceManager(PUB, memoryStore(), () => now);
    await m.init(null);
    expect(m.status()).toBe("MISSING");
    await m.install(signLicence({ licensee: "Demo Bank", expires_at: formatIst(T0 + 5 * 60_000) }, PRIV));
    expect(m.status()).toBe("VALID");
    now = T0 + 5 * 60_000 + 1000;
    expect(m.status()).toBe("EXPIRED");
    await m.install(signLicence({ licensee: "Demo Bank", expires_at: formatIst(T0 + 30 * 86_400_000) }, PRIV));
    expect(m.status()).toBe("VALID");
  });
  it("detects the clock being set back, even after a restart", async () => {
    let now = T0;
    const store = memoryStore();
    const m = new LicenceManager(PUB, store, () => now);
    await m.init(null);
    await m.install(signLicence({ licensee: "Demo Bank", expires_at: formatIst(T0 + 3_600_000) }, PRIV));
    now = T0 + 2 * 3_600_000; // licence has expired
    expect(m.status()).toBe("EXPIRED");
    await m.flush();
    now = T0 - 365 * 86_400_000; // someone sets the clock back a year
    expect(m.status()).toBe("CLOCK_ROLLBACK");
    const restarted = new LicenceManager(PUB, store, () => now);
    await restarted.init(null);
    expect(restarted.status()).toBe("CLOCK_ROLLBACK");
  });
  it("tolerates small clock adjustments (NTP)", async () => {
    let now = T0;
    const m = new LicenceManager(PUB, memoryStore(), () => now);
    await m.init(null);
    await m.install(signLicence({ licensee: "Demo Bank", expires_at: formatIst(T0 + 3_600_000) }, PRIV));
    now = T0 - 30_000;
    expect(m.status()).toBe("VALID");
  });
  it("bootstraps from LICENSE_JSON when the database has none", async () => {
    const m = new LicenceManager(PUB, memoryStore(), () => T0);
    await m.init(JSON.stringify(signLicence({ licensee: "Boot Bank", expires_at: formatIst(T0 + 3_600_000) }, PRIV)));
    expect(m.info().licensee).toBe("Boot Bank");
    expect(m.status()).toBe("VALID");
  });
  it("with no public key, everything is locked", async () => {
    const m = new LicenceManager(null, memoryStore(), () => T0);
    await m.init(null);
    expect(m.status()).toBe("MISSING");
  });
});

describe("time parsing", () => {
  it("accepts the brief's format and rejects impossible dates", () => {
    expect(parseIsoTime("2026-10-27T18:21:04+05:30")).toBe(Date.UTC(2026, 9, 27, 12, 51, 4));
    expect(parseIsoTime("2026-10-27T12:51:04Z")).toBe(Date.UTC(2026, 9, 27, 12, 51, 4));
    for (const bad of ["yesterday", "2026-13-45T10:00:00+05:30", "2026-02-30T10:00:00+05:30", "27/10/2026", ""]) expect(parseIsoTime(bad), bad).toBeNull();
  });
  it("formats in IST", () => expect(formatIst(Date.UTC(2026, 9, 27, 12, 51, 4))).toBe("2026-10-27T18:21:04+05:30"));
});
