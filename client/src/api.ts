// One wrapper for every API call. A 403 LICENSE_EXPIRED anywhere flips the whole app to the expired screen.
import type { RiskLevel, RiskResult, RiskSignal } from "../../shared/risk.js";
export type { RiskResult };

export interface Evidence {
  occurred_at: string;
  channel: string;
  scam_type: string;
  pincode: string;
}
export type Verdict = "KNOWN_SCAM" | "SUSPICIOUS" | "NO_REPORTS" | "VERIFIED_BUSINESS";

export interface LookupReply {
  verdict: Verdict;
  confirmation: "verified" | "confirmed" | "partly_confirmed" | "awaiting_confirmation" | "none";
  report_count: number;
  distinct_reporters: number;
  first_seen: string | null;
  last_seen: string | null;
  scam_type: string | null;
  display_value: string;
  evidence: Evidence[];
  challenged: boolean;
  identifier_type: string;
  verified_owner?: string;
  near_you_count?: number;
  message_en: string;
  message_hi: string;
  listed_by?: Array<{ source: string; label: string }>;
}

export interface AnalyzeReply {
  kind: "message" | "email";
  score: number;
  level: RiskLevel;
  scam_type: string | null;
  signals: RiskSignal[];
  reassurances: RiskSignal[];
  advice_en: string;
  advice_hi: string;
  community: { en: string; hi: string } | null;
  identifiers: Array<{ type: string; value: string; display_value: string; verdict: Verdict; distinct_reporters: number; verified_owner: string | null; risk: RiskResult; message_en: string; message_hi: string; listed_by?: Array<{ source: string; label: string }> }>;
  ai:
    | { available: true; model: string; risk_level: RiskLevel; risk_score: number; scam_type: string; is_likely_legitimate: boolean; summary_en: string; summary_hi: string; red_flags: Array<{ en: string; hi: string }>; advice_en: string; advice_hi: string }
    | { available: false; reason: string };
  dataset: TextVerdict | null;
  weights: { ai: number; rules: number; dataset: number };
}

export interface TextVerdict {
  available: boolean;
  p_scam: number;
  coverage: number;
  words: string[];
  similar: Array<{ label: "scam" | "ham"; text: string; similarity: number; lang: string; source: string }>;
  metrics: { folds: number; n: number; accuracy: number; precision: number; recall: number; f1: number } | null;
  sources: string[];
}

export interface IdentifierOpinion {
  type: string;
  display_value: string;
  community: { verdict: Verdict; people: number; scam_type: string | null; channels: string[]; challenged: boolean; verified_owner: string | null; awaiting: boolean };
  score: number;
  level: RiskLevel;
  rules: RiskResult;
  likely_scam_type: string | null;
  advice_en: string;
  advice_hi: string;
  ai:
    | { available: true; model: string; risk_level: RiskLevel; risk_score: number; likely_scam_type: string; summary_en: string; summary_hi: string; checks: Array<{ en: string; hi: string }>; safe_step_en: string; safe_step_hi: string }
    | { available: false; reason: string };
}

export interface CardModelMetrics {
  precision: number;
  recall: number;
  f1: number;
  average_precision: number;
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  fraud_amount_total: number;
  fraud_amount_caught: number;
}
export interface DatasetSummary {
  sources: Array<{ source: string; kind: string; file_name: string; rows: number; citation: string; imported_at: string }>;
  messages: null | {
    total: number;
    scam: number;
    ham: number;
    by_lang: Array<{ key: string; scam: number; ham: number }>;
    by_category: Array<{ key: string; scam: number; ham: number }>;
    top_words: string[];
    metrics: { folds: number; n: number; accuracy: number; precision: number; recall: number; f1: number };
  };
  cards: null | {
    total: number;
    fraud: number;
    fraud_rate: number;
    amount_fraud: number;
    by_hour: Array<{ hour: number; tx: number; fraud: number }>;
    by_amount: Array<{ key: string; tx: number; fraud: number }>;
    model: CardModelMetrics | null;
    test_rows: number;
  };
}

export type Trend = "rising_fast" | "rising" | "steady" | "cooling" | "quiet";
export interface AreaForecast {
  pincode: string;
  locality: string;
  locality_hi: string;
  city: string;
  lat: number;
  lng: number;
  last24: number;
  baseline_per_day: number;
  pace_per_hour: number;
  next24: number;
  trend: Trend;
  spike_now: boolean;
  alert_level: number;
  eta_hours: number | null;
  daily: number[];
  top_type: string | null;
}
export interface Forecast {
  generated_at: string;
  method: string;
  total_last24: number;
  total_next24: number;
  areas: AreaForecast[];
  hourly: Array<{ at: string; expected: number; actual_week_avg: number }>;
  types: Array<{ scam_type: string; last3d: number; prev_avg3d: number; change_pct: number | null }>;
}

export interface CardRow {
  id: number;
  t: number;
  amount: number;
  score: number;
  fraud: boolean;
}
export interface CardPage {
  rows: CardRow[];
  next: number | null;
  threshold: number;
  start_t: number | null;
}

interface LiveBase {
  id: number;
  at: string;
  pincode: string;
  locality: string;
  locality_hi: string;
  city: string;
  replay?: boolean;
}
export type DefenceKind = "COORDINATED_BURST" | "SYBIL_RING" | "SUBNET_CLUSTER" | "COPY_PASTE_NOTES" | "SPAM_REPEAT" | "PERSONAL_DISPUTE" | "VERIFIED_TARGET" | "RATE_LIMITED";
export type LiveEvent =
  | (LiveBase & { type: "report"; scam_type: string; channel: string; counted: boolean })
  | (LiveBase & { type: "defence"; kind: DefenceKind; scam_type: string; reports: number; people: number })
  | (LiveBase & { type: "alert"; alert: Alert })
  | (LiveBase & { type: "classified"; scam_type: string; from: string; language: string; outcome: "changed" | "confirmed" });

export interface Cluster {
  pincode: string;
  locality: string;
  city: string;
  count: number;
  top_scam_type: string;
  severity: "CRIT" | "HIGH" | "MED";
  lat: number;
  lng: number;
  spike: boolean;
  suppressed?: boolean;
}

export interface Alert {
  type: "SPIKE" | "NEW_TYPE";
  pincode: string;
  count: number;
  scam_type?: string;
  baseline_per_day?: number;
  locality: string;
  message_en: string;
  message_hi: string;
}

export interface KeyCount {
  key: string;
  count: number;
}
export interface Stats {
  window_days: number;
  totals: { received: number; counted: number; merged: number; set_aside: number; rejected: number; rate_limited: number; identifiers: number; known_scams: number; suspicious: number; awaiting: number; areas_active: number; active_alerts: number; lost_money_reports: number; counted_prev: number };
  daily: Array<{ day: string; counted: number; set_aside: number }>;
  by_type: KeyCount[];
  by_channel: KeyCount[];
  by_area: Array<{ pincode: string; locality: string; city: string; count: number; prev: number; top_scam_type: string }>;
  hour_weekday: number[][];
  report_delay: KeyCount[];
  languages: KeyCount[];
  loss: KeyCount[];
  set_aside_reasons: KeyCount[];
  rejections: KeyCount[];
  top_identifiers: Array<{ type: string; display_value: string; people: number; scam_type: string | null }>;
}
export interface Briefing {
  headline_en: string;
  headline_hi: string;
  insights: Array<{ en: string; hi: string }>;
  source: "gemini" | "rules";
  model?: string;
}

export interface LicenceInfo {
  licensee: string | null;
  expires_at: string | null;
  status: "VALID" | "EXPIRED" | "MISSING" | "CLOCK_ROLLBACK";
  seconds_remaining: number;
  server_time: string;
  clock?: { status: "OK" | "CLOCK_ROLLBACK"; high_water_mark: string | null; behind_seconds: number; tolerance_seconds: number };
}

export class ApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
  }
}

let expiredListener: (() => void) | null = null;
export function onLicenceExpired(fn: () => void): void {
  expiredListener = fn;
}

export async function api<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? {} : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init?.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, { error: "offline" });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (res.status === 403 && body.error === "LICENSE_EXPIRED") {
    expiredListener?.();
    throw new ApiError(403, body);
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const lookup = (type: string, value: string, pincode?: string, signal?: AbortSignal): Promise<LookupReply> =>
  api<LookupReply>(`/lookup?type=${encodeURIComponent(type)}&value=${encodeURIComponent(value)}${pincode ? `&pincode=${pincode}` : ""}`, { signal });

// ------------------------------------------------------------------ platform features

export interface ExplainReply {
  available: boolean;
  verdict?: Verdict;
  display_value?: string;
  raw: number;
  people: number;
  credible: number;
  reports: Array<{ hours_ago: number; voice: number; flags: string[]; has_note: boolean; evidence: boolean }>;
  voices: Array<{ index: number; size: number; accounts: number; credible: boolean; countable: boolean; weight: number; flags: string[] }>;
}

export type LinkVerdict = "proven_phishing" | "dangerous_download" | "suspicious" | "no_live_evidence" | "unreachable" | "blocked";
export interface LinkScan {
  url: string;
  scanned_at: string;
  cached: boolean;
  verdict: LinkVerdict;
  score: number;
  static_score: number;
  static_signals: Array<{ id: string; en: string; hi: string }>;
  live: {
    reachable: boolean;
    final_url: string | null;
    redirects: Array<{ url: string; status: number }>;
    status: number | null;
    content_type: string | null;
    https: boolean;
    tls: { valid: boolean; issuer: string | null; valid_from: string | null; age_days: number | null } | null;
    domain_age_days: number | null;
    page: { title: string; forms: number; asks_for: string[]; brands: string[]; external_form_hosts: string[]; apk_links: number; upi_intents: number } | null;
    error: string | null;
  };
  evidence: Array<{ id: string; en: string; hi: string; weight: number }>;
  correlations: Array<{ static_signal: string; live_evidence: string; en: string; hi: string }>;
  hosting: { ips: string[]; network: string | null } | null;
}

export type IdentType = "phone" | "upi" | "url" | "sender_id" | "email";
export type EdgeKind = "co_reported" | "same_template" | "same_host";
export interface Campaign {
  id: string;
  title_en: string;
  title_hi: string;
  status: "active" | "quiet";
  people: number;
  identifiers: Array<{ key: string; type: IdentType; display: string; verdict: string; people: number }>;
  counts: Partial<Record<IdentType, number>>;
  scam_types: Array<{ slug: string; count: number }>;
  channels: string[];
  first_seen: string;
  last_seen: string;
  lost_money_reports: number;
  spread: Array<{ pincode: string; locality: string; locality_hi: string; city: string; first: string }>;
  cities: string[];
  links: Array<{ a: string; b: string; kind: EdgeKind; weight: number }>;
  chain: Array<{ key: string; en: string; hi: string; detail_en: string; detail_hi: string; identifiers: string[] }>;
  story?: { en: string; hi: string; source: string } | null;
}
export interface NetworkNode {
  id: string;
  kind: IdentType | "host";
  label: string;
  verdict?: string;
  people?: number;
  scam_type?: string | null;
  campaign?: string | null;
  network?: string | null;
}
export interface Network {
  nodes: NetworkNode[];
  links: Array<{ source: string; target: string; kind: EdgeKind | "hosted_on" }>;
}

export interface PartnerHit {
  at: string;
  verdict: Verdict;
  people: number;
  confirmed: boolean;
  scam_type: string;
  matched: string[];
  identifier: { type: string; display_value: string };
  area: { pincode: string; locality: string; city: string };
}
export interface PartnerMe {
  id: string;
  name: string;
  kind: string;
  watch: Partial<Record<"upi_handles" | "brand_tokens" | "sender_ids" | "phone_prefixes" | "domains" | "areas", string[]>>;
  webhook: string | null;
}
export interface SeriesPoint {
  hour: string;
  counted: number;
  set_aside: number;
}
export interface ScaleInfo {
  rollup_refresh: { at: number; ms: number; hours: number };
  last_load_test: null | { at: string; seconds: number; concurrency: number; requests: number; rps: number; errors: number; endpoints: Record<string, { requests: number; p50_ms: number; p95_ms: number; p99_ms: number }> };
  counts: { reports: number; idents: number; rollups: number };
  partners: number;
  push_subscribers: number;
}
export interface ConnectorStatus {
  file: string;
  error: string | null;
  outputs: Array<{ name: string; type: string; on: string[]; active: boolean; off_reason: string | null; sent: number; failed: number; dropped: number; last_ok_at: string | null; last_error: string | null }>;
  inputs: Array<{ name: string; type: string; active: boolean; off_reason: string | null; items: number; last_ok_at: string | null; last_error: string | null }>;
}
export interface TransparencyLog {
  total: number;
  head: string;
  verified: boolean;
  broken_at: number | null;
  entries: Array<{ seq: number; at: string; ident_hash: string; from_verdict: string; to_verdict: string; people: number; prev_hash: string; hash: string }>;
}
export interface SchemaInfo {
  read_at: string;
  tables: Array<{ table: string; columns: Array<{ column: string; type: string; note: string | null }> }>;
}

/** Partner calls carry the tenant's API key. */
export async function partnerApi<T>(path: string, key: string, method: "GET" | "POST" = "GET"): Promise<T> {
  const res = await fetch(path, { method, headers: { "x-api-key": key } }).catch(() => null);
  if (!res) throw new ApiError(0, { error: "offline" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 403 && body.error === "LICENSE_EXPIRED") {
    expiredListener?.();
    throw new ApiError(403, body);
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

// ------------------------------------------------------------------ safety: clock guard, local AI, anti-spoofing
export interface ClockState {
  status: "OK" | "CLOCK_ROLLBACK";
  server_time: string;
  high_water_mark: string | null;
  high_water_source: string;
  behind_seconds: number;
  tolerance_seconds: number;
  persisted: string | null;
  database_clock_offset_seconds: number | null;
  witness: { url: string; offset_seconds: number | null; checked_at: string | null; error: string | null } | null;
  locked_since: string | null;
  lock_events: number;
}
export interface SafetyInfo {
  clock: ClockState;
  local_ai: {
    enabled: boolean;
    model: string | null;
    url: string | null;
    ready: boolean;
    reason: string | null;
    queue: number;
    read: number;
    changed: number;
    confirmed: number;
    kept: number;
    failed: number;
    dropped: number;
    avg_ms: number | null;
    auto_scam_type: boolean;
    recent: Array<{ at: string; pincode: string; language: string; from: string; to: string; confidence: number; ms: number; outcome: string }>;
  };
  scam_type_sources: Record<string, number>;
  anti_spoofing: { subnet_clustering: boolean; window_minutes: number; min_prefixes: number; min_accounts: number; same_network_window_hours: number; ip_prefix_from_body: boolean };
  demo_time_travel: { offset_seconds: number } | null;
}
export interface NoteReading {
  script: string;
  language: "hindi" | "hinglish" | "english" | "other";
  hinglish_words: number;
  rules: string | null;
  local_ai: { available: true; language: string; english: string; scam_type: string; confidence: number; model: string; ms: number } | { available: false; reason: string };
  chosen: string;
  chosen_by: "rules" | "local_ai" | "default";
}

// ------------------------------------------------------------------ map layer B: global threat feed (URLhaus)
export interface ThreatItem {
  id: string;
  display: string;
  host: string;
  threat: string;
  tags: string[];
  status: "online" | "offline" | "unknown";
  added: string;
  country: string | null;
  country_name: string | null;
  located_by: "domain" | "ip" | "hosting" | null;
  lat: number | null;
  lng: number | null;
  reference: string | null;
}
export interface ThreatFeedReply {
  status: { enabled: boolean; connected: boolean; reason: string | null; source: string; last_fetch: string | null; next_fetch: string | null; fetched: number; located: number };
  items: ThreatItem[];
  countries: Array<{ code: string; name: string; count: number }>;
  attribution: { name: string; url: string };
}
