// Local storage: one JSON file (data/db.json) plus photo files (data/photos/). No database needed.
import fs from 'node:fs';
import path from 'node:path';

/** Today's date in the server's local time zone, as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Opens (or creates and seeds) the data directory.
 * Seed rounds whose date is "today" get the current date, so the sample is playable as today's round.
 */
export function openStore(dataDir, seedDir) {
  const file = path.join(dataDir, 'db.json');
  const photosDir = path.join(dataDir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });

  const write = data => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file); // atomic: a crash mid-write never leaves a half-written db.json
  };

  let db;
  if (fs.existsSync(file)) {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    db = JSON.parse(fs.readFileSync(path.join(seedDir, 'db.json'), 'utf8'));
    const seedPhotos = path.join(seedDir, 'photos');
    if (fs.existsSync(seedPhotos)) {
      for (const f of fs.readdirSync(seedPhotos)) fs.copyFileSync(path.join(seedPhotos, f), path.join(photosDir, f));
    }
    for (const r of db.rounds || []) if (r.date === 'today') r.date = localDate();
    write(db);
  }
  db.maps ??= [];
  db.rounds ??= [];
  db.guesses ??= [];

  // Maps added to the seed later (e.g. the campus map) are added to existing data too, in seed order.
  const seedMaps = JSON.parse(fs.readFileSync(path.join(seedDir, 'db.json'), 'utf8')).maps || [];
  let added = false;
  seedMaps.forEach((m, i) => {
    if (!db.maps.some(x => x.id === m.id)) { db.maps.splice(i, 0, m); added = true; }
  });
  if (added) write(db);

  return { db, photosDir, save: () => write(db) };
}
