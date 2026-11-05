# Third-party notices

PolySpot's own code is MIT-licensed (see `LICENSE`). It includes or uses the components and online services below. Each keeps its own license or terms. The app shows this list under **Home → About & licenses**.

This is a good-faith summary for a personal, non-commercial project, not legal advice. Check each provider's current terms before you make the app public, add ads, charge money, or have many users.

## Bundled code

| Component | Version | License | Where |
|---|---|---|---|
| [Leaflet](https://leafletjs.com) | 1.9.4 | BSD 2-Clause. © 2010–2023 Volodymyr Agafonkin, © 2010–2011 CloudMade | `public/vendor/leaflet/` (full text: `public/vendor/leaflet/LICENSE`) |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | – | MIT. © 2009 Kazuhiko Arase | `public/vendor/qrcode.js` (full text: `public/vendor/qrcode-generator.LICENSE`) |

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

## Map imagery and map data (loaded over the internet)

| Service | Used for | Terms in short | Credit shown in the app |
|---|---|---|---|
| **USGS The National Map, "USGSImageryOnly"** (`basemap.nationalmap.gov`) | Default satellite layer on the campus map | U.S. government imagery, mostly USDA NAIP. The service lists no use constraints and asks that the agencies be credited. | "Imagery: USDA, USGS The National Map" |
| **Esri World Imagery** (`ibasemaps-api.arcgis.com`), *optional* | Sharper satellite layer, **only if you set `ESRI_API_KEY`** | Requires an ArcGIS Location Platform account and API key (free tier available). Use is subject to Esri's terms and your plan's limits. | "Powered by Esri \| Esri, Maxar, Earthstar Geographics, and the GIS User Community" |
| **OpenStreetMap tiles** (`tile.openstreetmap.org`) | "Street map (OSM)" layer | [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/): visible attribution, normal browser use only, no bulk or offline downloading, and heavy use needs another provider. | "© OpenStreetMap contributors" |
| **OpenStreetMap data via Overpass API** (`overpass-api.de`, `overpass.kumi.systems`) | Building and place names on the campus map | Data © OpenStreetMap contributors, licensed under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/). The public Overpass servers are fair use, and PolySpot only queries on first start or when you tap Import. | "Building names © OpenStreetMap contributors (ODbL)" |

### What this means for you
- **Keep the credits visible.** The map's attribution corner shows them automatically, so don't hide it with CSS.
- **Building names in `data/db.json` are ODbL data.** Using them in the app is fine. If you publish or share that data, or a database built from it, you must credit OpenStreetMap and offer it under the ODbL ([details](https://www.openstreetmap.org/copyright)). The repository doesn't include this data: `data/` is git-ignored and the seed has no OpenStreetMap names.
- **No offline tile caching from these servers.** To make the campus map work offline, use imagery you're allowed to download, such as the USGS/NAIP downloads, or a provider that sells offline packages.
- **Going public or commercial:** the OpenStreetMap tile servers aren't meant for apps with many users, and Esri's free tier has limits and terms. Switch to a paid tile provider or your own tiles first.

## Names and trademarks
- **Cal Poly Pomona:** the name describes where the game is played. PolySpot is an independent student project. It is **not affiliated with, sponsored by, or endorsed by** California State Polytechnic University, Pomona or the California State University, and it uses no university logos or marks.
- **GeoGuessr:** the game is inspired by photo-location guessing games. PolySpot is not affiliated with GeoGuessr AB, and it uses none of its code, art or content.

## Photos
- The sample photo `seed/photos/sample-dorm.jpg` is an original computer rendering made for this project and is covered by `LICENSE`.
- Photos you upload stay on your laptop (`data/photos/`). You're responsible for having the right to use them; see "Photos and privacy" in the README.
