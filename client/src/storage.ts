// Small per-device preferences. Browser storage can be missing or throw (private mode), so every access is guarded.
import type { Lang } from "./i18n";

export function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function set(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the app still works, it just forgets */
  }
}

const CODES: readonly Lang[] = ["en", "hi", "ta", "te", "kn", "bn", "mr", "gu", "ml"];
export function loadLang(): Lang {
  const saved = get("sm.lang");
  if (saved && (CODES as readonly string[]).includes(saved)) return saved as Lang;
  const nav = (navigator.language || "").toLowerCase().slice(0, 2);
  return (CODES as readonly string[]).includes(nav) ? (nav as Lang) : "en";
}
export const saveLang = (l: Lang): void => set("sm.lang", l);

export const loadArea = (): string | null => get("sm.area");
export const saveArea = (pin: string): void => set("sm.area", pin);

/** Anonymous device id: random, never linked to a name or number. Sent as reporter_id so repeats count once. */
export function reporterId(): string {
  let id = get("sm.rid");
  if (!id) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    id = `r_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    set("sm.rid", id);
  }
  return id;
}

export const loadMapStyle = (fallback: string): string => get("sm.mapstyle") ?? fallback;
export const saveMapStyle = (id: string): void => set("sm.mapstyle", id);
export const loadLiveStyle = (fallback: string): string => get("sm.livestyle") ?? fallback;
export const saveLiveStyle = (id: string): void => set("sm.livestyle", id);
