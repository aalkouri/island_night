# Island Night — Handoff for AI coding assistants

Read this first. It explains what the game is, how the code is laid out, how it ships, and the working rules the owner expects.

## 1. What it is

**Island Night** is a co-op (up to 8 players) top-down survival game for phones and browsers. Players chop trees, mine rocks, pick berries, keep a campfire fuelled, craft gear and walls, sail between islands, and survive nightly waves of aliens, wolves, raiders and other creatures. There is a persistent account (diamonds, unlocked classes, per-class XP/levels) and one saved game per account.

- Repo: `github.com/aalkouri/island_night` (the local folder is named `girl_game`; same repo).
- Live site: `https://island.alkouri.com`
- Android app: a Capacitor shell, package `com.alkouri.islandnight` (see `mobile/`).
- Stack: plain Node.js + `ws` server, vanilla JS client rendered with PixiJS 7 (loaded from CDN). **No build step, no framework, no bundler, no TypeScript, no test suite.**

## 2. Working rules (from the owner — follow these)

1. **Commit and push to `main` after every change**, without asking. A push to `main` goes live within about a minute (see §7), so keep `server.js` and `auth.js` syntactically valid.
2. **Checks are headless only**: run `node --check` on the files you changed (and optionally start the server briefly to check it boots). Don't open browsers to playtest. The owner tests in the game.
3. **Never put the test-account emails in the repo.** Accounts with unlimited resources are listed in the server's private `config.json` (`infiniteEmails`) or the `INFINITE_EMAILS` env var. Those files live only on the server.
4. Commit messages in this repo are one plain-English sentence describing the player-visible change (e.g. "Polar bears have half the health (1000 -> 500)"). Copy that style.
5. Code style is dense: long single lines, short names, and an explanatory `//` comment at the end of the line. Match it rather than reformatting, because reformatting makes diffs unreadable.

## 3. Files

| Path | Lines | What it does |
|---|---|---|
| `server.js` | ~1900 | **The whole game simulation** (authoritative): HTTP static server + `/api/*`, WebSocket protocol, `class Room` (the world, AI, combat, crafting, boats, saving), 30 Hz tick loop. |
| `auth.js` | ~120 | Accounts: emailed one-time codes (AWS SES v2 via `@aws-sdk/client-sesv2`), Google and Apple sign-in. Sessions are random tokens; only their SHA-256 is stored. |
| `public/index.html` | ~160 | Menus, sign-in, HUD markup and CSS. Loads scripts in this order: pixi (CDN), `classes.js`, `recipes.js`, `audio.js`, `sprites.js`, `game.js`, `extras.js`, `map.js`. |
| `public/game.js` | ~2000 | Client: procedural textures (ground, effects, and the fallback art for everything that has a sprite), PixiJS renderer (water shader, lighting, particles), networking, input (touch joystick + keyboard/mouse), HUD, menus. |
| `public/extras.js` | ~460 | Client add-ons for outer islands: loot areas, chests, traders, placeable campfires, bullets/zones/turrets, trader menu, ability button, item slots. `game.js` calls its `x*` hooks. |
| `public/map.js` | ~140 | Map overlay (button or M): fog of war remembered per room in `localStorage`, zoom/pan. |
| `public/audio.js` | ~140 | All sound is procedural Web Audio (no audio files). `SFX.init()` must run from a user gesture. |
| `public/classes.js` | ~70 | **Shared** (server and client) class list: stats, prices in diamonds, looks, abilities, level/XP curve (`GC`). |
| `public/recipes.js` | ~110 | **Shared** crafting recipes, structure radii, camp-size formula, island shape function (`RC`). The server enforces costs; the client draws menus. |
| `public/sprites.js` | ~190 | Client: loads the pictures in `public/sprites/` and shows them in place of the code-drawn art (see §5a). `game.js` and `extras.js` call its `SPR.*` hooks. |
| `public/sprites/*.webp` | | 140 in-game sprites (about 1.2 MB): creatures and the 20 classes as `<name>_front` / `_side` / `_back`, plus structures, resources, boats and tools. |
| `public/ui/*.webp/png` | | Menu art (backgrounds, buttons, icons). |
| `public/privacy.html`, `public/delete-account.html` | | Store-required pages served by the game server. |
| `mobile/` | | Capacitor Android app. `prepare-web.js` copies `public/` into `mobile/www` and injects `window.GAME_BASE` (the server URL from `game-url.txt` or `GAME_URL`) and `window.IN_APP=true`. See `mobile/README.md` and `mobile/store/STORE.md`. |
| `.github/workflows/android.yml` | | Manual or `android-v*` tag: builds a debug APK, plus a signed `.aab` when the signing secrets exist. |
| `deploy/README.md` | | How the server deploy works (summarised in §7). |
| `.claude/launch.json` | | Local dev server config (port 8317). |
| `o23.txt` | | A stray error log from an old test run. Not used; safe to delete. |

`classes.js` and `recipes.js` use a UMD wrapper, so the same file works with `require()` on the server and as `window.GC` / `window.RC` in the browser. **Anything that must agree between server and client belongs in these two files.**

## 4. Running locally

```
npm install
PORT=8080 node server.js        # PowerShell: $env:PORT=8080; node server.js
```
Open `http://localhost:8080`. The default port is 80 if `PORT` is unset.

Data directory: the first writable one of `$DATA_DIR`, `/var/lib/island-night`, `./data`. It holds:
- `profiles.json`: accounts keyed by lower-case email: `d` diamonds, `owned` classes, `xp` per class, `last` class, `abil`, `save` metadata
- `sessions.json`: hashed session tokens (auth.js)
- `rooms.json`: running rooms, so they survive a restart (written every 5 s and on SIGTERM/SIGINT)
- `saves/`: one gzipped save per account
- `config.json` (**private, never commit**): `googleClientId`, `appleClientId`, `mailMode`, `mailFrom`, `infiniteEmails`

Env overrides: `GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID`, `MAIL_MODE`, `MAIL_FROM`, `INFINITE_EMAILS`, `ROOM_IDLE_SEC`.

**Test hooks** (env vars that change the starting state, for local testing only): `START_C`, `START_N` (cycle time and night), `START_WOOD/STONE/FOOD/SCRAP/MEAT`, `START_GUNS`, `START_ABIL`, `START_BENCH`, `START_TRADER=<n>`, `START_ISL=<n>`, `START_OWNALL`, `START_SCRAPFOUND`, `START_BREAKALL`, `DEBUG_ACT`.

Syntax check before pushing:
```
node --check server.js && node --check auth.js && for f in public/*.js; do node --check "$f"; done
```

## 5. Architecture

**The server is authoritative.** Clients send only input and requests; the server simulates everything and sends state snapshots.

- `setInterval` at 30 Hz calls `room.tick(1/30)` for every room. Every 2nd tick (15 Hz) it sends `room.snap()`, a per-player snapshot, to each player.
- Rooms have 4-letter codes (`A–Z` without I/O). An empty room is deleted after `ROOM_IDLE_SEC` (20 min). A room is deleted when everyone is down (`endRun` pays diamonds by days survived and sends game-over screens).
- The day cycle: `DAY 90 s + DUSK 30 s + NIGHT 60 s`. `room.c` is the time in the cycle and `room.night` is the night number. Difficulty scales about +4% per night.
- World: island 0 is home (radius `R = 3600`, forest). Outer islands are generated from a seeded RNG on the room code (`genIslands`), each with a biome (forest/snow/desert/lava…). Then `genLoot`, `genCabins`, `genLava`, `genVillages` run. **`MAP_VER` and `ISL_VER` versioning:** bump `ISL_VER` when you change island generation so saved rooms regenerate outer islands. Old map versions are kept (`genIslandsLegacy`) so old saves still load.
- Creatures exist only on islands with a player nearby (`ACT_R`, `VIL_ACT`) and are not saved.
- Pathing: enemies use a distance field over the wall grid (`pathField`/`pathStep`). An enemy blocked for `BLOCK_SEC` attacks the nearest wall/gate for `WALL_SEC`. Cabin doors behave like breakable gates.
- Balance constants are grouped near the top of `server.js` (lines ~147–435): `WOLF`, `BIG` (bear/mammoth), `MOBS`, `CRIT`, `CHARGER`, `STA` (stamina), `REVIVE`, `VEND` (traveling vendor), `KILL_XP`, `HP` (hits per resource), `STRUCT` (structure HP), etc. Most tuning requests are a one-number change there, or in `classes.js` / `recipes.js`.

### 5a. Sprites (client only)

Most in-game art is a WebP sprite from `public/sprites/`; the code-drawn version in `game.js` / `extras.js` is still built first and stays on screen until the sprite has loaded, or if it is missing. Adding `?nosprites` to the address turns the sprites off. Nothing here touches the server or the protocol.

- **Creatures and players are not turned by their heading.** `SPR.step` picks a picture from the entity's facing (`e.ang`): down = `_front`, up = `_back`, sideways = `_side` (drawn facing left, mirrored for right). Walking is animated in code (bob, tilt, squash; the rabbit hops, the alien hovers); standing still is a slow breathing bob. The table `CRE` in `sprites.js` has each creature's height on screen, where its feet stand, its walk style and where its night eye-glows sit.
- **Seen from above, still turning with the heading:** scorpion, salamander, vulture and the rowing boat. The sloop and galleon are side-on pictures that only mirror left/right.
- **Players:** one sprite set per class (`cls_<id>_*`), drawn empty-handed. The class's tool (the code-drawn `FRONTS` item) or the selected pistol/rifle is a separate picture placed at the hand, tucked behind the body in the back view. Swing tools (axe, pick, sword, spear) are sprites turned so the handle runs along +x. Crafted armour is not shown.
- **Structures:** bench, chest, pot, smelter and spike strip always face the camera; walls and gates still turn in 45° steps. A gate is two gate pictures side by side (there is only a wooden one: rock and metal gates are tinted). Cabin doors/walls, the trap, loot chests, turrets, sharks, drops other than meat, village fires and all effects are still code-drawn.
- **Fire:** the campfire, pot and smelter pictures are unlit; flames, glow and smoke are still drawn in code on top.
- **Adding or replacing a sprite:** put a transparent WebP in `public/sprites/`, add its name to the lists at the top of `sprites.js`, and give it a size in the matching table (`CRE`, `RES`, `STR`, `BOATS`, `TOOLS`). The current files were cropped to their visible pixels and resized from 1024 px PNGs with ffmpeg (tools and the from-above creatures were also turned to point right).

### WebSocket protocol (JSON, `{t: type, ...}`; max payload 1 KB from the client)

Client → server: `join` (name, cls, room, token, load), `in` (input: dx, dy, act, hit, rn = run, aim), `craft`, `cook`, `use` (item slot), `abil`, `reload`, `wpn` (melee/pistol/rifle), `chest`, `smelt`, `dismantle`, `boat`, `trade`, `fishdone`, `save`, `quit`.
Most handlers have a per-player rate limit (`me.lastX`) and are wrapped in try/catch, so one bad message can't crash the server. Keep that pattern.

Server → client: `init` (full world on join), `s` (snapshot), plus events such as `toast`, `err`, `fx`, `crafted`, `cooked`, `traded`, `trader`, `saved`, `dia`, `xp`, `over`, `raid`, `fish`, `fishgame`, `loot`, `open`, `boatPlaced`, `abilUsed`, `trapped`.

### HTTP API (`server.js` ~lines 85–135)
`GET /api/config`; `POST /api/auth/email/start`, `/api/auth/email/verify`, `/api/auth/google`, `/api/auth/apple`, `/api/auth/session`, `/api/auth/logout`, `/api/account/delete`, `/api/profile`, `/api/buy` (buy a class with diamonds). Everything else is served as static files from `public/`.

### Saves and anti-save-scum rules (deliberate, don't loosen them by accident)
- One save per account. Loading a save consumes it (it can be loaded once).
- Losing the run deletes every account's saved copy of that game.
- Quitting to the menu more than 20 s of game time past your save deletes the save.
- Disconnecting at night or near enemies leaves your character in the world for `GHOST_SEC` (30 s).

## 6. Game content at a glance
- **Classes** (`classes.js`): 4 free (Forester, Marine, Radio Tech, Medic) and more bought with diamonds (Scout, Miner, Forager, Stoker, …). Each has a stat profile, and an ability unlocked through an in-world NPC (`useAbility` switch: timber, quake, grenade, meteor, inferno, volley, turret, totem, shadowstep, …). Levels go up to 99 per class and raise max stamina.
- **Resources**: wood, stone, food (berries), scrap, meat, gold, pelts, fish (3 kinds), ammo.
- **Building**: crafting bench (unlocks recipes), chest, cooking pot, smelter, walls/gates in wood/rock/metal, spikes, traps, extra campfires (camps grow with fire level), boats.
- **Enemies/creatures**: aliens (nightly waves), wolves/alphas, rabbits, boars, spitters, vultures, brutes, chargers, golems, bears, mammoths, penguins, scorpions, sharks, villagers/raiders and archers, lava-island cultists (mages and shield zealots).
- **World features**: traders and chests in loot areas, forest cabins with doors/rooms/furniture/windows, villages, a traveling vendor every 3rd day, fishing pools, map with fog.

## 7. Deploy (production)
- Server host alias: `games-server` (SSH). Runs as the `deploy` user; the game is installed in `/opt/game` as the systemd service `game` on port 3000, behind HTTPS at island.alkouri.com.
- A cron job runs every minute (`~/island-night-cron.sh` → `~/island-night-pull.sh`). When `main` has a new commit it downloads it, runs a syntax check on `server.js` and `auth.js`, backs up player data, installs, restarts, and **rolls back automatically** if the game doesn't answer within 40 s. Logs: `~/island-night-deploy/deploy.log`.
- Deploy right away: `ssh games-server 'bash ~/island-night-pull.sh'` (add `--force` to redeploy the same commit).
- A restart ends games in progress, but `rooms.json` restores running rooms and saves are kept.
- Client-only changes (files in `public/`) go live with the same deploy. The Android app bundles `public/` at build time, so app users only get client changes after a new APK/AAB build (`.github/workflows/android.yml`).

## 8. Gotchas
- `server.js` requires `public/classes.js` and `public/recipes.js`. A syntax error in either one breaks the server too, not just the client.
- Client and server both compute island shapes (`RC.shapeK`, `edgeJ` in `game.js`). If you change shape logic, change both and bump `ISL_VER`.
- Saved rooms come in two formats (`Room.fromSave` for v2 compact saves, `Room.restore` for old ones). New `Room` fields need defaults so old saves still load.
- `INFIGHT` (different species fight each other) is an experiment flag and is easy to turn off.
- The client talks to `window.GAME_BASE` when it runs inside the app, and to the same origin otherwise.

## 9. Recent direction (latest commits)
Shark fin/leap/dive animations; polar bears at half health (500); breakable cabin doors; the ability unlocker sells once; cabin window sunbeams; campfire level boosts healing/stamina; restyled sign-in screen; volcano cultists; new map version without small islands; weapon switching and ammo; traveling vendor; anti-save-scum rules. Use `git log --oneline` for the full history (≈165 commits, all descriptive).
