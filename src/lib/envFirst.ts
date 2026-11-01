// Imported FIRST by server.ts: loads .env before any other module reads process.env at import time
// (for example the trust thresholds in src/trust/config.ts). Real environment variables still win.
import { loadDotEnv } from "./dotenv.js";

loadDotEnv();
