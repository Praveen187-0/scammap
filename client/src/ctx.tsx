import { createContext, useContext } from "react";
import type { Area } from "../../shared/areas.js";
import { SCAM_TYPE_BY_SLUG } from "../../shared/scamTypes.js";
import { lookupString, type Lang, type StringKey } from "./i18n";

export type Tab = "check" | "report" | "map" | "live" | "alerts" | "insights" | "more" | "lost" | "campaigns" | "partners";

export interface AppCtx {
  lang: Lang;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  area: { pincode: string; locality: string; localityHi: string; city: string; lat: number; lng: number } | null;
  setArea: (pin: string) => void;
  openAreaPicker: () => void;
  go: (tab: Tab, payload?: string) => void;
  payload: string;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function areaName(a: Area | AppCtx["area"] | undefined | null, lang: Lang): string {
  if (!a) return "";
  return lang === "hi" || lang === "mr" ? a.localityHi : a.locality;
}

export function typeName(slug: string | null | undefined, lang: Lang): string {
  const s = SCAM_TYPE_BY_SLUG.get(slug ?? "other") ?? SCAM_TYPE_BY_SLUG.get("other");
  if (!s) return "";
  if (lang === "hi") return s.hi;
  if (lang === "en") return s.en;
  return lookupString(lang, `type_${s.slug}`) ?? s.en;
}

/** "2026-10-27T18:21:04+05:30" -> "27 Oct" in the reader's language, shown in IST. */
export function shortDate(iso: string | null, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export function fmt(n: number, lang: Lang): string {
  return n.toLocaleString(lang === "hi" ? "hi-IN" : "en-IN");
}
