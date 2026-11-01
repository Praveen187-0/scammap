import { Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { LANGS } from "../i18n";

/** Reads a verdict out loud with the phone's own voice (nothing is sent anywhere). Hidden where speech isn't supported. */
export function ReadAloud({ text }: { text: string }) {
  const { t, lang } = useApp();
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => () => {
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);
  if (!supported || !text) return null;
  const speak = (): void => {
    const s = window.speechSynthesis;
    if (speaking) {
      s.cancel();
      setSpeaking(false);
      return;
    }
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const code = LANGS.find((l) => l.code === lang)?.speech ?? "en-IN";
    u.lang = code;
    const voice = s.getVoices().find((v) => v.lang === code) ?? s.getVoices().find((v) => v.lang.startsWith(code.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    s.speak(u);
  };
  return (
    <button className="btn btn-text read-aloud" onClick={speak} aria-pressed={speaking}>
      {speaking ? <Square size={16} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />} {t("readAloud")}
    </button>
  );
}
