// Makes certs/cert.pem + certs/key.pem for HTTPS on this laptop's LAN address(es).
// Uses mkcert if installed (trusted, best), otherwise openssl (self-signed: the phone shows a warning once).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanAddresses } from '../src/net.js';

const dir = fileURLToPath(new URL('../certs', import.meta.url));
fs.mkdirSync(dir, { recursive: true });
const cert = path.join(dir, 'cert.pem'), key = path.join(dir, 'key.pem');
const names = ['localhost', '127.0.0.1', ...lanAddresses()];
const has = cmd => spawnSync(cmd, ['-help'], { stdio: 'ignore' }).error === undefined;

if (has('mkcert')) {
  const r = spawnSync('mkcert', ['-key-file', key, '-cert-file', cert, ...names], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  const caroot = spawnSync('mkcert', ['-CAROOT'], { encoding: 'utf8' }).stdout.trim();
  console.log(`
Done (mkcert) for: ${names.join(', ')}
Trust it on your iPhone once:
  1. Send ${path.join(caroot, 'rootCA.pem')} to the phone (AirDrop or email) and install the profile:
     Settings > General > VPN & Device Management.
  2. Settings > General > About > Certificate Trust Settings > turn on the mkcert root.
Android: Settings > Security > Encryption & credentials > Install a certificate > CA certificate.
Restart the server (npm start).`);
} else if (has('openssl')) {
  const san = names.map(n => (/^[\d.]+$/.test(n) ? `IP:${n}` : `DNS:${n}`)).join(',');
  const r = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
    '-keyout', key, '-out', cert, '-subj', '/CN=PolySpot local',
    '-addext', `subjectAltName=${san}`, '-addext', 'extendedKeyUsage=serverAuth',
  ], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log(`
Done (self-signed, openssl) for: ${names.join(', ')}
Restart the server (npm start) and open the https:// address it prints.
The phone warns that the connection is not private: tap Show Details > visit this website (iPhone)
or Advanced > Proceed (Android). If the compass is still blocked, install mkcert and run this again.`);
} else {
  console.error('Neither mkcert nor openssl was found. Install mkcert (https://github.com/FiloSottile/mkcert) and run `npm run cert` again.');
  process.exit(1);
}
if (lanAddresses().length === 0) console.warn('\nNo LAN address found: connect to Wi-Fi and re-run so the phone address is included.');
