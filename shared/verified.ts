// Verified numbers from Appendix C. A lookup on any of these is VERIFIED_BUSINESS, never a scam.
// Values are written the way the brief lists them; they are normalised at startup.
import type { IdentifierType } from "./normalize.js";

export interface VerifiedEntry {
  type: IdentifierType;
  value: string;
  owner: string;
}

export const VERIFIED: readonly VerifiedEntry[] = [
  { type: "phone", value: "1930", owner: "National Cybercrime Helpline" },
  { type: "phone", value: "1909", owner: "TRAI Do Not Disturb" },
  { type: "phone", value: "1800 1600", owner: "HDFC Bank customer care" },
  { type: "phone", value: "1800 2600", owner: "HDFC Bank customer care" },
  { type: "phone", value: "1800 1080", owner: "ICICI Bank customer care" },
  { type: "phone", value: "1800 1234", owner: "State Bank of India customer care" },
  { type: "phone", value: "1800 2100", owner: "State Bank of India customer care" },
  { type: "phone", value: "1860 419 5555", owner: "Axis Bank customer care" },
  { type: "phone", value: "1860 266 2666", owner: "Kotak Mahindra Bank customer care" },
  { type: "sender_id", value: "HDFCBK", owner: "HDFC Bank SMS sender" },
  { type: "sender_id", value: "ICICIB", owner: "ICICI Bank SMS sender" },
  { type: "sender_id", value: "SBIINB", owner: "State Bank of India SMS sender" },
  { type: "sender_id", value: "AXISBK", owner: "Axis Bank SMS sender" },
  { type: "sender_id", value: "KOTAKB", owner: "Kotak Mahindra Bank SMS sender" },
  { type: "url", value: "https://cybercrime.gov.in", owner: "National Cyber Crime Reporting Portal" },
  { type: "url", value: "https://sancharsaathi.gov.in", owner: "Sanchar Saathi" },
  { type: "phone", value: "+91 80 4100 2233", owner: "Fresh Bakes, Indiranagar" },
  { type: "phone", value: "+91 80 2553 0190", owner: "Koramangala Pharmacy" },
  { type: "upi", value: "freshbakes@okaxis", owner: "Fresh Bakes, Indiranagar" },
  // Common public emergency helplines, so they also show as verified.
  { type: "phone", value: "112", owner: "National Emergency Number" },
  { type: "phone", value: "100", owner: "Police" },
  { type: "phone", value: "1098", owner: "Childline" },
];
