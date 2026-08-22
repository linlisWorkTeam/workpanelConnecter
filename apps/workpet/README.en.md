# WorkPet Live2D desktop pet (`apps/workpet`)

[English](README.en.md) · [简体中文](README.md)

WorkPet is the WorkPanel desktop entry point: a transparent, always-on-top character with an expandable chat panel. It supports Live2D Cubism by default and state-sprite fallback assets for `idle`, `thinking`, `speaking`, and `error`.

WorkPet connects only to its bound Site Connecter under `/v1/*`. It does not connect directly to Connecter Host or WorkPanel.

```text
WorkPet ──bound to──► Connecter (:80 nginx → :9080) ──► WorkPanel in the site
                              │
                              ▼  (only cross-site messages use Host)
                         Connecter Host
```

## Desktop configuration

1. Copy `config.example.json` to `~/.workpet/config.json`;
2. Set `connecterBaseUrl` to the Connecter bound to this WorkPet, normally `http://127.0.0.1:9080` for local development;
3. Keep `preferLocalConnecter: true` unless a reviewed non-local setup is required;
4. Set `token` to the matching `pets[].token` from the Connecter's `relay.json`;
5. Set `env`, `group`, and `agent` to an existing binding;
6. Set `live2d.modelUrl` to a local `.model3.json` when using a custom model.

The default configuration targets `canary`; do not point a desktop pet at `prod` without an explicit review. Cross-site delivery is handled by the Site Connecter and Host federation, not by connecting the pet to Host.

Optional homepage announcement fields are `xiaoaiAnnounce`, `homepageBaseUrl`, and `homepagePetToken`. They are independent of Connecter federation and must not contain real secrets in committed files.

## Build and run

Tauri packages must be built on the target operating system. Windows packages require Windows; macOS packages require macOS.

```bash
cd apps/workpet
npm install
npm run test:ui
npm run dev
npm run build
```

Windows release output:

```text
src-tauri/target/release/bundle/nsis/WorkPet_<version>_x64-setup.exe
```

From the repository root, `npm run build:windows` builds the WorkPet installer, the standalone Connecter package, and `SHA256SUMS.txt`.

Build prerequisites include VS Build Tools with the WebView2 SDK on Windows, Xcode Command Line Tools on macOS, and the required WebKit/AppIndicator packages on Linux.

Without `~/.workpet/config.json`, the character can still run in pet-only mode, but chat is not connected to a backend.

## User interactions

- Right-click the character to switch between Live2D and state-sprite modes or manage models and skins;
- State-sprite customization uses four local assets; WorkPet does not call an image-generation API;
- Click the character for an interaction and the chat button to open the panel;
- `A−`/`A+` or `Ctrl+-`/`Ctrl++` changes the local pet scale between 75% and 150%;
- Sending a message calls `POST /v1/chat` and polls the run result;
- The open panel polls `GET /v1/messages?since=` every two seconds;
- Drag the top handle to move the window and use the collapse button to return to pet-only mode.

Live2D asset licenses and acceptance criteria are documented in [`docs/workpet-live2d-design.md`](../../docs/workpet-live2d-design.md). Review the actual Cubism, framework, and model licenses before distribution. The default development model is Hiyori from the official Live2D Cubism Web Samples; replace it with an appropriately licensed model for production.

## Gate

```bash
npm run test:workpet
```

This gate talks to the configured canary relay and may send a real message and trigger a real Agent run. Run it only when that side effect is intended.
