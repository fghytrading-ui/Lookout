// Refresh the shipped record (backend/data/seed/signal-log.json).
//
// The deployed server has no persistent disk, so it boots from this file.
// Run it after a stretch of local tracking to carry the newly resolved
// outcomes over to the live site:  npm run snapshot
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir  = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const live = path.join(dir, 'signal-log.json');
const seed = path.join(dir, 'seed', 'signal-log.json');

if (!fs.existsSync(live)) {
  console.error('No signal log to snapshot.');
  process.exit(1);
}

const records = JSON.parse(fs.readFileSync(live, 'utf-8'));
const before  = fs.existsSync(seed) ? JSON.parse(fs.readFileSync(seed, 'utf-8')).length : 0;
const closed  = records.filter(s => s.status === 'CLOSED').length;

fs.mkdirSync(path.dirname(seed), { recursive: true });
fs.writeFileSync(seed, JSON.stringify(records));

console.log(`Snapshot: ${records.length} signals (${closed} resolved), was ${before}.`);
console.log('Commit backend/data/seed/signal-log.json to carry it to the live site.');
