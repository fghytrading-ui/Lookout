// Durable storage for everything the system learns from.
//
// Render's free tier has no persistent disk: the filesystem is wiped on every
// deploy, every restart and every spin-down after 15 idle minutes. Every file
// in backend/data lived on that disk. Measured on 2026-10-02, a month after the
// self-learning features shipped:
//
//   live record      frozen at the 31 Aug seed — not one September trade kept
//   open trades      103, reset to OPEN and re-graded on every wake, forever
//   learning         never applied: live ran on baseline settings all month
//   daily review     1 entry (that morning); fault memory 0 runs
//
// Every wake the server reloaded the seed, scanned, logged the session's
// signals, graded, learned one step — then spun down and lost all of it. The
// learning loop, the daily review, the fault memory and the hypothesis tracker
// were all correct and all running, with nowhere to keep a single result.
//
// This keeps those four files in Upstash Redis (durable to block storage on
// every plan, free tier included) and mirrors them to disk, so every other
// module keeps reading and writing local files exactly as before:
//
//   boot   pull each key and write it to disk BEFORE anything reads state
//   every  minute, push any file whose content changed since the last push
//   exit   best-effort final push — Render does not document a shutdown
//          signal for free services and "might restart at any time", so the
//          minute cadence is the real guarantee, not this
//
// The signal log is merged rather than overwritten on push: Render starts the
// new instance before stopping the old one on deploy, and for those seconds
// both can write. Pull, merge by idea (the same coherence and dedupe rules as
// every other door into the store), then push.
//
// Enabled only on Render. A laptop pushing its own record over the live one
// would be the same clobbering this exists to prevent; DURABLE_ALLOW_LOCAL=1
// overrides for deliberate testing.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { flushSignalLog, mergeSignals } from './signalLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
const REST_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const ON_RENDER = process.env.RENDER === 'true';
export const DURABLE_CONFIGURED = !!(REST_URL && REST_TOKEN);
export const DURABLE_ENABLED = DURABLE_CONFIGURED && (ON_RENDER || process.env.DURABLE_ALLOW_LOCAL === '1');
const PREFIX = process.env.DURABLE_KEY_PREFIX || 'lookout:v1:';

// What is kept. The signal log is the irreplaceable one; the others are what
// the system has concluded from it.
const FILES = {
  'signal-log':     'signal-log.json',
  'learning-state': 'learning-state.json',
  'daily-review':   'daily-review.json',
  'selfcheck-log':  'selfcheck-log.json'
};

const status = {
  hydrated: false,          // remote state is on disk — pushing is safe
  hydratedAt: null,
  restored: {},             // name -> bytes restored at boot
  lastPushAt: null,
  lastError: null,
  lastErrorAt: null,
  pushes: 0
};
const lastHash = {};        // name -> hash of the content last known to be remote
let inFlight = null;        // the flush currently running, if any

async function redis(command) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(15_000)
  });
  let body;
  try { body = await r.json(); } catch { body = { error: `HTTP ${r.status}` }; }
  if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
  return body.result;
}

// Compressed: the signal log is ~400 KB of JSON and ~10x smaller gzipped,
// which keeps both the request and the monthly bandwidth small.
const encode = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64');
const decode = (str) => JSON.parse(zlib.gunzipSync(Buffer.from(str, 'base64')).toString('utf8'));
const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const fileOf = (name) => path.join(DATA_DIR, FILES[name]);

function readFile(name) {
  try { return fs.readFileSync(fileOf(name)); } catch { return null; }
}

function noteError(err) {
  status.lastError = String(err?.message || err).slice(0, 200);
  status.lastErrorAt = new Date().toISOString();
  console.warn(`  ⚠ durable store: ${status.lastError}`);
}

/**
 * Pull every key down to disk. Must finish before any module reads state.
 *
 * On failure nothing is pushed until a later hydrate succeeds — pushing the
 * seed-only state a fresh boot starts from would overwrite a month of good
 * remote history with the very loss this exists to prevent.
 */
export async function hydrate() {
  if (!DURABLE_ENABLED) return getDurableStatus();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // One round trip for all four: this runs while the service is waking and
    // a visitor is waiting for the page.
    const names = Object.keys(FILES);
    const vals = await redis(['MGET', ...names.map(n => PREFIX + n)]);
    for (let i = 0; i < names.length; i++) {
      const name = names[i], val = vals?.[i];
      if (val == null) { status.restored[name] = 0; continue; }
      const json = Buffer.from(JSON.stringify(decode(val)), 'utf8');
      fs.writeFileSync(fileOf(name), json);
      lastHash[name] = hash(json);
      status.restored[name] = json.length;
    }
    status.hydrated = true;
    status.hydratedAt = new Date().toISOString();
    const kept = Object.entries(status.restored).filter(([, b]) => b).map(([n]) => n);
    console.log(`  ✓ durable store: restored ${kept.length ? kept.join(', ') : 'nothing yet (first run)'}`);
  } catch (err) {
    noteError(err);
  }
  return getDurableStatus();
}

/**
 * Push whatever changed. Safe to call often; does nothing when nothing moved.
 * A call made while a flush is running waits for that one rather than being
 * dropped — at shutdown, dropping it would lose exactly the last minute.
 */
export function flushDurable() {
  if (!DURABLE_ENABLED) return Promise.resolve();
  if (!inFlight) inFlight = doFlush().finally(() => { inFlight = null; });
  return inFlight;
}

async function doFlush() {
  try {
    if (!status.hydrated) {
      await hydrate();
      if (!status.hydrated) return;   // still unreachable — keep remote untouched
    }

    // The log first, merged. Anything another writer put there in the
    // meantime is folded in under the same rules as every other door.
    flushSignalLog();
    let local = readFile('signal-log');
    if (local && hash(local) !== lastHash['signal-log']) {
      const remote = await redis(['GET', PREFIX + 'signal-log']);
      if (remote != null) {
        const incoming = decode(remote);
        if (Array.isArray(incoming)) mergeSignals(incoming);
        flushSignalLog();
        local = readFile('signal-log');
      }
      await redis(['SET', PREFIX + 'signal-log', encode(JSON.parse(local.toString('utf8')))]);
      lastHash['signal-log'] = hash(local);
      status.pushes++;
    }

    for (const name of Object.keys(FILES)) {
      if (name === 'signal-log') continue;
      const buf = readFile(name);
      if (!buf) continue;
      const h = hash(buf);
      if (h === lastHash[name]) continue;
      let parsed;
      try { parsed = JSON.parse(buf.toString('utf8')); } catch { continue; }   // mid-write; next pass
      await redis(['SET', PREFIX + name, encode(parsed)]);
      lastHash[name] = h;
      status.pushes++;
    }
    status.lastPushAt = new Date().toISOString();
  } catch (err) {
    noteError(err);
  }
}

let timer = null;
export function startDurableSync(intervalMs = 60_000) {
  if (!DURABLE_ENABLED || timer) return;
  timer = setInterval(() => { flushDurable(); }, intervalMs);
}

export function getDurableStatus() {
  return {
    configured: DURABLE_CONFIGURED,
    onRender: ON_RENDER,
    enabled: DURABLE_ENABLED,
    hydrated: status.hydrated,
    hydratedAt: status.hydratedAt,
    restored: status.restored,
    lastPushAt: status.lastPushAt,
    pushes: status.pushes,
    lastError: status.lastError,
    lastErrorAt: status.lastErrorAt
  };
}
