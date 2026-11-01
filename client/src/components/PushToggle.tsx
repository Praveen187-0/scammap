import { BellOff, BellRing, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { areaName, useApp } from "../ctx";
import { get, set } from "../storage";

function b64ToBytes(b64: string): ArrayBuffer {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

/**
 * Web push for the chosen area. Only two things are stored on the server: the browser's push address and the area.
 * The server sends a notification only when an alert fires (a spike or a new kind of scam), never per report.
 */
export function PushToggle() {
  const { t, lang, area, openAreaPicker } = useApp();
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  const [on, setOn] = useState<string | null>(get("sm.push"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!supported) return;
    void registration()
      .then((r) => r.pushManager.getSubscription())
      .then((s) => {
        if (!s && on) {
          set("sm.push", null);
          setOn(null);
        }
      })
      .catch(() => undefined);
  }, [supported, on]);

  if (!supported) return <section className="card notify"><h3><BellOff size={18} aria-hidden="true" /> {t("notifyTitle")}</h3><p className="muted">{t("notifyUnsupported")}</p><p className="hint">{t("notifyBot")}</p></section>;

  const turnOn = async (): Promise<void> => {
    if (!area) return openAreaPicker();
    setBusy(true);
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setMsg(t("notifyDenied"));
        return;
      }
      const { publicKey } = await api<{ publicKey: string }>("/push/key");
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api("/push/subscribe", { method: "POST", body: { subscription: sub.toJSON(), pincode: area.pincode, lang: lang === "hi" ? "hi" : "en" } });
      set("sm.push", area.pincode);
      setOn(area.pincode);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) setMsg(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async (): Promise<void> => {
    setBusy(true);
    try {
      const sub = await (await registration()).pushManager.getSubscription();
      if (sub) {
        await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => undefined);
        await sub.unsubscribe();
      }
    } finally {
      set("sm.push", null);
      setOn(null);
      setBusy(false);
    }
  };
  const test = async (): Promise<void> => {
    if (!on) return;
    await api("/push/test", { method: "POST", body: { pincode: on } }).catch(() => undefined);
  };

  return (
    <section className={`card notify ${on ? "is-on" : ""}`}>
      <h3>{on ? <BellRing size={18} aria-hidden="true" /> : <BellOff size={18} aria-hidden="true" />} {t("notifyTitle")}</h3>
      <p className="muted">{t("notifyIntro")}</p>
      {on ? (
        <>
          <p className="calm">{t("notifyOnNow", { area: area && area.pincode === on ? areaName(area, lang) : on })}</p>
          <div className="row">
            <button className="btn btn-quiet" onClick={() => void test()}><Send size={16} aria-hidden="true" /> {t("notifyTest")}</button>
            <button className="btn btn-text" onClick={() => void turnOff()} disabled={busy}>{t("notifyOff")}</button>
          </div>
        </>
      ) : (
        <button className="btn btn-primary" onClick={() => void turnOn()} disabled={busy}>
          <BellRing size={18} aria-hidden="true" /> {area ? t("notifyOn", { area: areaName(area, lang) }) : t("notifyNeedArea")}
        </button>
      )}
      {msg && <p className="error">{msg}</p>}
      <p className="hint">{t("notifyBot")}</p>
    </section>
  );
}
