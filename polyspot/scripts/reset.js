// Deletes all local data (maps, rounds, photos, guesses). The next `npm start` re-creates the sample data.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url)));
if (!fs.existsSync(dataDir)) {
  console.log(`Nothing to reset (${dataDir} does not exist).`);
  process.exit(0);
}
if (!process.argv.includes('--yes')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Delete everything in ${dataDir}? Type "yes": `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') process.exit(1);
}
fs.rmSync(dataDir, { recursive: true, force: true });
console.log('Deleted. Restart the server to load the sample data again.');
