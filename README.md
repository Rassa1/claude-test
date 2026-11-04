# Shuttle Tracker (QR-based, no tracking hardware)

Crowd-sourced live shuttle tracker. Riders scan QR codes; nothing is installed on the shuttle.

- **Stop QR** (`/s/<stop>`): see the ETA, tap **"The shuttle is here"** or **"I'm waiting"**.
- **Shuttle QR** (`/b/<shuttle>`): riders tap the stop they're at, or opt in to share their phone's location while riding (auto-stops after 30 min).
- **Home** (`/`): all stops with ETAs, people waiting, nearest stop, recent reports.
- **Print signs** (`/qr`): printable QR signs for every stop and shuttle.

ETAs = last known position + configured drive times between stops. Reports expire after `staleAfterMinutes`.
Abuse limits: per-device/IP rate limits, one report per device per stop per few minutes, and arrival reports with location must be within 800 m of the stop.

## Setup
1. Edit `config.json`: your stops **in route order** with real lat/lng (right-click in Google Maps to copy), and `minsFromPrev` = minutes driving from the previous stop (first stop = minutes from the last stop back to it). Add shuttles if there's more than one.
2. Run locally: `node server.js` (Node 20+, no dependencies) → http://localhost:3000
3. Deploy anywhere that runs Node (Render, Railway, Fly.io, a school server). Set `PORT` if needed. Data is stored in `data/events.json` (`DATA_DIR` to change); only the last 24 h is kept.
4. Open `https://<your-site>/qr` and print. Post stop signs at stops, shuttle signs inside shuttles.

Optional: set `ADMIN_KEY` and `POST /api/reset?key=...` to clear all reports.

`public/qrcode.js` is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
