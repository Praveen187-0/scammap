// Scam types and report channels from Appendix C, with labels, icons and safety advice in English and Hindi.
export interface ScamTypeInfo {
  slug: string;
  icon: string;
  en: string;
  hi: string;
  adviceEn: string;
  adviceHi: string;
  /** Lower-case keywords (English, Hinglish, Hindi) used to suggest a type from pasted text. */
  keywords: string[];
}

export const SCAM_TYPES: readonly ScamTypeInfo[] = [
  {
    slug: "digital-arrest",
    icon: "👮",
    en: "Digital arrest",
    hi: "डिजिटल अरेस्ट",
    adviceEn: "Police, CBI or customs never arrest anyone on a video call or ask for money to clear your name. Hang up and call 1930.",
    adviceHi: "पुलिस, CBI या कस्टम कभी वीडियो कॉल पर गिरफ़्तार नहीं करते और नाम साफ़ करने के लिए पैसे नहीं माँगते। कॉल काटें और 1930 पर कॉल करें।",
    keywords: ["arrest", "police", "cbi", "ncb", "narcotics", "drugs", "warrant", "officer", "uniform", "गिरफ्तार", "गिरफ़्तार", "पुलिस", "वारंट", "ड्रग्स", "अरेस्ट", "giraftar", "giraftaar", "griftar", "digital arrest", "video call pe", "thana", "हिरासत"],
  },
  {
    slug: "fake-kyc-link",
    icon: "🔗",
    en: "Fake KYC link",
    hi: "नकली KYC लिंक",
    adviceEn: "Banks never ask you to update KYC through an SMS link. Open your bank's own app yourself.",
    adviceHi: "बैंक कभी SMS लिंक से KYC अपडेट करने को नहीं कहते। अपने बैंक का ऐप खुद खोलें।",
    keywords: ["kyc", "pan card", "aadhaar", "account blocked", "account will be blocked", "suspended", "केवाईसी", "खाता बंद", "ब्लॉक", "khata band", "account band", "kyc update", "link pe click", "लिंक"],
  },
  {
    slug: "upi-refund-qr",
    icon: "🔳",
    en: "UPI refund QR",
    hi: "UPI रिफ़ंड QR",
    adviceEn: "You never scan a QR code or enter your PIN to receive money. Scanning sends money.",
    adviceHi: "पैसे पाने के लिए QR स्कैन करने या PIN डालने की ज़रूरत नहीं होती। स्कैन करने से पैसे जाते हैं।",
    keywords: ["qr", "scan", "refund", "receive money", "cashback", "रिफंड", "रिफ़ंड", "स्कैन", "scan karo", "paise wapas"],
  },
  {
    slug: "investment-group",
    icon: "📈",
    en: "Investment group",
    hi: "निवेश ग्रुप",
    adviceEn: "Guaranteed high returns and insider tips on WhatsApp or Telegram are a trap. Check SEBI registration first.",
    adviceHi: "WhatsApp या Telegram पर पक्का ज़्यादा मुनाफ़ा और 'टिप्स' जाल हैं। पहले SEBI पंजीकरण जाँचें।",
    keywords: ["invest", "stock", "trading", "ipo", "profit", "returns", "crypto", "telegram", "निवेश", "मुनाफा", "मुनाफ़ा", "शेयर", "paisa double", "paise double", "share market", "munafa", "दोगुना"],
  },
  {
    slug: "courier-customs",
    icon: "📦",
    en: "Parcel / customs",
    hi: "पार्सल / कस्टम",
    adviceEn: "Customs and courier companies don't collect fines over the phone. Track parcels only on the courier's official site.",
    adviceHi: "कस्टम या कूरियर कंपनियाँ फ़ोन पर जुर्माना नहीं लेतीं। पार्सल सिर्फ़ कूरियर की आधिकारिक साइट पर ट्रैक करें।",
    keywords: ["parcel", "courier", "customs", "fedex", "dhl", "package", "shipment", "पार्सल", "कूरियर", "कस्टम", "parsal"],
  },
  {
    slug: "job-offer",
    icon: "💼",
    en: "Task / job offer",
    hi: "टास्क / नौकरी ऑफ़र",
    adviceEn: "A real job never asks you to pay a deposit or recharge tasks to earn.",
    adviceHi: "असली नौकरी में कमाने के लिए जमा राशि या टास्क रिचार्ज नहीं माँगा जाता।",
    keywords: ["job", "work from home", "part time", "part-time", "task", "like videos", "salary", "hiring", "नौकरी", "घर से काम", "टास्क", "naukri", "ghar baithe", "ghar se kaam", "registration fee", "रजिस्ट्रेशन"],
  },
  {
    slug: "lottery-prize",
    icon: "🎁",
    en: "Lottery / prize",
    hi: "लॉटरी / इनाम",
    adviceEn: "If you have to pay a fee to receive a prize, there is no prize.",
    adviceHi: "अगर इनाम पाने के लिए फ़ीस देनी पड़े, तो कोई इनाम नहीं है।",
    keywords: ["lottery", "prize", "winner", "won", "kbc", "lucky draw", "लॉटरी", "इनाम", "जीत", "inaam", "inam", "lottery lagi", "jeeta", "jeete"],
  },
  {
    slug: "loan-app-harassment",
    icon: "📱",
    en: "Loan app threats",
    hi: "लोन ऐप धमकी",
    adviceEn: "Don't pay more under threat. Keep screenshots, report the app and call 1930.",
    adviceHi: "धमकी के डर से और पैसे न दें। स्क्रीनशॉट रखें, ऐप की शिकायत करें और 1930 पर कॉल करें।",
    keywords: ["loan", "instant loan", "emi", "contacts", "morphed", "recovery", "लोन", "कर्ज", "क़र्ज़", "karz", "karza", "photo viral", "रिकवरी"],
  },
  {
    slug: "electricity-disconnection",
    icon: "💡",
    en: "Power cut SMS",
    hi: "बिजली कटने का SMS",
    adviceEn: "Electricity boards don't SMS you to call an officer tonight. Pay bills only in the official app or website.",
    adviceHi: "बिजली विभाग 'आज रात कनेक्शन कटेगा, अफ़सर को कॉल करें' जैसे SMS नहीं भेजता। बिल सिर्फ़ आधिकारिक ऐप या साइट से भरें।",
    keywords: ["electricity", "power", "disconnect", "disconnected", "bescom", "light bill", "बिजली", "कनेक्शन", "बिल", "bijli", "light kat", "connection kat", "bill nahi bhara"],
  },
  {
    slug: "fake-customer-care",
    icon: "🎧",
    en: "Fake customer care",
    hi: "नकली कस्टमर केयर",
    adviceEn: "Take helpline numbers only from the company's official app or website, not from search results.",
    adviceHi: "हेल्पलाइन नंबर सिर्फ़ कंपनी के आधिकारिक ऐप या साइट से लें, सर्च रिज़ल्ट से नहीं।",
    keywords: ["customer care", "helpline", "support", "anydesk", "teamviewer", "toll free", "कस्टमर केयर", "हेल्पलाइन", "app download karwaya", "screen share", "amazon support", "amazon customer", "order cancel", "cancel the order", "cancellation desk", "press 1", "prime membership"],
  },
  {
    slug: "otp-call",
    icon: "🔢",
    en: "OTP / card call",
    hi: "OTP / कार्ड कॉल",
    adviceEn: "Never share an OTP, CVV or PIN with anyone, not even someone saying they are from the bank.",
    adviceHi: "OTP, CVV या PIN किसी को न बताएं, 'बैंक वाले' को भी नहीं।",
    keywords: ["otp", "cvv", "card", "pin", "verification code", "ओटीपी", "कार्ड", "otp bata", "otp maanga", "otp manga", "ओटीपी बताओ", "parcel otp", "delivery otp", "tell the otp", "share the otp", "otp you got"],
  },
  {
    slug: "sextortion",
    icon: "🎥",
    en: "Video call blackmail",
    hi: "वीडियो कॉल ब्लैकमेल",
    adviceEn: "Don't pay. Block, keep evidence and report at cybercrime.gov.in or 1930. It is not your fault.",
    adviceHi: "पैसे न दें। ब्लॉक करें, सबूत रखें और cybercrime.gov.in या 1930 पर शिकायत करें। यह आपकी गलती नहीं है।",
    keywords: ["blackmail", "nude", "obscene", "viral", "record", "ब्लैकमेल", "अश्लील", "वायरल", "nangi", "gandi video", "video viral"],
  },
  {
    slug: "other",
    icon: "❓",
    en: "Not sure",
    hi: "पता नहीं",
    adviceEn: "When in doubt, hang up and call the organisation on a number you find yourself. If you lost money, call 1930 quickly.",
    adviceHi: "शक हो तो कॉल काटें और खुद ढूँढे नंबर पर संस्था से बात करें। पैसे गए हों तो तुरंत 1930 पर कॉल करें।",
    keywords: [],
  },
];

export const SCAM_TYPE_SLUGS: ReadonlySet<string> = new Set(SCAM_TYPES.map((s) => s.slug));
export const SCAM_TYPE_BY_SLUG: ReadonlyMap<string, ScamTypeInfo> = new Map(SCAM_TYPES.map((s) => [s.slug, s]));

/** Unknown scam types are stored as "other" rather than rejected (Appendix C). */
export function normalizeScamType(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s_]+/g, "-") : "";
  return SCAM_TYPE_SLUGS.has(s) ? s : "other";
}

/** Suggest a scam type from free text (pasted SMS or note). Returns null when nothing matches. */
export function suggestScamType(text: string): string | null {
  const t = text.toLowerCase();
  let best: string | null = null;
  let bestScore = 0;
  for (const st of SCAM_TYPES) {
    let score = 0;
    for (const k of st.keywords) if (t.includes(k)) score += k.length > 4 ? 2 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = st.slug;
    }
  }
  return best;
}

export interface ChannelInfo {
  value: string;
  icon: string;
  en: string;
  hi: string;
}

export const CHANNELS: readonly ChannelInfo[] = [
  { value: "Phone call", icon: "📞", en: "Phone call", hi: "फ़ोन कॉल" },
  { value: "SMS or WhatsApp", icon: "💬", en: "SMS or WhatsApp", hi: "SMS या WhatsApp" },
  { value: "QR code", icon: "🔳", en: "QR code", hi: "QR कोड" },
  { value: "Fake website", icon: "🌐", en: "Fake website", hi: "नकली वेबसाइट" },
  { value: "UPI request", icon: "💸", en: "UPI request", hi: "UPI रिक्वेस्ट" },
  { value: "Something else", icon: "❔", en: "Something else", hi: "कुछ और" },
];

/** Unknown channels become "Something else". Matching is case-insensitive. */
export function normalizeChannel(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const hit = CHANNELS.find((c) => c.value.toLowerCase() === s);
  return hit ? hit.value : "Something else";
}
