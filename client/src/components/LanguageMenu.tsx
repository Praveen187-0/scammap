import { Check, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../ctx";
import { LANGS, type Lang } from "../i18n";

/** Language picker. Each language is written in its own script so people can find theirs. */
export function LanguageMenu({ onChange }: { onChange: (l: Lang) => void }) {
  const { t, lang } = useApp();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = LANGS.find((l) => l.code === lang);
  return (
    <div className="lang-menu" ref={box}>
      <button className="chip-btn lang-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={`${t("language")}: ${current?.name ?? lang}`}>
        <Languages size={16} aria-hidden="true" /> <span lang={lang}>{current?.name ?? lang}</span>
      </button>
      {open && (
        <ul className="lang-list" role="listbox" aria-label={t("language")}>
          {LANGS.map((l) => (
            <li key={l.code}>
              <button role="option" aria-selected={l.code === lang} lang={l.code} onClick={() => { onChange(l.code); setOpen(false); }}>
                <span>{l.name}</span>
                {l.code === lang && <Check size={16} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
