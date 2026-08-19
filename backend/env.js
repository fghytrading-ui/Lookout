// Environment loader — MUST be the first import in server.js.
//
// ES module imports are hoisted and execute in source order before any
// top-level statements in the importing file. Calling dotenv.config() inside
// server.js therefore ran AFTER lib/finnhub.js had already been evaluated and
// captured process.env.FINNHUB_API_KEY as undefined. The key silently never
// loaded: real-time quotes fell back to delayed Yahoo data and analyst ratings
// disappeared from every card, with no error raised anywhere.
//
// Isolating the load into its own module, imported first, guarantees the
// environment exists before any consumer reads it. The path is anchored to
// this file rather than the working directory so it also works when the
// process is started from the repo root or by a launcher that does not chdir.
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });

export const ENV_LOADED = true;
