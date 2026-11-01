import type { Gemini } from "../ai/gemini.js";
import type { NoteParser } from "../ai/noteParser.js";
import type { Ollama } from "../ai/ollama.js";
import type { DatasetStore } from "../datasets/store.js";
import type { LiveBus } from "../live/bus.js";
import type { CampaignService } from "../campaigns/service.js";
import type { Connectors } from "../connectors/connectors.js";
import type { LinkScanner } from "../linkscan/scan.js";
import type { PartnerService } from "../partners/partners.js";
import type { PushService } from "../push/push.js";
import type { RollupService } from "../services/rollups.js";
import type { TransparencyLog } from "../services/transparency.js";
import type { ThreatFeed } from "../threatfeed/urlhaus.js";

export interface Platform {
  rollups: RollupService;
  transparency: TransparencyLog;
  partners: PartnerService;
  connectors: Connectors;
  linkscan: LinkScanner;
  campaigns: CampaignService;
  push: PushService;
  /** Map layer B: global malicious-URL feed (URLhaus). */
  threats: ThreatFeed;
}
/** Time-travel defence, local AI note reading, and the demo clock. */
export interface Safety {
  noteParser: NoteParser;
  ollama: Ollama | null;
  autoScamType: boolean;
  /** Demo only (DEMO_TIME_TRAVEL=true): how far this server's clock is moved back, in ms (0 or negative). */
  timeTravel: { enabled: boolean; offsetMs: number };
}
import type { LicenceManager } from "../licence/manager.js";
import type { ScamService } from "../services/scamService.js";

export interface AppDeps {
  service: ScamService;
  licence: LicenceManager;
  enforceLicence: boolean;
  trustBodyIpPrefix: boolean;
  staticDir: string | null;
  now: () => number;
  /** Gemini client (disabled when GEMINI_API_KEY is empty). */
  gemini: Gemini;
  /** Always-disabled client, used when a caller is over their AI budget. */
  geminiOff: Gemini;
  /** Imported public datasets (labelled messages, card transactions) and the models trained on them. */
  datasets: DatasetStore;
  /** Live events for the Live screen and map pings (area-level only). */
  live: LiveBus;
  /** Partner console, rollups, integrations, link checks, campaigns, push alerts, transparency log. */
  platform: Platform;
  safety: Safety;
}

/** Zod errors become one short readable sentence for the 400 reply. */
export function zodMessage(issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>): string {
  const i = issues[0];
  if (!i) return "invalid request";
  return i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message;
}
