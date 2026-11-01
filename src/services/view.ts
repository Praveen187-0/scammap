// Turns a stored assessment into the /lookup reply. Verified status and disputes are applied here, at read
// time, so a new challenge takes effect instantly without recomputing anything.
import { maskValue, type IdentifierType } from "../../shared/normalize.js";
import { AREA_BY_PIN, haversineKm } from "../../shared/areas.js";
import { explainFlags, type BaseVerdict, type Flag } from "../trust/assess.js";
import { TRUST } from "../trust/config.js";

export type Verdict = "KNOWN_SCAM" | "SUSPICIOUS" | "NO_REPORTS" | "VERIFIED_BUSINESS";

export interface Evidence {
  occurred_at: string;
  channel: string;
  scam_type: string;
  pincode: string;
}

export interface StoredAssessment {
  verdict: BaseVerdict;
  report_count: number;
  distinct_reporters: number;
  credible_voices: number;
  weight: number;
  substance_voices: number;
  flags: Flag[];
  first_seen: string | null;
  last_seen: string | null;
  scam_type: string | null;
  evidence: Evidence[];
  voice_pincodes: string[];
}

/**
 * The public verdict ladder. Personal-number protection: a number reported by only ONE credible person (or by
 * nobody credible, e.g. a set-aside bombing) shows "No reports" to the public, so one angry person can never
 * label someone. Two unrelated people make it Suspicious; three make it a Known scam.
 */
export function publicVerdict(a: StoredAssessment | null, verifiedOwner: string | null, challenged: boolean): Verdict {
  if (verifiedOwner) return "VERIFIED_BUSINESS";
  if (!a || a.report_count === 0) return "NO_REPORTS";
  if (a.verdict === "KNOWN_SCAM") return challenged ? "SUSPICIOUS" : "KNOWN_SCAM";
  return a.credible_voices >= TRUST.suspiciousMinVoices ? "SUSPICIOUS" : "NO_REPORTS";
}

export type Confirmation = "verified" | "confirmed" | "partly_confirmed" | "awaiting_confirmation" | "none";

export interface LookupReply {
  verdict: Verdict;
  confirmation: Confirmation;
  report_count: number;
  distinct_reporters: number;
  first_seen: string | null;
  last_seen: string | null;
  scam_type: string | null;
  display_value: string;
  evidence: Evidence[];
  challenged: boolean;
  identifier_type: IdentifierType;
  verified_owner?: string;
  near_you_count?: number;
  message_en: string;
  message_hi: string;
  explain: { raw_reports: number; independent_voices: number; credible_voices: number; weight: number; flags: Flag[]; why: string };
}

const NEAR_KM = 5;

export function buildLookupReply(args: {
  type: IdentifierType;
  value: string;
  assessment: StoredAssessment | null;
  verifiedOwner: string | null;
  challenged: boolean;
  nearPincode?: string | undefined;
}): LookupReply {
  const a = args.assessment;
  const reports = a?.report_count ?? 0;
  const people = a?.distinct_reporters ?? 0;
  const credible = a?.credible_voices ?? 0;

  const verdict = publicVerdict(a, args.verifiedOwner, args.challenged);
  const awaiting = verdict === "NO_REPORTS" && reports > 0;
  const confirmation: Confirmation = verdict === "VERIFIED_BUSINESS" ? "verified" : verdict === "KNOWN_SCAM" ? "confirmed"
    : verdict === "SUSPICIOUS" ? "partly_confirmed" : awaiting ? "awaiting_confirmation" : "none";

  // Privacy rule 2: hidden until 3 different (credible) people reported it. Verified numbers are public.
  const unmasked = Boolean(args.verifiedOwner) || credible >= TRUST.knownScamMinVoices;
  const display = unmasked ? args.value : maskValue(args.type, args.value);

  let near: number | undefined;
  const center = args.nearPincode ? AREA_BY_PIN.get(args.nearPincode) : undefined;
  if (center && a) {
    near = a.voice_pincodes.filter((p) => {
      const ar = AREA_BY_PIN.get(p);
      return ar ? haversineKm(center.lat, center.lng, ar.lat, ar.lng) <= NEAR_KM : false;
    }).length;
  }

  // Privacy rule 3: always "reported", never "scammer" or "fraud". Wording follows the brief:
  // "Reported by 7 people near you".
  const ppl = (x: number): string => `${x} ${x === 1 ? "person" : "people"}`;
  const nearEn = !near ? "" : near >= people ? " near you" : `, ${near} of them near you`;
  const nearHi = !near ? "" : near >= people ? " (आपके आस-पास)" : `, जिनमें ${near} आपके आस-पास`;
  let en: string;
  let hi: string;
  switch (verdict) {
    case "VERIFIED_BUSINESS":
      en = `Verified: ${args.verifiedOwner ?? ""}. Callers can fake real numbers, so never share an OTP or PIN.`;
      hi = `सत्यापित: ${args.verifiedOwner ?? ""}। कॉल करने वाले असली नंबर की नकल कर सकते हैं, इसलिए OTP या PIN कभी न बताएं।`;
      break;
    case "NO_REPORTS":
      en = awaiting
        ? "No confirmed reports. A report shows here only after at least 2 unrelated people report the same number. That does not mean it is safe."
        : "No reports yet. That does not mean it is safe.";
      hi = awaiting
        ? "कोई पुष्ट रिपोर्ट नहीं। कम से कम 2 अलग-अलग लोगों के रिपोर्ट करने पर ही रिपोर्ट यहाँ दिखती है। इसका मतलब यह नहीं कि यह सुरक्षित है।"
        : "अभी तक कोई रिपोर्ट नहीं। इसका मतलब यह नहीं कि यह सुरक्षित है।";
      break;
    case "KNOWN_SCAM":
      en = `Reported by ${ppl(people)}${nearEn}.`;
      hi = `${people} लोगों ने रिपोर्ट किया है${nearHi}।`;
      break;
    default:
      en = `Reported by ${ppl(credible)}${nearEn}. Not yet confirmed by 3 unrelated people. Be careful.`;
      hi = `${credible} लोगों ने रिपोर्ट किया है${nearHi}। अभी 3 अलग-अलग लोगों से पुष्टि नहीं हुई, सावधान रहें।`;
  }
  if (args.challenged && verdict !== "VERIFIED_BUSINESS") {
    en += " The owner says this is their business number. Under review.";
    hi += " मालिक का कहना है कि यह उनका व्यवसाय नंबर है। जाँच जारी है।";
  }

  const flags = a?.flags ?? [];
  // Unconfirmed numbers reveal nothing beyond the counts: no type, dates or evidence that could label someone.
  const reveal = verdict === "KNOWN_SCAM" || verdict === "SUSPICIOUS";
  const reply: LookupReply = {
    verdict,
    confirmation,
    report_count: reports,
    distinct_reporters: people,
    first_seen: reveal ? (a?.first_seen ?? null) : null,
    last_seen: reveal ? (a?.last_seen ?? null) : null,
    scam_type: reveal ? (a?.scam_type ?? null) : null,
    display_value: display,
    // Evidence never includes who reported, their network or their note.
    evidence: reveal ? (a?.evidence ?? []) : [],
    challenged: args.challenged,
    identifier_type: args.type,
    message_en: en,
    message_hi: hi,
    explain: {
      raw_reports: reports,
      independent_voices: people,
      credible_voices: credible,
      weight: a?.weight ?? 0,
      flags,
      why: verdict === "KNOWN_SCAM"
        ? "3 or more unrelated people reported it"
        : [explainFlags(flags), awaiting ? "waiting for a second, unrelated person to confirm" : ""].filter(Boolean).join("; ") || (reports ? "" : "no reports"),
    },
  };
  if (args.verifiedOwner) reply.verified_owner = args.verifiedOwner;
  if (near !== undefined) reply.near_you_count = near;
  return reply;
}
