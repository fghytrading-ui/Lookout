// Client-side mirror of the server's signal log.
//
// WHY THIS EXISTS: the app runs on Render's free tier, which uses an ephemeral
// filesystem — the disk is wiped on every restart, and the service sleeps after
// ~15 minutes of inactivity. Without a mirror, the learning system loses its
// entire history every few hours and can never accumulate enough closed signals
// to tune anything.
//
// HOW IT WORKS:
//   1. Whenever the Performance page loads, we pull the server's full log and
//      merge it into localStorage (client keeps the superset).
//   2. If the server's log is SMALLER than ours, its disk was wiped — we POST
//      our mirror back so the server recovers its history.
//   3. Merge is by record id; CLOSED records always win over OPEN ones.

const KEY = 'lookout-signal-log-backup';
const META_KEY = 'lookout-signal-log-meta';

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeLocal(signals) {
  try {
    localStorage.setItem(KEY, JSON.stringify(signals));
    localStorage.setItem(META_KEY, JSON.stringify({
      size: signals.length,
      savedAt: Date.now()
    }));
    return true;
  } catch (err) {
    // Quota exceeded — drop oldest half and retry once
    try {
      const trimmed = [...signals]
        .sort((a, b) => (b.signaledAt || 0) - (a.signaledAt || 0))
        .slice(0, Math.floor(signals.length / 2));
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return true;
    } catch { return false; }
  }
}

// Merge two record arrays by id. CLOSED beats OPEN; otherwise newest lastSeenAt.
function merge(a, b) {
  const map = new Map();
  for (const rec of [...a, ...b]) {
    if (!rec?.id) continue;
    const existing = map.get(rec.id);
    if (!existing) { map.set(rec.id, rec); continue; }
    if (existing.status !== 'CLOSED' && rec.status === 'CLOSED') {
      map.set(rec.id, rec);
    } else if (existing.status === rec.status &&
               (rec.lastSeenAt || 0) > (existing.lastSeenAt || 0)) {
      map.set(rec.id, rec);
    }
  }
  return [...map.values()];
}

export function getBackupMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); }
  catch { return null; }
}

// Runs on Performance page load. Returns a status object for the UI.
export async function syncSignalBackup() {
  const local = readLocal();

  // Cheap size probe first
  let serverSize = null;
  try {
    const r = await fetch('/api/performance/size');
    serverSize = (await r.json())?.size ?? null;
  } catch { /* offline — keep local mirror as-is */ }

  if (serverSize == null) {
    return { status: 'offline', localSize: local.length };
  }

  // Server has fewer records than our mirror → its disk was wiped. Restore it.
  if (local.length > serverSize) {
    try {
      const r = await fetch('/api/performance/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(local)
      });
      const result = await r.json();
      return {
        status: 'restored',
        restored: result.added || 0,
        localSize: local.length,
        serverSize: result.total ?? serverSize
      };
    } catch {
      return { status: 'restore-failed', localSize: local.length, serverSize };
    }
  }

  // Otherwise pull the server's log down and refresh our mirror
  try {
    const r = await fetch('/api/performance/raw');
    const remote = await r.json();
    if (Array.isArray(remote)) {
      const merged = merge(local, remote);
      writeLocal(merged);
      return {
        status: 'synced',
        localSize: merged.length,
        serverSize,
        newFromServer: merged.length - local.length
      };
    }
  } catch { /* fall through */ }

  return { status: 'unchanged', localSize: local.length, serverSize };
}
