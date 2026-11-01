import { Database, Link2, Plug, Send, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, type ConnectorStatus, type SchemaInfo, type TransparencyLog } from "../api";
import { fmt, useApp } from "../ctx";
import type { StringKey } from "../i18n";

/** Connectors from config/connectors.yaml: what is on, and why the rest is off. */
export function IntegrationsPanel() {
  const { t } = useApp();
  const [s, setS] = useState<ConnectorStatus | null>(null);
  const [tests, setTests] = useState<Record<string, { busy: boolean; ok?: boolean; error?: string | null }>>({});
  const load = (): void => void api<ConnectorStatus>("/connectors").then(setS).catch(() => undefined);
  useEffect(load, []);
  const sendTest = async (name: string): Promise<void> => {
    setTests((m) => ({ ...m, [name]: { busy: true } }));
    try {
      const r = await api<{ ok: boolean; error: string | null }>("/connectors/test", { method: "POST", body: { name } });
      setTests((m) => ({ ...m, [name]: { busy: false, ok: r.ok, error: r.error } }));
    } catch (e) {
      const msg = e instanceof ApiError ? String((e.body as { error?: unknown }).error ?? e.status) : "offline";
      setTests((m) => ({ ...m, [name]: { busy: false, ok: false, error: msg } }));
    }
    load();
  };
  if (!s) return null;
  return (
    <section className="card span-all">
      <h3><Plug size={18} aria-hidden="true" /> {t("integTitle")}</h3>
      <p className="muted">{t("integIntro")} <code>{s.file}</code></p>
      {s.error && <p className="error">{s.error}</p>}
      <ul className="integ-list">
        {s.outputs.map((o) => (
          <li key={o.name}>
            <span className={`integ-dot ${o.active ? "on" : ""}`} aria-hidden="true" />
            <div>
              <strong>{o.name}</strong> <span className="muted small">{o.type}, {o.on.join(", ")}</span>
              <p className="small muted">{o.active ? `${t("integOn")}: ${t("integSent", { n: o.sent })}${o.failed ? `, ${o.failed} failed` : ""}${o.last_error ? ` (${o.last_error})` : ""}` : `${t("integOff")}: ${o.off_reason ?? ""}`}</p>
              {o.active && (
                <div className="integ-test">
                  <button type="button" className="btn btn-quiet integ-test-btn" disabled={tests[o.name]?.busy} onClick={() => void sendTest(o.name)}>
                    <Send size={14} aria-hidden="true" /> {tests[o.name]?.busy ? t("integTesting") : t("integTest")}
                  </button>
                  {tests[o.name] && !tests[o.name]?.busy && (
                    <span role="status" className={`small integ-result ${tests[o.name]?.ok ? "ok" : "bad"}`}>
                      {tests[o.name]?.ok ? t("integTestOk") : t("integTestFail", { e: tests[o.name]?.error ?? "" })}
                    </span>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
        {s.inputs.map((i) => (
          <li key={i.name}>
            <span className={`integ-dot ${i.active ? "on" : ""}`} aria-hidden="true" />
            <div>
              <strong>{i.name}</strong> <span className="muted small">{i.type}</span>
              <p className="small muted">{i.active ? `${t("integOn")}: ${t("integItems", { n: i.items })}${i.last_error ? ` (${i.last_error})` : ""}` : `${t("integOff")}: ${i.off_reason ?? ""}`}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const short = (h: string): string => `${h.slice(0, 10)}…`;

/** Hash-chained log of public verdict changes, re-verified on every read. */
export function TransparencyPanel() {
  const { t, lang } = useApp();
  const [log, setLog] = useState<TransparencyLog | null>(null);
  useEffect(() => {
    api<TransparencyLog>("/transparency?limit=12").then(setLog).catch(() => undefined);
  }, []);
  if (!log) return null;
  return (
    <section className="card span-all">
      <h3><Link2 size={18} aria-hidden="true" /> {t("transTitle")}</h3>
      <p className="muted">{t("transIntro")}</p>
      <p className={log.verified ? "calm" : "error"}>
        {log.verified ? <ShieldCheck size={20} aria-hidden="true" /> : <ShieldX size={20} aria-hidden="true" />}{" "}
        {log.verified ? t("transOk", { n: fmt(log.total, lang) }) : t("transBroken", { n: log.broken_at ?? "?" })}
      </p>
      {log.entries.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table mono-cells">
            <thead><tr><th className="num">#</th><th>{t("colWhen")}</th><th>{t("transChange")}</th><th className="num">{t("people")}</th><th>{t("transId")}</th><th>{t("transHash")}</th></tr></thead>
            <tbody>
              {log.entries.map((e) => (
                <tr key={e.seq}>
                  <td className="num">{e.seq}</td>
                  <td>{e.at.slice(5, 16).replace("T", " ")}</td>
                  <td>{t(`v${e.from_verdict}` as StringKey)} → <strong>{t(`v${e.to_verdict}` as StringKey)}</strong></td>
                  <td className="num">{e.people}</td>
                  <td className="hash">{e.ident_hash}</td>
                  <td className="hash" title={e.hash}>{short(e.hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">{t("transHead")}: <span className="hash">{log.head}</span></p>
    </section>
  );
}

/** Every table and column the server has, read from the live database, with what each column holds. */
export function SchemaPanel() {
  const { t } = useApp();
  const [s, setS] = useState<SchemaInfo | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !s) api<SchemaInfo>("/privacy/schema").then(setS).catch(() => undefined);
  }, [open, s]);
  return (
    <section className="card span-all">
      <h3><Database size={18} aria-hidden="true" /> {t("schemaTitle")}</h3>
      <p className="muted">{t("schemaIntro")}</p>
      <button className="btn btn-quiet" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? t("schemaHide") : t("schemaShow")}</button>
      {open && s && (
        <div className="schema">
          {s.tables.map((tb) => (
            <details key={tb.table}>
              <summary><code>{tb.table}</code> <span className="muted small">{t("schemaCols", { n: tb.columns.length })}</span>{tb.columns.some((c) => c.note) && <span className="tag">{t("schemaNoted")}</span>}</summary>
              <table className="data-table">
                <tbody>
                  {tb.columns.map((c) => (
                    <tr key={c.column}><td><code>{c.column}</code></td><td className="muted small">{c.type}</td><td className="small">{c.note ?? <span className="muted">{t("internal")}</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
          <p className="hint">{t("schemaRead", { at: s.read_at.slice(0, 19).replace("T", " ") })}</p>
        </div>
      )}
    </section>
  );
}
