import { CircleCheck, Sparkle, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { AREA_BY_PIN } from "../../../shared/areas.js";
import { api, type Alert } from "../api";
import { PushToggle } from "../components/PushToggle";
import { areaName, useApp } from "../ctx";

function AlertItem({ a }: { a: Alert }) {
  const { t, lang } = useApp();
  const name = areaName(AREA_BY_PIN.get(a.pincode), lang) || a.locality;
  return (
    <li className={`alert-item a-${a.type}`}>
      <span className="alert-icon">{a.type === "SPIKE" ? <TrendingUp size={20} aria-hidden="true" /> : <Sparkle size={20} aria-hidden="true" />}</span>
      <div>
        <h3>{a.type === "SPIKE" ? t("spikeTitle", { area: name }) : t("newTypeTitle", { area: name })}</h3>
        <p className="muted">{lang === "hi" ? a.message_hi : a.message_en}</p>
      </div>
    </li>
  );
}

/** Alerts fire only when something is unusual; the calm "all normal" state is shown on purpose. */
export function AlertsScreen() {
  const { t, lang, area } = useApp();
  const [all, setAll] = useState<Alert[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api<{ alerts: Alert[] }>("/alerts").then((r) => setAll(r.alerts)).catch(() => setErr(true));
  }, []);
  const mine = (all ?? []).filter((a) => a.pincode === area?.pincode);
  const others = (all ?? []).filter((a) => a.pincode !== area?.pincode);
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>{t("alertsTitle")}</h1>
          <p>{t("alertsIntro")}</p>
        </div>
      </div>
      {err && <p className="error">{t("errorGeneric")}</p>}
      <div className="stack">
        {area && (
          <section className="stack" style={{ gap: 10 }}>
            <h2>{t("yourArea")}: {areaName(area, lang)}</h2>
            {all && mine.length === 0 ? <p className="calm"><CircleCheck size={22} aria-hidden="true" /> {t("allNormal", { area: areaName(area, lang) })}</p> : <ul className="alert-list">{mine.map((a, i) => <AlertItem key={i} a={a} />)}</ul>}
          </section>
        )}
        <PushToggle />
        <section className="stack" style={{ gap: 10 }}>
          <h2>{area ? t("otherAreas") : t("alertsTitle")}</h2>
          {all && others.length === 0 ? <p className="calm"><CircleCheck size={22} aria-hidden="true" /> {t("allNormalAll")}</p> : <ul className="alert-list">{others.map((a, i) => <AlertItem key={i} a={a} />)}</ul>}
        </section>
      </div>
    </div>
  );
}
