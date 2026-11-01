// Telegram bot: forward a suspicious message to get a verdict, check a number, report a scam in a few taps, and get
// area alerts. Long polling, so it works on a laptop without a public URL.
// Privacy: reports use a keyed hash of the chat id as reporter_id (like the app's device id). The chat id itself is
// stored only for people who turn on /alerts (needed to message them), and deleted with /stop.
import { AREAS, findArea, haversineKm } from "../../shared/areas.js";
import { bestCandidate } from "../../shared/extract.js";
import { normalizeIdentifier, type IdentifierType } from "../../shared/normalize.js";
import { SCAM_TYPES, SCAM_TYPE_BY_SLUG, suggestScamType } from "../../shared/scamTypes.js";
import { analyzeWithAi } from "../ai/assist.js";
import { hmacHex, randomId } from "../lib/hmac.js";
import { logError, logInfo } from "../log.js";
import type { AppDeps } from "../routes/deps.js";
import { publishLive } from "../routes/reports.js";
import { buildLookupReply } from "../services/view.js";

type Lang = "en" | "hi";
interface ChatState {
  lang: Lang;
  step: "idle" | "ident" | "type" | "area";
  ident?: { type: string; value: string; key: string; raw: string };
  scamType?: string;
  hits: number[];
}
interface TgUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string; caption?: string; from?: { language_code?: string }; location?: { latitude: number; longitude: number } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } }; from?: { language_code?: string } };
  channel_post?: { chat: { id: number }; text?: string };
}

/** "/chatid" or "/chatid@SomeBot": setup helper that tells a chat (DM, group or channel) its own id. */
const isChatIdCommand = (text: string | undefined): boolean => /^\/chatid(@\w+)?$/i.test((text ?? "").trim());

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CITIES = [...new Set(AREAS.map((a) => a.city))];
const DEFAULT_CHANNEL: Record<string, string> = { phone: "Phone call", url: "Fake website", upi: "UPI request", sender_id: "SMS or WhatsApp" };
const VERDICT: Record<string, [string, string]> = {
  KNOWN_SCAM: ["🔴 Known scam", "🔴 ज्ञात स्कैम"],
  SUSPICIOUS: ["🟠 Suspicious", "🟠 संदिग्ध"],
  NO_REPORTS: ["⚪ No reports", "⚪ कोई रिपोर्ट नहीं"],
  VERIFIED_BUSINESS: ["🟢 Verified business", "🟢 सत्यापित व्यवसाय"],
};
const T = {
  start: [
    "<b>ScamMap</b>: check before you trust.\n\n• Forward me any suspicious SMS, WhatsApp message or email.\n• Send a number, UPI ID or link to check it.\n• /report: report a scam in a few taps (anonymous).\n• /alerts: get an alert when scams jump in your area.\n• /lang: हिंदी\n\nLost money? Call <b>1930</b> now.",
    "<b>स्कैम मैप</b>: भरोसा करने से पहले जाँचें।\n\n• कोई भी संदिग्ध SMS, WhatsApp मैसेज या ईमेल मुझे फ़ॉरवर्ड करें।\n• नंबर, UPI ID या लिंक भेजकर जाँचें।\n• /report: कुछ टैप में स्कैम रिपोर्ट करें (गुमनाम)।\n• /alerts: आपके इलाक़े में स्कैम बढ़ें तो अलर्ट।\n• /lang: English\n\nपैसे गए? अभी <b>1930</b> पर कॉल करें।",
  ],
  askIdent: ["Send the number, UPI ID or link you want to report (or paste the whole message).", "जिस नंबर, UPI ID या लिंक की रिपोर्ट करनी है वह भेजें (या पूरा मैसेज पेस्ट करें)।"],
  noIdent: ["I couldn't find a phone number, UPI ID, link or SMS sender in that. Try again or /cancel.", "इसमें फ़ोन नंबर, UPI ID, लिंक या SMS सेंडर नहीं मिला। फिर भेजें या /cancel।"],
  askType: ["What happened?", "क्या हुआ?"],
  askArea: ["Which area? Pick your city, send your 6-digit pincode, or share your location (it stays private: we only pick the nearest area).", "कौन सा इलाक़ा? शहर चुनें, 6 अंकों का पिनकोड भेजें, या लोकेशन शेयर करें (सिर्फ़ सबसे पास का इलाक़ा चुना जाता है)।"],
  pickArea: ["Pick your area:", "अपना इलाक़ा चुनें:"],
  unknownArea: ["That pincode isn't one of our areas yet. Pick from the list.", "यह पिनकोड अभी हमारे इलाक़ों में नहीं है। सूची से चुनें।"],
  sentPrivate: ["Thank you. Your report stays private until someone else reports the same number. Only your area was saved.", "धन्यवाद। जब तक कोई और यही नंबर रिपोर्ट न करे, आपकी रिपोर्ट निजी रहेगी। सिर्फ़ इलाक़ा सेव हुआ।"],
  sentPublic: ["Thank you. Others reported it too, so it now shows as a warning. Only your area was saved.", "धन्यवाद। दूसरों ने भी रिपोर्ट किया है, इसलिए अब चेतावनी दिखती है। सिर्फ़ इलाक़ा सेव हुआ।"],
  tooMany: ["You've sent many reports in a short time. Please try later.", "आपने कम समय में बहुत रिपोर्ट भेजीं। बाद में कोशिश करें।"],
  subscribed: ["Done. You'll get a message only when scam reports jump or a new kind appears in {area}. /stop to turn off.", "हो गया। {area} में स्कैम रिपोर्ट अचानक बढ़ने या नए तरह का स्कैम आने पर ही मैसेज आएगा। बंद करने के लिए /stop।"],
  stopped: ["Alerts are off and your chat id was deleted.", "अलर्ट बंद हैं और आपकी चैट ID हटा दी गई।"],
  cancelled: ["Cancelled.", "रद्द किया।"],
  expired: ["Licence expired. Contact your provider.\nलाइसेंस की अवधि समाप्त हो गई है। अपने प्रदाता से संपर्क करें।", "लाइसेंस की अवधि समाप्त हो गई है। अपने प्रदाता से संपर्क करें।\nLicence expired. Contact your provider."],
  slow: ["Too many messages, please wait a minute.", "बहुत मैसेज, एक मिनट रुकें।"],
  chatId: [
    "This chat's id is <code>{id}</code>\n\nTo send ScamMap area alerts here, put this line in your server's .env file and restart the server:\n<code>TELEGRAM_ALERT_CHAT_ID={id}</code>",
    "इस चैट की ID <code>{id}</code> है\n\nयहाँ ScamMap इलाक़ा अलर्ट भेजने के लिए यह लाइन सर्वर की .env फ़ाइल में डालें और सर्वर रीस्टार्ट करें:\n<code>TELEGRAM_ALERT_CHAT_ID={id}</code>",
  ],
} as const;
const tr = (k: keyof typeof T, lang: Lang, vars: Record<string, string> = {}): string => {
  let s: string = T[k][lang === "hi" ? 1 : 0];
  for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(b);
  return s;
};

export class TelegramBot {
  private offset = 0;
  private running = false;
  private chats = new Map<string, ChatState>();
  private unsub: (() => void) | null = null;
  private readonly base: string;
  handled = 0;

  constructor(private readonly token: string, private readonly deps: AppDeps, private readonly pepper: string, apiBase = process.env.TELEGRAM_API_BASE || "https://api.telegram.org") {
    this.base = `${apiBase.replace(/\/+$/, "")}/bot${token}`;
  }

  private async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`${this.base}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      clearTimeout(t);
      const j = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!j.ok) throw new Error(j.description ?? `HTTP ${res.status}`);
      return j.result ?? null;
    } catch (e) {
      if (method !== "getUpdates") logError(`telegram ${method} failed`, e);
      return null;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.call("setMyCommands", { commands: [
      { command: "report", description: "Report a scam (anonymous)" }, { command: "check", description: "Check a number, UPI ID or link" },
      { command: "alerts", description: "Alerts for your area" }, { command: "stop", description: "Turn alerts off" }, { command: "lang", description: "English / हिंदी" },
    ] });
    this.unsub = this.deps.live.subscribe((e) => {
      if (e.type !== "alert" || (e as { replay?: boolean }).replay) return;
      void this.alertArea(e.pincode, e.alert.message_en, e.alert.message_hi);
    });
    void this.loop();
    logInfo("telegram bot started");
  }

  stop(): void {
    this.running = false;
    this.unsub?.();
  }

  private async loop(): Promise<void> {
    let backoff = 2000;
    while (this.running) {
      const updates = await this.call<TgUpdate[]>("getUpdates", { offset: this.offset, timeout: 25, allowed_updates: ["message", "callback_query", "channel_post"] }, 35_000);
      if (!updates) {
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(60_000, backoff * 2);
        continue;
      }
      backoff = 2000;
      for (const u of updates) {
        this.offset = u.update_id + 1;
        try {
          await this.handle(u);
          this.handled++;
        } catch (e) {
          logError("telegram update failed", e);
        }
      }
    }
  }

  private state(chatId: string, langCode?: string): ChatState {
    let s = this.chats.get(chatId);
    if (!s) {
      s = { lang: langCode?.startsWith("hi") ? "hi" : "en", step: "idle", hits: [] };
      this.chats.set(chatId, s);
      if (this.chats.size > 50_000) this.chats.clear();
    }
    return s;
  }

  private send(chatId: string, text: string, keyboard?: Array<Array<{ text: string; callback_data: string }>>): Promise<unknown> {
    return this.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
  }

  async handle(u: TgUpdate): Promise<void> {
    // Channels: the bot (as an admin) only answers /chatid. Nothing else in a channel is read.
    if (u.channel_post) {
      if (isChatIdCommand(u.channel_post.text)) await this.send(String(u.channel_post.chat.id), tr("chatId", "en", { id: String(u.channel_post.chat.id) }));
      return;
    }
    const cq = u.callback_query;
    const chatId = String(cq?.message?.chat.id ?? u.message?.chat.id ?? "");
    if (!chatId) return;
    const s = this.state(chatId, cq?.from?.language_code ?? u.message?.from?.language_code);
    const now = this.deps.now();
    s.hits = s.hits.filter((t) => now - t < 60_000);
    if (s.hits.length >= 20) {
      if (s.hits.length === 20) await this.send(chatId, tr("slow", s.lang));
      s.hits.push(now);
      return;
    }
    s.hits.push(now);
    // Setup helper, answered even while the licence is locked: the chat id is not stored anywhere.
    if (!cq && isChatIdCommand(u.message?.text)) {
      await this.send(chatId, tr("chatId", s.lang, { id: chatId }));
      return;
    }
    if (this.deps.enforceLicence && this.deps.licence.status(now) !== "VALID") {
      if (cq) await this.call("answerCallbackQuery", { callback_query_id: cq.id });
      await this.send(chatId, tr("expired", s.lang));
      return;
    }
    if (cq) {
      await this.call("answerCallbackQuery", { callback_query_id: cq.id });
      await this.onCallback(chatId, s, cq.data ?? "");
      return;
    }
    const m = u.message!;
    if (m.location && s.step === "area") {
      const near = [...AREAS].sort((a, b) => haversineKm(m.location!.latitude, m.location!.longitude, a.lat, a.lng) - haversineKm(m.location!.latitude, m.location!.longitude, b.lat, b.lng))[0];
      if (near) await this.submit(chatId, s, near.pincode); // the coordinates are not kept
      return;
    }
    const text = (m.text ?? m.caption ?? "").trim();
    if (!text) return;
    const [cmd = "", ...rest] = text.split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase().replace(/@\w+$/, "")) {
      case "/start":
      case "/help":
        s.step = "idle";
        await this.send(chatId, tr("start", s.lang));
        return;
      case "/lang":
        s.lang = s.lang === "en" ? "hi" : "en";
        await this.send(chatId, tr("start", s.lang));
        return;
      case "/cancel":
        s.step = "idle";
        await this.send(chatId, tr("cancelled", s.lang));
        return;
      case "/report":
        s.step = "ident";
        s.ident = undefined;
        s.scamType = undefined;
        if (arg) await this.onIdent(chatId, s, arg);
        else await this.send(chatId, tr("askIdent", s.lang));
        return;
      case "/check":
        if (arg) await this.check(chatId, s, arg);
        else await this.send(chatId, tr("askIdent", s.lang));
        return;
      case "/alerts": {
        const pin = /^\d{6}$/.test(arg) ? arg : null;
        if (pin && findArea(pin)) await this.subscribe(chatId, s, pin);
        else await this.send(chatId, tr("pickArea", s.lang), this.cityKeyboard("sc"));
        return;
      }
      case "/stop":
        await this.deps.service.db.query("DELETE FROM telegram_subs WHERE chat_id = $1", [chatId]);
        await this.send(chatId, tr("stopped", s.lang));
        return;
    }
    if (s.step === "ident") return this.onIdent(chatId, s, text);
    if (s.step === "area" && /^\d{6}$/.test(text)) {
      if (findArea(text)) await this.submit(chatId, s, text);
      else await this.send(chatId, tr("unknownArea", s.lang), this.cityKeyboard("c"));
      return;
    }
    const words = text.split(/\s+/).length;
    if (words >= 5 || text.includes("\n")) await this.analyze(chatId, s, text);
    else await this.check(chatId, s, text);
  }

  private cityKeyboard(prefix: string): Array<Array<{ text: string; callback_data: string }>> {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < CITIES.length; i += 3) rows.push(CITIES.slice(i, i + 3).map((c) => ({ text: c, callback_data: `${prefix}:${c}` })));
    return rows;
  }

  private areaKeyboard(city: string, prefix: string, lang: Lang): Array<Array<{ text: string; callback_data: string }>> {
    const list = AREAS.filter((a) => a.city === city);
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2).map((a) => ({ text: lang === "hi" ? a.localityHi : a.locality, callback_data: `${prefix}:${a.pincode}` })));
    return rows;
  }

  private async onCallback(chatId: string, s: ChatState, data: string): Promise<void> {
    const [kind, val = ""] = [data.slice(0, data.indexOf(":")), data.slice(data.indexOf(":") + 1)];
    if (kind === "t" && s.step === "type") {
      s.scamType = SCAM_TYPE_BY_SLUG.has(val) ? val : "other";
      s.step = "area";
      await this.send(chatId, tr("askArea", s.lang), this.cityKeyboard("c"));
    } else if (kind === "c") await this.send(chatId, tr("pickArea", s.lang), this.areaKeyboard(val, "a", s.lang));
    else if (kind === "a" && s.step === "area" && findArea(val)) await this.submit(chatId, s, val);
    else if (kind === "sc") await this.send(chatId, tr("pickArea", s.lang), this.areaKeyboard(val, "sa", s.lang));
    else if (kind === "sa" && findArea(val)) await this.subscribe(chatId, s, val);
  }

  private async onIdent(chatId: string, s: ChatState, text: string): Promise<void> {
    const c = bestCandidate(text);
    const n = c ? normalizeIdentifier(c.type, c.value) : null;
    if (!c || !n || !n.ok) {
      await this.send(chatId, tr("noIdent", s.lang));
      return;
    }
    s.ident = { type: c.type, value: n.value, key: n.key, raw: c.raw };
    s.step = "type";
    const suggested = suggestScamType(text);
    const list = [...SCAM_TYPES].sort((a, b) => (a.slug === suggested ? -1 : b.slug === suggested ? 1 : 0));
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2).map((t) => ({ text: s.lang === "hi" ? t.hi : t.en, callback_data: `t:${t.slug}` })));
    await this.send(chatId, tr("askType", s.lang), rows);
  }

  private async submit(chatId: string, s: ChatState, pincode: string): Promise<void> {
    if (!s.ident || !s.scamType) {
      s.step = "idle";
      return;
    }
    const now = this.deps.now();
    const reporter = `tg_${hmacHex(this.pepper, "telegram", chatId)}`;
    const res = await this.deps.service.submit({
      reportId: randomId("tg"), identType: s.ident.type as IdentifierType, identValue: s.ident.value, identKey: s.ident.key, occurredAt: now, reportedAt: now,
      reporterId: reporter, ipPrefix: `tg:${reporter.slice(3, 15)}`, channel: DEFAULT_CHANNEL[s.ident.type] ?? "Something else", scamType: s.scamType,
      pincode, note: "", hasScreenshot: false, lostMoney: false, lossBand: 0,
    });
    s.step = "idle";
    if (res.kind === "rate_limited") {
      await this.send(chatId, tr("tooMany", s.lang));
      return;
    }
    const a = res.assessment;
    void publishLive(this.deps, res.reportId, s.ident.key, pincode, s.scamType, DEFAULT_CHANNEL[s.ident.type] ?? "Something else", Boolean(this.deps.service.verifiedOwner(s.ident.key)), a?.report_count ?? 1, a?.distinct_reporters ?? 1);
    await this.send(chatId, `${tr((a?.credible_voices ?? 0) >= 2 ? "sentPublic" : "sentPrivate", s.lang)}\n\n${s.lang === "hi" ? "पैसे गए? अभी 1930 पर कॉल करें।" : "Lost money? Call 1930 now."}`);
  }

  private async subscribe(chatId: string, s: ChatState, pincode: string): Promise<void> {
    await this.deps.service.db.query(
      "INSERT INTO telegram_subs (chat_id, pincode, lang) VALUES ($1, $2, $3) ON CONFLICT (chat_id) DO UPDATE SET pincode = EXCLUDED.pincode, lang = EXCLUDED.lang",
      [chatId, pincode, s.lang],
    );
    const a = findArea(pincode)!;
    await this.send(chatId, tr("subscribed", s.lang, { area: s.lang === "hi" ? a.localityHi : a.locality }));
  }

  private lookupText(type: string, value: string, s: ChatState): Promise<string> {
    return (async () => {
      const n = normalizeIdentifier(type as IdentifierType, value);
      if (!n.ok) return esc(n.error);
      const look = buildLookupReply({
        type: n.type, value: n.value, assessment: await this.deps.service.assessment(n.key),
        verifiedOwner: this.deps.service.verifiedOwner(n.key), challenged: this.deps.service.isChallenged(n.key),
      });
      const v = VERDICT[look.verdict]![s.lang === "hi" ? 1 : 0];
      return `<b>${v}</b>: <code>${esc(look.display_value)}</code>\n${esc(s.lang === "hi" ? look.message_hi : look.message_en)}`;
    })();
  }

  private async check(chatId: string, s: ChatState, text: string): Promise<void> {
    const c = bestCandidate(text);
    if (!c) {
      await this.send(chatId, tr("start", s.lang));
      return;
    }
    await this.send(chatId, await this.lookupText(c.type, c.value, s));
  }

  private async analyze(chatId: string, s: ChatState, text: string): Promise<void> {
    const a = await analyzeWithAi(text, this.deps.gemini, this.deps.datasets.analyze(text));
    const level = a.level === "high" ? (s.lang === "hi" ? "🔴 बहुत संभव है स्कैम" : "🔴 Very likely a scam") : a.level === "medium" ? (s.lang === "hi" ? "🟠 सावधान" : "🟠 Be careful") : s.lang === "hi" ? "🟢 आम स्कैम संकेत नहीं मिले" : "🟢 No common scam signs";
    const lines = [`<b>${level}</b> (${a.score}/100)`];
    for (const sig of a.signals.slice(0, 4)) lines.push(`• ${esc(s.lang === "hi" ? sig.hi : sig.en)}`);
    if (a.ai.available) lines.push("", `<i>${esc(s.lang === "hi" ? a.ai.summary_hi : a.ai.summary_en)}</i>`);
    for (const c of a.candidates.slice(0, 3)) lines.push("", await this.lookupText(c.type, c.value, s));
    if (a.advice_en) lines.push("", `<b>${s.lang === "hi" ? "क्या करें" : "What to do"}:</b> ${esc(s.lang === "hi" ? a.advice_hi : a.advice_en)}`);
    await this.send(chatId, lines.join("\n"));
  }

  private async alertArea(pincode: string, en: string, hi: string): Promise<void> {
    const subs = (await this.deps.service.db.query<{ chat_id: string; lang: string }>("SELECT chat_id, lang FROM telegram_subs WHERE pincode = $1", [pincode])).rows;
    for (const sub of subs) await this.send(sub.chat_id, `🚨 ${esc(sub.lang === "hi" ? hi : en)}`);
  }
}
