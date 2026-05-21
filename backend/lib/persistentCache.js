// Persistent file-based cache — survives server restarts.
// Saves all caches to disk every 30s, restores on startup.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', '.cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const registry = new Map(); // name → Map cache reference

export function registerCache(name, mapInstance) {
  registry.set(name, mapInstance);
  // Try to restore from disk on registration
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      let restored = 0;
      for (const [key, entry] of Object.entries(data)) {
        mapInstance.set(key, entry);
        restored++;
      }
      console.log(`  ✓ Restored ${restored} entries to ${name} cache`);
    } catch (e) {
      console.warn(`  ⚠ Failed to restore ${name} cache:`, e.message);
    }
  }
}

export function persistAll() {
  for (const [name, map] of registry.entries()) {
    const file = path.join(CACHE_DIR, `${name}.json`);
    try {
      const obj = Object.fromEntries(map);
      fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
    } catch (e) {
      console.warn(`  ⚠ Failed to persist ${name} cache:`, e.message);
    }
  }
}

// Auto-persist every 30 seconds
let persistTimer = null;
export function startAutoPersist(intervalMs = 30_000) {
  if (persistTimer) return;
  persistTimer = setInterval(persistAll, intervalMs);
  // Persist on graceful shutdown
  process.on('SIGINT',  () => { persistAll(); process.exit(0); });
  process.on('SIGTERM', () => { persistAll(); process.exit(0); });
}
