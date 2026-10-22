# Kaizen 改善

Anime list manager and player for Windows. Browse the AniList catalog, stream episodes on demand
(no full download), pick the audio and subtitle track Netflix-style, and use the whole interface in
Portuguese (Brazil) or English.

Created by **Gabriel (Snoopyzin)** - [GitHub](https://github.com/Snoopyzin) -
[Instagram @gabriel.arm_](https://www.instagram.com/gabriel.arm_/)

## Download

**[Get the Windows installer (latest release)](https://github.com/Snoopyzin/Kaizen-animes/releases/latest)**:
under "Assets" download `Kaizen-Setup-...exe` and run it. The installer is not digitally signed yet, so
Windows SmartScreen may warn: click "More info", then "Run anyway".
(Em português: na página acima, em "Assets", baixe o `.exe` e execute; se o Windows avisar, "Mais
informações" e "Executar assim mesmo".) The installer is not part of the source code zip: it is a release file.

## Features

- Catalog, search and your AniList list (sign in with AniList).
- On-demand streaming over BitTorrent (WebTorrent): only the parts you watch are downloaded; downloading
  the whole episode is optional.
- Audio and subtitle menu: any audio track, any subtitle track, automatic Portuguese subtitles
  (machine translation of the English ones) and subtitle sync.
- Long series are split by season / arc (One Piece and similar), with a quality filter (720p, 1080p, 4K).
- Portuguese / English interface, asked at every launch.
- Optional pieces, off or inert by default:
  - account + subscription portal, with a one-time "follow me on Instagram" screen (`VITE_KAIZEN_AUTH`,
    `VITE_KAIZEN_FOLLOW_GATE`). The portal server is a **separate, private project** and is not part of
    this repository;
  - "Biblioteca": movies and series from your own Jellyfin server (`VITE_KAIZEN_LIBRARY=true`, experimental).

## Build and run

Needs Node.js 20+ on Windows.

    npm install --ignore-scripts
    node node_modules/electron/install.js
    cd node_modules/node-datachannel && npx prebuild-install -r napi && cd ../..
    npm run dev            # development
    npm test               # unit tests
    npm run build:win      # Windows installer (dist/)

- **ffmpeg / ffprobe**: the app bundles them for subtitle extraction and audio conversion. The binaries are
  not in this repository (they are over GitHub's 100 MB file limit). Download a Windows build and put
  `ffmpeg.exe` and `ffprobe.exe` in `vendor/ffmpeg/` before `npm run build:win`; `npm run dev` also works
  with ffmpeg on the PATH. See `vendor/ffmpeg/PLACE-BINARIES-HERE.md`.
- In VS Code's terminal clear `ELECTRON_RUN_AS_NODE` before `npm run dev`.
- Build-time switches live in `.env.example` (`VITE_KAIZEN_AUTH`, `VITE_KAIZEN_SERVER`,
  `VITE_KAIZEN_FOLLOW_GATE`, `VITE_KAIZEN_LIBRARY`).

## Configuration worth knowing

`Documents/Kaizen/settings.json` (created by the app; it stays on your machine and is never part of the repo):

- `deeplApiKey` - optional DeepL key for reliable automatic subtitle translation.
- `discordClientId` - your own Discord application id; Rich Presence stays off without it.

The AniList login uses Kaizen's own AniList API client (its id is public, in
`src/renderer/src/utils/auth.js`, redirect URL `kaizen://anilistauthcallback`). If you fork the project,
create your own client at https://anilist.co/settings/developer and replace `ANILIST_CLIENT_ID`. The client
secret is not needed: the login uses the implicit flow.

## License and credits

Kaizen is free software under the **GNU General Public License v3.0** (see `LICENSE`).


Anyone who receives a copy of the app can get its complete source code from this repository.

## Disclaimer

Kaizen is a client application. It does not host, store or distribute any media and is not affiliated with
AniList, AnimeTosho or any content owner. What you watch, and where it comes from, is your responsibility:
follow the laws of your country and the terms of the services you use.

## Em português

Kaizen é um gerenciador e player de animes para Windows: catálogo do AniList, streaming sob demanda (sem
baixar tudo), menu de áudio e legenda estilo Netflix, legendas em português e interface em português ou
inglês. Para compilar, veja "Build and run" acima. O código é GPLv3; o Kaizen é baseado no Zenshin
(hitarth-gg), e o crédito original é mantido conforme a licença.
