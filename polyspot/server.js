// Starts PolySpot on all network interfaces (0.0.0.0) so phones on the same Wi-Fi can open it.
// HTTP on PORT (default 3000). HTTPS on HTTPS_PORT (default 3443) too, if certs/cert.pem + certs/key.pem exist
// (`npm run cert` makes them); iPhones only allow the compass on HTTPS.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';
import { lanAddresses } from './src/net.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const CERT = process.env.HTTPS_CERT || path.join(ROOT, 'certs', 'cert.pem');
const KEY = process.env.HTTPS_KEY || path.join(ROOT, 'certs', 'key.pem');

const hasCerts = fs.existsSync(CERT) && fs.existsSync(KEY);
const ips = lanAddresses();
const urls = {
  http: ips.map(ip => `http://${ip}:${PORT}`),
  https: hasCerts ? ips.map(ip => `https://${ip}:${HTTPS_PORT}`) : [],
};

// Optional: free ArcGIS Location Platform API key for sharper Esri satellite imagery (see README → Legal).
const ESRI_API_KEY = process.env.ESRI_API_KEY || null;
const app = createApp({ dataDir: DATA_DIR, info: () => ({ urls, esriApiKey: ESRI_API_KEY }) });

const onError = port => err => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try: PORT=3001 npm start` : err);
  process.exit(1);
};

http.createServer(app).on('error', onError(PORT)).listen(PORT, HOST, () => {
  const lines = [
    '',
    '  PolySpot is running',
    '',
    `  On this laptop:   http://localhost:${PORT}`,
    ...urls.http.map((u, i) => `  ${i ? '                  ' : 'On your phone:    '}${u}   (same Wi-Fi)`),
  ];
  if (!urls.http.length) lines.push('  On your phone:    no network found - connect the laptop to Wi-Fi and restart');
  if (hasCerts) {
    lines.push('', `  HTTPS (for the iPhone compass): https://localhost:${HTTPS_PORT}`);
    urls.https.forEach(u => lines.push(`                                  ${u}`));
  } else {
    lines.push('', '  Phone compass on iPhone needs HTTPS: run `npm run cert`, then restart (see README).');
  }
  lines.push('', `  Data: ${DATA_DIR}`, '');
  console.log(lines.join('\n'));
  app.autoImportOsm(); // campus building names from OpenStreetMap, first run only
});

if (hasCerts) {
  https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }, app)
    .on('error', onError(HTTPS_PORT))
    .listen(HTTPS_PORT, HOST);
}
