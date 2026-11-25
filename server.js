// Island Night - authoritative multiplayer server (Node + ws) with saved player profiles
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const GC = require('./public/classes.js');
const RC = require('./public/recipes.js');
const PORT = process.env.PORT || 80;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.webp': 'image/webp', '.png': 'image/png' };

// ---------- player profiles (no login: a secret random id stored in the player's browser) ----------
function pickDir() {
  for (const d of [process.env.DATA_DIR, '/var/lib/island-night', path.join(__dirname, 'data')]) {
    if (!d) continue;
    try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch (e) { }
  }
  return null;
}
const DIR = pickDir(), FILE = DIR && path.join(DIR, 'profiles.json');
let profiles = {}; try { profiles = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
let pcount = Object.keys(profiles).length, dirty = false;
function save() {
  if (!dirty || !FILE) return; dirty = false;
  try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(profiles)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.error('profile save failed:', e.message); }
}
let config = {}; try { config = JSON.parse(fs.readFileSync(path.join(DIR || '.', 'config.json'), 'utf8')); } catch (e) { }
if (process.env.GOOGLE_CLIENT_ID) config.googleClientId = process.env.GOOGLE_CLIENT_ID;
if (process.env.APPLE_CLIENT_ID) config.appleClientId = process.env.APPLE_CLIENT_ID;
if (process.env.MAIL_MODE) config.mailMode = process.env.MAIL_MODE;
if (process.env.MAIL_FROM) config.mailFrom = process.env.MAIL_FROM;
const auth = require('./auth.js')({ dir: DIR, config });
setInterval(() => { save(); auth.save(); }, 3000);
process.on('uncaughtException', e => console.error('uncaught:', e && e.stack || e));   // a bug in one message handler must not take the whole server (and everyone's game) down
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { save(); auth.save(); saveRooms(true); process.exit(0); });
// accounts are keyed by lower-case email. Old anonymous profiles (random 16-32 char ids) can be claimed once at sign-in.
const LEGACY = /^[A-Za-z0-9]{16,32}$/;
// test accounts with unlimited materials and diamonds: emails listed in the server's private config.json ("infiniteEmails")
// or the INFINITE_EMAILS env var (comma separated). Kept out of the repo on purpose.
const INFINITE = new Set([].concat(config.infiniteEmails || [], String(process.env.INFINITE_EMAILS || '').split(',')).map(e => String(e).trim().toLowerCase()).filter(Boolean));
const INF_N = 999, INF_D = 99999;
function acct(email, create) {
  if (!email) return null;
  let p = profiles[email];
  if (!p && create) { if (pcount > 200000) return null; p = profiles[email] = { d: 0, owned: [], k: 0, n: 0, last: 'forester', t: Date.now() }; pcount++; dirty = true; }
  if (p && INFINITE.has(email) && p.d < INF_D) { p.d = INF_D; dirty = true; }   // diamonds refill whenever the account is looked up (login, buying, joining)
  return p || null;
}
function claimLegacy(email, pid) {
  const p = acct(email, true), old = LEGACY.test(pid || '') ? profiles[pid] : null;
  if (!p || !old || (p.d || p.owned.length || p.n)) return;
  Object.assign(p, { d: old.d, owned: old.owned.slice(), k: old.k, n: old.n, last: old.last });
  delete profiles[pid]; pcount--; dirty = true;
}
const ownedOf = p => GC.DEFAULT_OWNED.concat(p ? p.owned : []);
const view = p => ({ save: p && p.save ? { at: p.save.at, n: p.save.n, bytes: p.save.bytes, gz: p.save.gz } : null, abil: p && p.abil ? Object.keys(p.abil) : [], d: p ? p.d : 0, owned: ownedOf(p), last: p && ownedOf(p).includes(p.last) ? p.last : 'forester', n: p ? p.n : 0, bn: p ? p.bn || 0 : 0, xp: p && p.xp ? p.xp : {} });
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
function award(pl, amount, why) {
  if (!pl.prof) return;
  const n = Math.max(1, Math.round(amount * GC.BY[pl.cls].dia));
  pl.prof.d += n; dirty = true; send(pl.ws, { t: 'dia', n, d: pl.prof.d, why });
  pl.runBy = pl.runBy || {}; pl.runBy[why] = (pl.runBy[why] || 0) + n;   // where this run's gems came from (for the game-over screen)
}

// ---------- levels: XP is earned per class (nights survived + kills); level 99 is the cap ----------
const KILL_XP = { rabbit: 1, scorpion: 1, penguin: 1, sal: 1, alien: 3, wolf: 4, imp: 5, villager: 5, mage: 12, zealot: 22, boar: 6, spitter: 6, vulture: 8, brute: 10, charger: 12, alpha: 14, golem: 25, bear: 40, mammoth: 80 };
const lvOf = p => GC.lvlOf(p.prof && p.prof.xp ? p.prof.xp[p.cls] : 0);
function gainXp(p, amt) {
  if (!p.prof || !(amt > 0)) return;
  const xp = p.prof.xp = p.prof.xp || {}, before = GC.lvlOf(xp[p.cls]); xp[p.cls] = (xp[p.cls] || 0) + Math.round(amt); dirty = true;
  const lv = GC.lvlOf(xp[p.cls]); p.smax = GC.staMax(lv);
  if (lv > before) p.sta = Math.min(p.smax, (p.sta || 0) + (p.smax - GC.staMax(before)));   // a level-up tops up the extra stamina it gives
  send(p.ws, { t: 'xp', xp: xp[p.cls], lv, up: lv > before ? 1 : 0, g: Math.round(amt) });
}

const MAXBODY = 8192;
function json(s, code, o) { s.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); s.end(JSON.stringify(o)); }
function body(q) {
  return new Promise(res => {
    let b = '', over = false;
    q.on('data', d => { b += d; if (b.length > MAXBODY) { over = true; q.destroy(); } });
    q.on('end', () => { if (over) return res(null); try { res(JSON.parse(b || '{}')); } catch (e) { res(null); } });
    q.on('error', () => res(null));
  });
}
const clientIp = q => { const x = q.headers['x-forwarded-for']; return (x ? String(x).split(',').pop().trim() : q.socket.remoteAddress) || ''; };
const login = (email, tok, extra) => Object.assign({ ok: true, token: tok, email }, extra || {}, { profile: view(acct(email, true)) });

async function api(q, s, u) {
  const ip = clientIp(q);
  if (!auth.allow('api:' + ip, 240, 60000)) return json(s, 429, { ok: false, err: 'Slow down.' });
  if (u.pathname === '/api/config' && q.method === 'GET') return json(s, 200, { ok: true, google: config.googleClientId || null, apple: config.appleClientId || null });
  if (q.method !== 'POST') return json(s, 405, { ok: false });
  const b = await body(q); if (!b) return json(s, 400, { ok: false, err: 'Bad request.' });
  switch (u.pathname) {
    case '/api/auth/email/start': return json(s, 200, await auth.startEmail(b.email, ip));
    case '/api/auth/email/verify': {
      if (!auth.allow('v:' + ip, 40, 3600e3)) return json(s, 200, { ok: false, err: 'Too many tries. Please try again later.' });
      const r = auth.verifyEmail(b.email, b.code); if (!r.ok) return json(s, 200, r);
      claimLegacy(r.email, b.pid); return json(s, 200, login(r.email, auth.createSession(r.email)));
    }
    case '/api/auth/google': {
      const r = await auth.verifyGoogle(b.credential); if (!r.ok) return json(s, 200, r);
      claimLegacy(r.email, b.pid); return json(s, 200, login(r.email, auth.createSession(r.email), { name: r.name }));
    }
    case '/api/auth/apple': {
      const r = await auth.verifyApple(b.credential); if (!r.ok) return json(s, 200, r);
      claimLegacy(r.email, b.pid); return json(s, 200, login(r.email, auth.createSession(r.email), { name: r.name }));
    }
    case '/api/auth/session': { const e = auth.sessionEmail(b.token); return json(s, 200, e ? login(e, b.token) : { ok: false }); }
    case '/api/auth/logout': auth.logout(b.token); return json(s, 200, { ok: true });
    case '/api/account/delete': {   // app stores require a way to delete the account and its data from inside the app
      const e = auth.sessionEmail(b.token); if (!e) return json(s, 200, { ok: false, err: 'auth' });
      if (profiles[e]) { delete profiles[e]; pcount--; dirty = true; }
      try { const f = saveFile(e); if (f) fs.unlinkSync(f); } catch (x) { }
      auth.deleteSessions(e); return json(s, 200, { ok: true });
    }
    case '/api/profile': { const e = auth.sessionEmail(b.token); return json(s, 200, e ? { ok: true, profile: view(acct(e, true)) } : { ok: false, err: 'auth' }); }
    case '/api/buy': {
      const e = auth.sessionEmail(b.token); if (!e) return json(s, 200, { ok: false, err: 'auth' });
      const c = GC.BY[b.cls]; if (!c || c.price <= 0) return json(s, 200, { ok: false, err: 'unknown class' });
      const p = acct(e, true); if (!p) return json(s, 200, { ok: false, err: 'bad profile' });
      if (ownedOf(p).includes(c.id)) return json(s, 200, Object.assign({ ok: false, err: 'already owned' }, { profile: view(p) }));
      if (p.d < c.price) return json(s, 200, { ok: false, err: 'need', need: c.price - p.d, profile: view(p) });
      p.d -= c.price; p.owned.push(c.id); dirty = true;
      return json(s, 200, { ok: true, profile: view(p) });
    }
  }
  return json(s, 404, { ok: false });
}

const srv = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const og = q.headers.origin; if (og && /^(https?:\/\/localhost(:\d+)?|capacitor:\/\/localhost|ionic:\/\/localhost)$/.test(og)) { s.setHeader('Access-Control-Allow-Origin', og); s.setHeader('Vary', 'Origin'); s.setHeader('Access-Control-Allow-Headers', 'Content-Type'); s.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }   // the Android / iPhone app's web view runs from localhost
    if (q.method === 'OPTIONS') { s.writeHead(204); return s.end(); }
    api(q, s, u).catch(e => { console.error('api error', e); if (!s.headersSent) json(s, 500, { ok: false, err: 'Server error.' }); }); return; }
  let f = u.pathname;
  if (f === '/') f = '/index.html';
  const p = path.join(PUB, path.normalize(f));
  if (!p.startsWith(PUB)) { s.writeHead(403); return s.end(); }
  fs.readFile(p, (e, d) => {
    if (e) { s.writeHead(404); return s.end('not found'); }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    s.end(d);
  });
});

// ---------- game constants ----------
const R = 3600;                      // home island radius (doubled again from 1800)
const ALIEN_R = 950;                 // aliens come ashore this far from the fire
const DAY = 90, DUSK = 30, NIGHT = 60, CYC = DAY + DUSK + NIGHT;
const HOME_R = 150, HOME_RATE = 1.0;   // a spitter's glob starts to curve toward you within HOME_R px, turning at most HOME_RATE rad/s, and only once
const CULT = { fire: 24, melee: 46 };   // a mage's fireball and a zealot's blow (before +4% per night and armor)
const VIL_DMG = { arrow: 22, melee: 18 };   // raiding / camp villagers: an archer's arrow and a villager's blow (was 6 and 7), before the +4% per night and before armor
// [infight] experiment: different species fight each other (set to false to switch it off; see the INFIGHT block in Room to remove it)
const INFIGHT = true, FIGHT_SEE = 280, FIGHT_PLAYER = 380;
const VEND = { every: 3, boat: 150, walk: 70, sight: 1100, leaveAt: 90 + 30 - 10 };   // traveling vendor: every 3rd day; he leaves 10 s before night (night starts at 120 s)
const GUN_MAG = { pistol: 6, rifle: 1 }, GUN_RELOAD = { pistol: 1.5, rifle: 3.2 };   // rounds per magazine, seconds to reload
const GHOST_SEC = 30;   // a player who disconnects at night / near enemies stays in the world this long
const SHARK_OUT = 1.5;   // a leaving shark lingers this long so its leap-and-dive can play
const BLOCK_SEC = 5, WALL_SEC = 8;   // an enemy that cannot find a way to (or a clear shot at) you for BLOCK_SEC seconds attacks the nearest wall for up to WALL_SEC seconds, then tries to path to you again
const ACT_R = 2600, VIL_ACT = 3000;   // an island's animals exist while a player is within ACT_R of its shore; villagers while one is within VIL_ACT of their camp
const MAXP = 8;
const ROOM_IDLE_SEC = +process.env.ROOM_IDLE_SEC || 20 * 60;   // an empty room is kept this long; any join resets the timer
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const CAMP_CLEAR = RC.camp(RC.FIRE_MAX) + 30;          // no trees anywhere the camp can grow to (max level)
const BUSHES = 132;                  // berry bushes on home (4x the area of the 1800 island)
const HP = { t: 4, r: 3, b: 1, c: 4, p: 8, g: 5 };   // p = snowy pine (twice the chops), g = gold ore vein            // hits to break: tree 4, rock 3, berry bush 1
// the nearest point of a structure's solid body to (x, y), and its radius: most are round; a gate is a 104-long bar along its rotation
const GATE_HALF = 52;
const RES_R = { t: 17, p: 15, c: 13, r: 24, g: 24 };   // how wide the solid base of each resource is (you walk behind the tops of trees, but not through the trunk)
function solidPt(st, x, y) {
  if (st.len) { const a = (st.rot || 0) * Math.PI / 4, ux = Math.cos(a), uy = Math.sin(a), t = Math.max(-st.len, Math.min(st.len, (x - st.x) * ux + (y - st.y) * uy)); return [st.x + ux * t, st.y + uy * t, st.r]; }   // a cabin wall: a bar of half-length len
  if (st.k !== 'gate') return [st.x, st.y, st.r];
  const a = (st.rot || 0) * Math.PI / 4, ux = Math.cos(a), uy = Math.sin(a), t = Math.max(-GATE_HALF, Math.min(GATE_HALF, (x - st.x) * ux + (y - st.y) * uy));
  return [st.x + ux * t, st.y + uy * t, 12];
}
const STRUCT = { bench: { r: RC.RADIUS.bench }, chest: { r: RC.RADIUS.chest }, pot: { r: RC.RADIUS.pot }, smelter: { r: RC.RADIUS.smelter }, wall: { r: RC.RADIUS.wall, hp: 150 }, gate: { r: RC.RADIUS.gate, hp: 50 }, spike: { r: RC.RADIUS.spike, hp: 120 },   // gates are much weaker than walls
   trap: { r: RC.RADIUS.trap } };
const BAG_MAX = 99, BAG_KEYS = ['wood', 'stone', 'food', 'scrap', 'meat', 'gold', 'pelt', 'apelt', 'ammoP', 'ammoR'];   // no item stack in a bag goes past 99
const CHEST_CAP = 500, REACH = 62;   // collision radius / hit points of placed structures
const SPILL = { t: 5, r: 3, c: 8, p: 12 };   // a pine gives far more wood
const SPEAR_REACH = 30;   // how much further than the normal swing the spear's poke reaches (straight ahead)
const GOLD_P = 0.01;   // chance a rock (new or regrowing) comes up as a gold ore vein
const WOODY = k => k === 't' || k === 'c' || k === 'p', ROCKY = k => k === 'r' || k === 'g';
const WOLF = { aHp: 100, aDmg: 16, aRun: 150, n: 10, outer: 14, alpha: 0.20, respawn: 40, reAggro: 3, pelt: 0.15, aPelt: 0.3, hp: 45, see: 300, give: 520, leash: 1100, run: 132, walk: 30, dmg: 9, reach: 30, cd: 1.0, fireGap: 140 };
const BIG = { 1: { name: 'bear', hp: 500, dmg: 35, run: 105, reach: 46, cd: 1.3, walk: 26, see: 330, meat: [3, 3], pelt: 0.7 }, 2: { name: 'mammoth', hp: 2000, dmg: 50, run: 80, reach: 64, cd: 2.0, walk: 20, see: 280, meat: [6, 4], pelt: 1 } };   // snow-island giants (player walks 150): a bear takes ~30 s to kill, a mammoth ~60 s
// more hostile animals (they share the wolf code): forest boars on every island, golems and imps on lava islands. n = [on home, on each outer island that has the biome]
const MOBS = {
  boar: { b: 'f', idx: 1, hp: 70, dmg: 12, run: 125, reach: 34, cd: 1.1, see: 340, walk: 28, meat: [2, 2], n: [8, 5] },
  golem: { b: 'l', idx: 2, hp: 360, dmg: 30, run: 70, reach: 54, cd: 1.9, see: 420, walk: 18, meat: [0, 0], ore: [1, 2], heavy: 1, n: [0, 3] },
  imp: { b: 'l', idx: 3, hp: 45, dmg: 10, run: 150, reach: 30, cd: 0.9, see: 460, walk: 55, meat: [0, 1], n: [0, 7] },
};
// passive creatures (rabbit code): one kind per biome. n = [home, outer]
const CRIT = {
  rabbit: { b: 'f', idx: 0, n: [20, 8], run: 95, walk: 28, see: 260 },
  scorpion: { b: 'd', idx: 1, n: [0, 14], run: 85, walk: 26, see: 220 },
  penguin: { b: 's', idx: 2, n: [8, 10], run: 70, walk: 22, see: 200 },
  sal: { b: 'l', idx: 3, n: [0, 10], run: 105, walk: 32, see: 250 },
};
const hasBiome = (is, b) => b === 'f' || is.b === b || (is.b === 'm' && (b === 's' || b === 'd'));   // does this island have that biome somewhere?
const DIST_F = (x, y, wr = WORLD_R) => Math.max(0, Math.min(1, (Math.hypot(x, y) - R) / (wr - R)));   // 0 at home's shore, 1 at the far edge: out there alphas are common and bears / mammoths appear   // snow wolves: count, respawn s, hp, notice range, give-up range, max chase from home spot, speeds (players walk 150), bite   // a cactus gives more wood than a tree
// ---------- the archipelago: island 0 is home (all forest); the others are random sizes, each 25% forest on the side facing home and 75% its own biome (b) ----------
const WORLD_R = 24000, WORLD_R_V1 = 30000, MAP_VER = 2, BOAT_SPEED = 190, BOAT_AHEAD = 100, ISL_VER = 5;   // ISL_VER: bump when island generation changes so saved rooms regenerate their outer islands
function seeded(code) { let h = 2166136261; for (const ch of String(code)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); let a = h >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// outer islands come in all sizes (about 1/6 of home's radius up to 1.4x) and are lumpy blobs, never circles (see RC.shapeK). The two nearest sit 500-1100 of
// open sea from home's shore; the rest spread over the world, as many as fit (up to 60), with at least 450 of sea between any two shores
const ISL_GAP = 450;
function islandsClash(A, B, gap) {   // do the real outlines of two islands come closer than `gap`?
  if (Math.hypot(A.x - B.x, A.y - B.y) > (A.r + B.r) * RC.SHAPE_MAX + gap) return false;
  for (const [P, Q] of [[A, B], [B, A]]) for (let k = 0; k < 64; k++) { const a = k / 64 * 6.2832, e = RC.edgeR(P, a); if (RC.inIsland(Q, P.x + Math.cos(a) * e, P.y + Math.sin(a) * e, -gap)) return true; }
  return Math.hypot(A.x - B.x, A.y - B.y) < Math.min(A.r, B.r) * 0.6;   // (one inside the other)
}
function genIslandsLegacy(code) {   // the original layout (map version 1): kept so older saved games still load with the islands they were saved with
  const rnd = seeded(code), out = [{ x: 0, y: 0, r: R, b: 'f' }]; let tries = 0;
  while (out.length < 61 && tries++ < 80000) {
    const near = out.length <= 2, q = rnd();
    const r = near ? R * (0.55 + rnd() * 0.8) : q < 0.22 ? R * (0.18 + rnd() * 0.27) : q < 0.6 ? R * (0.45 + rnd() * 0.45) : R * (0.9 + rnd() * 0.5);   // small / medium / large
    const bound = r * RC.SHAPE_MAX, lo = R + bound + (near ? 500 : ISL_GAP), hi = near ? lo + 600 : WORLD_R_V1 - bound - 300;
    const dist = lo + rnd() * (hi - lo), a = rnd() * 6.283, x = Math.cos(a) * dist, y = Math.sin(a) * dist;
    const cand = { x, y, r, s: +(out.length * 1.7).toFixed(1) };
    if (out.some(i => islandsClash(cand, i, ISL_GAP))) continue;   // keep water between islands
    out.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r), s: +(out.length * 1.7).toFixed(1), b: (q => q < 0.28 ? 'm' : q < 0.6 ? 's' : q < 0.92 ? 'd' : 'l')(rnd()) });   // the 75% biome: snow, desert, a mix of both ('m'), or (rarely, 8%) lava ('l')
  }
  if (out.length > 2 && !out.some(i => i.b === 's' || i.b === 'm')) out[out.length - 1].b = 's';   // always at least one snow island
  if (out.length > 2 && !out.slice(1).some(i => i.b === 'd' || i.b === 'm')) out[out.length - 1].b = 'd';   // and at least one desert
  return out;
}
function genIslands(code, wr = WORLD_R) {   // map version 2: no small islands, and a map 20% smaller across
  const rnd = seeded(code), out = [{ x: 0, y: 0, r: R, b: 'f' }]; let tries = 0;
  while (out.length < 61 && tries++ < 80000) {
    const near = out.length <= 2, q = rnd();
    const r = near ? R * (0.7 + rnd() * 0.7) : q < 0.5 ? R * (0.6 + rnd() * 0.3) : R * (0.9 + rnd() * 0.5);   // medium (0.6-0.9 x home) / large
    const bound = r * RC.SHAPE_MAX, lo = R + bound + (near ? 500 : ISL_GAP), hi = near ? lo + 600 : wr - bound - 300;
    const dist = lo + rnd() * (hi - lo), a = rnd() * 6.283, x = Math.cos(a) * dist, y = Math.sin(a) * dist;
    const cand = { x, y, r, s: +(out.length * 1.7).toFixed(1) };
    if (out.some(i => islandsClash(cand, i, ISL_GAP))) continue;   // keep water between islands
    out.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r), s: +(out.length * 1.7).toFixed(1), b: (q => q < 0.28 ? 'm' : q < 0.6 ? 's' : q < 0.92 ? 'd' : 'l')(rnd()) });   // the 75% biome: snow, desert, a mix of both ('m'), or (rarely, 8%) lava ('l')
  }
  if (out.length > 2 && !out.some(i => i.b === 's' || i.b === 'm')) out[out.length - 1].b = 's';   // always at least one snow island
  if (out.length > 2 && !out.slice(1).some(i => i.b === 'd' || i.b === 'm')) out[out.length - 1].b = 'd';   // and at least one desert
  return out;
}
function islandRes(is, idx, code) {
  const rnd = seeded(code + '#' + idx), A = Math.PI * is.r * is.r, out = [];
  // part: true = only in the forest quarter, false = only in the biome's three quarters, null = anywhere
  const add = (k, n, part, biome) => { for (let i = 0, tries = 0; i < n && tries < n * 40; tries++) { const a = rnd() * 6.283, d = 30 + Math.sqrt(rnd()) * (RC.edgeR(is, a) - 110), x = is.x + Math.cos(a) * d, y = is.y + Math.sin(a) * d; if (part !== null && RC.inForestPart(is.x, is.y, is.r, x, y) !== part) continue; if (biome && RC.biomeAt(is.x, is.y, is.r, is.b, x, y) !== biome) continue; const kk = k === 'r' && rnd() < GOLD_P ? 'g' : k; out.push({ k: kk, x, y, hp: HP[kk], mhp: HP[kk], rt: 0, isl: idx }); i++; } };
  add('t', Math.max(2, Math.round(A * 0.25 * 1.3e-5)), true); add('b', Math.max(1, Math.round(A * 0.25 * 3.2e-6)), true);   // forest quarter: trees + berry bushes
  const half = is.b === 'm' ? 0.5 : 1;   // a mixed island has cacti on its desert half and pines on its snow half
  if (is.b === 'd' || is.b === 'm') add('c', Math.max(3, Math.round(A * 0.75 * half * 1.1e-5)), false, 'd');   // desert: cacti
  if (is.b === 's' || is.b === 'm') add('p', Math.max(3, Math.round(A * 0.75 * half * 1.0e-5)), false, 's');   // snow: snowy pines
  if (is.b === 'l') { add('r', Math.max(4, Math.round(A * 0.75 * 1.6e-5)), false, 'l'); add('g', Math.max(3, Math.round(A * 0.75 * 0.9e-5)), false, 'l'); }   // lava islands: lots of dark rock and gold ore
  add('r', Math.max(2, Math.round(A * 8e-6)), null);
  return out;
}
// end-of-run payout: 1 diamond per day survived up to day 20, 2 per day for days 21-60, 3 per day after that
const runPayout = days => { let t = 0; for (let d = 1; d <= days; d++) t += d <= 20 ? 1 : d <= 60 ? 2 : 3; return t; };
// ---------- loot areas: every outer island has 5-8 of them (small clusters of biome decorations); near each there may be a chest (3 tiers) and/or a trader ----------
function genLoot(islands, code) {
  const out = []; let id = 1;
  for (let i = 1; i < islands.length; i++) {
    const is = islands[i], rnd = seeded(code + '@loot' + i), n = Math.max(1, Math.round((5 + Math.floor(rnd() * 4)) * Math.min(1, (is.r / R) * (is.r / R) * 1.3)));   // small islands have fewer loot spots
    for (let k = 0, tries = 0; k < n && tries < 800; tries++) {
      const a = rnd() * 6.283, d = 160 + Math.sqrt(rnd()) * Math.max(100, RC.edgeR(is, a) - 520), x = is.x + Math.cos(a) * d, y = is.y + Math.sin(a) * d;
      if (out.some(l => l.isl === i && Math.hypot(l.x - x, l.y - y) < 500)) continue;
      const q = rnd(), tier = q < 0.30 ? 1 : q < 0.50 ? 2 : q < 0.58 ? 3 : 0, trader = 0, seed = Math.floor(rnd() * 1e6), ca = (seed % 628) / 100;
      out.push({ id: id++, isl: i, x: Math.round(x), y: Math.round(y), b: RC.biomeAt(is.x, is.y, is.r, is.b, x, y), seed, tier, cx: Math.round(x + Math.cos(ca) * 90), cy: Math.round(y + Math.sin(ca) * 90), trader, tx: Math.round(x + Math.cos(ca + 3.14159) * 105), ty: Math.round(y + Math.sin(ca + 3.14159) * 105), open: 0 }); k++;
    }
  }
  const rnd = seeded(code + '@traders');   // exactly one of each of the five traders on the whole map, on random islands (some islands get none, a few may get two)
  const isls = [...new Set(out.map(l => l.isl))];
  for (let t = 1; t <= 5 && isls.length; t++) {   // each trader goes to a random island that has none yet (while any are left), in a random loot area there
    const free = isls.filter(i => !out.some(l => l.isl === i && l.trader)), pool = free.length ? free : isls, isl = pool[Math.floor(rnd() * pool.length)];
    const c = out.filter(l => l.isl === isl && !l.trader); if (c.length) c[Math.floor(rnd() * c.length)].trader = t;
  }
  return out;
}
// ---------- cabins in the forest: random sizes, solid walls with one door, a treasure chest and cabinets inside ----------
const CAB_WALL = 11, CAB_DOOR_W = 104, CAB_GAP = 84, CAB_KINDS = ['cabinet', 'barrel', 'crate', 'shelf'];   // door = a gate (104 wide), inner doorways are open gaps
// geometry of a cabin (all relative to its centre): exterior walls with a gap for each door, inner dividers with a doorway each, and solid furniture
function cabinSegments(c) {
  const out = [], hw = c.w / 2, hh = c.h / 2;
  const bars = (lo, hi, gaps, fn) => {   // split [lo, hi] around gaps (each [centre, width]) and emit the pieces
    let from = lo; for (const [g, gw] of gaps.slice().sort((a, b) => a[0] - b[0])) { if (g - gw / 2 - from > 6) fn(from, g - gw / 2); from = g + gw / 2; } if (hi - from > 6) fn(from, hi);
  };
  const side = (n, len, cx, cy, horiz) => { bars(-len / 2, len / 2, c.doors.filter(d => d.side === n).map(d => [d.pos, CAB_DOOR_W]), (a, b) => { const m = (a + b) / 2; out.push({ x: Math.round(horiz ? cx + m : cx), y: Math.round(horiz ? cy : cy + m), len: (b - a) / 2, rot: horiz ? 0 : 2, r: CAB_WALL }); }); };
  side(0, c.w, c.x, c.y - hh, true); side(2, c.w, c.x, c.y + hh, true); side(3, c.h, c.x - hw, c.y, false); side(1, c.h, c.x + hw, c.y, false);
  for (const [o, pos, a0, a1, gap] of c.divs) bars(a0, a1, [[gap, CAB_GAP]], (a, b) => { const m = (a + b) / 2; out.push({ x: Math.round(o === 1 ? c.x + pos : c.x + m), y: Math.round(o === 1 ? c.y + m : c.y + pos), len: (b - a) / 2, rot: o === 1 ? 2 : 0, r: CAB_WALL - 2 }); });
  for (const [kind, rx, ry, fw, fh] of c.decor) if (kind === 'table' || kind === 'bed' || kind === 'counter' || kind === 'fire') {   // big furniture is solid: a capsule along its long side
    const along = fw >= fh, r = Math.min(fw, fh) / 2 - 1, len = Math.max(0, Math.abs(fw - fh) / 2); out.push({ x: Math.round(c.x + rx), y: Math.round(c.y + ry), len, rot: along ? 0 : 2, r });
  }
  return out;
}
function genCabins(islands, code, loot) {
  const rnd = seeded(code + '@cabins2'), cabins = [], out = []; let lid = loot.reduce((m, l) => Math.max(m, l.id), 0);
  const rectDist = (c, x, y) => Math.hypot(Math.max(Math.abs(x - c.x) - c.w / 2, 0), Math.max(Math.abs(y - c.y) - c.h / 2, 0));
  const pts = c => { const p = []; for (const fx of [-.5, 0, .5]) for (const fy of [-.5, 0, .5]) p.push([c.x + fx * c.w, c.y + fy * c.h]); p.push([c.x - c.w / 2 - 115, c.y], [c.x + c.w / 2 + 115, c.y], [c.x, c.y - c.h / 2 - 115], [c.x, c.y + c.h / 2 + 115]); return p; };   // (the cabin and the ground around it, porches included)
  const okSpot = (i, c) => {
    const is = islands[i];
    for (const [x, y] of pts(c)) { if (i === 0 ? (RC.inSnow(x, y) || Math.hypot(x, y) > R - 300 || Math.hypot(x, y) < CAMP_CLEAR + 260) : !(RC.inIsland(is, x, y, 160) && RC.biomeAt(is.x, is.y, is.r, is.b, x, y) === 'f')) return false; }
    if (cabins.some(o => o.isl === i && Math.abs(o.x - c.x) < (o.w + c.w) / 2 + 200 && Math.abs(o.y - c.y) < (o.h + c.h) / 2 + 200)) return false;
    if (loot.some(l => l.isl === i && [[l.x, l.y], [l.cx, l.cy], [l.tx, l.ty]].some(([x, y]) => rectDist(c, x, y) < 220))) return false;
    return true;
  };
  for (let i = 0; i < islands.length; i++) {
    const is = islands[i], n = i === 0 ? 5 : is.r > 2600 ? 1 : is.r > 1200 ? (rnd() < 0.5 ? 1 : 0) : 0, k = i === 0 ? 1 : Math.max(.6, Math.min(1, is.r / 2200));
    for (let m = 0; m < n; m++) for (let t = 0; t < 120; t++) {
      const a = rnd() * 6.283, d = i === 0 ? CAMP_CLEAR + 260 + rnd() * (R - 560 - CAMP_CLEAR - 260) : Math.sqrt(rnd()) * (RC.edgeR(is, a) - 300);
      const w = Math.round((400 + rnd() * 520) * k), h = Math.round((320 + rnd() * 380) * k), hw = w / 2, hh = h / 2;
      const c = { id: cabins.length + 1, isl: i, x: Math.round((i === 0 ? 0 : is.x) + Math.cos(a) * d), y: Math.round((i === 0 ? 0 : is.y) + Math.sin(a) * d), w, h, doors: [], divs: [], rooms: [], decor: [] };
      if (!okSpot(i, c)) continue;
      // rooms: a divider across the long side (when big enough), then each half may be split across the other way
      let rooms = [[-hw, -hh, hw, hh]]; const longW = w >= h;
      if ((longW ? w : h) >= 460) {
        const pos = Math.round((rnd() - .5) * 0.3 * (longW ? w : h)), a0 = longW ? -hh : -hw, gap = Math.round(a0 + 90 + rnd() * (-2 * a0 - 180));
        c.divs.push([longW ? 1 : 0, pos, a0, -a0, gap]); rooms = longW ? [[-hw, -hh, pos, hh], [pos, -hh, hw, hh]] : [[-hw, -hh, hw, pos], [-hw, pos, hw, hh]];
        const next = [];
        for (const rm of rooms) {
          const rw = rm[2] - rm[0], rh = rm[3] - rm[1];
          if (longW ? rh >= 440 : rw >= 440) { if (rnd() < 0.8) {   // a second divider across this half
            if (longW) { const py = Math.round(rm[1] + rh * (.4 + rnd() * .2)), gp = Math.round(rm[0] + 90 + rnd() * (rw - 180)); c.divs.push([0, py, rm[0], rm[2], gp]); next.push([rm[0], rm[1], rm[2], py], [rm[0], py, rm[2], rm[3]]); }
            else { const px = Math.round(rm[0] + rw * (.4 + rnd() * .2)), gp = Math.round(rm[1] + 90 + rnd() * (rh - 180)); c.divs.push([1, px, rm[1], rm[3], gp]); next.push([rm[0], rm[1], px, rm[3]], [px, rm[1], rm[2], rm[3]]); }
            continue; } }
          next.push(rm);
        }
        rooms = next;
      }
      c.rooms = rooms.map(r => r.map(Math.round));
      // doors: 1 on a small cabin, 2 on a mid one, 3 on a big one - on different sides, away from where dividers meet the outer wall
      const area = w * h, nd = area < 240000 ? 1 : area < 400000 ? 2 : 3, sides = [0, 1, 2, 3].sort(() => rnd() - .5);
      for (let q = 0; q < sides.length && c.doors.length < nd; q++) {
        const sd = sides[q], len = sd % 2 === 0 ? w : h;
        for (let tr = 0; tr < 30; tr++) {
          const pos = Math.round((rnd() - .5) * (len - CAB_DOOR_W - 120));
          if (c.divs.some(([o, p, a0, a1]) => (sd % 2 === 0 ? o === 1 : o === 0) && Math.abs(p - pos) < CAB_DOOR_W / 2 + 70 && (sd % 2 === 0 || true))) continue;
          c.doors.push({ side: sd, pos }); break;
        }
      }
      if (!c.doors.length) c.doors.push({ side: sides[0], pos: 0 });
      cabins.push(c);
      // inside: decoration and furniture. Each room gets a theme; nothing blocks a door or a doorway.
      const doorPts = c.doors.map(dd => { const sd = dd.side; return [sd === 1 ? hw : sd === 3 ? -hw : dd.pos, sd === 2 ? hh : sd === 0 ? -hh : dd.pos]; }), gapPts = c.divs.map(([o, p, a0, a1, gp]) => o === 1 ? [p, gp] : [gp, p]);
      const placed = [];   // [rx, ry, fw, fh] of everything put down
      const clearOf = (rx, ry, fw, fh, pad = 16) => !placed.some(q => Math.abs(q[0] - rx) < (q[2] + fw) / 2 + pad && Math.abs(q[1] - ry) < (q[3] + fh) / 2 + pad) && !doorPts.some(q => Math.hypot(q[0] - rx, q[1] - ry) < 100 + Math.max(fw, fh) / 2) && !gapPts.some(q => Math.hypot(q[0] - rx, q[1] - ry) < 80 + Math.max(fw, fh) / 2);
      const put = (rm, kind, fw, fh, wallSide, seed) => {   // wallSide: 0-3 = against that wall of the room, -1 = anywhere inside
        const ins = 34; for (let tr = 0; tr < 60; tr++) {
          let rx, ry; const x0 = rm[0] + ins + fw / 2, x1 = rm[2] - ins - fw / 2, y0 = rm[1] + ins + fh / 2, y1 = rm[3] - ins - fh / 2; if (x1 <= x0 || y1 <= y0) return null;
          rx = x0 + rnd() * (x1 - x0); ry = y0 + rnd() * (y1 - y0);
          if (wallSide === 0) ry = y0; else if (wallSide === 2) ry = y1; else if (wallSide === 3) rx = x0; else if (wallSide === 1) rx = x1;
          if (!clearOf(rx, ry, fw, fh)) continue; rx = Math.round(rx); ry = Math.round(ry); placed.push([rx, ry, fw, fh]); c.decor.push([kind, rx, ry, fw, fh, seed || Math.floor(rnd() * 1e6), wallSide]); return [rx, ry];
        } return null;
      };
      const byArea = rooms.map((rm, ri) => ri).sort((p, q) => (rooms[q][2] - rooms[q][0]) * (rooms[q][3] - rooms[q][1]) - (rooms[p][2] - rooms[p][0]) * (rooms[p][3] - rooms[p][1]));
      byArea.forEach((ri, rank) => {
        const rm = rooms[ri], rw = rm[2] - rm[0], rh = rm[3] - rm[1], theme = rank === 0 ? 'living' : ['bedroom', 'kitchen', 'study'][(rank - 1 + Math.floor(rnd() * 3)) % 3];
        if (rw > 150 && rh > 150) put(rm, 'rug', Math.min(190, rw - 120), Math.min(120, rh - 120), -1);
        if (theme === 'living') { put(rm, 'fire', 96, 36, Math.floor(rnd() * 4)); const t = put(rm, 'table', 120, 72, -1); if (t) { for (const [dx, dy, f] of [[0, -58, 2], [0, 58, 0], [-84, 0, 1], [84, 0, 3]]) if (rnd() < 0.7) { const cx = t[0] + dx, cy = t[1] + dy; if (clearOf(cx, cy, 30, 30, 4) && cx > rm[0] + 40 && cx < rm[2] - 40 && cy > rm[1] + 40 && cy < rm[3] - 40) { placed.push([cx, cy, 30, 30]); c.decor.push(['chair', Math.round(cx), Math.round(cy), 30, 30, 0, f]); } } } put(rm, 'plant', 26, 26, Math.floor(rnd() * 4)); }
        else if (theme === 'bedroom') { put(rm, 'bed', 74, 118, [0, 2][Math.floor(rnd() * 2)]); if (rw > 330) put(rm, 'bed', 74, 118, [0, 2][Math.floor(rnd() * 2)]); put(rm, 'plant', 26, 26, Math.floor(rnd() * 4)); }
        else if (theme === 'kitchen') { put(rm, 'counter', 150, 38, [0, 2][Math.floor(rnd() * 2)]); const t = put(rm, 'table', 90, 60, -1); if (t) for (const [dx, dy, f] of [[0, -50, 2], [0, 50, 0]]) { const cx = t[0] + dx, cy = t[1] + dy; if (clearOf(cx, cy, 30, 30, 4) && cy > rm[1] + 40 && cy < rm[3] - 40) { placed.push([cx, cy, 30, 30]); c.decor.push(['chair', Math.round(cx), Math.round(cy), 30, 30, 0, f]); } } put(rm, 'plant', 26, 26, Math.floor(rnd() * 4)); }
        else { const t = put(rm, 'table', 104, 56, Math.floor(rnd() * 4)); if (t) { const cy = t[1] + (t[1] > (rm[1] + rm[3]) / 2 ? -46 : 46); if (clearOf(t[0], cy, 30, 30, 4)) { placed.push([t[0], cy, 30, 30]); c.decor.push(['chair', Math.round(t[0]), Math.round(cy), 30, 30, 0, cy > t[1] ? 2 : 0]); } } put(rm, 'plant', 26, 26, Math.floor(rnd() * 4)); put(rm, 'plant', 26, 26, Math.floor(rnd() * 4)); }
      });
      // the treasure chest (a second one in a very big cabin) and the cabinets, barrels, crates and shelves to open, spread over the rooms
      const spot = (rm, force) => { for (let q = 0; q < 70; q++) { const x = rm[0] + 50 + rnd() * (rm[2] - rm[0] - 100), y = rm[1] + 50 + rnd() * (rm[3] - rm[1] - 100); if (!clearOf(x, y, 34, 34, 10)) continue; placed.push([x, y, 34, 34]); return [Math.round(c.x + x), Math.round(c.y + y)]; } if (force) { const p = [Math.round(c.x + (rm[0] + rm[2]) / 2), Math.round(c.y + (rm[1] + rm[3]) / 2)]; return p; } return null; };
      const mk = (rm, tier, kind) => { const p = spot(rm, kind === 'chest'); if (p) out.push({ id: ++lid, isl: i, x: c.x, y: c.y, b: 'f', seed: Math.floor(rnd() * 1e6), tier, cx: p[0], cy: p[1], trader: 0, tx: p[0], ty: p[1], cab: c.id, kind }); };
      mk(rooms[byArea.length > 1 ? byArea[1 + Math.floor(rnd() * (byArea.length - 1))] : byArea[0]], area > 380000 && rnd() < 0.3 ? 3 : 2, 'chest');   // (not in the biggest room, which is the one by the entrance, when there is another)
      if (area > 420000) mk(rooms[byArea[Math.floor(rnd() * byArea.length)]], 2, 'chest');
      for (let q = 0, nc = Math.max(3, Math.min(14, 2 + Math.floor(area / 45000))); q < nc; q++) mk(rooms[q % rooms.length], 1, CAB_KINDS[Math.floor(rnd() * CAB_KINDS.length)]);
      break;
    }
  }
  return { cabins, loot: out };
}
// lava pools: scattered over the lava part of a lava island; standing in one burns you
function genLava(islands, code, loot) {
  const rnd = seeded(code + '@lava'), out = [];
  for (let i = 1; i < islands.length; i++) {
    const is = islands[i]; if (is.b !== 'l') continue; let n = 0;
    for (let t = 0; t < 400 && n < 12; t++) {
      const a = rnd() * 6.283, d = 250 + Math.sqrt(rnd()) * Math.max(100, RC.edgeR(is, a) - 750), x = is.x + Math.cos(a) * d, y = is.y + Math.sin(a) * d, r = 60 + rnd() * 80;
      if (RC.biomeAt(is.x, is.y, is.r, is.b, x, y) !== 'l' || RC.biomeAt(is.x, is.y, is.r, is.b, x + Math.cos(a) * r, y + Math.sin(a) * r) !== 'l') continue;
      if (out.some(q => Math.hypot(q.x - x, q.y - y) < q.r + r + 160) || loot.some(l => Math.hypot(l.x - x, l.y - y) < r + 420 || Math.hypot(l.cx - x, l.cy - y) < r + 200 || Math.hypot(l.tx - x, l.ty - y) < r + 200)) continue;
      out.push({ id: out.length + 1, isl: i, x: Math.round(x), y: Math.round(y), r: Math.round(r) }); n++;
    }
  }
  return out;
}
// villages: one tipi camp in the desert of each desert (or mixed) island - decoration plus a home for groups of 3-6 villagers
function genVillages(islands, code, loot, lava) {
  const rnd = seeded(code + '@villages'), out = [];
  for (let i = 1; i < islands.length; i++) {
    const is = islands[i]; if (is.b !== 'd' && is.b !== 'm') continue;
    let made = 0;   // two camps on each desert island
    for (let t = 0; t < 200 && made < 2; t++) {
      const a = rnd() * 6.283, d = 400 + Math.sqrt(rnd()) * Math.max(100, RC.edgeR(is, a) - 1000), x = is.x + Math.cos(a) * d, y = is.y + Math.sin(a) * d;
      if (RC.biomeAt(is.x, is.y, is.r, is.b, x, y) !== 'd' || !RC.inIsland(is, x, y, 500) || out.some(v => v.isl === i && Math.hypot(v.x - x, v.y - y) < 1300)) continue;
      if (loot.some(l => Math.hypot(l.x - x, l.y - y) < 500 || Math.hypot(l.cx - x, l.cy - y) < 400 || Math.hypot(l.tx - x, l.ty - y) < 400)) continue;
      out.push({ id: out.length + 1, isl: i, x: Math.round(x), y: Math.round(y), seed: Math.floor(rnd() * 1e6) }); made++;
    }
  }
  // the volcano biome: a ritual camp (a fire altar ringed by obelisks) with a band of hooded cultists, two on each lava island
  const cr = seeded(code + '@cults');
  for (let i = 1; i < islands.length; i++) {
    const is = islands[i]; if (is.b !== 'l') continue; let made = 0;
    for (let t = 0; t < 300 && made < 2; t++) {
      const a = cr() * 6.283, d = 400 + Math.sqrt(cr()) * Math.max(100, RC.edgeR(is, a) - 1000), x = is.x + Math.cos(a) * d, y = is.y + Math.sin(a) * d;
      if (RC.biomeAt(is.x, is.y, is.r, is.b, x, y) !== 'l' || !RC.inIsland(is, x, y, 500) || out.some(v => v.isl === i && Math.hypot(v.x - x, v.y - y) < 1300)) continue;
      if (loot.some(l => Math.hypot(l.x - x, l.y - y) < 500 || Math.hypot(l.cx - x, l.cy - y) < 400 || Math.hypot(l.tx - x, l.ty - y) < 400)) continue;
      if ((lava || []).some(q => q.isl === i && Math.hypot(q.x - x, q.y - y) < q.r + 280)) continue;
      out.push({ id: out.length + 1, isl: i, x: Math.round(x), y: Math.round(y), seed: Math.floor(cr() * 1e6), cult: 1 }); made++;
    }
  }
  return out;
}
const SLOTS = 3, TRAP_SEC = 20, ARROW_SPEED = 520;
const slotCap = (p, room) => { const b = p.boat && room.boats.find(x => x.id === p.boat); return SLOTS + (b ? RC.BOATS[b.type || 'boat'].slots : 0); };   // bigger boats carry extra slots while you are aboard
const RAB = { home: 20, outer: 8, respawn: 6, see: 260, run: 95, walk: 28, edge: 45, foot: 0.10 };   // rabbits: counts per island, seconds between top-ups, flee range, speeds (players walk 150), shore margin, foot drop chance   // how long a trap holds the big monster   // cooked food you can carry
const REVIVE = { sec: 10, hp: .5, decay: 1 };   // a downed player is revived by a teammate standing still next to them and holding ACT for 10 s (Medic-type classes are faster); they come back with half health
const STA = { max: 100, drain: 16, regen: 22, delay: 1, tiredDelay: 1.6, resume: 30, sprint: 1.7, swing: 8, bush: 5, attack: 6 };   // stamina: a full-stick run drains 16/s (~6 s), refills 22/s after a 1 s rest; at 0 you are winded (no running, chopping, mining or attacking) until it climbs back to 30%; every chop/mine/pick costs 8/8/5 and attacks are free
// ---------- saving a game to your account: one save per account (the newest), gzipped, in <data dir>/saves ----------
const saveFile = email => DIR && path.join(DIR, 'saves', crypto.createHash('sha1').update(email).digest('hex').slice(0, 20) + '.json.gz');
function writeSave(email, blob) {
  const f = saveFile(email); if (!f) return null;
  const json = JSON.stringify(blob), gz = zlib.gzipSync(json, { level: 9 });
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', gz); fs.renameSync(f + '.tmp', f);
  return { bytes: json.length, gz: gz.length };
}
function eraseSaveOf(email) {   // delete one account's saved game
  const pf = profiles[email]; try { const f = saveFile(email); if (f) fs.unlinkSync(f); } catch (e) { } if (pf && pf.save) { delete pf.save; dirty = true; }
}
function eraseSavesOf(code) {   // delete every account's saved copy of this game (called when the run is lost)
  for (const email in profiles) { const pf = profiles[email]; if (pf && pf.save && pf.save.rc === code) { try { const f = saveFile(email); if (f) fs.unlinkSync(f); } catch (e) { } delete pf.save; dirty = true; } }
}
function readSave(email) { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(saveFile(email))).toString()); } catch (e) { return null; } }
// the Charger: from night 4 on, one huge, very fast enemy per night that hammers players far backwards and vanishes at dawn
const CHARGER = { firstNight: 4, sp0: 115, spPerNight: 5, spMax: 185, dmg: 25, rad: 36, reach: 62, stop: 44, knock: 300, stunSec: 0.6 };               // logs per tree / stones per rock (before class bonus)

class Room {
  constructor(code, mv = MAP_VER) {
    this.mv = mv; this.worldR = mv >= 2 ? WORLD_R : WORLD_R_V1; this.code = code; this.away = new Map(); this.players = new Map(); this.nid = 1; this.emptyFor = 0;
    this.res = [];
    const add = (k, n, min = 130) => { for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
      const a = Math.random() * 6.283, d = min + Math.sqrt(Math.random()) * (R - 70 - min), x = Math.cos(a) * d, y = Math.sin(a) * d, snow = RC.inSnow(x, y);
      if (k === 'b' && snow) continue;   // no berries in the snow
      const kk = k === 't' && snow ? 'p' : k === 'r' && Math.random() < GOLD_P ? 'g' : k;   // trees in the snow quarter are snowy pines
      this.res.push({ k: kk, x, y, hp: HP[kk], mhp: HP[kk], rt: 0 }); i++;
    } };
    add('t', 540, CAMP_CLEAR); add('r', 336); add('b', BUSHES);   // 4x the area of the old island, same density
    this.islands = mv >= 2 ? genIslands(code, this.worldR) : genIslandsLegacy(code); this.islands.forEach((is, i) => { if (i > 0) this.res.push(...islandRes(is, i, code)); });
    this.loot = genLoot(this.islands, code); this.lava = genLava(this.islands, code, this.loot); this.villages = genVillages(this.islands, code, this.loot, this.lava);
    { const cb = genCabins(this.islands, code, this.loot); this.cabins = cb.cabins; this.loot.push(...cb.loot); this.clearCabinRes(); }
    this.reset();
  }
  // ===== the traveling vendor: every 3rd day a random vendor sails to the shore nearest a camp (on an island where a player is), walks to the fire, stays until 10 s before night, then
  // walks back and sails home. Out of sight of every player on the way back = he and his boat vanish; keep him in sight all the way and he leads you to where that vendor lives. =====
  shoreNear(is, x, y, pref) {   // the point on an island's shore nearest to (x, y) (pref: an angle to prefer when several are about as near), and the outward direction there
    let best = null, bd = 1e9;
    for (let k = 0; k < 120; k++) {
      const a = k / 120 * 6.283, rr = RC.edgeR(is, a), px = is.x + Math.cos(a) * rr, py = is.y + Math.sin(a) * rr;
      const d = Math.hypot(px - x, py - y) + (pref === undefined ? 0 : 20 * Math.abs(((a - pref + Math.PI) % 6.283 + 6.283) % 6.283 - Math.PI));
      if (d < bd) { bd = d; best = { x: px, y: py, a }; }
    }
    return best;
  }
  vendorSail(v, tx, ty, dt) {   // the vendor's boat heads for (tx, ty), steering around islands; returns the distance left
    const dx = tx - v.bx, dy = ty - v.by, d = Math.hypot(dx, dy); if (d < 6) return d;
    const h = Math.atan2(dy, dx), step = Math.min(d, VEND.boat * dt);
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8]) {
      const a = h + k * 0.3, nx = v.bx + Math.cos(a) * 90, ny = v.by + Math.sin(a) * 90;
      if (this.isWater(nx, ny) && this.isWater(v.bx + Math.cos(a) * 40, v.by + Math.sin(a) * 40)) { v.bx += Math.cos(a) * step; v.by += Math.sin(a) * step; v.ba += (((a - v.ba + Math.PI) % 6.283 + 6.283) % 6.283 - Math.PI) * Math.min(1, dt * 4); return Math.hypot(tx - v.bx, ty - v.by); }
    }
    return d;
  }
  vendorGo(v, tx, ty, sp, dt) { const dx = tx - v.x, dy = ty - v.y, d = Math.hypot(dx, dy); if (d > 1) { const m = Math.min(d, sp * dt); v.x += dx / d * m; v.y += dy / d * m; v.fa = Math.atan2(dy, dx); } return Math.hypot(tx - v.x, ty - v.y); }
  vendorGone() { const v = this.vendor; if (!v) return; this.loot = this.loot.filter(l => l !== v.l); this.vendor = null; }
  spawnVendor(P) {
    const cands = [];
    for (const p of P) if (!p.down && !p.boat) { const i = this.landAt(p.x, p.y, 0); if (i < 0) continue; let f = null;
      if (i === 0) f = { x: 0, y: 0 }; else for (const c of this.camps) if (c.isl === i && (!f || Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(f.x - p.x, f.y - p.y))) f = c;
      if (f) cands.push({ i, f }); }
    if (!cands.length) return false;
    const { i, f } = cands[Math.floor(Math.random() * cands.length)], is = this.islands[i];
    const types = [1, 2, 3, 4, 5].filter(t => this.loot.some(l => l.trader === t)); if (!types.length) return false;
    const type = types[Math.floor(Math.random() * types.length)], hl = this.loot.find(l => l.trader === type), hi = hl.isl, his = this.islands[hi] || this.islands[0];
    const S = this.shoreNear(is, f.x, f.y, Math.atan2(his.y - is.y, his.x - is.x)), ux = Math.cos(S.a), uy = Math.sin(S.a);
    let B0 = null; for (const dd of [1500, 1300, 1700, 1900, 1100, 2100]) { const bx = S.x + ux * dd, by = S.y + uy * dd; if (this.isWater(bx, by) && this.isWater(S.x + ux * dd * .5, S.y + uy * dd * .5)) { B0 = [bx, by]; break; } }
    if (!B0) return false;
    const v = { id: this.nid++, type, i, f, S, ux, uy, L: [S.x + ux * 70, S.y + uy * 70], hl, hi, st: 0, bx: B0[0], by: B0[1], ba: Math.atan2(-uy, -ux), x: B0[0], y: B0[1], fa: Math.atan2(-uy, -ux), t: 0, prog: 1e9, pt: 0 };
    v.l = { id: this.nid++, isl: -1, x: v.x, y: v.y, b: 'f', seed: 0, tier: 0, cx: 0, cy: 0, trader: 0, tx: v.x, ty: v.y, visit: 1 }; this.loot.push(v.l); this.vendor = v;
    for (const p of P) if (this.onIsland(p, i)) send(p.ws, { t: 'toast', msg: '⛵ A traveling merchant (' + RC.TRADERS[type].n + ') is sailing in...' });
    return true;
  }
  stepVendor(P, dt) {
    const ph = this.ph();
    if (!this.vendor) {
      if (this.night % VEND.every === 0 && this.vSched !== this.night && ph === 0 && this.c > 10) { if (this.spawnVendor(P) || this.c > 70) this.vSched = this.night; }
      return;
    }
    const v = this.vendor; v.t += dt;
    const tell = (msg, i) => { for (const p of P) if (this.onIsland(p, i)) send(p.ws, { t: 'toast', msg }); };
    if (v.t > 900) return this.vendorGone();   // (safety net)
    if (v.st === 0) {   // sailing in
      v.x = v.bx; v.y = v.by; v.fa = v.ba;
      if (this.vendorSail(v, v.L[0], v.L[1], dt) < 10) { v.st = 1; v.x = v.S.x - v.ux * 25; v.y = v.S.y - v.uy * 25; tell('🧳 The ' + RC.TRADERS[v.type].n + ' has landed and is walking to your camp.', v.i); }
      else { v.prog = Math.min(v.prog, Math.hypot(v.L[0] - v.bx, v.L[1] - v.by)); v.pt += dt; if (v.pt > 25) { v.pt = 0; if (v.prog > 1e8) return this.vendorGone(); } }
    } else if (v.st === 1) {   // walking up to the camp
      const sx = v.S.x - v.f.x, sy = v.S.y - v.f.y, sl = Math.hypot(sx, sy) || 1, stop = [v.f.x + sx / sl * 115, v.f.y + sy / sl * 115];
      if (this.vendorGo(v, stop[0], stop[1], VEND.walk, dt) < 6) v.st = 2;
    } else if (v.st === 2) {   // waiting at the camp, open for trade
      v.fa = Math.atan2(v.f.y - v.y, v.f.x - v.x);
      if (this.c >= VEND.leaveAt || ph >= 2) { v.st = 3; tell('🧳 The ' + RC.TRADERS[v.type].n + ' is heading back to his boat.', v.i); }
    } else if (v.st === 3) {   // walking back to the boat
      if (this.vendorGo(v, v.S.x, v.S.y, VEND.walk * 1.15, dt) < 8) {
        v.st = 4; v.x = v.bx; v.y = v.by;
        const Sh = this.shoreNear(v.hi === 0 ? this.islands[0] : this.islands[v.hi], v.hl.tx, v.hl.ty); v.H = [Sh.x + Math.cos(Sh.a) * 70, Sh.y + Math.sin(Sh.a) * 70]; v.Sh = Sh; v.prog = 1e9; v.pt = 0;
      }
    } else if (v.st === 4) {   // sailing home
      v.x = v.bx; v.y = v.by; v.fa = v.ba;
      const left = this.vendorSail(v, v.H[0], v.H[1], dt);
      if (left < 12) { v.st = 5; v.x = v.Sh.x - Math.cos(v.Sh.a) * 25; v.y = v.Sh.y - Math.sin(v.Sh.a) * 25; }
      else { v.pt += dt; if (left < v.prog - 30) { v.prog = left; v.pt = 0; } else if (v.pt > 14) return this.vendorGone(); }   // (no progress: give up)
    } else if (v.st === 5) {   // walking to where his stall is
      if (this.vendorGo(v, v.hl.tx, v.hl.ty, VEND.walk * 1.4, dt) < 8) { v.st = 6; v.t = 0; for (const p of P) if (!p.down && Math.hypot(p.x - v.x, p.y - v.y) < VEND.sight) send(p.ws, { t: 'vendHome', x: Math.round(v.hl.tx), y: Math.round(v.hl.ty), ty: v.type }); }
    } else if (v.st === 6) {   // home: he is the stall now for a moment, then he and the boat vanish
      v.fa = Math.atan2(v.hl.y - v.y, v.hl.x - v.x); if (v.t > 6) return this.vendorGone();
    }
    v.l.tx = v.x; v.l.ty = v.y; v.l.x = v.x; v.l.y = v.y; v.l.trader = v.st === 2 ? v.type : 0;
    if (v.st >= 3 && v.st <= 4 && !P.some(p => !p.down && (Math.hypot(p.x - v.x, p.y - v.y) < VEND.sight || Math.hypot(p.x - v.bx, p.y - v.by) < VEND.sight))) return this.vendorGone();   // out of sight of everybody: he and his boat disappear
  }
  // ===== end of the traveling vendor =====
  clearCabinRes() {   // no trees, rocks or bushes inside a cabin (or right up against its walls)
    for (const c of this.cabins || []) for (const q of this.res) if ((q.isl | 0) === c.isl && Math.abs(q.x - c.x) < c.w / 2 + 110 && Math.abs(q.y - c.y) < c.h / 2 + 110) { q.hp = 0; q.mhp = 0; q.rt = 1e9; }
  }
  addCabinWalls() {   // cabin walls and big furniture are solid; the doors are gates you open with ACT / E. None of it is sent as a wall, saved, or destructible: it is rebuilt from the room code
    this.struct = this.struct.filter(s => s.k !== 'cwall' && !s.cab);
    for (const c of this.cabins || []) {
      for (const sg of cabinSegments(c)) this.struct.push({ id: this.nid++, k: 'cwall', x: sg.x, y: sg.y, len: sg.len, rot: sg.rot, r: sg.r, hp: 0, mhp: 0 });
      c.doorSt = []; for (const d of c.doors) { const sd = d.side, hw = c.w / 2, hh = c.h / 2, dst = { id: this.nid++, k: 'gate', cab: 1, m: 'c', side: sd, x: Math.round(sd === 1 ? c.x + hw : sd === 3 ? c.x - hw : c.x + d.pos), y: Math.round(sd === 2 ? c.y + hh : sd === 0 ? c.y - hh : c.y + d.pos), r: RC.RADIUS.gate, rot: sd % 2 === 0 ? 0 : 2, hp: STRUCT.gate.hp, mhp: STRUCT.gate.hp, open: 0 }; Object.defineProperty(dst, 'cabRef', { value: c, enumerable: false }); c.doorSt.push(dst); this.struct.push(dst); }   // cabin doors take hits like a wood gate (50 HP); a broken one hangs open until morning
    }
  }
  endRun() {   // everyone is down: pay out by days survived, send everyone back to the title screen, and start the room fresh
    const days = Math.max(0, this.night - 1), pay = runPayout(days);
    for (const p of this.players.values()) {
      p.ended = 1; let got = 0;
      if (p.prof && pay > 0) { const before = p.prof.d; award(p, pay, 'run'); got = p.prof.d - before; }
      const by = p.runBy || {}, all = Object.values(by).reduce((s, v) => s + v, 0), total = p.prof ? p.prof.d : 0;
      send(p.ws, { t: 'over', n: days, d: got, total, before: total - all, kills: p.runK || {}, gems: { days: by.run || 0, kills: by.kills || 0, chest: by.chest || 0, other: all - (by.run || 0) - (by.kills || 0) - (by.chest || 0) } });
    }
    eraseSavesOf(this.code);   // no save-scumming: when the game is lost, every saved copy of it (any player's) is deleted
    this.players.clear(); this.away.clear(); this.reset(); this.ended = 1;
  }
  reset() {
    this.c = +process.env.START_C || 0; this.night = +process.env.START_N || 1; this.fire = { fuel: 150, lvl: 1 }; this.aliens = []; this.over = 0;
    for (const r of this.res) r.hp = r.mhp;
    if (process.env.START_BREAKALL) for (const r of this.res) { r.hp = 0; r.rt = 1e9; }   // (test hook: size a worst-case save)
    this.drops = []; this.pend = []; this.struct = []; this.chargerNight = 0; this.islNight = {}; this.boats = []; this.camps = []; this.bullets = []; this.zones = []; this.turrets = []; for (const l of this.loot || []) l.open = 0; this.arrows = []; this.rabbits = []; this.rabT = 0; this.rabFull = 0; this.wolves = []; this.wolfT = 0; this.raidNight = 0; this.scrapFound = !!process.env.START_SCRAPFOUND;
    if (process.env.START_BENCH) this.struct.push({ id: this.nid++, k: 'bench', x: 110, y: 0, r: RC.RADIUS.bench, hp: 0, mhp: 0, rot: 0 });   // (test hook)
    this.vendorGone(); this.vSched = 0; this.addCabinWalls();
    for (const p of this.players.values()) { this.respawn(p); p.gear = {}; p.buff = { speed: 0, regen: 0, dmg: 0 }; p.kb = null; p.slots = []; }
  }
  respawn(p) {
    const c = GC.BY[p.cls]; p.mhp = c.hp; p.hp = c.hp; p.down = 0; p.rev = 0; p.smax = GC.staMax(lvOf(p)); p.sta = p.smax; p.tired = 0; p.staCd = 0;
    const a = Math.random() * 6.283; p.x = Math.cos(a) * 100; p.y = Math.sin(a) * 100;
    if (process.env.START_TRADER) { const l = (this.loot || []).find(x => x.trader === +process.env.START_TRADER); if (l) { p.x = l.tx - 30; p.y = l.ty; return; } }   // (test hook: start next to a trader)
    if (process.env.START_ISL) { const is = this.islands[+process.env.START_ISL]; if (is) { p.x = is.x; p.y = is.y; } }   // (test hook: start on an outer island)
  }
  // a broken tree/rock leaves pickups on the ground after its fall/crumble animation (client shows them when they appear)
  spendSta(p, amt) {   // chopping, mining, picking and attacking cost stamina; while winded (after hitting 0) you can't until it refills to 30%
    if (p.tired || p.sta <= 0) return false;
    p.sta = Math.max(0, p.sta - amt); p.staCd = STA.delay; if (p.sta <= 0) { p.tired = 1; p.staCd = STA.tiredDelay; }
    return true;
  }
  winded(p) { const now = Date.now(); if (now - (p.windedAt || 0) > 1500) { p.windedAt = now; send(p.ws, { t: 'toast', msg: 'Out of breath!' }); } }
  onIsland(p, i) { return i === 0 ? Math.hypot(p.x, p.y) < R + 40 : this.landAt(p.x, p.y, 0) === i; }
  // night enemies for one island. Home always gets them (they gather around the fire); any other island only while someone
  // is standing on it: the same mix (aliens, brutes, the Charger, villager raids), coming ashore, scaled to the island's size
  inFire(x, y, m = 0) { return this.fires().some(F => Math.hypot(x - F.x, y - F.y) < RC.camp(F.f.lvl) + m); }
  outOfFire(x, y) {   // slide a spawn point out of any campfire's range (straight away from that fire)
    for (const F of this.fires()) { const R0 = RC.camp(F.f.lvl) + 30, dx = x - F.x, dy = y - F.y, d = Math.hypot(dx, dy); if (d < R0) { const k = R0 / (d || 1); x = F.x + (d ? dx * k : R0); y = F.y + (d ? dy * k : 0); } }
    return [x, y];
  }
  spawnA(a) { if (!this.inFire(a.x, a.y)) this.aliens.push(a); }   // enemies never appear inside a campfire's range
  nightSpawns(i, P, dt) {
    const is = this.islands[i], home = i === 0, here = P.filter(p => !p.boat && this.onIsland(p, i));
    if (!home && !here.some(p => !p.down)) return;
    const st = home ? this : (this.islNight[i] = this.islNight[i] || { chargerNight: 0, raidNight: 0 });
    const size = home ? 1 : Math.min(1, Math.max(0.15, is.r / R));   // never more than home gets
    const at0 = (ang, out = 0) => home ? [Math.cos(ang) * (ALIEN_R + out), Math.sin(ang) * (ALIEN_R + out)] : [is.x + Math.cos(ang) * (RC.edgeR(is, ang) - 40), is.y + Math.sin(ang) * (RC.edgeR(is, ang) - 40)];
    const at = (ang, out = 0) => { let [x, y] = this.outOfFire(...at0(ang, out)); if (!home) { const dx = x - is.x, dy = y - is.y, d = Math.hypot(dx, dy); const er = RC.edgeRat(is, x, y) - 40; if (d > er) { x = is.x + dx * er / d; y = is.y + dy * er / d; } } return [x, y]; };   // never inside a campfire's range
    let want = Math.min(40, 2 + this.night * 2); if (this.night % 5 === 0) want = Math.floor(want * 1.5);
    if (!home) want = Math.max(2, Math.round(want * size));
    if (this.night >= CHARGER.firstNight && st.chargerNight !== this.night) {
      st.chargerNight = this.night; const [x, y] = at(Math.random() * 6.283), hp = 1;   // it cannot be hurt; hp only exists so dawn can remove it
      this.spawnA({ id: this.nid++, isl: i, x, y, hp, mhp: hp, sp: Math.min(CHARGER.spMax, CHARGER.sp0 + CHARGER.spPerNight * (this.night - CHARGER.firstNight)), dmg: CHARGER.dmg, k: 2, cd: 0, rad: CHARGER.rad, reach: CHARGER.reach, stop: CHARGER.stop });
    }
    if (this.night % 5 === 0 && st.raidNight !== this.night) {   // every 5th night villagers raid: 3 the first time, one more each time, stronger every night
      st.raidNight = this.night; const n = 3 + (this.night / 5 - 1), s = 1 + 0.04 * (this.night - 1), a0 = Math.random() * 6.283, arch = Math.floor(n / 2);
      for (let k = 0; k < n; k++) {
        const [x, y] = at(a0 + (k - (n - 1) / 2) * (home ? 0.22 : 0.5), 40), archer = k < arch, hp = Math.round((archer ? 30 : 45) * s);
        this.spawnA({ id: this.nid++, isl: i, x, y, hp, mhp: hp, sp: archer ? 70 : 80, dmg: (archer ? VIL_DMG.arrow : VIL_DMG.melee) * s, k: archer ? 4 : 3, cd: 0, atkCd: 1.5, reach: archer ? 0 : 30, stop: archer ? 250 : 22, range: 290, aim: 0, shotCd: 0 });
      }
      for (const q of home ? P : here) send(q.ws, { t: 'raid', n });
    }
    if (this.aliens.filter(a => (a.isl | 0) === i && a.k < 2).length < want && Math.random() < dt * 2) {
      const [x, y] = at(Math.random() * 6.283), brute = this.night % 5 === 0 && Math.random() < 0.2;
      if (this.night > 15 && !brute && Math.random() < Math.min(0.45, 0.2 + 0.02 * (this.night - 16))) {   // after day 15: spitters - slow, fragile, they stay back and now and then lob a slow glob of acid
        this.spawnA({ id: this.nid++, isl: i, x, y, hp: 40 + Math.min(40, this.night), mhp: 40 + Math.min(40, this.night), sp: 55, dmg: 0, k: 0, spit: 1, cd: 0, reach: 0, stop: 230, spitCd: 2 + Math.random() * 3 }); return;
      }
      this.spawnA({ id: this.nid++, isl: i, x, y, hp: brute ? 120 : 30, mhp: brute ? 120 : 30, sp: brute ? 55 : 70 + Math.min(30, this.night * 2), dmg: brute ? 20 : 10, k: brute ? 1 : 0, cd: 0 });
    }
  }
  landAt(x, y, m = 30) { for (let i = 0; i < this.islands.length; i++) { const s = this.islands[i]; if (RC.inIsland(s, x, y, m)) return i; } return -1; }
  isWater(x, y) { if (Math.hypot(x, y) > this.worldR) return false; for (const s of this.islands) if (RC.inIsland(s, x, y, -40)) return false; return true; }
  landPoint(x, y, m = 30) { let best = null, bd = 1e9; for (const s of this.islands) { const d = Math.hypot(x - s.x, y - s.y) - RC.edgeRat(s, x, y); if (d < bd) { bd = d; best = s; } } const dx = x - best.x, dy = y - best.y, L = Math.hypot(dx, dy) || 1, k = Math.min(L, RC.edgeRat(best, x, y) - m) / L; return [best.x + dx * k, best.y + dy * k]; }
  // ----- boats: placed in the water near the shore; two riders, the first one steers -----
  tickBoats(dt) {
    for (const b of this.boats) {   // boats rot away over time; one that falls apart takes everyone aboard down with it
      const bt = RC.BOATS[b.type || 'boat'], storm = this.ph() === 2 && b.riders.length > 0;   // sailing at night: a storm batters the boat
      if (storm && b.stormNight !== this.night) { b.stormNight = this.night; for (const id of b.riders) { const q = this.players.get(id); if (q) send(q.ws, { t: 'toast', msg: 'A storm! The boat is taking a beating - get to shore!' }); } }
      b.storm = storm ? 1 : 0; if (b.life == null) b.life = bt.life; if (b.riders.length) b.life -= dt * (storm ? 8 : 1);   // boats only wear while someone is riding them (a flat rate; 8x in a night storm); parked boats do not age
      if (b.life < bt.life * 0.2 && !b.warned) { b.warned = 1; for (const id of b.riders) { const q = this.players.get(id); if (q) send(q.ws, { t: 'toast', msg: 'The boat is falling apart! Get to shore!' }); } }
      if (b.life <= 0) {
        for (const id of b.riders) { const q = this.players.get(id); if (!q) continue; q.boat = 0; q.hp = 0; q.down = 1; q.rev = 0; q.sea = 1; send(q.ws, { t: 'toast', msg: 'The boat fell apart! Another boat has to reach you to revive you.' }); }
        b.riders = []; b.drv = 0; b.gone = 1;
      }
    }
    if (this.boats.some(b => b.gone)) this.boats = this.boats.filter(b => !b.gone);
    for (const b of this.boats) {
      b.riders = b.riders.filter(id => { const p = this.players.get(id); return p && p.boat === b.id; });
      if (!b.riders.includes(b.drv)) b.drv = b.riders[0] || 0;
      const d = b.drv && this.players.get(b.drv);
      if (d && !d.down) {
        const i = d.inpAt && Date.now() - d.inpAt > 400 ? { dx: 0, dy: 0 } : d.inp; let dx = i.dx, dy = i.dy; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
        if (b.storm) {   // rough seas: the waves keep turning the bow, so your heading wanders, and the boat answers the helm slowly
          b.yawT = (b.yawT || 0) - dt; if (b.yawT <= 0) { b.yawT = 1.2 + Math.random() * 2.5; b.yawTo = (Math.random() - 0.5) * 2.2; }
          b.yaw = (b.yaw || 0) + ((b.yawTo || 0) - (b.yaw || 0)) * Math.min(1, dt * 1.6);
          const c0 = Math.cos(b.yaw), s0 = Math.sin(b.yaw), ndx = dx * c0 - dy * s0; dy = dx * s0 + dy * c0; dx = ndx;
        } else b.yaw = 0;
        if (m > 0.1) {
          const sp = (RC.BOATS[b.type || 'boat'].speed) * (b.storm ? 0.8 : 1) * Math.min(1, m), nx = b.x + dx * sp * dt, ny = b.y + dy * sp * dt;
          if (this.isWater(nx, ny)) { b.x = nx; b.y = ny; } else if (this.isWater(nx, b.y)) b.x = nx; else if (this.isWater(b.x, ny)) b.y = ny;
          const da = ((Math.atan2(dy, dx) - b.ang + Math.PI) % 6.283185 + 6.283185) % 6.283185 - Math.PI; b.ang += da * Math.min(1, dt * (b.storm ? 1.8 : 5));
        }
      }
      b.riders.forEach((id, k) => { const p = this.players.get(id), o = k === 0 ? 12 : -14; p.x = b.x + Math.cos(b.ang) * o; p.y = b.y + Math.sin(b.ang) * o; p.fa = b.ang; });
    }
  }
  // Is this player sealed in by walls / closed gates? A flood fill from the player over a grid (blocked cells = near a wall); if it never gets out of the
  // grid, they are enclosed, and the walls the fill touched are what enemies will attack. Cached for half a second.
  enclosure(p) {
    const now = Date.now(); if (p._enc && now - p._enc.t < 500) return p._enc.walls;
    { const c = this.cabinAt(p.x, p.y); if (c && c.doorSt && c.doorSt.every(d => !d.open)) { const out = c.doorSt.filter(d => d.hp > 0); out.cab = c; p._enc = { t: now, walls: out.length ? out : null }; return p._enc.walls; } }   // shut inside a cabin: the doors are what enemies break
    const CELL = 20, H = 30, walls = this.struct.filter(st => !st.cab && (st.k === 'wall' || (st.k === 'gate' && !st.open)) && Math.abs(st.x - p.x) < H * CELL + 80 && Math.abs(st.y - p.y) < H * CELL + 80);
    let out = null;
    if (walls.length >= 3) {
      const N = 2 * H + 1, blk = new Int16Array(N * N).fill(-1), ox = p.x - H * CELL, oy = p.y - H * CELL;
      walls.forEach((st, wi) => { const len = st.k === 'gate' ? GATE_HALF : 0, a = (st.rot || 0) * Math.PI / 4, ux = Math.cos(a), uy = Math.sin(a), rr = (st.k === 'gate' ? 12 : st.r) + 12;
        const x0 = Math.floor((st.x - len - rr - ox) / CELL), x1 = Math.ceil((st.x + len + rr - ox) / CELL), y0 = Math.floor((st.y - len - rr - oy) / CELL), y1 = Math.ceil((st.y + len + rr - oy) / CELL);
        for (let i = Math.max(0, x0); i <= Math.min(N - 1, x1); i++) for (let j = Math.max(0, y0); j <= Math.min(N - 1, y1); j++) { const cx = ox + (i + .5) * CELL, cy = oy + (j + .5) * CELL, t = Math.max(-len, Math.min(len, (cx - st.x) * ux + (cy - st.y) * uy)); if (Math.hypot(cx - st.x - ux * t, cy - st.y - uy * t) < rr) blk[i * N + j] = wi; } });
      const seen = new Uint8Array(N * N), q = [H * N + H], hit = new Set(); seen[H * N + H] = 1; let escaped = false;
      for (let qi = 0; qi < q.length && !escaped; qi++) {
        const c = q[qi], i = (c / N) | 0, j = c % N;
        if (i === 0 || j === 0 || i === N - 1 || j === N - 1) { escaped = true; break; }
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = (i + di) * N + j + dj; if (seen[n]) continue; if (blk[n] >= 0) { hit.add(blk[n]); continue; } seen[n] = 1; q.push(n); }
      }
      if (!escaped && hit.size) out = [...hit].map(wi => walls[wi]);
    }
    p._enc = { t: now, walls: out }; return out;
  }
  // Walking around walls: a distance map from the player over the same grid the enclosure check uses (blocked cells = near a wall / closed gate).
  // An enemy whose straight line to the player is blocked steps toward the neighbouring cell that is closer (by walking distance), so it goes around instead of pushing at the wall.
  pathField(p) {
    const now = Date.now(); if (p._pf && now - p._pf.t < 400) return p._pf;
    const CELL = 20, H = 30, N = 2 * H + 1, walls = this.struct.filter(st => (st.k === 'wall' || st.k === 'cwall' || (st.k === 'gate' && !st.open)) && Math.abs(st.x - p.x) < H * CELL + 80 + (st.len || 0) && Math.abs(st.y - p.y) < H * CELL + 80 + (st.len || 0));
    if (!walls.length) return (p._pf = { t: now, none: 1 });
    const blk = new Int16Array(N * N).fill(-1), ox = p.x - H * CELL, oy = p.y - H * CELL;
    walls.forEach((st, wi) => { const len = st.k === 'gate' ? GATE_HALF : (st.len || 0), a = (st.rot || 0) * Math.PI / 4, ux = Math.cos(a), uy = Math.sin(a), rr = (st.k === 'gate' ? 12 : st.r) + 12;
      const x0 = Math.floor((st.x - len - rr - ox) / CELL), x1 = Math.ceil((st.x + len + rr - ox) / CELL), y0 = Math.floor((st.y - len - rr - oy) / CELL), y1 = Math.ceil((st.y + len + rr - oy) / CELL);
      for (let i = Math.max(0, x0); i <= Math.min(N - 1, x1); i++) for (let j = Math.max(0, y0); j <= Math.min(N - 1, y1); j++) { const cx = ox + (i + .5) * CELL, cy = oy + (j + .5) * CELL, t = Math.max(-len, Math.min(len, (cx - st.x) * ux + (cy - st.y) * uy)); if (Math.hypot(cx - st.x - ux * t, cy - st.y - uy * t) < rr) blk[i * N + j] = wi; } });
    const dist = new Int16Array(N * N).fill(-1), q = [H * N + H]; dist[H * N + H] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi], i = (c / N) | 0, j = c % N;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = ni * N + nj; if (dist[n] >= 0 || blk[n] >= 0) continue;
        if (di && dj && (blk[(i + di) * N + j] >= 0 || blk[i * N + nj] >= 0)) continue;   // no squeezing diagonally between two wall corners
        dist[n] = dist[c] + 1; q.push(n);
      }
    }
    return (p._pf = { t: now, CELL, N, ox, oy, blk, dist });
  }
  pathStep(p, x, y) {   // null = nothing in the way; otherwise { blocked: true, dir: [dx, dy] | null } (dir = the way round the wall)
    const f = this.pathField(p); if (f.none) return null;
    const { CELL, N, ox, oy, blk, dist } = f, i = Math.floor((x - ox) / CELL), j = Math.floor((y - oy) / CELL); if (i < 0 || j < 0 || i >= N || j >= N) return null;
    let blocked = false; const L = Math.hypot(p.x - x, p.y - y);
    for (let sd = 12; sd < L; sd += 12) { const ci = Math.floor((x + (p.x - x) * sd / L - ox) / CELL), cj = Math.floor((y + (p.y - y) * sd / L - oy) / CELL); if (ci >= 0 && cj >= 0 && ci < N && cj < N && blk[ci * N + cj] >= 0) { blocked = true; break; } }
    if (!blocked) return null;
    let best = null, bd = dist[i * N + j] >= 0 ? dist[i * N + j] : 1e9;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue; const dv = dist[ni * N + nj]; if (dv >= 0 && dv < bd) { bd = dv; best = [ni, nj]; } }
    if (!best) return { blocked: true, dir: null };
    const cx = ox + (best[0] + .5) * CELL, cy = oy + (best[1] + .5) * CELL, d = Math.hypot(cx - x, cy - y) || 1; return { blocked: true, dir: [(cx - x) / d, (cy - y) / d] };
  }
  wallToBreak(x, y) {   // the closest wall / closed gate to an enemy that has been stuck behind walls for a while (as a { st, qx, qy, qr } target)
    const list = this.struct.filter(st => (st.k === 'wall' || (st.k === 'gate' && !st.open)) && st.hp > 0 && Math.abs(st.x - x) < 500 && Math.abs(st.y - y) < 500);
    return list.length ? this.nearWall(list, x, y) : null;
  }
  nearWall(list, x, y) {   // the closest wall of an enclosure to (x, y): { st, qx, qy, qr }
    let best = null, bd = 1e9; for (const st of list) { const [qx, qy, qr] = solidPt(st, x, y), d = Math.hypot(qx - x, qy - y); if (d < bd) { bd = d; best = { st, qx, qy, qr }; } } return best;
  }
  hitWall(st, dmg) { if (st.k === 'cwall' || !(st.hp > 0)) return; st.hp -= dmg; if (st.hp <= 0) { if (st.cab) { st.hp = 0; st.broken = 1; st.open = 1; } else st.dead = 1; } }   // a cabin door is not removed when it breaks: it hangs open (and can't be shut) until morning
  inCabin(c, x, y, m = 0) { return Math.abs(x - c.x) < c.w / 2 + m && Math.abs(y - c.y) < c.h / 2 + m; }
  cabinAt(x, y) { for (const c of this.cabins || []) if (this.inCabin(c, x, y)) return c; return null; }
  // the way to a cabin door from outside: straight to it from the door's side, otherwise round the corners (so enemies don't push into the log walls)
  cabinApproach(c, door, mx, my) {
    const M = 30, MC = 70, x0 = c.x - c.w / 2, x1 = c.x + c.w / 2, y0 = c.y - c.h / 2, y1 = c.y + c.h / 2, ds = door.side;
    const ex = [y0 - M - my, mx - x1 - M, my - y1 - M, x0 - M - mx];   // how far past each side (0 top, 1 right, 2 bottom, 3 left) the enemy stands
    const corner = k => [[x0 - MC, y0 - MC], [x1 + MC, y0 - MC], [x1 + MC, y1 + MC], [x0 - MC, y1 + MC]][k & 3];   // side k runs from corner k to corner k+1
    if (ex[ds] > 0) return null;   // already on the door's side: go straight for it
    const adj = [(ds + 1) & 3, (ds + 3) & 3].filter(k => ex[k] > 0);
    if (adj.length) { const k = adj.sort((a, b) => ex[b] - ex[a])[0]; return corner(k === ((ds + 1) & 3) ? k : ds); }   // round the shared corner
    const op = (ds + 2) & 3; if (ex[op] > 0) { const a = corner(op), b = corner(op + 1); return Math.hypot(a[0] - mx, a[1] - my) < Math.hypot(b[0] - mx, b[1] - my) ? a : b; }
    return null;   // inside the box (or right on the wall): nothing to route round
  }
  // fishing pools: shimmering spots near the shore of any island; walk up and press ACT to fish (the minigame runs on the client, the server checks it)
  stepPools(dt) {   // fish are in the sea: pools just off every island's shore (fish from the beach) and pools out in the open water near players (fish from a boat)
    if (!this.pools) { this.pools = []; this.poolT = 2; }
    this.pools = this.pools.filter(q => q.left > 0 && (q.ttl -= dt) > 0);
    if ((this.poolT -= dt) > 0) return; this.poolT = 2 + Math.random() * 3;
    const kind = () => { const r = Math.random(); return r < 0.06 ? 3 : r < 0.32 ? 2 : 1; }, fish = k => k === 3 ? 1 + Math.floor(Math.random() * 2) : k === 2 ? 2 + Math.floor(Math.random() * 2) : 3 + Math.floor(Math.random() * 3);   // 3-5 common, 2-3 rare, 1-2 legendary fish per pool
    if (Math.random() < 0.6) {   // off a beach
      const i = Math.floor(Math.random() * this.islands.length), is = this.islands[i]; if (this.pools.filter(q => q.isl === i).length >= 4) return;
      const a = Math.random() * 6.283, d = RC.edgeR(is, a) + 40 + Math.random() * 60, x = is.x + Math.cos(a) * d, y = is.y + Math.sin(a) * d;
      if (!this.isWater(x, y) || this.pools.some(q => Math.hypot(q.x - x, q.y - y) < 250)) return;
      const k = kind(); this.pools.push({ id: this.nid++, isl: i, x: Math.round(x), y: Math.round(y), kind: k, left: fish(k), ttl: 200 + Math.random() * 200 });
    } else {   // deep ocean, somewhere ahead of a player
      const P = [...this.players.values()].filter(p => !p.down); if (!P.length || this.pools.filter(q => q.isl < 0).length >= 8) return;
      const p = P[Math.floor(Math.random() * P.length)], a = Math.random() * 6.283, d = 700 + Math.random() * 2200, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (!this.isWater(x, y) || this.islands.some(s => RC.inIsland(s, x, y, -250)) || this.pools.some(q => Math.hypot(q.x - x, q.y - y) < 400)) return;
      const k = kind(); this.pools.push({ id: this.nid++, isl: -1, x: Math.round(x), y: Math.round(y), kind: k, left: fish(k), ttl: 300 + Math.random() * 200 });
    }
  }
  poolNear(p) { let best = null, bd = 150; for (const q of this.pools || []) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; best = q; } } return best; }
  fishDone(p, id, ok) {
    const f = p.fishing; p.fishing = null; if (!f || f.id !== id) return;
    const q = (this.pools || []).find(x => x.id === id), toast = msg => send(p.ws, { t: 'toast', msg });
    if (!q) return toast('The fish swam away.');
    if (!ok || Date.now() - f.t < 2500 || Math.hypot(p.x - q.x, p.y - q.y) > 260) return toast('It got away!');
    q.left--; p['fish' + q.kind] = (p['fish' + q.kind] || 0) + 1;   // the pool holds a few fish; it disappears when they are all caught
    send(p.ws, { t: 'fishCaught', kind: q.kind, left: q.left });
  }
  resGrid() {   // trees, cacti, rocks and ore are solid at their base: a coarse grid so a player only checks what is right beside them
    if (!this._rg || this._rgN !== this.res.length) { this._rgN = this.res.length; const g = new Map(); for (const r of this.res) { if (!RES_R[r.k]) continue; const key = Math.floor(r.x / 200) * 100003 + Math.floor(r.y / 200); (g.get(key) || g.set(key, []).get(key)).push(r); } this._rg = g; }
    return this._rg;
  }
  // sharks: out on the open sea a fin now and then picks a boat with people aboard and chases it; each bite takes 25% of the boat's full life
  stepSharks(dt) {   // (SHARK_OUT: seconds a leaving shark stays for its dive animation)
    if (!this.sharks) this.sharks = [];
    const shoreDist = (x, y) => Math.min(...this.islands.map(s => Math.hypot(x - s.x, y - s.y) - RC.edgeRat(s, x, y)));
    for (const b of this.boats) {   // now and then a ridden boat far from land draws a shark
      if (!b.riders.length || this.sharks.some(s => s.tg === b.id)) continue; if (shoreDist(b.x, b.y) < 700 || Math.random() > dt / 45) continue;
      const a = Math.random() * 6.283, d = 650 + Math.random() * 250, x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d; if (!this.isWater(x, y)) continue;
      this.sharks.push({ id: this.nid++, x, y, fa: a + Math.PI, tg: b.id, cd: 2, bite: 0, ttl: 100 });
      for (const id of b.riders) { const q = this.players.get(id); if (q) send(q.ws, { t: 'toast', msg: '🦈 A shark fin! Keep moving - or get to shore.' }); }
    }
    for (const s of this.sharks) {
      if (s.out !== undefined) { s.out -= dt; continue; }   // leaving: it leaps and splashes back down (the client animates it), then it is gone
      s.ttl -= dt; s.cd -= dt; s.bite -= dt; const b = this.boats.find(x => x.id === s.tg);
      if (!b || !b.riders.length || shoreDist(b.x, b.y) < 450 || s.ttl <= 0) { s.out = SHARK_OUT; continue; }   // the boat is gone, empty, or near land (or it got bored): the shark dives away
      const dx = b.x - s.x, dy = b.y - s.y, d = Math.hypot(dx, dy) || 1; s.fa = Math.atan2(dy, dx);
      if (d > 70) { const nx = s.x + dx / d * 205 * dt, ny = s.y + dy / d * 205 * dt; if (this.isWater(nx, ny)) { s.x = nx; s.y = ny; } }
      else if (s.cd <= 0) {
        s.cd = 4; s.bite = 0.4; b.life -= RC.BOATS[b.type || 'boat'].life * 0.25;
        for (const id of b.riders) { const q = this.players.get(id); if (q) send(q.ws, { t: 'bite' }); }
      }
    }
    if (this.sharks.some(s => s.out <= 0)) this.sharks = this.sharks.filter(s => !(s.out <= 0));
  }
  gateNear(p) { let best = null, bd = 70; for (const st of this.struct) if (st.k === 'gate') { const [qx, qy] = solidPt(st, p.x, p.y), d = Math.hypot(p.x - qx, p.y - qy); if (d < bd) { bd = d; best = st; } } return best; }
  boatNear(p) { let best = null, bd = 125; for (const b of this.boats) { const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; best = b; } } return best; }
  enterBoat(p, b) {
    if (b.riders.length >= RC.BOATS[b.type || 'boat'].riders) { send(p.ws, { t: 'toast', msg: 'The boat is full.' }); return; }
    b.riders.push(p.id); p.boat = b.id; p.sea = 0; if (!b.drv) b.drv = p.id; p.x = b.x; p.y = b.y;
  }
  releaseBoat(p) { if (!p.boat) return; const b = this.boats.find(x => x.id === p.boat); p.boat = 0; if (b) { b.riders = b.riders.filter(id => id !== p.id); if (b.drv === p.id) b.drv = b.riders[0] || 0; } }
  exitBoat(p) {   // step out onto the nearest shore (must be close to land)
    const b = this.boats.find(x => x.id === p.boat); if (!b) { p.boat = 0; return; }
    let best = null, bd = 1e9; for (const s of this.islands) { const d = Math.hypot(b.x - s.x, b.y - s.y) - RC.edgeRat(s, b.x, b.y); if (d < bd) { bd = d; best = s; } }
    if (!best || bd > 120) { send(p.ws, { t: 'toast', msg: 'Sail closer to land to get out.' }); return; }
    const dx = b.x - best.x, dy = b.y - best.y, k = (RC.edgeRat(best, b.x, b.y) - 50) / (Math.hypot(dx, dy) || 1); this.releaseBoat(p); p.x = best.x + dx * k; p.y = best.y + dy * k;
  }
  placeBoat(p, i) {
    const fail = msg => ({ ok: false, msg });
    if (p.down || p.boat) return fail('Not now.'); if (!RC.BOATS[p.slots[i]]) return fail('You have no boat there.');
    const x = p.x + Math.cos(p.fa) * BOAT_AHEAD, y = p.y + Math.sin(p.fa) * BOAT_AHEAD;
    if (!this.isWater(x, y)) return fail('A boat can only go in the water - stand at the shore and face the sea.');
    if (this.boats.some(b => Math.hypot(b.x - x, b.y - y) < 90)) return fail('Too close to another boat.');
    const type = p.slots[i]; p.slots.splice(i, 1); this.boats.push({ id: this.nid++, type, x, y, ang: p.fa, riders: [], drv: 0 });
    return { ok: true, msg: 'Boat placed. Walk up to it and press ACT to get in.' };
  }
  // ===== campfires, loot, traders, abilities =====
  fires() { return [{ f: this.fire, x: 0, y: 0, home: true }, ...this.camps.map(c => ({ f: c, x: c.x, y: c.y }))]; }
  litAt(x, y, margin = 0) { for (const F of this.fires()) if (F.f.fuel > 0 && Math.hypot(x - F.x, y - F.y) < RC.camp(F.f.lvl) + margin) return F; return null; }
  campOf(p) { for (const F of this.fires()) if (Math.hypot(p.x - F.x, p.y - F.y) < RC.camp(F.f.lvl)) return F; return null; }   // the campfire whose ring you stand in (home or a camp on another island)
  inCamp(F, st) { return Math.hypot(st.x - F.x, st.y - F.y) < RC.camp(F.f.lvl); }
  fireNear(p, r = 80) { let best = null, bd = r; for (const F of this.fires()) { const d = Math.hypot(p.x - F.x, p.y - F.y); if (d < bd) { bd = d; best = F; } } return best; }
  placeCampfire(p, i) {   // tap the Campfire in a slot: it is lit where you stand (outer islands only, away from the shore)
    const no = msg => send(p.ws, { t: 'toast', msg });
    if (p.boat) return no('Not from a boat.');
    const ii = this.landAt(p.x, p.y); if (ii <= 0) return no('Campfires go on the outer islands - home already has its fire.');
    const is = this.islands[ii]; if (!RC.inIsland(is, p.x, p.y, 250)) return no('Too close to the shore.');
    if (this.camps.some(c => c.isl === ii)) return no('This island already has a campfire - only one per island.');
    if (this.camps.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 260)) return no('Too close to another campfire.');
    if (this.res.some(r => r.isl === ii && Math.hypot(r.x - p.x, r.y - p.y) < 140)) return no('Too close to a tree, rock, bush or ore - find a clearer spot.');   // (resources are checked even while they are chopped and regrowing)
    p.slots.splice(i, 1); this.camps.push({ id: this.nid++, isl: ii, x: p.x, y: p.y, fuel: 120, lvl: 1 }); send(p.ws, { t: 'camped' });
  }
  lootNear(p, kind) {
    for (const l of this.loot) {
      if (kind === 'chest') { if (l.tier && !l.open && Math.hypot(p.x - l.cx, p.y - l.cy) < 80) return l; }
      else if (l.trader && Math.hypot(p.x - l.tx, p.y - l.ty) < 100) return l;
    }
    return null;
  }
  openChest(p, l) {
    const R2 = (a, b) => a + Math.floor(Math.random() * (b - a + 1)), got = [];
    const give = (k, n, e) => { n = Math.min(n, BAG_MAX - (p[k] || 0)); if (n > 0) { p[k] = (p[k] || 0) + n; got.push('+' + n + ' ' + e); } };
    const t = l.tier;
    const ammo = (chance, mult) => { if (Math.random() < chance) { if (Math.random() < 0.6) { const n = Math.min(R2(6, 12) * mult, BAG_MAX - (p.ammoP || 0)); if (n > 0) { p.ammoP = (p.ammoP || 0) + n; got.push('+' + n + ' pistol rounds'); } } else { const n = Math.min(R2(3, 5) * mult, BAG_MAX - (p.ammoR || 0)); if (n > 0) { p.ammoR = (p.ammoR || 0) + n; got.push('+' + n + ' rifle rounds'); } } } };   // ammunition turns up in chests and cabin furniture
    if (l.kind && l.kind !== 'chest') {   // cabin furniture: scrap, and often something better (gold, a pelt, now and then a gem)
      give('scrap', R2(2, 5), '🔩'); const x = Math.random();
      if (x < 0.30) give('gold', R2(1, 2), '🪙'); else if (x < 0.50) give('pelt', 1, '🐺'); if (Math.random() < 0.04) { award(p, 1, 'chest'); got.push('+1 💎'); } ammo(0.35, 1);
      l.open = 1; this.scrapFound = true; send(p.ws, { t: 'loot', tier: 1, msg: { cabinet: 'Cabinet', barrel: 'Barrel', crate: 'Crate', shelf: 'Shelf' }[l.kind] + ': ' + got.join('  ') }); return;
    }
    // chests hold only what the traders want: scrap and gold (pelts come from wolves)
    give('scrap', t === 1 ? R2(2, 4) : t === 2 ? R2(5, 8) : R2(9, 14), '🔩'); if (t >= 2) give('gold', t === 2 ? R2(1, 2) : R2(3, 5), '🪙');
    const dia = t === 3 ? R2(2, 4) : t === 2 && Math.random() < 0.3 ? 1 : 0; if (dia) { award(p, dia, 'chest'); got.push('+' + dia + ' 💎'); }
    ammo(t === 1 ? 0.25 : 0.5, t === 3 ? 2 : 1);
    l.open = 1; this.scrapFound = this.scrapFound || got.some(g => g.includes('🔩'));
    send(p.ws, { t: 'loot', tier: t, msg: ['', 'Small', 'Silver', 'Golden'][t] + ' chest: ' + got.join('  ') });
  }
  trade(p, lid, offerId) {
    const fail = msg => ({ ok: false, msg }), l = this.loot.find(x => x.id === lid);
    if (!l || !l.trader || p.down) return fail('No trader here.');
    if (Math.hypot(p.x - l.tx, p.y - l.ty) > 150) return fail('Stand next to the trader.');
    let cost, apply;
    if (l.trader === 5) {
      const cid = String(offerId).replace('abil:', ''), c = GC.BY[p.cls];   // only the ability of the character you are playing, and only for this game
      if (!c || cid !== p.cls) return fail('That ability belongs to a different character.');
      if (p.abilOn) return fail('Already unlocked for this game.');
      cost = GC.abilCost(c); apply = () => { p.abilOn = 1; };
    } else {
      const o = RC.TRADERS[l.trader].offers.find(x => x.id === offerId); if (!o) return fail('Unknown offer.');
      if (o.armor && (p.gear.armor || 0) >= o.armor) return fail('You already wear equal or better armor.'); if (o.gear && p.gear[o.gear]) return fail('You already have that.');
      cost = o.cost;
      apply = () => {
        if (o.armor) p.gear.armor = o.armor; else if (o.gear) { p.gear[o.gear] = true; if (o.gear === 'pistol' || o.gear === 'rifle') { p.wpn = o.gear; if (o.gear === 'pistol') { p.magP = GUN_MAG.pistol; p.ammoP = (p.ammoP || 0) + 18; } else { p.magR = GUN_MAG.rifle; p.ammoR = (p.ammoR || 0) + 9; } p.reload = null; } }   // a gun you just bought is selected, and comes with some rounds
        else if (o.ammo) p['ammo' + o.ammo] = (p['ammo' + o.ammo] || 0) + o.amt;
        else if (o.item) { if (p.slots.length < slotCap(p, this)) p.slots.push(o.item); else { const q = this.landPoint(p.x + 30, p.y + 30, 50); this.pend.push({ k: 'q', food: o.item, x: q[0], y: q[1], t: 0.2 }); } }
      };
    }
    for (const k in cost) if ((p[k] || 0) < cost[k]) return fail('You need ' + Object.entries(cost).map(([a, b]) => b + ' ' + a).join(', ') + '.');
    for (const k in cost) p[k] -= cost[k]; apply();
    return { ok: true, msg: 'Deal!' };
  }
  hurt(p, d) {   // every hit on a player goes through here (armor, Bulwark, Blood Rage)
    const B = p.buff; if (B.invuln > 0) return; d *= 1 - Math.min(0.6, RC.ARMOR[p.gear.armor || 0] + RC.armorOf(p.gear)); if (B.shield > 0) d *= 0.3; if (B.rage > 0) d *= 1.5;
    p.hp -= d; if (p.hp <= 0) { p.hp = 0; p.down = 1; p.rev = 0; }
  }
  killKey(a) {   // what kind of creature was that (for the game-over kill list)
    if (a.rab) return a.crit || 'rabbit'; if (a.vul) return 'vulture'; if (a.sp) return a.sp; if (a.big === 1) return 'bear'; if (a.big === 2) return 'mammoth'; if (a.wolf) return a.alpha ? 'alpha' : 'wolf';
    if (a.spit) return 'spitter'; if (a.k === 1) return 'brute'; if (a.k === 5) return 'mage'; if (a.k === 6) return 'zealot'; if (a.k >= 3) return 'villager'; return 'alien';
  }
  tally(p, a) { p.runK = p.runK || {}; const k = this.killKey(a); p.runK[k] = (p.runK[k] || 0) + 1; gainXp(p, a.k === 2 && !a.wolf && !a.rab ? KILL_XP.charger : KILL_XP[k] || 2); }
  killCredit(p, a) { if (a.hp <= 0 && !a.cred) { a.cred = 1; this.tally(p, a); if (p.prof) { p.prof.k++; dirty = true; if (p.prof.k % 10 === 0) award(p, 1, 'kills'); } } }
  aoe(p, x, y, r, dmg, stun) {   // damage (and stun) every alien and wolf in a circle; the Charger cannot be hurt
    for (const a of this.aliens) if (a.hp > 0 && a.k !== 2 && Math.hypot(a.x - x, a.y - y) < r) { a.hp -= dmg; if (stun) a.stunT = stun; this.killCredit(p, a); }
    for (const w of this.wolves || []) if (w.hp > 0 && !w.air && Math.hypot(w.x - x, w.y - y) < r) { w.hp -= dmg; w.st = 1; w.tg = p.id; this.killCredit(p, w); }
    for (const q of this.players.values()) send(q.ws, { t: 'fx', k: 'boom', x, y, r });
  }
  shoot(p, ang, dmg, speed, ttl, kind) { this.bullets.push({ id: this.nid++, x: p.x, y: p.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, dmg, ttl, owner: p.id, kind: kind || 0 }); }
  useAbility(p) {
    const c = GC.BY[p.cls], ab = GC.ABIL[p.cls], no = msg => send(p.ws, { t: 'toast', msg });
    if (!ab || p.down || p.boat) return;
    if (!p.abilOn) return no('Locked - find an Ability Unlocker trader on the outer islands.');
    if (p.abilCd > 0) return no(ab.n + ' is recharging (' + Math.ceil(p.abilCd) + 's).');
    const B = p.buff, R2 = (a, b) => a + Math.floor(Math.random() * (b - a + 1)), here = this.landAt(p.x, p.y), all = [...this.players.values()];
    const ahead = d => [p.x + Math.cos(p.fa) * d, p.y + Math.sin(p.fa) * d];
    switch (ab.id) {
      case 'timber': case 'quake': {
        let n = 0; for (const r of this.res) if (r.hp > 0 && (ab.id === 'timber' ? WOODY(r.k) : ROCKY(r.k)) && Math.hypot(r.x - p.x, r.y - p.y) < 260) { r.hp = 0; r.rt = 45 + Math.random() * 30; this.spill(r, Math.max(1, Math.round(SPILL[r.k] * (ab.id === 'timber' ? c.wood : c.stone)))); n++; }
        this.rForce = 1; for (const q of all) send(q.ws, { t: 'fx', k: 'boom', x: p.x, y: p.y, r: 260 }); if (!n) return no('Nothing in reach.'); break; }
      case 'harvest': { for (const r of this.res) if (r.k === 'b' && Math.hypot(r.x - p.x, r.y - p.y) < 500 && !this.fires().some(F => Math.hypot(r.x - F.x, r.y - F.y) < RC.camp(F.f.lvl))) r.hp = r.mhp; p.food = Math.min(BAG_MAX, p.food + Math.round(8 * c.food)); this.rForce = 1; break; }
      case 'grenade': { const [x, y] = ahead(260); this.aoe(p, x, y, 130, 60, 2); break; }
      case 'meteor': { const [x, y] = ahead(350); this.aoe(p, x, y, 170, 120, 1); break; }
      case 'inferno': this.aoe(p, p.x, p.y, 220, 50, 2); break;
      case 'signal': { const F = this.fireNear(p, 600); if (!F) return no('No campfire close enough.'); F.f.fuel = RC.fuelMax(F.f.lvl); F.f.slow = 60; break; }
      case 'massrevive': for (const q of all) { if (q.down) { q.down = 0; q.rev = 0; q.hp = q.mhp * 0.5; } q.hp = Math.min(q.mhp, q.hp + q.mhp * 0.3); send(q.ws, { t: 'fx', k: 'heal' }); } break;
      case 'sprint': B.haste = 6; break;
      case 'bulwark': for (const q of all) if (!q.down && Math.hypot(q.x - p.x, q.y - p.y) < 220) B.shield = 8, q.buff.shield = 8; break;
      case 'volley': for (let k = 0; k < 16; k++) this.shoot(p, k / 16 * 6.2832, 25, 700, 0.6, 1); break;
      case 'flurry': B.flurry = 6; break;
      case 'turret': this.turrets.push({ id: this.nid++, x: p.x, y: p.y, ttl: 20, cd: 0, owner: p.id }); break;
      case 'totem': this.zones.push({ id: this.nid++, k: 1, x: p.x, y: p.y, r: 300, ttl: 8 }); break;
      case 'beacon': this.zones.push({ id: this.nid++, k: 2, x: p.x, y: p.y, r: 260, ttl: 10 }); break;
      case 'rage': B.rage = 8; break;
      case 'jackpot': { p.wood += R2(20, 40); p.stone += R2(20, 40); p.food += R2(6, 12); p.scrap += R2(3, 8); for (const k of BAG_KEYS) if (p[k] > BAG_MAX) p[k] = BAG_MAX; if (Math.random() < 0.25) award(p, R2(1, 3), 'jackpot'); break; }
      case 'rally': for (const q of all) if (!q.down && !q.boat && this.landAt(q.x, q.y) === here) { q.hp = Math.min(q.mhp, q.hp + q.mhp * 0.4); q.buff.speed = 8; } break;
      case 'shadowstep': { const [x, y] = ahead(380); if (this.landAt(x, y) >= 0) { p.x = x; p.y = y; } else { const q = this.landPoint(x, y); p.x = q[0]; p.y = q[1]; } B.crit3 = 10; break; }
      case 'legendary': p.hp = p.mhp; B.power = 8; break;
    }
    p.abilCd = ab.cd; send(p.ws, { t: 'abilUsed', n: ab.n, b: p.buff });
  }
  stepBattle(P, dt) {   // bullets, turrets and zones (totems, beacons)
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.ttl -= dt; let dead = b.ttl <= 0; const owner = this.players.get(b.owner);
      if (!dead) for (const a of this.aliens) if (a.hp > 0 && a.k !== 2 && Math.hypot(a.x - b.x, a.y - b.y) < (a.rad || 22)) {
        if (a.k === 6) { let da = Math.atan2(-b.vy, -b.vx) - (a.fa || 0); da = Math.atan2(Math.sin(da), Math.cos(da)); if (Math.abs(da) < 1.9) { dead = true; for (const q of this.players.values()) if (Math.hypot(q.x - a.x, q.y - a.y) < 900) send(q.ws, { t: 'fx', k: 'block', x: Math.round(a.x + Math.cos(a.fa || 0) * 20), y: Math.round(a.y + Math.sin(a.fa || 0) * 20) }); break; } }   // the zealot's shield stops everything shot at it from the front
        a.hp -= b.dmg; if (owner) this.killCredit(owner, a); dead = true; break; }
      if (!dead) for (const w of this.wolves || []) if (w.hp > 0 && !w.air && Math.hypot(w.x - b.x, w.y - b.y) < 24) { w.hp -= b.dmg; w.st = 1; w.tg = b.owner; if (owner) this.killCredit(owner, w); dead = true; break; }
      if (!dead) for (const q of this.rabbits || []) if (q.hp > 0 && Math.hypot(q.x - b.x, q.y - b.y) < 16) { if (owner) this.tally(owner, q); this.killRabbit(q); dead = true; break; }   // scorpions and the other small creatures can be shot too
      if (dead) this.bullets.splice(i, 1);
    }
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i]; t.ttl -= dt; t.cd -= dt; if (t.ttl <= 0) { this.turrets.splice(i, 1); continue; }
      if (t.cd <= 0) { let best = null, bd = 450; for (const a of this.aliens) if (a.hp > 0 && a.k !== 2) { const d = Math.hypot(a.x - t.x, a.y - t.y); if (d < bd) { bd = d; best = a; } }
        if (best) { t.cd = 0.8; const ang = Math.atan2(best.y - t.y, best.x - t.x); this.bullets.push({ id: this.nid++, x: t.x, y: t.y, vx: Math.cos(ang) * 800, vy: Math.sin(ang) * 800, dmg: 14, ttl: 0.7, owner: t.owner, kind: 2 }); } }
    }
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i]; z.ttl -= dt; if (z.ttl <= 0) { this.zones.splice(i, 1); continue; }
      if (z.k === 1) { for (const q of P) if (!q.down && Math.hypot(q.x - z.x, q.y - z.y) < z.r) q.hp = Math.min(q.mhp, q.hp + 8 * dt); for (const a of this.aliens) if (a.k !== 2 && Math.hypot(a.x - z.x, a.y - z.y) < z.r) a.slowT = 0.3; }
      else for (const a of this.aliens) if (a.k !== 2) { const dx = a.x - z.x, dy = a.y - z.y, d = Math.hypot(dx, dy); if (d < z.r) { const k = Math.min(z.r - d, 220 * dt) / Math.max(1, d); a.x += dx * k; a.y += dy * k; } }
    }
  }
  spill(r, n) {
    const wood = WOODY(r.k), delay = wood ? .95 : .5, kind = wood ? 'w' : r.k === 'b' ? 'f' : r.k === 'g' ? 'o' : 's';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, d = 24 + Math.random() * 28; let x = r.x + Math.cos(a) * d, y = r.y + Math.sin(a) * d;
      { const s = this.islands[r.isl | 0] || this.islands[0], dx = x - s.x, dy = y - s.y, dd = Math.hypot(dx, dy), er = RC.edgeRat(s, x, y) - 40; if (dd > er) { x = s.x + dx * er / dd; y = s.y + dy * er / dd; } }
      this.pend.push({ k: kind, x, y, t: delay });
    }
  }
  craft(p, id, rot) {
    const r = RC.BY[id], fail = msg => ({ ok: false, msg });
    if (!r) return fail('Unknown recipe.');
    if (p.down) return fail('You are down.');
    const CF = this.campOf(p), hasBench = !!CF && this.struct.some(st => st.k === 'bench' && this.inCamp(CF, st));
    if (r.kind === 'bench' && hasBench) return fail('This camp already has a crafting bench.');
    if (r.kind !== 'bench' && !hasBench) return fail(CF ? 'Build a crafting bench in this camp first.' : 'Stand inside a camp to craft.');
    if (r.kind === 'gear' && p.gear[r.gear]) return fail('You already have that.');
    if (!this.canPay(p, r.cost)) return fail('Not enough materials (your bag plus the chests).');
    if (r.kind === 'boat' || r.kind === 'item') {   // items (boat, trap) go into a free slot, or onto the floor next to you when all 3 are full
      if (r.scrap && !this.scrapFound && !(p.scrap >= 1)) return fail('Nobody has found scrap yet.');
      this.pay(p, r.cost); const it = r.item || 'boat';
      if (p.slots.length < slotCap(p, this)) { p.slots.push(it); return { ok: true, msg: r.n + ' crafted - it is in your slot.' }; }
      const q = this.landPoint(p.x + 30, p.y + 30, 50); this.pend.push({ k: 'q', food: it, x: q[0], y: q[1], t: 0.2 });
      return { ok: true, msg: r.n + ' crafted - your slots are full, so it dropped on the floor.' };
    }
    if (r.kind !== 'gear') {
      if (!CF) return fail('Stand inside a camp to build.');
      const x = p.x + Math.cos(p.fa) * 58, y = p.y + Math.sin(p.fa) * 58, d = Math.hypot(x - CF.x, y - CF.y), campR = RC.camp(CF.f.lvl), isl = this.islands[CF.f.isl | 0] || this.islands[0];
      const sr = STRUCT[r.kind].r, station = r.kind !== 'wall' && r.kind !== 'trap' && r.kind !== 'gate' && r.kind !== 'spike';
      if (d < RC.fireClear(r.kind)) return fail('Too close to the fire. Nothing can be built on or against it.');
      if (station && d > campR) return fail('Stand inside the camp (the fire ring), a little away from the fire, facing a free spot.');
      if (!station && d > campR + 200) return fail('Walls and traps go in or just outside the camp.');
      if (!RC.inIsland(isl, x, y, 50)) return fail('Too close to the water.');
      if (this.struct.filter(st => st.k === r.kind && (st.m || '') === (r.mat || '') && this.inCamp(CF, st)).length >= (r.max || 99)) return fail('You have built the maximum number of those.');
      for (const st of this.struct) {   // nothing may be crafted too close to anything else
        const stWall = st.k === 'wall' || st.k === 'gate' || st.k === 'spike', dd = Math.hypot(st.x - x, st.y - y);
        const need = station && !stWall ? RC.STATION_GAP : (station || !stWall) ? RC.WALL_GAP : st.r + sr - 4;
        if (dd < need) return fail(need > 60 ? 'Too close to another structure. Keep stations about ' + RC.STATION_GAP + ' apart (walls about ' + RC.WALL_GAP + ' from stations).' : 'Something is already there. Turn and try another spot.');
      }
      this.pay(p, r.cost);
      const st = { id: this.nid++, k: r.kind, x, y, r: sr, hp: r.hp || STRUCT[r.kind].hp || 0, mhp: r.hp || STRUCT[r.kind].hp || 0, m: r.mat || undefined, rot: r.norot ? 0 : ((Math.trunc(+rot) || 0) % 8 + 8) % 8, items: r.kind === 'chest' ? { wood: 0, stone: 0, food: 0, scrap: 0 } : null, smelt: r.kind === 'smelter' ? { q: 0, prog: 0 } : null }; this.struct.push(st);
      return { ok: true, msg: r.kind === 'bench' ? 'Crafting bench placed! More recipes unlocked.' : r.n + ' placed.' };
    }
    this.pay(p, r.cost); p.gear[r.gear] = 1;
    return { ok: true, msg: r.n + ' crafted!' };
  }
  dismantle(p, id) {   // take a bench / chest / pot / smelter apart: its building materials drop around it for anyone to pick up
    const fail = msg => ({ ok: false, msg }), st = this.struct.find(s => s.id === id);
    if (!st || !['bench', 'chest', 'pot', 'smelter'].includes(st.k)) return fail('Nothing to dismantle.');
    if (p.down) return fail('You are down.'); if (!this.near(p, st)) return fail('Stand next to it to dismantle it.');
    const r = RC.LIST.find(x => x.kind === st.k); let wood = r.cost.wood, stone = r.cost.stone, extra = '';
    if (st.k === 'chest' && st.items) { const spill = { w: 0, s: 0, f: 0, c: 0 }; for (const [k, key] of [['wood', 'w'], ['stone', 's'], ['food', 'f'], ['scrap', 'c']]) { const n = st.items[k] || 0, fit = Math.max(0, Math.min(n, BAG_MAX - (p[k] || 0))); p[k] = (p[k] || 0) + fit; spill[key] = Math.min(n - fit, 25); }
      for (const [k, n] of Object.entries(spill)) for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, d = st.r + 16 + Math.random() * 30; this.pend.push({ k: k === 'c' ? 'm' : k, x: st.x + Math.cos(a) * d, y: st.y + Math.sin(a) * d, t: 0.45 }); }
      extra = ' What was inside went into your bag; what did not fit (99 max) is on the floor.'; }
    if (st.k === 'smelter' && st.smelt && st.smelt.q) stone += st.smelt.q * RC.SMELT.cost;   // rocks that were queued come back
    this.struct = this.struct.filter(s => s !== st);
    if (this.drops.length + this.pend.length + wood + stone > 150) { p.wood = Math.min(BAG_MAX, p.wood + wood); p.stone = Math.min(BAG_MAX, p.stone + stone); }   // too much already on the floor: straight into the bag
    else for (const [k, n] of [['w', wood], ['s', stone]]) for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, d = st.r + 16 + Math.random() * 30; this.pend.push({ k, x: st.x + Math.cos(a) * d, y: st.y + Math.sin(a) * d, t: 0.45 }); }
    return { ok: true, msg: r.n + ' dismantled.' + extra };
  }
  smelterLoad(p, id, n) {   // put rocks into the smelter from its menu: n batches of 5 rocks (1 scrap each). It only runs while it has rocks in it
    const st = this.struct.find(s => s.id === id && s.k === 'smelter'), fail = msg => ({ ok: false, msg });
    if (!st || p.down || !this.near(p, st)) return fail('Stand next to the smelter.');
    n = Math.max(1, Math.min(RC.SMELT.queue, Math.trunc(+n) || 1));
    const room = RC.SMELT.queue - st.smelt.q, afford = Math.floor(this.pool(p, 'stone') / RC.SMELT.cost), k = Math.min(n, room, afford);
    if (room <= 0) return fail('The smelter is full.');
    if (k <= 0) return fail('Need ' + RC.SMELT.cost + ' rocks to smelt (your bag plus the chests).');
    this.pay(p, { stone: k * RC.SMELT.cost }); if (st.smelt.q === 0) st.smelt.prog = 0; st.smelt.q += k;
    return { ok: true, msg: 'Put in ' + k * RC.SMELT.cost + ' rocks.' };
  }
  // Materials are drawn from the crafter's own bag first, then from the chests (oldest chest first). Chests are put-only.
  pool(p, res) { let n = p[res] || 0; for (const t of this.struct) if (t.items) n += t.items[res] || 0; return n; }
  canPay(p, cost) { for (const k in cost) if (cost[k] && this.pool(p, k) < cost[k]) return false; return true; }
  pay(p, cost) {
    for (const k in cost) {
      let need = cost[k] || 0; if (!need) continue;
      const own = Math.min(p[k] || 0, need); p[k] -= own; need -= own;
      for (const t of this.struct) { if (!need) break; if (!t.items) continue; const take = Math.min(t.items[k] || 0, need); t.items[k] -= take; need -= take; }
    }
  }
  near(p, st) { return Math.hypot(p.x - st.x, p.y - st.y) < st.r + REACH + 30; }
  chestOp(p, id, res, n) {   // shared storage, put-only: anyone may deposit; nothing can be taken out (crafting uses it automatically)
    const st = this.struct.find(s => s.id === id && s.k === 'chest');
    if (!st || p.down || !this.near(p, st) || !['wood', 'stone', 'food', 'scrap'].includes(res)) return;
    n = Math.max(-1e6, Math.min(1e6, Math.trunc(+n) || 0)); if (!n) return;
    if (n <= 0) return;   // no withdrawing
    const k = Math.min(n, p[res], CHEST_CAP - st.items[res]); p[res] -= k; st.items[res] += k;
  }
  cook(p, id) {
    const f = RC.FOOD_BY[id], fail = msg => ({ ok: false, msg });
    if (!f) return fail('Unknown recipe.'); if (p.down) return fail('You are down.');
    if (!this.struct.some(s => s.k === 'pot' && this.near(p, s))) return fail('Stand next to a cooking pot.');
    for (const k in f.cost) if (this.pool(p, k) < f.cost[k]) return fail('Not enough ' + (k === 'meat' ? 'meat' : k.startsWith('fish') ? 'fish' : 'berries') + ' (your bag plus the chests).');
    this.pay(p, f.cost);
    const pot = this.struct.find(s => s.k === 'pot' && this.near(p, s)), a = Math.PI * (0.15 + Math.random() * 0.7), dd = pot.r + 24 + Math.random() * 18;
    this.pend.push({ k: 'q', food: id, x: pot.x + Math.cos(a) * dd, y: pot.y + Math.sin(a) * dd, t: 0.45 });   // the dish pops out of the pot and lands on the floor to be picked up
    return { ok: true, msg: f.n + ' popped out of the pot!' };
  }
  useSlot(p, i) {   // eat/drink what is in one of your 3 slots, or set a trap down where you stand
    const id = p.slots[i]; if (p.down || !id) return;
    if (id === 'trap') {
      const no = msg => send(p.ws, { t: 'toast', msg });
      if (p.boat) return no('Not from a boat.');
      if (Math.hypot(p.x, p.y) < RC.fireClear('trap')) return no('Too close to the fire.');
      if (this.struct.some(st => st.k === 'trap' && Math.hypot(st.x - p.x, st.y - p.y) < RC.RADIUS.trap * 2)) return no('There is already a trap here.');
      p.slots.splice(i, 1);
      this.struct.push({ id: this.nid++, k: 'trap', x: p.x, y: p.y, r: STRUCT.trap.r, hp: 0, mhp: 0, rot: 0, items: null, smelt: null });
      send(p.ws, { t: 'trapSet' }); return;
    }
    if (id === 'campfire') return this.placeCampfire(p, i);
    if (id === 'foot') return send(p.ws, { t: 'toast', msg: "Your lucky rabbit's foot. Hold on to it." });
    if (!RC.FOOD_BY[id]) return;
    p.slots.splice(i, 1);
    if (id === 'steak') p.hp = Math.min(p.mhp, p.hp + 80);
    else if (id === 'juice') p.hp = Math.min(p.mhp, p.hp + 40);
    else if (id === 'tea') p.buff.speed = 60;
    else if (id === 'fishc') { p.hp = Math.min(p.mhp, p.hp + 50); p.buff.regen = Math.max(p.buff.regen || 0, 15); }
    else if (id === 'fishr') { p.hp = p.mhp; p.buff.regen2 = Math.max(p.buff.regen2 || 0, 30); }
    else if (id === 'fishl') p.buff.invuln = 10;
    send(p.ws, { t: 'ate', id, msg: RC.FOOD_BY[id].n, b: p.buff });
  }
  // rabbits: live in the forest (all of home, the forest quarter of the other islands), run slowly from people, slide along the coast
  critOk(b, x, y) {   // is this a place where that kind of creature belongs (its own biome)?
    const C = CRIT[b.crit || 'rabbit'], is = this.islands[b.isl | 0] || this.islands[0];
    if ((b.isl | 0) === 0) return C.b === 'f' ? true : C.b === 's' ? RC.inSnow(x, y) : false;
    return RC.biomeAt(is.x, is.y, is.r, is.b, x, y) === C.b;
  }
  rabSpot(i, key = 'rabbit') {
    const is = this.islands[i], C = CRIT[key];
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * (RC.edgeR(is, a) - RAB.edge - 20), x = is.x + Math.cos(a) * d, y = is.y + Math.sin(a) * d;
      if (i === 0 ? (C.b === 'f' ? Math.hypot(x, y) < RC.camp(3) + 60 : !RC.inSnow(x, y)) : RC.biomeAt(is.x, is.y, is.r, is.b, x, y) !== C.b) continue;   // not in camp / only in its own biome
      if ([...this.players.values()].some(p => Math.hypot(p.x - x, p.y - y) < 500)) continue;   // never pop in next to someone
      return [x, y];
    }
    return null;
  }
  stepRabbits(P, dt) {
    if (!this.rabbits) this.rabbits = [];
    if ((this.rabT = (this.rabT || 0) - dt) <= 0) {   // top the forests back up, one per island at a time - only islands with a player near; an island's animals all appear at once when someone arrives
      this.rabT = RAB.respawn; const act = this.act || new Set(); this.popR = this.popR || new Set();
      for (let i = 0; i < this.islands.length; i++) { if (!act.has(i)) continue; const fill = !this.popR.has(i); this.popR.add(i); for (const key in CRIT) {
        const C = CRIT[key], want = i === 0 ? C.n[0] : hasBiome(this.islands[i], C.b) ? this.scaleN(i, C.n[1]) : 0;
        for (let k = 0; k < (fill ? 14 : 1); k++) {
          if (this.rabbits.filter(b => b.isl === i && (b.crit || 'rabbit') === key).length >= want) break;
          const q = this.rabSpot(i, key); if (q) this.rabbits.push({ id: this.nid++, rab: 1, crit: key, x: q[0], y: q[1], hx: q[0], hy: q[1], isl: i, hp: 1, fa: Math.random() * 6.283, wt: 0, wa: 0, run: 0, sit: 1, side: 1 });
        }
      } }
    }
    for (const b of this.rabbits) {
      const is = this.islands[b.isl], C = CRIT[b.crit || 'rabbit']; let near = null, nd = C.see;
      if (INFIGHT && this.fleeHostile(b, C, is, dt)) continue;   // [infight]
      for (const p of P) if (!p.down && !p.boat) { const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < nd) { nd = d; near = p; } }
      let dx, dy, spd;
      if (near) { dx = b.x - near.x; dy = b.y - near.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; spd = C.run; b.run = 1; b.sit = 0; b.wt = 0; }
      else {
        b.run = 0; b.wt -= dt;
        if (b.wt <= 0) {   // wander: hop a bit, sit a bit; drift back toward home turf if it strayed out of the forest
          b.wt = 1 + Math.random() * 2.5; b.sit = Math.random() < 0.45;
          const out = !this.critOk(b, b.x, b.y);
          b.wa = out || Math.hypot(b.x - b.hx, b.y - b.hy) > 350 ? Math.atan2(b.hy - b.y, b.hx - b.x) + (Math.random() - 0.5) : Math.random() * 6.283;
        }
        if (b.sit) continue;
        dx = Math.cos(b.wa); dy = Math.sin(b.wa); spd = C.walk;
      }
      let nx = b.x + dx * spd * dt, ny = b.y + dy * spd * dt;
      const lim = RC.edgeRat(is, nx, ny) - RAB.edge, cx = nx - is.x, cy = ny - is.y, cd = Math.hypot(cx, cy);
      if (cd > lim) {   // at the shore: run along the coast (whichever way leads away), never stand there stuck
        const ux = cx / cd, uy = cy / cd; let tx = -uy, ty = ux; const dot = tx * dx + ty * dy;
        if (dot < -0.05 || (Math.abs(dot) <= 0.05 && b.side < 0)) { tx = -tx; ty = -ty; }   // head-on: keep the way it was already going
        b.side = (tx === -uy) ? 1 : -1;
        nx = b.x + tx * spd * dt; ny = b.y + ty * spd * dt;
        const ex = nx - is.x, ey = ny - is.y, ed = Math.hypot(ex, ey); if (ed > lim) { nx = is.x + ex / ed * lim; ny = is.y + ey / ed * lim; }
        dx = tx; dy = ty;
        if (!near) b.wa = Math.atan2(ty, tx);
      }
      if (b.isl === 0 && Math.hypot(nx, ny) < RC.FIRE_R + 30) continue;   // don't hop into the fire
      if (!this.critOk(b, nx, ny) && this.critOk(b, b.x, b.y)) { b.wa = Math.atan2(b.hy - b.y, b.hx - b.x); continue; }   // never wander out of its own biome
      b.x = nx; b.y = ny; b.fa = Math.atan2(dy, dx);
    }
    if (this.rabbits.some(b => b.hp <= 0)) this.rabbits = this.rabbits.filter(b => b.hp > 0);
  }
  // snow wolves: roam the snow quarter of home; chase anyone who comes close; when the chase reaches the fire (or drags them
  // too far from home) they turn tail and run back to where they spawned. st: 0 roaming, 1 chasing, 2 running home
  mobBiomeOk(w, wi, is, x, y) {   // wolves/bears stay on the snow, boars in the forest, lava creatures on the lava
    const b = w.biome || 's';
    if (wi === 0) return b === 's' ? RC.inSnow(x, y) : b === 'f' ? !RC.inSnow(x, y) : false;
    return RC.biomeAt(is.x, is.y, is.r, is.b, x, y) === b;
  }
  stepVulture(w, P, dt) {   // vultures: circle high up (cannot be hit), stalk a player, then land beside them and fight on the ground for a while, then fly off
    w.cd -= dt; w.bite -= dt; w.t -= dt; const is = this.islands[w.isl | 0] || this.islands[0];
    const pl = id => P.find(p => p.id === id && !p.down && !p.boat && this.onIsland(p, w.isl | 0));
    const go = (tx, ty, sp) => { const dx = tx - w.x, dy = ty - w.y, d = Math.hypot(dx, dy) || 1; if (d > 4) { const m = Math.min(d, sp * dt); w.x += dx / d * m; w.y += dy / d * m; w.fa = Math.atan2(dy, dx); } return d; };
    if (w.vs === 0) {   // circling over its home patch of desert
      w.oa += dt * 0.35; go(w.hx + Math.cos(w.oa) * 260, w.hy + Math.sin(w.oa) * 260, 100);
      let best = null, bd = 650; for (const p of P) if (!p.down && !p.boat && this.onIsland(p, w.isl | 0)) { const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < bd) { bd = d; best = p; } }
      if (best) { w.vs = 1; w.tg = best.id; w.t = 8 + Math.random() * 7; w.oa = Math.atan2(w.y - best.y, w.x - best.x); }
    } else if (w.vs === 1) {   // circling above the player it picked, for 8-15 s
      const p = pl(w.tg); if (!p || Math.hypot(p.x - w.x, p.y - w.y) > 1000) { w.vs = 0; w.air = 1; return; }
      w.oa += dt * 0.9; go(p.x + Math.cos(w.oa) * 210, p.y + Math.sin(w.oa) * 210, 135);
      if (w.t <= 0) { w.vs = 2; w.la = Math.random() * 6.283; }
    } else if (w.vs === 2) {   // swooping down to a spot beside the player
      const p = pl(w.tg); if (!p) { w.vs = 0; return; }
      if (go(p.x + Math.cos(w.la) * 55, p.y + Math.sin(w.la) * 55, 230) < 22) { w.vs = 3; w.air = 0; w.t = 22; w.cd = 0.7; }
    } else {   // on the ground: hop after the nearest player and peck; after a while it takes off again
      let tg = null, bd = 520; for (const p of P) if (!p.down && !p.boat && this.onIsland(p, w.isl | 0)) { const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < bd) { bd = d; tg = p; } }
      if (tg) {
        let gx = tg.x, gy = tg.y; const ps = this.pathStep(tg, w.x, w.y); if (ps && ps.dir) { gx = w.x + ps.dir[0] * 60; gy = w.y + ps.dir[1] * 60; }   // on the ground it walks round walls like everything else
        go(gx, gy, 115); const d = Math.hypot(tg.x - w.x, tg.y - w.y); if (d < 36 && w.cd <= 0) { w.cd = 1.4; w.bite = 0.25; this.hurt(tg, w.dmg); }
      }
      if (tg) w.lost = 0; if (w.t <= 0 || (!tg && (w.lost = (w.lost || 0) + dt) > 4)) { w.vs = 0; w.air = 1; w.hx = w.x; w.hy = w.y; w.lost = 0; }   // time is up (or nobody is left near): take off
    }
    { const ex = w.x - is.x, ey = w.y - is.y, L = Math.hypot(ex, ey), er = RC.edgeRat(is, w.x, w.y) - 45; if (L > er) { w.x = is.x + ex * er / L; w.y = is.y + ey * er / L; } }
    if (!w.air) for (const st of this.struct) {   // flying it passes over everything, but once it has landed, walls and closed gates are solid
      if (st.k === 'trap' || st.k === 'spike' || (st.k === 'gate' && st.open)) continue;
      const [qx, qy, qr] = solidPt(st, w.x, w.y), sd = Math.hypot(w.x - qx, w.y - qy), mn = qr + 12; if (sd < mn && sd > 0.01) { w.x = qx + (w.x - qx) / sd * mn; w.y = qy + (w.y - qy) / sd * mn; }
    }
  }
  scaleN(i, n) {   // how many of a creature an island holds: the listed number is for an island as big as home; smaller islands get fewer (at least one), so a tiny islet is not crammed
    if (i === 0) return n; const is = this.islands[i]; return Math.max(1, Math.round(n * Math.min(1, (is.r / R) * (is.r / R) * 1.3)));
  }
  refreshActive(P, dt) {   // which islands have a player close enough to need their animals; everything on the others is removed (and made again when someone comes back)
    if ((this.actT = (this.actT || 0) - dt) > 0) return; this.actT = 1;
    const act = new Set();
    for (const p of P) this.islands.forEach((is, i) => { if (Math.hypot(p.x - is.x, p.y - is.y) - (i === 0 ? R : RC.edgeRat(is, p.x, p.y)) < ACT_R) act.add(i); });
    this.act = act; const gone = new Set(); if (process.env.DEBUG_ACT) console.log('active islands', [...act].join(','), 'creatures', this.wolves.length, this.rabbits.length, JSON.stringify(this.wolves.map(w => (w.isl) + ':' + (w.sp || (w.vul ? 'vul' : w.big ? 'big' : 'wolf')))), 'isl1 r', this.islands[1].r, 'villagers', this.aliens.filter(a => a.vil).length);
    for (const i of [...(this.popW || []), ...(this.popM || []), ...(this.popR || [])]) if (!act.has(i)) gone.add(i);
    if (gone.size) {
      this.wolves = this.wolves.filter(w => !gone.has(w.isl | 0)); this.rabbits = (this.rabbits || []).filter(b => !gone.has(b.isl | 0));
      for (const i of gone) { this.popW && this.popW.delete(i); this.popM && this.popM.delete(i); this.popR && this.popR.delete(i); }
    }
    for (const i of act) if (!(this.popR && this.popR.has(i)) || !(this.popW && this.popW.has(i)) || !(this.popM && this.popM.has(i))) { this.wolfT = Math.min(this.wolfT, 0); this.rabT = Math.min(this.rabT || 0, 0); break; }   // someone arrived somewhere new: fill it now, not on the next timer
    for (const v of this.villages || []) {   // villagers only exist while someone is within a few screens of their camp
      if (!v.spawned || P.some(q => Math.hypot(q.x - v.x, q.y - v.y) < VIL_ACT + 600)) continue;
      const n0 = this.aliens.length; this.aliens = this.aliens.filter(a => a.vil !== v.id); if (this.aliens.length !== n0 || v.spawned) { v.spawned = 0; v.rt = 0; }
    }
  }
  // ===== INFIGHT: different species fight each other. To remove: delete this block, the INFIGHT const near the top and the three lines tagged [infight] =====
  // Species: wolf (alphas too), bear, mammoth, boar, golem, imp, and the night aliens (as one species). Same species never fight. Villagers neither attack nor are attacked.
  // Scorpions are never attacked. Other passive critters are fair prey and flee from anything hostile. Anything near a player carries on with the player instead.
  fightSpecies(c, kind) {
    if (kind === 'a') return null;   // aliens, villagers and cultists stay out of it entirely: they neither attack the animals nor get attacked by them
    if (c.vul) return null;   // vultures are left alone (and leave others alone)
    return c.sp || (c.big === 1 ? 'bear' : c.big === 2 ? 'mammoth' : 'wolf');
  }
  fightPrey(c, kind, sp) {   // the nearest creature of another species within sight (same island), or null
    const ci = c.isl | 0; let best = null, bd = FIGHT_SEE;
    const look = (o, osp, r0) => { const d = Math.hypot(o.x - c.x, o.y - c.y); if (d < bd) { bd = d; best = { o, r: r0 }; } };
    for (const w of this.wolves) if (w !== c && w.hp > 0 && (w.isl | 0) === ci) { const osp = this.fightSpecies(w, 'w'); if (osp && osp !== sp) look(w, osp, w.big ? 26 : 12); }
    for (const a of this.aliens) if (a !== c && a.hp > 0 && (a.isl | 0) === ci && !(a.trapT > 0)) { const osp = this.fightSpecies(a, 'a'); if (osp && osp !== sp) look(a, osp, a.rad || 12); }
    for (const b of this.rabbits) if (b.hp > 0 && b.crit !== 'scorpion' && (b.isl | 0) === ci) look(b, 'critter', 8);
    return best;
  }
  fightStep(c, kind, dt, P) {   // true = this creature spent the tick fighting (the caller skips its normal behaviour)
    const sp = this.fightSpecies(c, kind); if (!sp) return false;
    if (kind === 'w' && (c.st === 1 || c.st === 2)) return false;   // chasing a player / running home: normal behaviour
    const ci = c.isl | 0; for (const p of P) if (!p.down && !p.boat && (this.onIsland(p, ci)) && Math.hypot(p.x - c.x, p.y - c.y) < FIGHT_PLAYER) return false;   // a player is close: deal with the player
    const f = this.fightPrey(c, kind, sp); if (!f) return false;
    const t = f.o, d = Math.max(1, Math.hypot(t.x - c.x, t.y - c.y)), ux = (t.x - c.x) / d, uy = (t.y - c.y) / d, is = this.islands[ci] || this.islands[0];
    c.fa = Math.atan2(uy, ux);
    const reach = (kind === 'w' ? (c.reach || WOLF.reach) : Math.max(26, c.reach || 0)) + f.r;
    if (d > reach) {   // close in
      const spd = kind === 'w' ? (c.run || WOLF.run) : (c.sp || 70), nx = c.x + ux * spd * dt, ny = c.y + uy * spd * dt;
      if (kind === 'w' && !this.mobBiomeOk(c, ci, is, nx, ny)) return true;   // never leaves its own ground: it just waits at the edge
      const ex = nx - is.x, ey = ny - is.y, L = Math.hypot(ex, ey), er = RC.edgeRat(is, nx, ny) - 45;
      if (L > er) { c.x = is.x + ex * er / L; c.y = is.y + ey * er / L; } else { c.x = nx; c.y = ny; }
      if (kind === 'w') c.st = 0;
    } else if (c.cd <= 0) {   // bite / hit
      c.cd = kind === 'w' ? (c.bcd || WOLF.cd) : (c.atkCd || 1); if (kind === 'w') c.bite = 0.25;
      t.hp -= kind === 'w' ? (c.dmg || WOLF.dmg) : Math.max(6, c.dmg || 0);
    }
    return true;
  }
  fleeHostile(b, C, is, dt) {   // passive critters run from any hostile that gets close
    let h = null, hd = 190; const ci = b.isl | 0;
    for (const w of this.wolves) if (w.hp > 0 && !w.vul && (w.isl | 0) === ci) { const d = Math.hypot(w.x - b.x, w.y - b.y); if (d < hd) { hd = d; h = w; } }
    for (const a of this.aliens) if (a.hp > 0 && !a.vil && a.k < 3 && (a.isl | 0) === ci) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < hd) { hd = d; h = a; } }
    if (!h) return false;
    const dx = (b.x - h.x) / hd, dy = (b.y - h.y) / hd, nx = b.x + dx * C.run * 1.1 * dt, ny = b.y + dy * C.run * 1.1 * dt;
    b.run = 1; b.sit = 0; b.fa = Math.atan2(dy, dx);
    const lim = RC.edgeRat(is, nx, ny) - RAB.edge; if (Math.hypot(nx - is.x, ny - is.y) < lim && this.critOk(b, nx, ny)) { b.x = nx; b.y = ny; }
    return true;
  }
  // ===== end of INFIGHT =====
  stepWolves(P, dt) {
    if (!this.wolves) this.wolves = [];
    this.refreshActive(P, dt);
    if ((this.wolfT -= dt) <= 0) {   // home's snow quarter and every snow island; all filled at once the first time, then one per island at a time
      this.wolfT = WOLF.respawn; const act = this.act || new Set(); this.popW = this.popW || new Set();
      for (let i = 0; i < this.islands.length; i++) {
        const is = this.islands[i]; if (i > 0 && is.b !== 's' && is.b !== 'm') continue;
        if (!act.has(i)) continue; const first = !this.popW.has(i); this.popW.add(i);
        const want = i === 0 ? WOLF.n : this.scaleN(i, WOLF.outer); let have = this.wolves.filter(w => w.isl === i && !w.vul && !w.sp).length;
        for (let k = 0; k < (first ? want : 1) && have < want; k++) {
          let q = null;
          for (let t = 0; t < 40 && !q; t++) {
            let x, y;
            if (i === 0) { const a = RC.SNOW_A + (Math.random() - 0.5) * 1.3, d = 1300 + Math.random() * (R - 1500); x = Math.cos(a) * d; y = Math.sin(a) * d; if (!RC.inSnow(x, y)) continue; }
            else { const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * (RC.edgeR(is, a) - 200); x = is.x + Math.cos(a) * d; y = is.y + Math.sin(a) * d; if (RC.biomeAt(is.x, is.y, is.r, is.b, x, y) !== 's') continue; }
            if (!P.some(p => Math.hypot(p.x - x, p.y - y) < 600) && !this.inFire(x, y, 60)) q = [x, y];
          }
          if (!q) continue; have++;
          const f = i > 0 ? DIST_F(q[0], q[1], this.worldR) : 0, rl = Math.random(), nB = this.wolves.filter(w => w.isl === i && w.big === 1).length, nM = this.wolves.filter(w => w.isl === i && w.big === 2).length;
          const big = i > 0 && nM < 1 && rl < 0.07 * f ? 2 : i > 0 && nB < 2 && rl < 0.07 * f + 0.28 * f ? 1 : 0;   // farther out: more bears, and the odd mammoth
          if (big) { const B = BIG[big]; this.wolves.push({ id: this.nid++, wolf: 1, big, heavy: 1, isl: i, alpha: 0, x: q[0], y: q[1], hx: q[0], hy: q[1], hp: B.hp, mhp: B.hp, run: B.run, dmg: B.dmg, reach: B.reach, bcd: B.cd, see: B.see, walk: B.walk, fa: Math.random() * 6.283, st: 0, tg: 0, cd: 0, wt: 0, wa: 0, bite: 0 }); continue; }
          const al = i > 0 && Math.random() < 0.08 + 0.55 * f, hp = al ? WOLF.aHp : WOLF.hp;   // alphas get more common the farther from home
          this.wolves.push({ id: this.nid++, wolf: 1, isl: i, alpha: al ? 1 : 0, x: q[0], y: q[1], hx: q[0], hy: q[1], hp, mhp: hp, run: al ? WOLF.aRun : WOLF.run, dmg: al ? WOLF.aDmg : WOLF.dmg, fa: Math.random() * 6.283, st: 0, tg: 0, cd: 0, wt: 0, wa: 0, bite: 0 });
        }
      }
    }
    if (this.wolfT === WOLF.respawn) {   // vultures circle over the desert: up to 2 per desert island, topped up on the wolf timer, never spawning in sight
      for (let i = 1; i < this.islands.length; i++) {
        const is = this.islands[i]; if ((is.b !== 'd' && is.b !== 'm') || !(this.act && this.act.has(i))) continue;
        let have = this.wolves.filter(w => w.vul && w.isl === i).length;
        const vmax = this.scaleN(i, 4);   // (smaller islands have fewer vultures)
        for (let k = 0; k < 3 && have < vmax; k++) for (let t = 0; t < 30; t++) {
          const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * (RC.edgeR(is, a) - 300), x = is.x + Math.cos(a) * d, y = is.y + Math.sin(a) * d;
          if (RC.biomeAt(is.x, is.y, is.r, is.b, x, y) !== 'd' || P.some(p => Math.hypot(p.x - x, p.y - y) < 900)) continue;
          this.wolves.push({ id: this.nid++, wolf: 1, vul: 1, air: 1, vs: 0, isl: i, x, y, hx: x, hy: y, hp: 40, mhp: 40, dmg: 8, fa: Math.random() * 6.283, st: 0, tg: 0, cd: 0, wt: 0, wa: 0, bite: 0, oa: Math.random() * 6.283, t: 0 }); have++; break;
        }
      }
    }
    if (this.wolfT === WOLF.respawn) {   // forest boars and the lava creatures (golems, imps) - hostile animals on the same timer, each kept to its own biome
      this.popM = this.popM || new Set();
      for (let i = 0; i < this.islands.length; i++) {
        const is = this.islands[i]; if (!(this.act && this.act.has(i))) continue; const firstM = !this.popM.has(i); this.popM.add(i);
        for (const key in MOBS) {
          const M = MOBS[key], want = i === 0 ? M.n[0] : hasBiome(is, M.b) && (M.b !== 'l' || is.b === 'l') ? this.scaleN(i, M.n[1]) : 0; if (!want) continue;
          let have = this.wolves.filter(w => w.isl === i && w.sp === key).length;
          for (let k = 0; k < (firstM ? want : 1) && have < want; k++) {
            let q = null;
            for (let t = 0; t < 40 && !q; t++) {
              let x, y;
              if (i === 0) { const a = Math.random() * 6.283, d = RC.camp(3) + 700 + Math.random() * (R - RC.camp(3) - 1100); x = Math.cos(a) * d; y = Math.sin(a) * d; if (RC.inSnow(x, y)) continue; }
              else { const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * (RC.edgeR(is, a) - 220); x = is.x + Math.cos(a) * d; y = is.y + Math.sin(a) * d; if (RC.biomeAt(is.x, is.y, is.r, is.b, x, y) !== M.b) continue; }
              if (!P.some(p => Math.hypot(p.x - x, p.y - y) < 600) && !this.inFire(x, y, 80) && !(this.lava || []).some(l => l.isl === i && Math.hypot(l.x - x, l.y - y) < l.r + 40)) q = [x, y];
            }
            if (!q) continue; have++;
            this.wolves.push({ id: this.nid++, wolf: 1, sp: key, biome: M.b, heavy: M.heavy ? 1 : 0, isl: i, alpha: 0, x: q[0], y: q[1], hx: q[0], hy: q[1], hp: M.hp, mhp: M.hp, run: M.run, dmg: M.dmg, reach: M.reach, bcd: M.cd, see: M.see, walk: M.walk, fa: Math.random() * 6.283, st: 0, tg: 0, cd: 0, wt: 0, wa: 0, bite: 0 });
          }
        }
      }
    }
    if (this.villages && this.villages.length && this.wolfT === WOLF.respawn) {   // (runs on the same timer as the wolves) villagers settle in groups at their camps when nobody can see it
      const s = 1 + 0.04 * Math.max(0, this.night - 1);
      for (const v of this.villages) {
        const alive = this.aliens.filter(a => a.vil === v.id).length;
        if (alive > 0) { v.rt = 0; continue; }
        if (v.spawned && !v.rt) v.rt = 120; if (v.rt > 0) { v.rt -= WOLF.respawn; if (v.rt > 0) continue; }
        if (P.some(p => !p.down && Math.hypot(p.x - v.x, p.y - v.y) < 1300) || !P.some(p => Math.hypot(p.x - v.x, p.y - v.y) < VIL_ACT)) continue;   // never pop in where anyone can see; and only when someone is within a few screens
        const n = 3 + Math.floor(Math.random() * 4); v.spawned = 1; v.rt = 0;
        if (v.cult) {   // a band of cultists: a shield-bearing zealot every third one, the rest are staff-wielding mages
          const cs = 1 + 0.04 * Math.max(0, this.night - 1);
          for (let k = 0; k < n; k++) {
            const zealot = k % 3 === 0, a = Math.random() * 6.283, d = 60 + Math.random() * 90, hp = Math.round((zealot ? 220 : 60) * cs);
            this.spawnA({ id: this.nid++, isl: v.isl, x: v.x + Math.cos(a) * d, y: v.y + Math.sin(a) * d, hp, mhp: hp, sp: zealot ? 62 : 70, dmg: (zealot ? CULT.melee : CULT.fire) * cs, k: zealot ? 6 : 5, cd: 0, atkCd: zealot ? 2.0 : 1.5, reach: zealot ? 38 : 0, stop: zealot ? 24 : 300, range: 380, rad: zealot ? 15 : 12, aim: 0, shotCd: Math.random() * 2, vil: v.id, hx: v.x, hy: v.y });
          }
          continue;
        }
        for (let k = 0; k < n; k++) {
          const archer = k % 3 === 2, a = Math.random() * 6.283, d = 60 + Math.random() * 90, hp = Math.round((archer ? 30 : 45) * s);
          this.spawnA({ id: this.nid++, isl: v.isl, x: v.x + Math.cos(a) * d, y: v.y + Math.sin(a) * d, hp, mhp: hp, sp: archer ? 70 : 80, dmg: (archer ? VIL_DMG.arrow : VIL_DMG.melee) * s, k: archer ? 4 : 3, cd: 0, atkCd: 1.5, reach: archer ? 0 : 30, stop: archer ? 250 : 22, range: 290, aim: 0, shotCd: 0, vil: v.id, hx: v.x, hy: v.y });
        }
      }
    }
    const rnd2 = (a, b) => a + Math.random() * (b - a);
    const nearFire = () => false;   // wolves, bears and mammoths are no longer scared of fire: they chase until the target is out of range (give-up distance) or they are too far from home (leash)
    for (const w of this.wolves) {
      if (w.vul) { this.stepVulture(w, P, dt); continue; }
      w.cd -= dt; w.bite -= dt; let dx = 0, dy = 0, spd = 0; const wi = w.isl | 0, is = this.islands[wi] || this.islands[0];
      if (INFIGHT && this.fightStep(w, 'w', dt, P)) continue;   // [infight]
      const home = Math.hypot(w.x - w.hx, w.y - w.hy);
      if (w.st === 2) {   // running home; after 3 s of that, anyone who comes close (away from the fire) gets chased again
        w.rt = (w.rt || 0) + dt; let re = null;
        if (w.rt >= WOLF.reAggro) { let nd = WOLF.see; for (const p of P) if (!p.down && !p.boat && this.onIsland(p, wi) && !nearFire(p.x, p.y)) { const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < nd) { nd = d; re = p; } } }
        if (re) { w.st = 1; w.tg = re.id; w.rt = 0; }
        else if (home < 40) { w.st = 0; w.wt = 0; w.rt = 0; } else { dx = (w.hx - w.x) / home; dy = (w.hy - w.y) / home; spd = w.run || WOLF.run; }
      }
      if (w.st !== 2) {
        let tg = w.st === 1 ? P.find(p => p.id === w.tg && !p.down && !p.boat) : null;
        if (tg && Math.hypot(tg.x - w.x, tg.y - w.y) > WOLF.give) tg = null;
        if (!tg) { let nd = w.see || WOLF.see; for (const p of P) if (!p.down && !p.boat && this.onIsland(p, wi)) { const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < nd) { nd = d; tg = p; } } }
        if (tg && !nearFire(tg.x, tg.y)) {
          w.st = 1; w.tg = tg.id; let tp = tg, wl = null, far = false; const E = this.enclosure(tg); if (E && !(E.cab && this.inCabin(E.cab, w.x, w.y, 10))) { wl = this.nearWall(E, w.x, w.y); if (wl) { tp = { x: wl.qx, y: wl.qy }; if (wl.st.cabRef) { const wp = this.cabinApproach(wl.st.cabRef, wl.st, w.x, w.y); if (wp) { tp = { x: wp[0], y: wp[1] }; far = true; } } } }   // walled in: go for the nearest wall
          if (!wl && w.wallTg) { if (w.wallTg.dead || w.wallTg.hp <= 0 || (w.wallT -= dt) <= 0) { w.wallTg = null; w.blkT = 0; } else { const [qx, qy, qr] = solidPt(w.wallTg, w.x, w.y); wl = { st: w.wallTg, qx, qy, qr }; tp = { x: qx, y: qy }; } }   // stuck behind walls for a while: break this one, then path again
          const d = Math.hypot(tp.x - w.x, tp.y - w.y) || 1; dx = (tp.x - w.x) / d; dy = (tp.y - w.y) / d;
          if (!wl) { const ps = this.pathStep(tg, w.x, w.y); if (ps && ps.dir) { dx = ps.dir[0]; dy = ps.dir[1]; } if (ps) { if ((w.blkT = (w.blkT || 0) + dt) > BLOCK_SEC) { const bw = this.wallToBreak(w.x, w.y); if (bw) { w.wallTg = bw.st; w.wallT = WALL_SEC; } w.blkT = 0; } } else w.blkT = 0; }   // a wall is in the way: go around it
          if (far || d - (wl ? wl.qr : 0) > (w.reach || WOLF.reach) * (w.alpha ? 1.25 : 1)) spd = w.run || WOLF.run;
          else if (w.cd <= 0) { w.cd = w.bcd || WOLF.cd; w.bite = 0.25; if (wl) this.hitWall(wl.st, w.dmg || WOLF.dmg); else this.hurt(tg, w.dmg || WOLF.dmg); }
        } else if (w.st === 1) { w.st = 2; w.rt = 0; continue; }   // lost them (or they reached the fire): head home
        else {   // roaming around its spot
          w.wt -= dt; if (w.wt <= 0) { w.wt = 1.5 + Math.random() * 3; w.sit = Math.random() < 0.5; w.wa = home > 260 ? Math.atan2(w.hy - w.y, w.hx - w.x) : Math.random() * 6.283; }
          if (!w.sit) { dx = Math.cos(w.wa); dy = Math.sin(w.wa); spd = w.walk || WOLF.walk; }
        }
      }
      if (!spd) { if (dx || dy) w.fa = Math.atan2(dy, dx); continue; }
      let nx = w.x + dx * spd * dt, ny = w.y + dy * spd * dt;
      if (w.st !== 2 && !this.mobBiomeOk(w, wi, is, nx, ny)) { if (w.st === 1) { w.st = 2; w.rt = 0; } else { w.sit = 1; } continue; }   // wolves, bears and mammoths never leave the snow: a chase ends at its edge and they head home
      if (w.st !== 2 && (nearFire(nx, ny) || Math.hypot(nx - w.hx, ny - w.hy) > WOLF.leash)) { w.st = 2; w.rt = 0; continue; }   // got near the fire / too far from home: back it goes
      { const ex = nx - is.x, ey = ny - is.y, L = Math.hypot(ex, ey), er = RC.edgeRat(is, nx, ny) - 45; if (L > er) { nx = is.x + ex * er / L; ny = is.y + ey * er / L; } }   // stays on its island
      for (const st of this.struct) { if (st.k === 'trap' || st.k === 'spike' || (st.k === 'gate' && st.open)) continue; const [qx, qy, qr] = solidPt(st, nx, ny), sd = Math.hypot(nx - qx, ny - qy), mn = qr + (w.big ? 26 : 12); if (sd < mn && sd > 0.01) { nx = qx + (nx - qx) / sd * mn; ny = qy + (ny - qy) / sd * mn; } }   // walls and gates are solid for wolves too
      w.x = nx; w.y = ny; w.fa = Math.atan2(dy, dx);
    }
    for (const w of this.wolves) if (w.hp <= 0 && !w.dropped) { w.dropped = 1; const BG = BIG[w.big], MB = MOBS[w.sp], AL = w.alpha || w.big === 2, n = BG ? BG.meat[0] + (Math.random() * (BG.meat[1] + 1) | 0) : MB ? MB.meat[0] + (Math.random() * (MB.meat[1] + 1) | 0) : 1 + (Math.random() < 0.5 ? 1 : 0); for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, d = 8 + Math.random() * (BG ? 40 : 18); this.pend.push({ k: 'n', x: w.x + Math.cos(a) * d, y: w.y + Math.sin(a) * d, t: 0.15 }); }
      if (MB && MB.ore) { const no = MB.ore[0] + (Math.random() * (MB.ore[1] - MB.ore[0] + 1) | 0); for (let i = 0; i < no; i++) this.pend.push({ k: 'o', x: w.x + rnd2(-30, 30), y: w.y + rnd2(-30, 30), t: 0.2 }); }   // golems crumble into gold ore
      if (BG) { for (let i = 0; i < (w.big === 2 ? 3 : 1); i++) if (Math.random() < BG.pelt) this.pend.push({ k: 'h', x: w.x + 10 + i * 14, y: w.y - 6, t: 0.2 }); } else if (!w.vul && !MB && Math.random() < WOLF.pelt) this.pend.push({ k: 'h', x: w.x + 10, y: w.y - 6, t: 0.2 });
      if (AL && Math.random() < (w.big === 2 ? 1 : WOLF.aPelt)) this.pend.push({ k: 'H', x: w.x - 12, y: w.y + 8, t: 0.25 }); }   // alpha wolves (and mammoths) can drop an alpha pelt   // 1-2 meat scraps, and a 10% chance of a wolf pelt
    if (this.wolves.some(w => w.hp <= 0)) this.wolves = this.wolves.filter(w => w.hp > 0);
  }
  killRabbit(b) {   // one hit: 1-2 meat scraps, and a 10% chance of a lucky rabbit's foot
    b.hp = 0; const n = 1, drops = [];   // passive creatures drop exactly one meat
    for (let i = 0; i < n; i++) drops.push({ k: 'n' });
    if ((b.crit || 'rabbit') === 'rabbit' && Math.random() < RAB.foot) drops.push({ k: 'q', food: 'foot' });
    if (b.crit === 'sal' && Math.random() < 0.25) drops.push({ k: 'o' });   // a salamander sometimes leaves a bit of gold ore
    for (const q of drops) { const a = Math.random() * 6.283, d = 8 + Math.random() * 18; q.x = b.x + Math.cos(a) * d; q.y = b.y + Math.sin(a) * d; q.t = 0.15; this.pend.push(q); }
  }
  ph() { return this.c < DAY ? 0 : this.c < DAY + DUSK ? 1 : 2; }
  awayEntry(p) { return { t: Date.now(), s: { wood: p.wood, stone: p.stone, food: p.food, scrap: p.scrap, meat: p.meat, gold: p.gold, pelt: p.pelt, apelt: p.apelt, fish1: p.fish1, fish2: p.fish2, fish3: p.fish3, abilOn: p.abilOn, gear: p.gear, buff: p.buff, slots: p.slots, cls: p.cls, down: p.down, hp: p.hp, x: p.x, y: p.y, bt: p.boat || 0, wpn: p.wpn, magP: p.magP, magR: p.magR, ammoP: p.ammoP, ammoR: p.ammoR } }; }
  // guns: the pistol holds 6 rounds and the rifle 1; when the magazine is empty (or you press V) the gun reloads from your reserve rounds, which takes a moment (the rifle a long one)
  gunReady(p) {   // may the selected gun fire right now? (if not, it starts reloading / tells you)
    const g = this.gunOf(p); if (!g || p.reload) return false;
    if ((p[g === 'rifle' ? 'magR' : 'magP'] || 0) > 0) return true;
    if (!this.startReload(p)) { const now = Date.now(); if (now - (p.noAmmoAt || 0) > 1500) { p.noAmmoAt = now; send(p.ws, { t: 'toast', msg: 'Out of ' + g + ' rounds! Switch weapon (X) or find more.' }); } }
    p.hitcd = 0.3; return false;
  }
  gunFired(p) { const g = this.gunOf(p), k = g === 'rifle' ? 'magR' : 'magP'; p[k] = Math.max(0, (p[k] || 0) - 1); if (p[k] <= 0) this.startReload(p); }   // the last round is gone: reload at once
  startReload(p) {
    const g = this.gunOf(p); if (!g || p.reload) return false; const cap = GUN_MAG[g], mk = g === 'rifle' ? 'magR' : 'magP', rk = g === 'rifle' ? 'ammoR' : 'ammoP';
    if ((p[mk] || 0) >= cap || (p[rk] || 0) <= 0) return false;
    p.reload = { g, t: 0, dur: GUN_RELOAD[g] }; return true;
  }
  stepReload(p, dt) {
    const rl = p.reload; if (!rl) return;
    if (this.gunOf(p) !== rl.g || p.down) { p.reload = null; return; }   // switched weapon (or went down): the reload is lost
    rl.t += dt; if (rl.t < rl.dur) return;
    const mk = rl.g === 'rifle' ? 'magR' : 'magP', rk = rl.g === 'rifle' ? 'ammoR' : 'ammoP', n = Math.min(GUN_MAG[rl.g] - (p[mk] || 0), p[rk] || 0);
    p[mk] = (p[mk] || 0) + n; p[rk] = (p[rk] || 0) - n; p.reload = null; p.hitcd = Math.max(p.hitcd || 0, 0.15);
  }
  gunOf(p) { const w = p.wpn || 'melee'; return w === 'rifle' && p.gear.rifle ? 'rifle' : w === 'pistol' && p.gear.pistol ? 'pistol' : null; }   // the gun you have selected (null = melee, or a plain thrown shot aboard a boat)
  dangerFor(p) {   // is it dangerous to be where this player is (night / dusk, an enemy close by, a shark near their boat)?
    if (this.ph() >= 1) return true;
    for (const w of this.wolves || []) if (w.hp > 0 && !w.vul && Math.hypot(w.x - p.x, w.y - p.y) < 700) return true;
    for (const a of this.aliens) if (a.hp > 0 && !a.vil && a.k < 3 && Math.hypot(a.x - p.x, a.y - p.y) < 700) return true;
    if (p.boat) for (const sk of this.sharks || []) if (Math.hypot(sk.x - p.x, sk.y - p.y) < 900) return true;
    return false;
  }
  stash(p) {   // remember a leaving player's character so they can come back (dropped connection) within the room window
    if (!p.email) return; const now = Date.now(); for (const [k, v] of this.away) if (now - v.t > ROOM_IDLE_SEC * 1000) this.away.delete(k);
    this.away.set(p.email, this.awayEntry(p));
  }
  snapshot() {   // everything needed to rebuild this room after a server restart; connected players are saved as 'away' so they get their character back when they reconnect
    const away = [...this.away]; for (const p of this.players.values()) if (p.email) away.push([p.email, this.awayEntry(p)]);
    return { code: this.code, c: this.c, night: this.night, fire: this.fire, aliens: this.aliens, res: this.res, islands: this.islands, isv: ISL_VER, mv: this.mv, camps: this.camps, lootOpen: this.loot.filter(l => l.open).map(l => l.id), boats: this.boats.map(b => ({ id: b.id, type: b.type || 'boat', x: b.x, y: b.y, ang: b.ang, life: b.life == null ? undefined : Math.round(b.life) })), scrapFound: this.scrapFound, drops: this.drops, pend: this.pend, struct: this.struct.filter(s => s.k !== 'cwall' && !s.cab), chargerNight: this.chargerNight, raidNight: this.raidNight, islNight: this.islNight, nid: this.nid, wolves: this.wolves || [], rabbits: this.rabbits || [], pools: this.pools || [], away };
  }
  saveBlob() {   // everything about this game, compactly: island resources are re-made from the room code, so only home's resources and the changed island ones are stored
    const o = this.snapshot(); delete o.islands;
    const homeRes = [], dev = []; let ri = 0;
    if (!this._fresh) { this._fresh = []; this.islands.forEach((is, i) => { if (i > 0) this._fresh.push(...islandRes(is, i, this.code)); }); }   // (the untouched island resources never change, so they are made once)
    const fresh = this._fresh;
    for (const r of this.res) {
      if (!(r.isl > 0)) homeRes.push([r.k, Math.round(r.x), Math.round(r.y), Math.round(r.hp * 10) / 10]);
      else { const f = fresh[ri++]; if (!f || r.hp !== r.mhp || r.k !== f.k) dev.push([ri - 1, r.k, Math.round(r.hp * 10) / 10]); }
    }
    o.res = undefined; o.homeRes = homeRes; o.dev = dev; o.v = 2; o.at = Date.now();
    const rd = n => Math.round(n * 10) / 10;
    o.aliens = (o.aliens || []).map(a => ({ id: a.id, isl: a.isl, k: a.k, x: rd(a.x), y: rd(a.y), hp: rd(a.hp), mhp: a.mhp, sp: a.sp, dmg: a.dmg, cd: 0, atkCd: a.atkCd, reach: a.reach, stop: a.stop, range: a.range, rad: a.rad, aim: 0, shotCd: 0, vil: a.vil, hx: a.hx, hy: a.hy, spit: a.spit, spitCd: a.spit ? 3 : undefined }));
    // wolves, bears, mammoths, vultures, rabbits and fish pools: just where they are and how hurt they are (their moods reset when the game loads)
    const pick = (w, keys) => { const q = {}; for (const k of keys) if (w[k] !== undefined) q[k] = typeof w[k] === 'number' ? rd(w[k]) : w[k]; return q; };
    o.wolves = []; o.rabbits = []; o.aliens = o.aliens.filter(a => !(a.k >= 3 && a.vil));   // animals and villagers are not saved: they are made again around you when you come back to an island
    o.pools = (o.pools || []).map(w => pick(w, ['id', 'isl', 'x', 'y', 'kind', 'left', 'ttl']));
    return o;
  }
  static fromSave(b) {   // rebuild the snapshot form that restore() understands, then restore it
    const r0 = new Room(b.code, b.mv || 1), rest = r0.res.filter(x => x.isl > 0);
    for (const [i, k, hp] of b.dev || []) if (rest[i]) { rest[i].k = k; rest[i].mhp = HP[k]; rest[i].hp = hp; }
    const home = (b.homeRes || []).map(a => ({ k: a[0], x: a[1], y: a[2], hp: a[3], mhp: HP[a[0]], rt: 0, isl: 0 }));
    const o = Object.assign({}, b, { res: home.concat(rest), islands: r0.islands, isv: ISL_VER, mv: r0.mv, islandsV: 2 });
    return Room.restore(o);
  }
  static restore(o) {
    const r = new Room(o.code, o.mv || 1), genIsl = r.islands, genExtra = r.res.filter(x => x.isl > 0), fresh = r.res;
    Object.assign(r, { c: o.c, night: o.night, fire: o.fire, aliens: o.aliens || [], res: o.res, drops: (o.drops || []).filter(d => d.k !== 'q' || RC.ITEM_BY[d.food]), pend: o.pend || [], struct: o.struct || [], chargerNight: o.chargerNight || 0, raidNight: o.raidNight || 0, islNight: o.islNight || {}, nid: o.nid || 1, over: 0, emptyFor: 0,
      wolves: (o.wolves || []).map(w => Object.assign({ st: 0, tg: 0, cd: 0, wt: 0, wa: 0, bite: 0, t: 0 }, w)), rabbits: (o.rabbits || []).map(w => Object.assign({ wt: 0, wa: 0, run: 0, sit: 1, side: 1 }, w)), pools: o.pools || [], wolfFull: o.wolves ? 1 : 0, rabFull: o.rabbits ? 1 : 0 });
    if (o.islands) { r.islands = o.islands; r.boats = (o.boats || []).map(b => ({ id: b.id, type: b.type || 'boat', x: b.x, y: b.y, ang: b.ang, life: b.life, riders: [], drv: 0 })); r.scrapFound = !!o.scrapFound; }
    else { r.islands = genIsl; r.res = o.res.concat(genExtra); }   // rooms saved before the islands existed get the archipelago added
    if (o.islands && o.isv !== ISL_VER) {   // older island layouts: regenerate the outer islands (seeded by room code) and their resources
      r.islands = genIsl; r.res = fresh;   // the whole archipelago (home too) is regenerated
      for (const b of r.boats) if (!r.isWater(b.x, b.y)) {   // a boat that now sits on land is pushed out to the nearest shore
        let best = r.islands[0], bd = 1e9; for (const s of r.islands) { const d = Math.hypot(b.x - s.x, b.y - s.y) - RC.edgeRat(s, b.x, b.y); if (d < bd) { bd = d; best = s; } }
        const dx = b.x - best.x, dy = b.y - best.y, L = Math.hypot(dx, dy) || 1; const er2 = RC.edgeRat(best, b.x, b.y) + 90; b.x = best.x + dx / L * er2; b.y = best.y + dy / L * er2;
      }
    }
    r.loot = genLoot(r.islands, o.code); r.lava = genLava(r.islands, o.code, r.loot); r.villages = genVillages(r.islands, o.code, r.loot, r.lava); { const cb = genCabins(r.islands, o.code, r.loot); r.cabins = cb.cabins; r.loot.push(...cb.loot); }   // loot areas are derived from the islands; only which chests were opened and the campfires are saved
    if (o.islands && o.isv === ISL_VER) { r.camps = o.camps || []; const op = new Set(o.lootOpen || []); for (const l of r.loot) if (op.has(l.id)) l.open = 1; }
    { let nb = 0; r.res = r.res.filter(x => x.k !== 'b' || x.isl > 0 || ++nb <= BUSHES); }
    r.clearCabinRes(); r.addCabinWalls();   // rooms saved before the bush cut lose their extra bushes (done before anyone joins, so client indexes stay aligned)
    const now = Date.now(); r.away = new Map((o.away || []).map(([e, v]) => [e, { t: now, s: v.s }]));   // the reconnect window starts from the restart
    return r;
  }
  add(ws, name, cls, pf, email) {
    this.rForce = 1;   // the next snapshot carries the full resource state for the newcomer
    const p = { needR: 1, id: this.nid++, ws, name, cls, prof: pf, gear: {}, buff: { speed: 0, regen: 0, dmg: 0 }, actPrev: 0, fa: 0, sw: 0, swk: 0, swa: 0, wood: parseInt(process.env.START_WOOD) || 0, stone: parseInt(process.env.START_STONE) || 0, food: parseInt(process.env.START_FOOD) || 0, scrap: parseInt(process.env.START_SCRAP) || 0, meat: parseInt(process.env.START_MEAT) || 0, gold: 0, pelt: 0, apelt: 0, fish1: 0, fish2: 0, fish3: 0, slots: [], abilCd: 0, sta: STA.max, staCd: 0, tired: 0, actcd: 0, hitcd: 0, eat: 0, inp: { dx: 0, dy: 0, act: 0, hit: 0 } };
    p.email = email; p.inf = INFINITE.has(email); this.respawn(p);
    if (process.env.START_GUNS) { p.gear.pistol = p.gear.rifle = true; p.magP = 6; p.magR = 1; p.ammoP = 30; p.ammoR = 10; p.wpn = 'pistol'; }   // (test hook)
    if (process.env.START_ABIL) p.abilOn = 1;   // (test hook: the ability starts unlocked)
    const a = email && this.away.get(email); this.away.delete(email);
    if (a && Date.now() - a.t <= ROOM_IDLE_SEC * 1000) {   // welcome back: same stuff, same spot (a downed player just respawns)
      const o = a.s; p.wood = o.wood; p.stone = o.stone; p.food = o.food; p.scrap = o.scrap; p.meat = o.meat || 0; p.gold = o.gold || 0; p.pelt = o.pelt || 0; p.apelt = o.apelt || 0; p.fish1 = o.fish1 || 0; p.fish2 = o.fish2 || 0; p.fish3 = o.fish3 || 0; p.abilOn = o.abilOn ? 1 : 0; p.gear = o.gear; p.buff = o.buff; p.slots = (o.slots || []).filter(id => RC.ITEM_BY[id]).slice(0, 7);
      if (o.cls === cls && !o.down) {
        p.hp = Math.min(p.mhp, o.hp); p.x = o.x; p.y = o.y; p.wpn = o.wpn || 'melee'; p.magP = o.magP || 0; p.magR = o.magR || 0; p.ammoP = o.ammoP || 0; p.ammoR = o.ammoR || 0;
        const bt = o.bt && this.boats.find(x => x.id === o.bt && !x.gone);   // left while sailing: you come back aboard the same boat, still on the water
        if (bt && bt.riders.length < RC.BOATS[bt.type || 'boat'].riders) this.enterBoat(p, bt);
        else if (this.landAt(p.x, p.y) < 0) { const q = this.landPoint(p.x, p.y); p.x = q[0]; p.y = q[1]; }   // (the boat is gone or full: the nearest shore)
      }
    }
    this.players.set(p.id, p); return p;
  }
  tick(dt) {
    for (const gp of [...this.players.values()]) if (gp.ghost) {   // players who dropped out in danger: they stand there helpless until the grace period ends
      gp.inp = { dx: 0, dy: 0, act: 0, hit: 0, rn: 0, am: 0, aim: 0 }; gp.ghost -= dt;
      if (gp.ghost <= 0) { this.stash(gp); this.releaseBoat(gp); this.players.delete(gp.id); }
    }
    const P = [...this.players.values()];
    if (!P.length) { this.emptyFor += dt; return; } this.emptyFor = 0;
    for (const p of P) this.stepReload(p, dt);
    for (const p of P) if (p.inf) { p.wood = p.stone = p.food = p.scrap = p.meat = p.gold = p.pelt = p.apelt = INF_N; }   // test accounts: bag always full
    if (this.over > 0) { this.over -= dt; if (this.over <= 0) this.endRun(); return; }
    this.c += dt;
    if (this.c >= CYC) {
      this.c -= CYC; this.night++;
      for (const st of this.struct) if (st.cab && st.k === 'gate' && st.hp < st.mhp) { st.hp = st.mhp; if (st.broken) { st.broken = 0; st.open = 0; } }   // morning: cabin doors are mended (broken ones shut again)
      for (const p of P) if (p.prof) { p.prof.n++; p.prof.bn = Math.max(p.prof.bn || 0, this.night - 1); dirty = true; gainXp(p, 40 + 8 * (this.night - 1)); }   // diamonds are paid when the run ends, not per night; XP for the night survived; bn = best nights survived in one run
    }
    const ph = this.ph(), f = this.fire, maxF = RC.fuelMax(f.lvl);
    let burn = 1; for (const p of P) if (!p.down) burn = Math.min(burn, GC.BY[p.cls].burn);
    burn *= Math.min(2, 1 + 0.03 * Math.max(0, this.night - 1));   // fires burn a little faster every night (+3% per night, up to double)
    f.fuel = Math.max(0, f.fuel - (ph === 0 ? 0.4 : 1) * burn * (f.slow > 0 ? 0.5 : 1) * dt); f.slow = Math.max(0, (f.slow || 0) - dt);
    const fr = f.fuel > 0 ? RC.camp(f.lvl) : 0;

    const FR = this.fires();   // nothing grows back inside a campfire's ring (home or any camp)
    for (let ri = 0; ri < this.res.length; ri++) { const r = this.res[ri]; if (r.hp <= 0 && (r.rt -= dt) <= 0) {
      if (FR.some(F => Math.hypot(r.x - F.x, r.y - F.y) < RC.camp(F.f.lvl))) { r.rt = 0; continue; }
      if (ROCKY(r.k)) { const nk = Math.random() < GOLD_P ? 'g' : 'r'; if (nk !== r.k) { r.k = nk; r.mhp = HP[nk]; this.rForce = 1; for (const q of P) send(q.ws, { t: 'rk', i: ri, k: nk }); } }   // ~1% of regrowing rocks come up as gold ore veins
      r.hp = r.mhp;
    } }
    for (const p of P) p.rv = 0;
    this.tickBoats(dt); this.stepSharks(dt); this.stepBattle(P, dt);
    for (const c of this.camps) c.fuel = Math.max(0, c.fuel - (ph === 0 ? 0.4 : 1) * burn * (c.slow > 0 ? 0.5 : 1) * dt), c.slow = Math.max(0, (c.slow || 0) - dt);

    for (const p of P) {
      if (p.down) continue;
      if (p.inpAt && Date.now() - p.inpAt > 400) p.inp = { dx: 0, dy: 0, act: 0, hit: 0, rn: 0 };   // client stopped sending (frozen/backgrounded tab): never keep walking
      const c = GC.BY[p.cls], i = p.inp;
      p.actcd -= dt; p.hitcd -= dt; p.abilCd = Math.max(0, (p.abilCd || 0) - dt);
      const B = p.buff; for (const k in B) if (B[k] > 0) B[k] = Math.max(0, B[k] - dt);
      const actEdge = i.act && !p.actPrev; p.actPrev = i.act;
      if (p.boat) {   // aboard a boat: the boat carries you; ACT gets you out near land. Passengers (not the captain) can shoot projectiles with ATTACK
        if (actEdge) { const q = p.gear.rod && (!p.fishing || Date.now() - p.fishing.t > 40000) && this.poolNear(p); if (q) { p.fishing = { id: q.id, t: Date.now() }; send(p.ws, { t: 'fishgame', id: q.id, kind: q.kind }); } else this.exitBoat(p); }   // ACT next to a fish pool fishes from the boat; otherwise it gets you out
        { const mate = P.find(q => q.down && q !== p && Math.hypot(q.x - p.x, q.y - p.y) < 110);   // revive someone floating in the water from the boat
          if (mate && i.act && Math.hypot(i.dx, i.dy) <= 0.1) { mate.rev += dt * c.rev; mate.rv = 1; } }
        const bt = this.boats.find(x => x.id === p.boat);
        if (bt && bt.drv !== p.id && i.hit && p.hitcd <= 0 && !(p.fishing && Date.now() - p.fishing.t < 40000)) {
          if (false) { }
          else {
            const gk = this.gunOf(p);
            if (!gk || this.gunReady(p)) {   // a gun that is empty or being reloaded does not fire
              const g = gk ? RC.GUNS[gk] : { dmg: c.dmg + (p.gear.sword ? 8 : 0), cd: Math.max(0.5, c.cd), speed: 800, ttl: 0.6 };   // no gun: a plain thrown shot
              p.hitcd = g.cd; let ang = p.fa, bd = 700;
              if (i.am) ang = i.aim; else for (const t of [...this.aliens, ...(this.wolves || []), ...(this.rabbits || [])]) if (t.hp > 0 && t.k !== 2 && !t.air) { const dd = dist(p, t); if (dd < bd) { bd = dd; ang = Math.atan2(t.y - p.y, t.x - p.x); } }   // aboard you can aim all around
              p.sw = (p.sw + 1) & 255; p.swk = 3; p.swa = ang; this.shoot(p, ang, g.dmg * (B.rage > 0 || B.power > 0 ? 2 : 1), g.speed, g.ttl, 3); if (gk) this.gunFired(p);
            }
          }
        }
        continue;
      }
      if (B.regen > 0 && p.hp < p.mhp) p.hp = Math.min(p.mhp, p.hp + 2 * dt);
      if (B.regen2 > 0 && p.hp < p.mhp) p.hp = Math.min(p.mhp, p.hp + 5 * dt);
      let dx = i.dx, dy = i.dy; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      let spd = c.spd * (B.speed > 0 ? 1.25 : 1) * (B.haste > 0 ? 2 : 1) * (B.rage > 0 || B.power > 0 ? 1.4 : 1);
      // running: the further the stick is pushed past the walk ring, the faster (up to 1.7x); it costs stamina, and a winded player can only walk
      let rn = m > 0.1 ? Math.max(0, Math.min(1, +i.rn || 0)) : 0; if (p.tired) rn = 0;
      if (rn > 0 && p.sta > 0) {
        p.sta = Math.max(0, p.sta - STA.drain * rn * dt); p.staCd = STA.delay; spd *= 1 + (STA.sprint - 1) * rn;
        if (p.sta <= 0) { p.tired = 1; p.staCd = STA.tiredDelay; }
      } else {
        p.staCd -= dt; if (p.staCd <= 0) { const SF = this.litAt(p.x, p.y); p.sta = Math.min(p.smax || STA.max, p.sta + STA.regen * (SF ? 10 * (1 + 0.05 * (SF.f.lvl - 1)) : 1) * dt); }   // inside a lit fire's ring stamina refills 10x as fast (and +5% more per fire level above 1)
        if (p.tired && p.sta >= STA.resume * (p.smax || STA.max) / STA.max) p.tired = 0;
      }
      let flying = false;
      if (p.kb) { p.kb.t += dt; const u = p.kb.t / CHARGER.stunSec; if (u >= 1) p.kb = null; else { const v = p.kb.v0 * (1 - u) * (1 - u); p.x += p.kb.dx * v * dt; p.y += p.kb.dy * v * dt; flying = true; } }   // knocked back: no steering until it wears off
      if (!flying) { p.x += dx * spd * dt; p.y += dy * spd * dt; } if (m > 0.1) p.fa = Math.atan2(dy, dx);
      if (i.am) p.fa = i.aim;   // aiming (mouse cursor / aim stick): you face where you aim, whichever way you walk
      for (const st of this.struct) { if (st.k === 'trap' || st.k === 'spike' || (st.k === 'gate' && st.open)) continue; const [qx, qy, qr] = solidPt(st, p.x, p.y), sd = Math.hypot(p.x - qx, p.y - qy), mn = qr + 14; if (sd < mn && sd > 0.01) { p.x = qx + (p.x - qx) / sd * mn; p.y = qy + (p.y - qy) / sd * mn; } }
      { const g = this.resGrid(), cx = Math.floor(p.x / 200), cy = Math.floor(p.y / 200);   // trunks and boulders are obstacles
        for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) { const arr = g.get((cx + ax) * 100003 + cy + ay); if (!arr) continue;
          for (const r of arr) { if (r.hp <= 0) continue; const sd = Math.hypot(p.x - r.x, p.y - r.y), mn = RES_R[r.k] + 14; if (sd < mn && sd > 0.01) { p.x = r.x + (p.x - r.x) / sd * mn; p.y = r.y + (p.y - r.y) / sd * mn; } } } }
      if (this.lava && this.lava.length) { for (const L of this.lava) if (Math.hypot(p.x - L.x, p.y - L.y) < L.r - 6) { this.hurt(p, 15 * dt); if (!p.burnT || p.burnT <= 0) { p.burnT = 2; send(p.ws, { t: 'toast', msg: '🔥 Lava! Get out!' }); } break; } if (p.burnT > 0) p.burnT -= dt; }   // standing in lava burns (15 HP a second)
      if (this.landAt(p.x, p.y) < 0) { const q = this.landPoint(p.x, p.y); p.x = q[0]; p.y = q[1]; }   // stay on land (any island); only boats go on water
      const d = Math.hypot(p.x, p.y);

      if (i.act) {
        const mate = P.find(q => q.down && dist(p, q) < 60);
        if (mate) { if (m <= 0.1) { mate.rev += dt * c.rev; mate.rv = 1; } }   // you have to stand still while reviving
        else if (actEdge && this.boatNear(p)) this.enterBoat(p, this.boatNear(p));
        else if (actEdge && this.lootNear(p, 'chest')) this.openChest(p, this.lootNear(p, 'chest'));
        else if (actEdge && !p.gear.rod && this.poolNear(p)) { send(p.ws, { t: 'toast', msg: 'You need a fishing rod to fish - the Fisherman trader sells one.' }); p.actcd = 0.6; }
        else if (actEdge && (!p.fishing || Date.now() - p.fishing.t > 40000) && this.poolNear(p)) { const q = this.poolNear(p); p.fishing = { id: q.id, t: Date.now() }; p.actcd = 0.5; send(p.ws, { t: 'fishgame', id: q.id, kind: q.kind }); }
        else if (actEdge && this.gateNear(p)) { const g = this.gateNear(p); if (g.broken) send(p.ws, { t: 'toast', msg: 'This door is smashed - it will be mended by morning.' }); else g.open = g.open ? 0 : 1; p.actcd = 0.3; }
        else if (actEdge && this.lootNear(p, 'trader')) { const l = this.lootNear(p, 'trader'); send(p.ws, { t: 'open', what: 'trader', id: l.id, ty: l.trader }); }
        else if (p.actcd <= 0) {
          const FF = this.fireNear(p, 80);
          let stn = null, sd = 1e9; for (const st of this.struct) { if (st.k !== 'bench' && st.k !== 'chest' && st.k !== 'pot' && st.k !== 'smelter') continue; const dd = Math.hypot(p.x - st.x, p.y - st.y); if (dd < st.r + REACH && dd < sd) { sd = dd; stn = st; } }   // the nearest station in reach
          if (stn && FF && Math.hypot(p.x - FF.x, p.y - FF.y) < sd) stn = null;   // the fire is closer than the station: ACT feeds the fire
          if (stn) { if (actEdge) { p.actcd = 0.4; send(p.ws, { t: 'open', what: stn.k, id: stn.id }); } }   // every station opens its menu; the smelter only starts when you put rocks in
          else if (FF) {   // the main fire or any campfire: wood refuels it, stone levels it up
            const ff = FF.f, mxF = RC.fuelMax(ff.lvl), per = 15 * c.feed, need = mxF - ff.fuel;
            if (p.wood > 0 && need > per * 0.5) { const n = Math.min(p.wood, 5, Math.ceil(need / per)); ff.fuel = Math.min(mxF, ff.fuel + n * per); p.wood -= n; p.actcd = 0.3; }   // only as much wood as the gauge needs, and at most 5 per press
            else if (ff.lvl < RC.FIRE_MAX && p.stone >= 10 * ff.lvl) { p.stone -= 10 * ff.lvl; ff.lvl++; p.actcd = 0.5; }                                                          // gauge full: level the fire up with stone
          } else {
            let best = null, bd = 55;
            for (const r of this.res) if (r.hp > 0) { const dd = dist(p, r); if (dd < bd) { bd = dd; best = r; } }
            if (best && !this.spendSta(p, best.k === 'b' ? STA.bush : STA.swing)) { p.actcd = 0.3; this.winded(p); }
            else if (best) {
              p.actcd = 0.55; p.sw = (p.sw + 1) & 255; p.swk = WOODY(best.k) ? 1 : ROCKY(best.k) ? 2 : 3; p.swa = Math.atan2(best.y - p.y, best.x - p.x);
              best.hp -= WOODY(best.k) && p.gear.axe ? 1.34 : ROCKY(best.k) && p.gear.pick ? 1.5 : 1;
              if (best.hp <= 0) {
                best.rt = 45 + Math.random() * 30;
                if (best.k === 'g') this.spill(best, 1 + (Math.random() < 0.5 ? 1 : 0));   // a gold vein: 1-2 gold ore
                else if (best.k === 'b') this.spill(best, Math.max(1, Math.round(2 * c.food)));   // little strawberries pop out around the bush
                else this.spill(best, Math.max(1, Math.round(SPILL[best.k] * (best.k === 'r' ? c.stone : c.wood))));
              }
            } else if (this.campOf(p) && !this.struct.some(st => st.k === 'bench' && this.inCamp(this.campOf(p), st))) { if (actEdge) { p.actcd = 0.4; send(p.ws, { t: 'open', what: 'bench', id: 0 }); } }   // no bench yet: ACT in camp opens the build menu so you can place the first one
            else if (p.gear.rod && !p.boat && this.isWater(p.x + Math.cos(p.fa) * 80, p.y + Math.sin(p.fa) * 80)) {   // fishing rod at the shore: ACT casts
              if (!this.spendSta(p, STA.bush)) { p.actcd = 0.3; this.winded(p); }
              else { p.actcd = 1.1; p.sw = (p.sw + 1) & 255; p.swk = 1; p.swa = p.fa; if (Math.random() < 0.5) { const n = Math.min(Math.max(1, Math.round(2 * c.food)), Math.max(0, BAG_MAX - p.food)); p.food += n; send(p.ws, { t: 'fish', n }); } else send(p.ws, { t: 'fish', n: 0 }); }
            }
            else { p.actcd = 0.55; p.sw = (p.sw + 1) & 255; p.swk = 1; p.swa = p.fa; }   // nothing to chop: still swing
          }
        }
      }
      const fishingNow = p.fishing && Date.now() - p.fishing.t < 40000;   // no swinging while the fishing minigame is up
      if (i.hit && fishingNow) { }
      
      else if (i.hit && p.hitcd <= 0 && !p.boat && this.gunOf(p) && !this.gunReady(p)) { /* reloading or empty: no shot, no swing */ }
      else if (i.hit && p.hitcd <= 0 && !p.boat && this.gunOf(p)) {   // guns: ATTACK fires a bullet (auto-aimed at the nearest target in front)
        const g = RC.GUNS[this.gunOf(p)]; p.hitcd = g.cd; let ang = p.fa, bd = 700;
        if (!i.am) for (const t of [...this.aliens, ...(this.wolves || []), ...(this.rabbits || [])]) if (t.hp > 0 && t.k !== 2 && !t.air) { const dd = dist(p, t); let da = Math.atan2(t.y - p.y, t.x - p.x) - p.fa; da = Math.atan2(Math.sin(da), Math.cos(da)); if (dd < bd && Math.abs(da) < 1.0) { bd = dd; ang = Math.atan2(t.y - p.y, t.x - p.x); } }
        p.sw = (p.sw + 1) & 255; p.swk = 3; p.swa = ang; this.shoot(p, ang, g.dmg * (B.rage > 0 || B.power > 0 ? 2 : 1), g.speed, g.ttl, 3); this.gunFired(p);
      }
      else if (i.hit && p.hitcd <= 0) {
        p.hitcd = c.cd * (B.flurry > 0 ? 0.5 : 1);
        // with the spear it is a poke: anything up close as usual, plus a long reach straight ahead (within ~35 degrees of where you face)
        const sp = !!p.gear.spear, far = c.range + SPEAR_REACH; let best = null, bd = 1e9;
        const AIM = !!i.am, inArc = (t, w) => { let da = Math.atan2(t.y - p.y, t.x - p.x) - p.fa; da = Math.atan2(Math.sin(da), Math.cos(da)); return Math.abs(da) < w; };   // aiming: melee only hits what is in front of the cursor direction
        const ok = t => { const dd = dist(p, t); if (dd < c.range) return AIM && !inArc(t, 1.15) ? -1 : dd; if (!sp || dd > far) return -1; let da = Math.atan2(t.y - p.y, t.x - p.x) - p.fa; da = Math.atan2(Math.sin(da), Math.cos(da)); return Math.abs(da) < 0.6 ? dd : -1; };
        const consider = t => { const dd = ok(t); if (dd >= 0 && dd < bd) { bd = dd; best = t; } };
        for (const a of this.aliens) if (a.hp > 0 && a.k !== 2) consider(a);   // the Charger cannot be hit
        for (const b of this.rabbits) if (b.hp > 0) consider(b);   // rabbits too
        for (const w of this.wolves || []) if (w.hp > 0 && !w.air) consider(w);   // and wolves (vultures only once they have landed)
        p.sw = (p.sw + 1) & 255; p.swk = sp ? 5 : 4; p.swa = best ? Math.atan2(best.y - p.y, best.x - p.x) : p.fa;   // the weapon swings (or the spear pokes) even when nothing is in front of you
        if (best && best.rab) { this.tally(p, best); this.killRabbit(best); }
        else if (best) {
          let mul = (B.rage > 0 || B.power > 0 ? 2 : 1) * (B.flurry > 0 ? 1.5 : 1); if (B.crit3 > 0) { mul *= 3; B.crit3 = 0; }
          best.hp -= (c.dmg + (p.gear.spear ? 6 : 0) + (p.gear.sword ? 8 : 0) + (B.dmg > 0 ? 5 : 0)) * (Math.random() < c.crit ? 2 : 1) * mul;
          const kd = Math.max(1, dist(p, best)); const kr = best.k === 2 ? 0.2 : best.big === 2 ? 0.05 : best.heavy ? 0.12 : 1; best.x += (best.x - p.x) / kd * c.knock * kr; best.y += (best.y - p.y) / kd * c.knock * kr;
          if (best.wolf) { best.st = 1; best.tg = p.id; }   // a hit wolf turns on you
          if (best.hp <= 0) this.tally(p, best);
          if (best.hp <= 0 && p.prof) { p.prof.k++; dirty = true; if (p.prof.k % 10 === 0) award(p, 1, 'kills'); }
        }
      }
      if (p.hp < p.mhp) { const HF = this.litAt(p.x, p.y); if (HF) p.hp = Math.min(p.mhp, p.hp + 2 * (1 + 0.1 * (HF.f.lvl - 1)) * dt); }   // resting at a lit camp heals 2 HP/s at fire level 1, +10% per level (5.8 HP/s at level 20)
      if (c.regen && p.hp < p.mhp) p.hp = Math.min(p.mhp, p.hp + c.regen * dt);
      if (c.heal) for (const q of P) if (!q.down && q.hp < q.mhp && dist(p, q) < 90) q.hp = Math.min(q.mhp, q.hp + c.heal * dt);
    }
    for (const p of P) if (p.down) {
      if (!p.rv) p.rev = Math.max(0, p.rev - REVIVE.decay * dt);
      if (p.rev >= REVIVE.sec) { p.down = 0; p.rev = 0; p.hp = p.mhp * REVIVE.hp; if (this.landAt(p.x, p.y) < 0) { p.sea = 0; const bn = this.boatNear(p); if (bn) this.enterBoat(p, bn); } }   // revived in the water: climb aboard the boat that reached you
    }

    // smelters: one scrap per SMELT.time seconds, then it hops out onto the ground
    for (const st of this.struct) if (st.smelt && st.smelt.q > 0) {
      st.smelt.prog += dt;
      if (st.smelt.prog >= RC.SMELT.time) {
        st.smelt.prog = 0; st.smelt.q--;
        const a = Math.PI * (0.15 + Math.random() * 0.7), dd = st.r + 24 + Math.random() * 18;   // lands in front (below) of the smelter
        this.pend.push({ k: 'm', x: st.x + Math.cos(a) * dd, y: st.y + Math.sin(a) * dd, t: 0.45 });
      }
    }
    // ground pickups: appear after the animation, collected by running over them
    for (let i = this.pend.length - 1; i >= 0; i--) {
      const q = this.pend[i]; if ((q.t -= dt) > 0) continue;
      this.pend.splice(i, 1); if (this.drops.length < 160) this.drops.push({ id: this.nid++, k: q.k, x: q.x, y: q.y, ttl: 100, food: q.food });
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]; d.ttl -= dt; let taken = false;
      if (d.ttl > 0) for (const p of P) if (!p.down && dist(p, d) < 30) { if (d.k === 'q') { if (p.slots.length >= slotCap(p, this) || (d.food === 'foot' && p.slots.includes('foot'))) continue; p.slots.push(d.food); taken = true; break; }   // cooked food needs a free slot; with all 3 full it stays on the floor
        const bk = { w: 'wood', s: 'stone', f: 'food', n: 'meat', o: 'gold', h: 'pelt', H: 'apelt' }[d.k] || (d.k === 'd' ? '' : 'scrap');
        if (bk && (p[bk] || 0) >= BAG_MAX) continue;   // that stack is full (99): it stays on the floor until it times out
        if (d.k === 'w') p.wood++; else if (d.k === 's') p.stone++; else if (d.k === 'f') p.food++; else if (d.k === 'd') award(p, 1, 'drop'); else if (d.k === 'n') p.meat++; else if (d.k === 'o') p.gold++; else if (d.k === 'h') p.pelt++; else if (d.k === 'H') p.apelt++; else { p.scrap++; this.scrapFound = true; } taken = true; break; }
      if (taken || d.ttl <= 0) this.drops.splice(i, 1);
    }
    for (const p of P) if (!p.inf) for (const k of BAG_KEYS) if (p[k] > BAG_MAX) p[k] = BAG_MAX;   // safety net: whatever path added items, a stack never stays above 99
    for (const st of this.struct) if (st.k === 'spike') {   // spike strips hurt every enemy on them (not the Charger), 10 damage a tick per enemy, and wear down as they do
      for (const e of [...this.aliens, ...(this.wolves || [])]) {
        if (e.hp <= 0 || e.k === 2 || e.air || Math.hypot(e.x - st.x, e.y - st.y) > 36) continue;
        e.spk = (e.spk || 0) - dt; if (e.spk > 0) continue; e.spk = 0.5; e.hp -= 10; if (e.wolf) { e.st = 1; } this.hitWall(st, 3); if (st.dead) break;
      }
    }
    this.stepRabbits(P, dt); this.stepWolves(P, dt); this.stepPools(dt); this.stepVendor(P, dt);
    // aliens
    if (ph === 2) for (let i = 0; i < this.islands.length; i++) this.nightSpawns(i, P, dt);
    for (const a of this.aliens) {
      if (ph !== 2) { if (a.k === 2) a.hp = 0; else if (a.k < 3) a.hp -= 25 * dt; }   // dawn: aliens burn and the Charger vanishes, but raiding villagers (k 3-4, the tribesmen) are people, not creatures of the night       // sunlight burns them; the Charger vanishes the moment night ends
      a.cd -= dt;
      if (a.k === 2 && !(a.trapT > 0)) { const tr = this.struct.find(st => st.k === 'trap' && Math.hypot(a.x - st.x, a.y - st.y) < 34); if (tr) { a.trapT = TRAP_SEC; this.struct = this.struct.filter(s => s !== tr); for (const q of P) send(q.ws, { t: 'trapped' }); } }   // the big monster ran over a trap: stuck for 20 s
      if (a.trapT > 0) { a.trapT -= dt; a.cd = Math.max(a.cd, 0.3); continue; }   // stuck: no moving, no attacking
      if (a.stunT > 0) { a.stunT -= dt; a.cd = Math.max(a.cd, 0.3); continue; }   // stunned by an ability
      if (INFIGHT && this.fightStep(a, 'a', dt, P)) continue;   // [infight]
      if (a.slowT > 0) a.slowT -= dt;
      let tgt = null, bd = 1e9, slow = 0; const ai = a.isl | 0, home = ai === 0, own = this.islands[ai] || this.islands[0];
      let sealed = null, sbd = 1e9;   // players walled in where the enemy cannot path to them
      for (const p of P) if (!p.down && !p.boat && this.onIsland(p, ai)) {   // aliens only hunt players on their own island
        const dd = dist(a, p); if (a.vil && dd > (a.chase ? 800 : 420)) continue;   // camp villagers only notice you up close and give up a long chase
        const E = this.enclosure(p);
        if (E && !(E.cab && this.inCabin(E.cab, a.x, a.y, 10))) { if (dd < sbd) { sbd = dd; sealed = E; } continue; }
        if (dd < bd) { bd = dd; tgt = p; }
        const sl = GC.BY[p.cls].slow; if (sl > slow && dd < 110) slow = sl;
      }
      if (!tgt && sealed) { const w = this.nearWall(sealed, a.x, a.y); if (w) { tgt = { x: w.qx, y: w.qy, wall: w.st, qr: w.qr }; if (w.st.cabRef) { const wp = this.cabinApproach(w.st.cabRef, w.st, a.x, a.y); if (wp) { tgt.x = wp[0]; tgt.y = wp[1]; tgt.far = 1; } } } }   // shut in a cabin: round the walls to a door first   // cannot reach anyone: attack the nearest wall of the enclosure
      if (a.wallTg) {   // it gave up on a way round: breaking this wall first (up to WALL_SEC), then it paths to you again
        const ws = a.wallTg; if (ws.dead || ws.hp <= 0 || (a.wallT -= dt) <= 0 || !tgt) { a.wallTg = null; a.blkT = 0; }
        else { const [qx, qy, qr] = solidPt(ws, a.x, a.y); tgt = { x: qx, y: qy, wall: ws, qr }; }
      }
      if (a.vil) a.chase = tgt ? 1 : 0;
      const sp = a.sp * (1 - slow) * (a.slowT > 0 ? 0.45 : 1);
      const tx = tgt ? tgt.x : a.vil ? a.hx : own.x, ty = tgt ? tgt.y : a.vil ? a.hy : own.y, d = Math.max(1, Math.hypot(tx - a.x, ty - a.y));   // with nobody to chase they drift to the fire (home) or the island's middle
      if (tgt) a.fa = Math.atan2(ty - a.y, tx - a.x);   // always face the nearest living player, even when standing still against the fire ring
      let mx = (tx - a.x) / d, my = (ty - a.y) / d;
      { // the firelight ring is a wall for aliens: when the straight line to the player would run into it, slide around it (the short way) instead of getting stuck on the near side
        const LF = a.k < 3 ? this.litAt(a.x, a.y, 70) : null, ad0 = LF ? Math.max(1, Math.hypot(a.x - LF.x, a.y - LF.y)) : 1;
        if (LF) {
          const ux = (a.x - LF.x) / ad0, uy = (a.y - LF.y) / ad0;
          if (mx * ux + my * uy < 0.15) {
            const cr = ux * my - uy * mx; if (Math.abs(cr) > 0.25) a.side = cr >= 0 ? 1 : -1; else if (!a.side) a.side = Math.random() < 0.5 ? 1 : -1;
            mx = -uy * a.side; my = ux * a.side;
          }
        }
      }
      let pathBlocked = false;
      if (tgt && !tgt.wall && tgt.cls) {
        const ps = this.pathStep(tgt, a.x, a.y);
        if (ps) { pathBlocked = true; if (ps.dir) { mx = ps.dir[0]; my = ps.dir[1]; } if ((a.blkT = (a.blkT || 0) + dt) > BLOCK_SEC) { const w = this.wallToBreak(a.x, a.y); if (w) { a.wallTg = w.st; a.wallT = WALL_SEC; } a.blkT = 0; } }
        else a.blkT = 0;
      }   // a wall is in the way: walk around it (ranged enemies do not shoot until they can see you)
      if (a.spit && tgt && !pathBlocked && d < 440) {   // spitter: every few seconds it lobs a slow glob toward you (walls stop it)
        a.spitCd = (a.spitCd === undefined ? 3 : a.spitCd) - dt;
        if (a.spitCd <= 0) { a.spitCd = 4 + Math.random() * 3; const ang = Math.atan2(ty - a.y, tx - a.x); this.arrows.push({ id: this.nid++, x: a.x, y: a.y, vx: Math.cos(ang) * 150, vy: Math.sin(ang) * 150, dmg: 12 + Math.min(12, (this.night - 16) * 0.5), ttl: 4.5, slow: 1 }); }
      }
      let stay = false;
      if ((a.k === 4 || a.k === 5) && tgt) {   // archer villager / cult mage: stops at range, aims (the client shows a red aim line), then looses an arrow / a slow fireball
        if (a.shotCd > 0) a.shotCd -= dt;
        if (d <= a.range && a.shotCd <= 0 && !pathBlocked) {
          a.aim = (a.aim || 0) + dt; stay = true;
          if (a.aim >= (a.k === 5 ? 1.0 : 1.5)) { const ang = Math.atan2(ty - a.y, tx - a.x); if (a.k === 5) this.arrows.push({ id: this.nid++, x: a.x, y: a.y, vx: Math.cos(ang) * 230, vy: Math.sin(ang) * 230, dmg: a.dmg, ttl: 2.6, fb: 1 }); else this.arrows.push({ id: this.nid++, x: a.x, y: a.y, vx: Math.cos(ang) * ARROW_SPEED, vy: Math.sin(ang) * ARROW_SPEED, dmg: a.dmg, ttl: 1.3 }); a.aim = 0; a.shotCd = a.k === 5 ? 2.4 : 2.6; }
        } else a.aim = 0;
      } else if (a.k === 4 || a.k === 5) a.aim = 0;
      if (!stay && (pathBlocked || d > (a.vil && !tgt ? 90 : (a.stop || 20)))) { a.x += mx * sp * (a.vil && !tgt ? 0.6 : 1) * dt; a.y += my * sp * (a.vil && !tgt ? 0.6 : 1) * dt; }
      for (const st of this.struct) {   // every structure is solid and indestructible (except traps)
        if (st.k === 'trap' || st.k === 'spike' || (st.k === 'gate' && st.open)) continue;
        const [qx, qy, qr] = solidPt(st, a.x, a.y), sd = Math.hypot(a.x - qx, a.y - qy), mn = qr + (a.rad || 12);
        if (sd < mn) { const k = sd > 0.01 ? mn / sd : 1; a.x = qx + (a.x - qx) * k; a.y = qy + (a.y - qy) * k; }   // solid: aliens slide around it, but cannot damage it, and it does not damage them
      }
      { const LF = a.k < 3 ? this.litAt(a.x, a.y, 0) : null; if (LF) { const r0 = RC.camp(LF.f.lvl), dx = a.x - LF.x, dy = a.y - LF.y, dd = Math.max(1, Math.hypot(dx, dy)); a.x = LF.x + dx * r0 / dd; a.y = LF.y + dy * r0 / dd; } }   // repelled by firelight (the main fire or any campfire)
      if (!home) { const ox = a.x - own.x, oy = a.y - own.y, od = Math.hypot(ox, oy), lim = RC.edgeRat(own, a.x, a.y) - 30; if (od > lim) { a.x = own.x + ox * lim / od; a.y = own.y + oy * lim / od; } }   // outer-island enemies stay ashore
      if (tgt && tgt.wall) { if (a.k !== 4 && !tgt.far && d - tgt.qr < (a.reach === undefined ? 28 : a.reach) + (a.rad || 12) && a.cd <= 0) { this.hitWall(tgt.wall, a.dmg); a.cd = a.atkCd || 1; } }   // walls take the hits (they do no damage back)
      else if (tgt && d < (a.reach === undefined ? 28 : a.reach) && a.cd <= 0 && (a.k >= 3 || !this.litAt(tgt.x, tgt.y))) {
        this.hurt(tgt, a.dmg); a.cd = a.atkCd || 1;
        if (a.k === 2) {   // the Charger sends you flying (about 10 steps) and then needs a moment before it can hit again
          const kx = tgt.x - a.x, ky = tgt.y - a.y, kl = Math.max(1, Math.hypot(kx, ky));
          tgt.kb = { dx: kx / kl, dy: ky / kl, t: 0, v0: CHARGER.knock * 3 / CHARGER.stunSec }; a.cd = 1.3;
        }
        if (tgt.hp <= 0) { tgt.hp = 0; tgt.down = 1; tgt.rev = 0; }
      }
    }
    for (let i = this.arrows.length - 1; i >= 0; i--) {   // arrows fly straight; spike walls / stations stop them, players take the damage
      const w = this.arrows[i];
      if (w.slow && w.hd !== 2) {   // the spitter's glob bends a little toward you once it gets close; if it misses it just carries on straight
        let tp = null, td = HOME_R; for (const p of P) if (!p.down && !p.boat) { const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < td) { td = d; tp = p; } }
        if (tp) {
          const cur = Math.atan2(w.vy, w.vx), want = Math.atan2(tp.y - w.y, tp.x - w.x), df = ((want - cur + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          if (!w.hd && Math.abs(df) < 1.2) { w.hd = 1; w.pd = td; }   // it only tries if you are roughly ahead of it
          if (w.hd === 1) {
            if (td > w.pd + 0.3) w.hd = 2;   // it is moving away again: that was its one attempt
            else { const turn = Math.max(-HOME_RATE * dt, Math.min(HOME_RATE * dt, df)), sp = Math.hypot(w.vx, w.vy), na = cur + turn; w.vx = Math.cos(na) * sp; w.vy = Math.sin(na) * sp; w.pd = td; }
          }
        } else if (w.hd === 1) w.hd = 2;
      }
      w.x += w.vx * dt; w.y += w.vy * dt; w.ttl -= dt; let dead = w.ttl <= 0;
      if (!dead) for (const st of this.struct) if (st.k !== 'trap' && st.k !== 'spike' && !(st.k === 'gate' && st.open)) { const [qx, qy, qr] = solidPt(st, w.x, w.y); if (Math.hypot(w.x - qx, w.y - qy) < qr) { if (st.hp > 0) this.hitWall(st, w.dmg); dead = true; break; } }
      if (!dead) for (const p of P) if (!p.down && !p.boat && Math.hypot(p.x - w.x, p.y - w.y) < 18) { this.hurt(p, w.dmg); dead = true; break; }
      if (dead) this.arrows.splice(i, 1);
    }
    for (const a of this.aliens) if (a.hp <= 0 && !a.dropped) { a.dropped = 1; if (Math.random() < 0.03) this.pend.push({ k: 'd', x: a.x, y: a.y, t: 0.35 }); }   // 3% of dead mobs leave a diamond
    this.aliens = this.aliens.filter(a => a.hp > 0);
    if (this.struct.some(st => st.dead)) this.struct = this.struct.filter(st => !st.dead);
    if (P.every(p => p.down)) this.over = 6;
  }
  snap() {
    const f = this.fire, hpNow = this.res.map(r => Math.max(0, Math.ceil(r.hp - 1e-9))), last = this.lastRhp, rd = [];   // resources are sent as changes only: [index, hp, index, hp, ...]; a newcomer gets the full string once
    if (last && last.length === hpNow.length) for (let i = 0; i < hpNow.length; i++) if (hpNow[i] !== last[i]) rd.push(i, hpNow[i]);
    this.lastRhp = hpNow; this.rForce = 0; let rsFull = null;
    const o = {
      t: 's', c: Math.round(this.c * 10) / 10, n: this.night, ph: this.ph(), o: this.over > 0 ? 1 : 0,
      f: [Math.round(f.fuel), RC.fuelMax(f.lvl), f.lvl, f.fuel > 0 ? RC.camp(f.lvl) : 0],
      p: [...this.players.values()].map(p => [p.id, p.name, p.cls, Math.round(p.x), Math.round(p.y), Math.round(p.hp), p.mhp, p.wood, p.stone, p.food, p.down, Math.round(p.rev * 10) / 10, p.sw, p.swk, Math.round(p.swa * 100), p.scrap, Math.round(p.fa * 100), Math.round(p.sta), p.tired, p.slots, p.boat || 0, p.meat || 0, p.gold || 0, p.pelt || 0, slotCap(p, this), !p.abilOn ? 0 : p.abilCd > 0 ? Math.ceil(p.abilCd) + 1 : 1, p.apelt || 0, p.fish1 || 0, p.fish2 || 0, p.fish3 || 0, p.prof ? p.prof.bn || 0 : 0, lvOf(p), p.smax || STA.max, this.gunOf(p) === 'pistol' ? 1 : this.gunOf(p) === 'rifle' ? 2 : 0, (() => { const g = this.gunOf(p); return g === 'rifle' ? p.magR || 0 : g === 'pistol' ? p.magP || 0 : 0; })(), (() => { const g = this.gunOf(p); return g === 'rifle' ? p.ammoR || 0 : g === 'pistol' ? p.ammoP || 0 : 0; })(), p.reload ? Math.max(1, Math.round(p.reload.t / p.reload.dur * 100)) : 0]),
      sk: (this.sharks || []).map(s => [s.id, Math.round(s.x), Math.round(s.y), Math.round(s.fa * 100), s.bite > 0 ? 1 : 0, s.out !== undefined ? 1 : 0]),
      fp: (this.pools || []).map(q => [q.id, q.x, q.y, q.kind, q.left]),
      bt: this.boats.map(b => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.ang * 100), b.riders.length, b.drv, b.type || 'boat', Math.round(100 * (b.life == null ? 1 : b.life / RC.BOATS[b.type || 'boat'].life)), b.storm || 0]).concat(this.vendor ? [[-this.vendor.id, Math.round(this.vendor.bx), Math.round(this.vendor.by), Math.round(this.vendor.ba * 100), 0, 0, 'boat', 100, 0]] : []), vd: this.vendor ? [this.vendor.id, this.vendor.type, Math.round(this.vendor.x), Math.round(this.vendor.y), this.vendor.st, Math.round(this.vendor.fa * 100), this.vendor.l.id] : undefined, sf: this.scrapFound ? 1 : 0,
      a: this.aliens.map(a => [a.id, Math.round(a.x), Math.round(a.y), Math.round(a.hp), a.mhp, a.k, a.fa === undefined ? null : Math.round(a.fa * 100), Math.ceil(a.trapT > 0 ? a.trapT : 0), a.aim > 0 ? Math.round(Math.min(1, a.aim / 1.5) * 100) : 0, a.spit ? 1 : 0]),
      wf: (this.wolves || []).map(w => [w.id, Math.round(w.x), Math.round(w.y), Math.round(w.fa * 100), Math.round(w.hp), w.mhp, w.st, w.bite > 0 ? 1 : 0, w.alpha || 0, w.big || 0, w.vul ? (w.air ? 1 : 2) : 0, w.sp ? MOBS[w.sp].idx : 0]),
      rb: this.rabbits.map(b => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.fa * 100), b.run ? 1 : b.sit ? 0 : 2, CRIT[b.crit || 'rabbit'].idx]),
      cf: this.camps.map(c => [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.fuel), RC.fuelMax(c.lvl), c.lvl, c.fuel > 0 ? RC.camp(c.lvl) : 0]),
      lo: this.loot.filter(l => l.open).map(l => l.id),
      bl: this.bullets.map(b => [b.id, Math.round(b.x), Math.round(b.y), Math.round(Math.atan2(b.vy, b.vx) * 100), b.kind]),
      zn: this.zones.map(z => [z.id, Math.round(z.x), Math.round(z.y), z.r, z.k, Math.ceil(z.ttl)]),
      tr: this.turrets.map(t => [t.id, Math.round(t.x), Math.round(t.y)]),
      ar: this.arrows.map(w => [w.id, Math.round(w.x), Math.round(w.y), Math.round(Math.atan2(w.vy, w.vx) * 100), w.fb ? 2 : w.slow ? 1 : 0]),
      rd: rd.length ? rd : undefined,
      dr: this.drops.map(d => [d.id, d.k, Math.round(d.x), Math.round(d.y), d.food]),
      st: this.struct.filter(t => t.k !== 'cwall').map(t => [t.id, t.k, Math.round(t.x), Math.round(t.y), Math.round(t.hp), t.mhp, t.items ? [t.items.wood, t.items.stone, t.items.food, t.items.scrap] : t.smelt ? [t.smelt.q, Math.round(t.smelt.prog / RC.SMELT.time * 100) / 100] : 0, t.rot || 0, t.open ? 1 : 0, t.m || '']),
    };
    // each player only gets the creatures, fish pools and sharks near them (the whole map's worth was ~90 KB per snapshot); everything else is shared
    const NEAR = 1900, out = new Map();
    for (const p of this.players.values()) {
      const px = p.x, py = p.y, near = e => Math.abs(e[1] - px) < NEAR && Math.abs(e[2] - py) < NEAR;
      if (p.needR && !rsFull) rsFull = hpNow.join('');
      const full = p.needR ? rsFull : undefined; p.needR = 0;
      out.set(p.id, JSON.stringify(Object.assign({}, o, { r: full, a: o.a.filter(near), wf: o.wf.filter(near), rb: o.rb.filter(near), fp: o.fp.filter(near), sk: o.sk.filter(near) })));
    }
    return out;
  }
}

const rooms = new Map();
// ---------- rooms survive a server restart: saved to rooms.json every 3 s and on shutdown, reloaded at startup ----------
const ROOMS_FILE = DIR && path.join(DIR, 'rooms.json'); let lastRoomsJson = '';
function saveRooms(sync) {   // the compact form (about a third of the size); written in the background except at shutdown
  if (!ROOMS_FILE) return;
  try {
    const j = JSON.stringify([...rooms.values()].map(r => r.saveBlob())); if (j === lastRoomsJson) return; lastRoomsJson = j;
    if (sync) { fs.writeFileSync(ROOMS_FILE + '.tmp', j); fs.renameSync(ROOMS_FILE + '.tmp', ROOMS_FILE); }
    else fs.writeFile(ROOMS_FILE + '.tmp', j, e => { if (e) return console.error('rooms save failed:', e.message); fs.rename(ROOMS_FILE + '.tmp', ROOMS_FILE, () => { }); });
  } catch (e) { console.error('rooms save failed:', e.message); }
}
try { for (const o of JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'))) rooms.set(o.code, o.v === 2 ? Room.fromSave(o) : Room.restore(o)); console.log('restored', rooms.size, 'room(s)'); } catch (e) { }
setInterval(saveRooms, 5000);   // compact (~1 MB), written in the background; shutdown saves again synchronously
const code = () => { let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join(''); } while (rooms.has(c)); return c; };

const wss = new WebSocketServer({ server: srv, maxPayload: 1024 });
wss.on('connection', ws => {
  let room = null, me = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !me) {
      const name = String(m.name || 'Survivor').replace(/[^\w \-]/g, '').slice(0, 12) || 'Survivor';
      const email = auth.sessionEmail(m.token);
      if (!email) { send(ws, { t: 'err', m: 'auth' }); return; }
      const pf = acct(email, true); if (!pf) { send(ws, { t: 'err', m: 'Server is full' }); return; }
      const owned = process.env.START_OWNALL ? GC.LIST.map(c => c.id) : ownedOf(pf);   // (START_OWNALL: test hook)
      const cls = owned.includes(m.cls) ? m.cls : (owned.includes(pf.last) ? pf.last : 'forester');
      if (pf.last !== cls) { pf.last = cls; dirty = true; }
      let rc = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (m.load) {   // "Continue saved game": rebuild the saved room (unless that room is still running)
        const sv = readSave(email); if (!sv || !sv.code) { send(ws, { t: 'err', m: 'No saved game found.' }); return; }
        rc = sv.code; if (!rooms.has(rc)) { try { rooms.set(rc, Room.fromSave(sv)); eraseSaveOf(email); /* a save can be loaded once */ } catch (e) { console.error('load failed:', e && e.stack || e); send(ws, { t: 'err', m: 'The saved game could not be loaded.' }); return; } }
      }
      if (!rc) rc = code();
      if (!rooms.has(rc)) rooms.set(rc, new Room(rc));
      room = rooms.get(rc);
      // one character per account: signing in again (another tab or device) takes over; the old connection is told to stop
      let live = null;
      for (const [, rm] of rooms) for (const op of [...rm.players.values()]) if (op.email === email && op.ws !== ws && !op.ghost) {
        const old = op.ws; op.ws = { readyState: 3, send() { } };   // its own close handler is now a no-op
        try { send(old, { t: 'err', m: 'dup' }); old.close(); } catch (e) { }
        if (rm === room) live = op; else { rm.stash(op); rm.releaseBoat(op); rm.players.delete(op.id); }
      }
      for (const [, rm] of rooms) if (rm !== room) for (const op of [...rm.players.values()]) if (op.email === email && op.ghost) { rm.stash(op); rm.releaseBoat(op); rm.players.delete(op.id); }   // a lingering "ghost" of you elsewhere goes too
      if (!live && room.players.size >= MAXP) { send(ws, { t: 'err', m: 'Room is full' }); return; }
      const ghost = live || (email && [...room.players.values()].find(p => p.ghost && p.email === email));   // you dropped out in danger (or are playing in another tab) and are back: continue the same character
      if (ghost) { me = ghost; me.ghost = 0; me.ws = ws; me.name = name; } else me = room.add(ws, name, cls, pf, email);
      send(ws, { t: 'init', id: me.id, room: rc, R, cls, gear: me.gear, prof: view(pf), res: room.res.map(r => [r.k, Math.round(r.x), Math.round(r.y)]), isl: room.islands.map(i => [i.x, i.y, i.r, i.b, i.s || 0]), loot: room.loot.filter(l => !l.visit).map(l => [l.id, l.x, l.y, l.b, l.seed, l.tier, l.cx, l.cy, l.trader, l.tx, l.ty, l.cab || 0, l.kind || '']), cab: (room.cabins || []).map(c => [c.id, c.isl, c.x, c.y, c.w, c.h, c.doors.map(d => [d.side, d.pos]), c.divs, c.decor]), vg: (room.villages || []).map(v => [v.id, v.x, v.y, v.seed, v.cult ? 1 : 0]), lv: (room.lava || []).map(l => [l.x, l.y, l.r]) });
    } else if (m.t === 'craft' && me) {
      const now = Date.now(); if (now - (me.lastCraft || 0) < 200) { send(ws, { t: 'crafted', id: String(m.id || ''), ok: false, msg: 'Slow down a little.', gear: me.gear }); return; } me.lastCraft = now;
      let res; try { res = room.craft(me, String(m.id || ''), m.rot); } catch (e) { console.error('craft error:', e && e.stack || e); res = { ok: false, msg: 'Could not craft that.' }; }
      send(ws, { t: 'crafted', id: String(m.id || ''), ok: res.ok, msg: res.msg, gear: me.gear });
    } else if (m.t === 'fishdone' && me) {
      try { room.fishDone(me, +m.id, !!m.ok); } catch (e) { console.error('fish error:', e && e.stack || e); }
    } else if (m.t === 'chest' && me) {
      try { room.chestOp(me, +m.id, String(m.res || ''), m.n); } catch (e) { console.error('chest error:', e && e.stack || e); }
    } else if (m.t === 'smelt' && me) {
      const now = Date.now(); if (now - (me.lastSmelt || 0) < 150) return; me.lastSmelt = now;
      let res; try { res = room.smelterLoad(me, m.id | 0, m.n); } catch (e) { console.error('smelt error:', e && e.stack || e); res = { ok: false, msg: 'Could not smelt that.' }; }
      send(ws, { t: 'smelted', ok: res.ok, msg: res.msg });
    } else if (m.t === 'dismantle' && me) {
      const now = Date.now(); if (now - (me.lastDis || 0) < 300) return; me.lastDis = now;
      let res; try { res = room.dismantle(me, m.id | 0); } catch (e) { console.error('dismantle error:', e && e.stack || e); res = { ok: false, msg: 'Could not dismantle that.' }; }
      send(ws, { t: 'dism', ok: res.ok, msg: res.msg });
    } else if (m.t === 'boat' && me) {
      const now = Date.now(); if (now - (me.lastBoat || 0) < 300) return; me.lastBoat = now;
      const res = room.placeBoat(me, m.i | 0); send(ws, { t: 'boatPlaced', ok: res.ok, msg: res.msg });
    } else if (m.t === 'quit' && me) {   // "Exit to main menu": leaving after playing on past your save forfeits that save (no rewinding by quitting)
      const sv = me.prof && me.prof.save; if (sv && sv.rc === room.code && sv.gt !== undefined && room.night * CYC + room.c - sv.gt > 20) eraseSaveOf(me.email);
    } else if (m.t === 'save' && me) {
      const now = Date.now(); if (now - (me.lastSave || 0) < 5000) return; me.lastSave = now;
      let out = null; try { out = writeSave(me.email, room.saveBlob()); } catch (e) { console.error('save failed:', e && e.stack || e); }
      if (!out || !me.prof) { send(ws, { t: 'saved', ok: false }); return; }
      me.prof.save = { at: now, n: room.night, rc: room.code, gt: room.night * CYC + room.c, bytes: out.bytes, gz: out.gz }; dirty = true;
      send(ws, { t: 'saved', ok: true, at: now, night: room.night, bytes: out.bytes, gz: out.gz, players: room.players.size });
    } else if (m.t === 'trade' && me) {
      const now = Date.now(); if (now - (me.lastTrade || 0) < 250) return; me.lastTrade = now;
      let res; try { res = room.trade(me, m.id | 0, String(m.offer || '')); } catch (e) { console.error('trade error:', e && e.stack || e); res = { ok: false, msg: 'Trade failed.' }; }
      send(ws, { t: 'traded', ok: res.ok, msg: res.msg, gear: me.gear, prof: view(me.prof) });
    } else if (m.t === 'abil' && me) {
      const now = Date.now(); if (now - (me.lastAbil || 0) < 300) return; me.lastAbil = now;
      try { room.useAbility(me); } catch (e) { console.error('ability error:', e && e.stack || e); }
    } else if (m.t === 'reload' && me) { if (!me.down) room.startReload(me);
    } else if (m.t === 'wpn' && me) {   // pick which weapon ATTACK uses: melee, or a gun you own
      const w = String(m.w); if (w === 'melee' || (w === 'pistol' && me.gear.pistol) || (w === 'rifle' && me.gear.rifle)) me.wpn = w;
    } else if (m.t === 'use' && me) {
      const now = Date.now(); if (now - (me.lastUse || 0) < 150) return; me.lastUse = now;
      try { room.useSlot(me, m.i | 0); } catch (e) { console.error('use error:', e && e.stack || e); }
    } else if (m.t === 'cook' && me) {
      const now = Date.now(); if (now - (me.lastCook || 0) < 150) return; me.lastCook = now;
      let res; try { res = room.cook(me, String(m.id || '')); } catch (e) { console.error('cook error:', e && e.stack || e); res = { ok: false, msg: 'Could not cook that.' }; }
      send(ws, { t: 'cooked', id: String(m.id || ''), ok: res.ok, msg: res.msg, b: me.buff });
    } else if (m.t === 'in' && me) {
      const n = v => Math.max(-1, Math.min(1, +v || 0));
      me.inp = { dx: n(m.dx), dy: n(m.dy), act: m.act ? 1 : 0, hit: m.hit ? 1 : 0, rn: Math.max(0, Math.min(1, +m.rn || 0)), am: m.am && isFinite(+m.aim) ? 1 : 0, aim: +m.aim || 0 }; me.inpAt = Date.now();
    }
  });
  ws.on('close', () => {
    if (!(room && me) || me.ws !== ws) return;
    if (!me.ended && room.dangerFor(me)) { me.ghost = GHOST_SEC; me.ws = { readyState: 3, send() { } }; return; }   // leaving in danger: the character stays in the world (and can be hurt) for GHOST_SEC seconds
    if (!me.ended) room.stash(me); room.releaseBoat(me); room.players.delete(me.id);   // (stash first: it remembers which boat you were on)
  });
  ws.on('error', () => { });
});

let tk = 0;
setInterval(() => {
  tk++;
  for (const [c, r] of rooms) {
    try { r.tick(1 / 30); } catch (e) { console.error('tick error:', e && e.stack || e); }
    if (tk % 2 === 0 && r.players.size) { const s = r.snap(); for (const p of r.players.values()) if (p.ws.readyState === 1) p.ws.send(s.get(p.id)); }
    if (r.emptyFor > ROOM_IDLE_SEC) rooms.delete(c);   // nobody joined for the whole window: destroy the session
    if (r.ended) rooms.delete(c);   // everyone died and the game-over screens were sent: the session is gone (the same code starts a brand-new game)
  }
}, 1000 / 30);

srv.listen(PORT, () => console.log('Island Night listening on', PORT, 'profiles:', pcount, 'dir:', DIR));
