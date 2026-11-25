'use strict';
// Outer-island extras: loot areas (decorations, chests, traders), placeable campfires, bullets/zones/turrets, the trader menu,
// the hidden-ability button and the dynamic item slots. Loaded after game.js, which calls the x* hooks below.

// ---------- textures ----------
const T_MUSH = tex(46, 36, g => { [[12, 26, 8], [28, 22, 10], [20, 30, 6]].forEach(m => { g.fillStyle = '#eadfc8'; g.fillRect(m[0] - 2, m[1] - 4, 4, 9); g.fillStyle = '#d33f3a'; ell(g, m[0], m[1] - 5, m[2], m[2] * .7); g.fillStyle = '#fff'; circ(g, m[0] - 2, m[1] - 7, 1.6); circ(g, m[0] + 3, m[1] - 5, 1.3); }); });
const T_LOGF = tex(62, 30, g => { g.fillStyle = '#5a3a1e'; g.beginPath(); g.roundRect ? g.roundRect(4, 8, 52, 16, 7) : g.rect(4, 8, 52, 16); g.fill(); g.fillStyle = '#7b5230'; g.fillRect(8, 9, 44, 4); g.fillStyle = '#4f8a3c'; ell(g, 22, 10, 10, 3); ell(g, 42, 11, 8, 3); g.fillStyle = '#d9b676'; ell(g, 55, 16, 4, 7); });
const T_CAIRN = tex(40, 44, g => { [[20, 36, 15, 8], [20, 26, 11, 7], [20, 17, 7, 6], [20, 10, 4, 4]].forEach((r, i) => { g.fillStyle = ['#8b9096', '#a2a8ae', '#b6bcc2', '#c9ced3'][i]; ell(g, r[0], r[1], r[2], r[3]); g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.beginPath(); g.ellipse(r[0], r[1], r[2], r[3], 0, 0, TAU); g.stroke(); }); });
const T_BONES = tex(64, 42, g => { g.strokeStyle = '#efe6cf'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(10, 36); g.lineTo(54, 36); g.stroke(); for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(32, 22, 10 + i * 3, 4 + i * 4, 0, Math.PI, 0); g.stroke(); } });
const T_SKULL = tex(34, 34, g => { g.fillStyle = '#efe6cf'; ell(g, 17, 14, 12, 11); g.fillRect(10, 20, 14, 9); g.fillStyle = '#2b2118'; circ(g, 12, 14, 3.4); circ(g, 22, 14, 3.4); g.fillRect(15, 21, 1.5, 6); g.fillRect(19, 21, 1.5, 6); });
const T_PILLAR = tex(48, 78, g => { g.fillStyle = 'rgba(0,0,0,.18)'; ell(g, 24, 72, 20, 6); g.fillStyle = '#cdb98a'; g.fillRect(10, 20, 28, 52); g.fillStyle = '#b6a173'; g.fillRect(28, 20, 10, 52); g.fillStyle = '#dccb9c'; g.beginPath(); g.moveTo(8, 20); g.lineTo(14, 8); g.lineTo(22, 14); g.lineTo(30, 4); g.lineTo(40, 20); g.closePath(); g.fill(); g.fillStyle = '#a8946a'; g.fillRect(6, 68, 36, 8); });
const T_DRYB = tex(46, 38, g => { g.strokeStyle = '#a07a3c'; g.lineWidth = 2; for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; g.beginPath(); g.moveTo(23, 22); g.quadraticCurveTo(23 + Math.cos(a) * 12, 22 + Math.sin(a) * 4, 23 + Math.cos(a + .6) * 19, 22 + Math.sin(a + .6) * 14); g.stroke(); } });
const T_ICE = tex(48, 56, g => { [[14, 50, 9, 34], [26, 52, 11, 46], [37, 50, 8, 28]].forEach(c => { g.fillStyle = '#bfe6ff'; g.beginPath(); g.moveTo(c[0] - c[2] / 2, c[1]); g.lineTo(c[0], c[1] - c[3]); g.lineTo(c[0] + c[2] / 2, c[1]); g.closePath(); g.fill(); g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.moveTo(c[0] - 1, c[1]); g.lineTo(c[0], c[1] - c[3]); g.lineTo(c[0] + c[2] / 4, c[1]); g.closePath(); g.fill(); }); });
const T_STUMP = tex(46, 40, g => { g.fillStyle = '#6b4a2c'; g.fillRect(10, 14, 26, 22); g.fillStyle = '#8a6540'; ell(g, 23, 14, 13, 5); g.fillStyle = '#f2f7fb'; ell(g, 23, 11, 14, 5); ell(g, 14, 15, 5, 3); g.fillStyle = '#d9a441'; g.fillRect(31, 22, 3, 12); });
const T_SNOWM = tex(60, 36, g => { g.fillStyle = '#eef4fa'; ell(g, 30, 26, 26, 11); ell(g, 22, 20, 14, 10); ell(g, 38, 22, 12, 8); g.fillStyle = '#cfe0ee'; ell(g, 30, 30, 22, 5); });
const DECOR = { f: [T_MUSH, T_MUSH, T_LOGF, T_CAIRN, T_FLOWER], d: [T_BONES, T_SKULL, T_PILLAR, T_DRYB, T_DRYB], s: [T_ICE, T_ICE, T_STUMP, T_SNOWM, T_CAIRN], l: [T_CAIRN, T_SKULL, T_BONES, T_CAIRN, T_STUMP] };
const chestTex = (tier, open) => tex(60, 50, g => {
  const body = ['', '#8a5a2b', '#9aa3ad', '#e0b020'][tier], lid = ['', '#a8733a', '#c3cad2', '#f5cf4a'][tier], band = ['', '#4a2f14', '#5a626b', '#a67c00'][tier];
  g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, 30, 44, 26, 6);
  g.fillStyle = body; g.fillRect(8, 22, 44, 22); g.fillStyle = band; g.fillRect(8, 22, 44, 3); g.fillRect(8, 40, 44, 3); g.fillRect(27, 22, 6, 22);
  if (open) { g.fillStyle = '#1c130a'; g.fillRect(10, 18, 40, 6); g.fillStyle = lid; g.save(); g.translate(8, 18); g.rotate(-.9); g.fillRect(0, -14, 44, 14); g.restore(); g.fillStyle = '#ffe9a0'; circ(g, 30, 20, 3); }
  else { g.fillStyle = lid; g.beginPath(); g.moveTo(8, 22); g.quadraticCurveTo(30, 0, 52, 22); g.closePath(); g.fill(); g.fillStyle = band; g.fillRect(27, 10, 6, 12); g.fillStyle = '#ffe27a'; circ(g, 30, 24, 3.4); }
});
const T_LCHEST_BASE = [null, [chestTex(1, 0), chestTex(1, 1)], [chestTex(2, 0), chestTex(2, 1)], [chestTex(3, 0), chestTex(3, 1)]];
const T_LCHEST = T_LCHEST_BASE;
// cabin furniture (closed, opened): cabinet, barrel, crate, shelf - same look as the chests (seen from a little above)
const T_CAB = {
  cabinet: [0, 1].map(o => tex(56, 70, g => { g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, 28, 64, 22, 5); g.fillStyle = '#6e4623'; g.fillRect(8, 8, 40, 54); g.fillStyle = '#8a5a2b'; g.fillRect(10, 10, 36, 50); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.5; g.strokeRect(8, 8, 40, 54);
    if (o) { g.fillStyle = '#1c130a'; g.fillRect(12, 12, 32, 46); g.fillStyle = '#a8733a'; g.fillRect(2, 12, 10, 46); g.fillRect(44, 12, 10, 46); g.fillStyle = '#ffe9a0'; circ(g, 28, 40, 3); }
    else { g.fillStyle = '#a8733a'; g.fillRect(12, 12, 15, 46); g.fillRect(29, 12, 15, 46); g.strokeRect(12, 12, 15, 46); g.strokeRect(29, 12, 15, 46); g.fillStyle = '#ffe27a'; circ(g, 24, 36, 2.2); circ(g, 32, 36, 2.2); g.fillStyle = '#5a3a1c'; g.fillRect(6, 4, 44, 6); } })),
  barrel: [0, 1].map(o => tex(50, 60, g => { g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, 25, 54, 21, 5); g.fillStyle = '#7a4a22'; g.beginPath(); g.moveTo(8, 18); g.quadraticCurveTo(2, 36, 8, 52); g.lineTo(42, 52); g.quadraticCurveTo(48, 36, 42, 18); g.closePath(); g.fill();
    g.strokeStyle = '#3b3f45'; g.lineWidth = 3; for (const y of [24, 36, 47]) { g.beginPath(); g.moveTo(6, y); g.quadraticCurveTo(25, y + 5, 44, y); g.stroke(); }
    g.fillStyle = o ? '#1c130a' : '#a56b34'; ell(g, 25, 18, 17, 7); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(25, 18, 17, 7, 0, 0, TAU); g.stroke(); if (o) { g.fillStyle = '#ffe9a0'; circ(g, 25, 18, 3); } else { g.fillStyle = '#c28a4a'; ell(g, 25, 17, 12, 4); } })),
  crate: [0, 1].map(o => tex(56, 54, g => { g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, 28, 48, 23, 5); g.fillStyle = '#9a6a35'; g.fillRect(8, 16, 40, 30); g.strokeStyle = '#4a2f14'; g.lineWidth = 2.5; g.strokeRect(8, 16, 40, 30); g.beginPath(); g.moveTo(8, 16); g.lineTo(48, 46); g.moveTo(48, 16); g.lineTo(8, 46); g.stroke();
    g.fillStyle = o ? '#1c130a' : '#b8803f'; g.fillRect(6, 10, 44, 9); g.strokeRect(6, 10, 44, 9); if (o) { g.fillStyle = '#ffe9a0'; circ(g, 28, 14, 3); g.fillStyle = '#b8803f'; g.save(); g.translate(40, 12); g.rotate(.5); g.fillRect(0, -8, 22, 7); g.restore(); } })),
  shelf: [0, 1].map(o => tex(64, 62, g => { g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, 32, 56, 26, 5); g.fillStyle = '#5a3a1c'; g.fillRect(6, 8, 52, 46); g.fillStyle = '#2b1a0c'; g.fillRect(9, 11, 46, 18); g.fillRect(9, 32, 46, 19); g.fillStyle = '#7a4a22'; g.fillRect(6, 29, 52, 4); g.fillRect(6, 52, 52, 3);
    const cols = ['#c0392b', '#2e86c1', '#d4ac0d', '#27ae60', '#8e44ad']; for (let i = 0; i < 8; i++) { g.fillStyle = cols[i % 5]; g.fillRect(11 + i * 5.4, 15 + (i % 3), 4, 13 - (i % 3)); }
    if (o) { g.fillStyle = '#1c130a'; g.fillRect(12, 36, 40, 12); g.fillStyle = '#ffe9a0'; circ(g, 32, 42, 3); } else { for (let i = 0; i < 5; i++) { g.fillStyle = cols[(i + 2) % 5]; g.fillRect(12 + i * 8, 38, 6, 11); } g.fillStyle = '#d9c7a0'; g.fillRect(44, 41, 8, 8); } })),
};
const T_BULLET = tex(26, 8, g => { const gr = g.createLinearGradient(0, 0, 26, 0); gr.addColorStop(0, 'rgba(255,200,80,0)'); gr.addColorStop(1, 'rgba(255,240,170,1)'); g.fillStyle = gr; g.fillRect(0, 2, 26, 4); g.fillStyle = '#fff'; circ(g, 23, 4, 3); });
const T_TURRET = tex(44, 56, g => { g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, 22, 50, 18, 5); g.fillStyle = '#5b6068'; g.fillRect(10, 30, 24, 18); g.fillStyle = '#7d848d'; g.fillRect(12, 32, 8, 14); g.fillStyle = '#ffb74d'; circ(g, 22, 24, 11); g.fillStyle = '#3b3f45'; g.fillRect(20, 6, 6, 22); g.fillStyle = '#d32f2f'; circ(g, 22, 24, 3.5); });
const TRADER_LOOK = { 1: ['#9e9e9e', '#616161', '#3e2723', null, 'pack'], 2: ['#29b6f6', '#0277bd', '#6d4c41', null, 'basket'], 3: ['#8d6e63', '#4e342e', '#212121', 'wrench'], 4: ['#1e88e5', '#0d47a1', '#eeeeee', 'staff'], 5: ['#7e57c2', '#4527a0', '#e0e0e0', 'staff'] };
const T_TRADER = {}; for (const k in TRADER_LOOK) T_TRADER[k] = PIXI.Texture.from(mkPlayerCanvas(TRADER_LOOK[k]));

// ---------- state ----------
let LOOT = [], trE = {}, cullList = [], lootE = {}, campE = {}, bulletE = {}, zoneE = {}, turretE = {};
const BSPEED = { 1: 700, 2: 800, 3: 1000 };
const COSTI = { wood: '🪵', stone: '🪨', food: '🍓', scrap: '🔩', pelt: '🐺', apelt: '🐾', meat: '🍖', gold: '🪙' }, COSTX = { wood: 7, stone: 8, food: 9, scrap: 15, meat: 21, gold: 22, pelt: 23, apelt: 26 };

// ---------- loot areas ----------
// ---- desert villages: a few tipis around a campfire that is only for show (no glow, keeps nothing away) ----
const T_TIPI = tex(120, 136, g => {
  g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(60, 122, 52, 11, 0, 0, TAU); g.fill();
  g.strokeStyle = '#5a3a1c'; g.lineWidth = 4; g.beginPath(); g.moveTo(52, 10); g.lineTo(46, -2); g.moveTo(68, 10); g.lineTo(74, -2); g.stroke();   // the poles poking out of the top
  g.fillStyle = '#e8d4a6'; g.beginPath(); g.moveTo(60, 8); g.lineTo(112, 122); g.lineTo(8, 122); g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#d3b97d'; g.beginPath(); g.moveTo(60, 8); g.lineTo(112, 122); g.lineTo(76, 122); g.closePath(); g.fill();   // the shaded side
  g.fillStyle = '#b3402a'; for (let i = 0; i < 3; i++) { const y = 46 + i * 20, w = 12 + i * 11; g.fillRect(60 - w, y, w * 2, 5); }   // painted bands
  g.fillStyle = '#3a2412'; g.beginPath(); g.moveTo(60, 70); g.lineTo(76, 122); g.lineTo(44, 122); g.closePath(); g.fill();   // the door flap
});
const T_VFIRE = tex(90, 60, g => {
  g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(45, 42, 36, 12, 0, 0, TAU); g.fill();
  for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, x = 45 + Math.cos(a) * 28, y = 38 + Math.sin(a) * 11; g.fillStyle = '#8a8d92'; g.beginPath(); g.ellipse(x, y, 7, 5, 0, 0, TAU); g.fill(); g.strokeStyle = 'rgba(0,0,0,.4)'; g.stroke(); }
  g.strokeStyle = '#4b2f17'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(30, 40); g.lineTo(60, 34); g.moveTo(32, 33); g.lineTo(58, 42); g.stroke();   // two logs
});
// ---- lava pools (burn anyone standing in them) ----
let LAVAP = [];
function xLava(m) {
  LAVAP = (m.lv || []).map(([x, y, r]) => ({ x, y, r, ph: rnd(0, TAU) }));
  for (const L of LAVAP) {
    const g = new PIXI.Graphics(), rr = L.r, pts = k => { const o = []; for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, w = 1 + .1 * Math.sin(a * 3 + L.x) + .07 * Math.sin(a * 5 + L.y); o.push(Math.cos(a) * rr * k * w, Math.sin(a) * rr * k * w * .8); } return o; };
    g.beginFill(0x120a0c, .9); g.drawPolygon(pts(1.14)); g.endFill(); g.beginFill(0x8a2a0c); g.drawPolygon(pts(1)); g.endFill(); g.beginFill(0xe8561a); g.drawPolygon(pts(.8)); g.endFill(); g.beginFill(0xffa23a, .9); g.drawPolygon(pts(.5)); g.endFill(); g.beginFill(0xffe08a, .7); g.drawPolygon(pts(.22)); g.endFill();
    g.position.set(L.x, L.y); ground.addChild(g); L.g = g;
    const gl = new PIXI.Sprite(T_GLOW); gl.anchor.set(.5); gl.tint = 0xff6a1a; gl.blendMode = BM.ADD; gl.position.set(L.x, L.y); gl.scale.set(rr / 60 * 1.8); overL.addChild(gl); L.gl = gl;   // lava glows even at night
  }
}
let VILL = [];
function xVillages(m) {
  VILL = (m.vg || []).map(v => ({ id: v[0], x: v[1], y: v[2], seed: v[3], cult: !!v[4], flames: [] }));
  for (const v of VILL) {
    const rng = mulberry(v.seed), c = new PIXI.Container(); c.position.set(v.x, v.y); c.zIndex = v.y;
    if (v.cult) {   // a ritual site in the volcano: scorched ground, a ring of glowing runes, four obsidian obelisks and a fire altar
      const pad = new PIXI.Graphics(); pad.beginFill(0x120708, .55); pad.drawEllipse(v.x, v.y + 8, 200, 130); pad.endFill(); pad.lineStyle(3, 0xc0301a, .65); pad.drawEllipse(v.x, v.y + 8, 150, 98); pad.lineStyle(2, 0xff7a1a, .45); pad.drawEllipse(v.x, v.y + 8, 112, 73);
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + rng() * .1; pad.lineStyle(2.5, 0xff6a1a, .6); pad.moveTo(v.x + Math.cos(a) * 118, v.y + 8 + Math.sin(a) * 77); pad.lineTo(v.x + Math.cos(a + .1) * 142, v.y + 8 + Math.sin(a + .1) * 93); }
      ground.addChild(pad);
      for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + Math.PI / 4, ox = Math.cos(a) * 128, oy = Math.sin(a) * 84, o = new PIXI.Graphics(); o.beginFill(0x000000, .3); o.drawEllipse(0, 6, 16, 6); o.endFill(); o.beginFill(0x1c1216); o.drawPolygon([-12, 4, -8, -46, 0, -64, 8, -46, 12, 4]); o.endFill(); o.beginFill(0x3a2630); o.drawPolygon([0, -64, 8, -46, 12, 4, 0, 4]); o.endFill(); o.lineStyle(2, 0xff5a1f, .85); o.moveTo(-4, -40); o.lineTo(0, -22); o.lineTo(-3, -6); o.position.set(v.x + ox, v.y + oy); o.zIndex = v.y + oy; cullList.push({ c: o, x: v.x + ox, y: v.y + oy }); }
      const ring = new PIXI.Sprite(T_VFIRE); ring.anchor.set(.5, .6); c.addChild(ring);
      for (let i = 0; i < 2; i++) { const f = new PIXI.Sprite(T_FLAME); f.anchor.set(.5, .9); f.scale.set(.5 - i * .12); f.y = 2; f.tint = i ? 0xff4a1a : 0xc24bff; c.addChild(f); v.flames.push(f); }   // a purple and red fire
      v.c = c; cullList.push({ c, x: v.x, y: v.y }); continue;
    }
    const pad = new PIXI.Graphics(); pad.beginFill(0x8a6a34, .25); pad.drawEllipse(v.x, v.y + 8, 190, 120); pad.endFill(); ground.addChild(pad);
    const n = 3, a0 = rng() * TAU;
    for (let i = 0; i < n; i++) {   // tipis in a ring around the fire (each is its own sprite so it sorts by depth)
      const a = a0 + i * TAU / n + (rng() - .5) * .4, d = 110 + rng() * 25, s = new PIXI.Sprite(T_TIPI); s.anchor.set(.5, .92); s.scale.set(.85 + rng() * .25); s.position.set(v.x + Math.cos(a) * d, v.y + Math.sin(a) * d * .8); s.zIndex = s.y; cullList.push({ c: s, x: s.x, y: s.y });
    }
    const ring = new PIXI.Sprite(T_VFIRE); ring.anchor.set(.5, .6); c.addChild(ring);
    for (let i = 0; i < 2; i++) { const f = new PIXI.Sprite(T_FLAME); f.anchor.set(.5, .9); f.scale.set(.42 - i * .1); f.y = 2; c.addChild(f); v.flames.push(f); }   // normal blending, no glow sprite: just a picture of a fire
    v.c = c; cullList.push({ c, x: v.x, y: v.y });
  }
}
// ---------- cabins: log walls and a plank floor on the ground; the roof sits on top and fades out while you are inside ----------
const CABINS = [];
const CAB_FIRES = [];   // fireplace glows, so they can flicker
function drawBeams(c) {   // sunlight through each window: a widening shaft across the floor, its far end shifted by w.sh
  const g = c.beams; g.clear();
  for (const o of c.wins) {
    const P = (u, v) => [o.cx + o.ix * u + o.tx * v, o.cy + o.iy * u + o.ty * v], poly = (hw0, hw1, D, sh, col, al) => { const a = P(11, -hw0), b = P(11, hw0), q = P(D, hw1 + sh), d = P(D, -hw1 + sh); g.beginFill(col, al); g.drawPolygon([a[0], a[1], b[0], b[1], q[0], q[1], d[0], d[1]]); g.endFill(); };
    poly(23, 40, o.D, o.sh, 0xffe9a0, .11); poly(14, 22, o.D * .8, o.sh * .8, 0xfff4c8, .10);
    const e = P(o.D * .85, o.sh * .85); g.beginFill(0xfff0b0, .07); g.drawEllipse(e[0], e[1], 34, 34); g.endFill();   // a soft bright spot where the beam lands
  }
}
function xCabins(m) {
  for (const c of CABINS) { try { c.roof.destroy({ children: true }); } catch (e) { } } CABINS.length = 0; CAB_FIRES.length = 0;
  const DW = 104, GAPW = 84;   // a door is 104 wide (a gate); inner doorways are open gaps
  for (const [id, isl, x, y, w, h, doors, divs, decor] of m.cab || []) {
    const hw = w / 2, hh = h / 2, T = 22, rng = mulberry(id * 7919 + 13), sides = new Set(doors.map(d => d[0]));
    // ---- floor ----
    const fl = new PIXI.Graphics(); fl.beginFill(0x8a6a3f); fl.drawRect(x - hw, y - hh, w, h); fl.endFill();
    for (let yy = y - hh + 14; yy < y + hh; yy += 14) { fl.lineStyle(1.2, 0x5a4024, .55); fl.moveTo(x - hw, yy); fl.lineTo(x + hw, yy); }
    for (let yy = y - hh; yy < y + hh; yy += 14) { fl.lineStyle(1, 0x5a4024, .4); const xx = x - hw + 20 + rng() * (w - 40); fl.moveTo(xx, yy); fl.lineTo(xx, Math.min(y + hh, yy + 14)); }
    ground.addChild(fl);
    // ---- walls: log bars; the outer ones leave a gap at each door, the inner ones a doorway ----
    const wl = new PIXI.Graphics(), bar = (x0, y0, x1, y1, TT) => {
      const hz = y0 === y1; wl.beginFill(0x4a2f16); wl.drawRect(Math.min(x0, x1) - (hz ? 0 : TT / 2), Math.min(y0, y1) - (hz ? TT / 2 : 0), Math.abs(x1 - x0) + (hz ? 0 : TT), Math.abs(y1 - y0) + (hz ? TT : 0)); wl.endFill();
      if (hz) { for (let xx = Math.min(x0, x1); xx < Math.max(x0, x1) - 1; xx += 26) { const lw = Math.min(24, Math.max(x0, x1) - xx); wl.beginFill(0x9a6a36); wl.drawRoundedRect(xx + 1, y0 - TT / 2 + 2, lw - 2, TT - 4, 5); wl.endFill(); wl.beginFill(0xb98349, .7); wl.drawRoundedRect(xx + 3, y0 - TT / 2 + 4, lw - 6, Math.max(2, TT / 4), 2); wl.endFill(); } }
      else { for (let yy = Math.min(y0, y1); yy < Math.max(y0, y1) - 1; yy += 26) { const lh = Math.min(24, Math.max(y0, y1) - yy); wl.beginFill(0x9a6a36); wl.drawRoundedRect(x0 - TT / 2 + 2, yy + 1, TT - 4, lh - 2, 5); wl.endFill(); wl.beginFill(0xb98349, .7); wl.drawRoundedRect(x0 - TT / 2 + 4, yy + 3, Math.max(2, TT / 4), lh - 6, 2); wl.endFill(); } }
    };
    const span = (lo, hi, gaps, fn) => { let from = lo; for (const [g, gw] of gaps.slice().sort((a, b) => a[0] - b[0])) { if (g - gw / 2 - from > 4) fn(from, g - gw / 2); from = g + gw / 2; } if (hi - from > 4) fn(from, hi); };
    const side4 = (n, len, ax, ay, horiz) => span(-len / 2, len / 2, doors.filter(d => d[0] === n).map(d => [d[1], DW]), (a, b) => horiz ? bar(ax + a, ay, ax + b, ay, T) : bar(ax, ay + a, ax, ay + b, T));
    side4(0, w, x, y - hh, true); side4(2, w, x, y + hh, true); side4(3, h, x - hw, y, false); side4(1, h, x + hw, y, false);
    for (const [o, pos, a0, a1, gap] of divs) span(a0, a1, [[gap, GAPW]], (a, b) => o === 1 ? bar(x + pos, y + a, x + pos, y + b, T - 8) : bar(x + a, y + pos, x + b, y + pos, T - 8));
    ground.addChild(wl);
    // ---- windows in the outer walls (clear of doors and of where inner walls meet them) ----
    const wd = new PIXI.Graphics(), beams = new PIXI.Graphics(), wins = [];
    for (const [n, len] of [[0, w], [2, w], [3, h], [1, h]]) {
      const horiz = n % 2 === 0, junc = divs.filter(d => (horiz ? d[0] === 1 : d[0] === 0)).map(d => d[1]), dts = doors.filter(d => d[0] === n).map(d => d[1]);
      for (let t = -len / 2 + 120; t < len / 2 - 90; t += 170 + rng() * 60) {
        if (dts.some(q => Math.abs(q - t) < DW / 2 + 52) || junc.some(q => Math.abs(q - t) < 56)) continue;
        const cx = horiz ? x + t : (n === 3 ? x - hw : x + hw), cy = horiz ? (n === 0 ? y - hh : y + hh) : y + t, ix = n === 3 ? 1 : n === 1 ? -1 : 0, iy = n === 0 ? 1 : n === 2 ? -1 : 0;   // (ix, iy): into the cabin
        const lw = horiz ? 46 : 18, lh = horiz ? 18 : 46;
        wins.push({ cx, cy, ix, iy, tx: horiz ? 1 : 0, ty: horiz ? 0 : 1, D: Math.min(170, (horiz ? h : w) * .55), sh: 0 });   // daylight beam: drawn each frame (it swings toward you while you are inside)
        wd.beginFill(0x2b1a0b); wd.drawRect(cx - lw / 2 - 3, cy - lh / 2 - 3, lw + 6, lh + 6); wd.endFill();
        wd.beginFill(0xa9d8ee, .9); wd.drawRect(cx - lw / 2, cy - lh / 2, lw, lh); wd.endFill(); wd.beginFill(0xffffff, .35); wd.drawRect(cx - lw / 2 + 2, cy - lh / 2 + 2, horiz ? lw * .45 : 5, horiz ? 4 : lh * .45); wd.endFill();
        wd.lineStyle(1.6, 0x2b1a0b, .9); if (horiz) { wd.moveTo(cx, cy - lh / 2); wd.lineTo(cx, cy + lh / 2); wd.moveTo(cx - lw / 2, cy); wd.lineTo(cx + lw / 2, cy); } else { wd.moveTo(cx - lw / 2, cy); wd.lineTo(cx + lw / 2, cy); wd.moveTo(cx, cy - lh / 2); wd.lineTo(cx, cy + lh / 2); } wd.lineStyle(0);
        wd.beginFill(0x6e4420); if (horiz) { wd.drawRect(cx - lw / 2 - 11, cy - lh / 2 - 3, 8, lh + 6); wd.drawRect(cx + lw / 2 + 3, cy - lh / 2 - 3, 8, lh + 6); } else { wd.drawRect(cx - lw / 2 - 3, cy - lh / 2 - 11, lw + 6, 8); wd.drawRect(cx - lw / 2 - 3, cy + lh / 2 + 3, lw + 6, 8); } wd.endFill();   // shutters
      }
    }
    ground.addChild(beams); ground.addChild(wd);
    // ---- decoration: rugs first, then furniture ----
    const dc = new PIXI.Graphics(), pal = [0x8c2f39, 0x2f5d8c, 0x3d7a4a, 0x8a6a2f, 0x5b3a78];
    const shadow = (cx, cy, fw, fh) => { dc.beginFill(0x000000, .22); dc.drawRoundedRect(cx - fw / 2 + 4, cy - fh / 2 + 5, fw, fh, 4); dc.endFill(); };
    const order = decor.slice().sort((a, b) => (a[0] === 'rug' ? 0 : 1) - (b[0] === 'rug' ? 0 : 1));
    for (const [kind, rx, ry, fw, fh, seed, face] of order) {
      const cx = x + rx, cy = y + ry, r2 = mulberry(seed + 5);
      if (kind === 'rug') { const col = pal[seed % pal.length] || pal[0]; dc.beginFill(col, .92); dc.drawRoundedRect(cx - fw / 2, cy - fh / 2, fw, fh, 10); dc.endFill(); dc.lineStyle(3, 0xe8d9b0, .8); dc.drawRoundedRect(cx - fw / 2 + 7, cy - fh / 2 + 7, fw - 14, fh - 14, 7); dc.lineStyle(1.5, 0xe8d9b0, .55); dc.drawRoundedRect(cx - fw / 2 + 16, cy - fh / 2 + 16, fw - 32, fh - 32, 5); dc.lineStyle(0); }
      else if (kind === 'table') { shadow(cx, cy, fw, fh); dc.beginFill(0x6e4420); dc.drawRoundedRect(cx - fw / 2, cy - fh / 2, fw, fh, 5); dc.endFill(); dc.beginFill(0x9b6a38); dc.drawRoundedRect(cx - fw / 2 + 3, cy - fh / 2 + 3, fw - 6, fh - 6, 4); dc.endFill(); dc.lineStyle(1.2, 0x5a3a1c, .6); for (let k = 1; k < 4; k++) { dc.moveTo(cx - fw / 2 + 5, cy - fh / 2 + k * fh / 4); dc.lineTo(cx + fw / 2 - 5, cy - fh / 2 + k * fh / 4); } dc.lineStyle(0);
        dc.beginFill(0xf1ebe0); dc.drawCircle(cx - fw * .22, cy, 7); dc.endFill(); dc.beginFill(0xd9cfbf); dc.drawCircle(cx - fw * .22, cy, 4); dc.endFill(); dc.beginFill(0xf6efd8); dc.drawRect(cx + fw * .18, cy - 6, 5, 9); dc.endFill(); dc.beginFill(0xffc24a); dc.drawCircle(cx + fw * .18 + 2.5, cy - 9, 2.6); dc.endFill(); }   // a plate and a candle
      else if (kind === 'chair') { const f = face, bx = f === 1 ? -1 : f === 3 ? 1 : 0, by = f === 2 ? -1 : f === 0 ? 1 : 0; dc.beginFill(0x000000, .2); dc.drawRoundedRect(cx - 12, cy - 11, 26, 26, 4); dc.endFill(); dc.beginFill(0x7a4a22); dc.drawRoundedRect(cx - 13, cy - 13, 26, 26, 4); dc.endFill(); dc.beginFill(0xa56b34); dc.drawRoundedRect(cx - 9, cy - 9, 18, 18, 3); dc.endFill(); dc.beginFill(0x4a2f16); if (bx) dc.drawRoundedRect(cx + bx * 12 - 3, cy - 13, 6, 26, 2); else dc.drawRoundedRect(cx - 13, cy + by * 12 - 3, 26, 6, 2); dc.endFill(); }
      else if (kind === 'bed') { const down = face === 2; shadow(cx, cy, fw, fh); dc.beginFill(0x4a2f16); dc.drawRoundedRect(cx - fw / 2, cy - fh / 2, fw, fh, 6); dc.endFill(); dc.beginFill(0xe9e4d8); dc.drawRoundedRect(cx - fw / 2 + 5, cy - fh / 2 + 5, fw - 10, fh - 10, 5); dc.endFill();
        const hy = down ? cy + fh / 2 - 24 : cy - fh / 2 + 8; dc.beginFill(0xfff8e8); dc.drawRoundedRect(cx - fw / 2 + 9, hy, fw - 18, 16, 5); dc.endFill(); dc.lineStyle(1, 0xcfc6b0, .9); dc.drawRoundedRect(cx - fw / 2 + 9, hy, fw - 18, 16, 5); dc.lineStyle(0);
        const col = pal[(seed >> 3) % pal.length], by0 = down ? cy - fh / 2 + 6 : cy - fh / 2 + 28, bh = fh - 34; dc.beginFill(col); dc.drawRoundedRect(cx - fw / 2 + 6, by0, fw - 12, bh, 4); dc.endFill(); dc.lineStyle(1.5, 0xffffff, .35); for (let k = 1; k < 4; k++) { dc.moveTo(cx - fw / 2 + 8, by0 + k * bh / 4); dc.lineTo(cx + fw / 2 - 8, by0 + k * bh / 4); } dc.lineStyle(0); }
      else if (kind === 'counter') { shadow(cx, cy, fw, fh); dc.beginFill(0x5a3a1c); dc.drawRoundedRect(cx - fw / 2, cy - fh / 2, fw, fh, 3); dc.endFill(); dc.beginFill(0xc2a67c); dc.drawRoundedRect(cx - fw / 2 + 2, cy - fh / 2 + 2, fw - 4, fh - 8, 3); dc.endFill(); dc.beginFill(0x9fb7c4); dc.drawRoundedRect(cx - fw / 2 + 14, cy - 10, 34, 18, 4); dc.endFill(); dc.beginFill(0x4a4f57); dc.drawCircle(cx + fw / 2 - 30, cy - 2, 9); dc.endFill(); dc.beginFill(0x2a2d33); dc.drawCircle(cx + fw / 2 - 30, cy - 2, 5); dc.endFill(); dc.beginFill(0xd8d3c4); dc.drawRoundedRect(cx + 4, cy - 8, 22, 12, 2); dc.endFill(); }   // a sink, a stove ring, a cutting board
      else if (kind === 'fire') { shadow(cx, cy, fw, fh); dc.beginFill(0x57534f); dc.drawRoundedRect(cx - fw / 2, cy - fh / 2, fw, fh, 3); dc.endFill(); dc.lineStyle(1.2, 0x2e2b29, .9); for (let k = 0; k < 6; k++) { dc.moveTo(cx - fw / 2 + k * fw / 6, cy - fh / 2); dc.lineTo(cx - fw / 2 + k * fw / 6, cy + fh / 2); } dc.lineStyle(0);
        const hearth = new PIXI.Graphics(), ix = face === 3 ? -1 : face === 1 ? 1 : 0, iy = face === 0 ? 1 : face === 2 ? -1 : 0; hearth.beginFill(0x120a08); hearth.drawRoundedRect(cx - 24, cy - 8, 48, 16, 3); hearth.endFill(); hearth.beginFill(0xff7a1a, .9); hearth.drawEllipse(cx, cy, 16, 5); hearth.endFill(); hearth.beginFill(0xffd27a, .9); hearth.drawEllipse(cx, cy, 8, 3); hearth.endFill(); ground.addChild(hearth);
        const glow = new PIXI.Graphics(); glow.beginFill(0xff9a3c, .14); glow.drawEllipse(cx, cy + (face === 0 ? 40 : face === 2 ? -40 : 0), 110, 70); glow.endFill(); glow.beginFill(0xffb060, .10); glow.drawEllipse(cx, cy + (face === 0 ? 40 : face === 2 ? -40 : 0), 60, 38); glow.endFill(); ground.addChild(glow); CAB_FIRES.push({ g: glow, ph: rng() * 6 }); }
      else if (kind === 'plant') { dc.beginFill(0x000000, .22); dc.drawCircle(cx + 3, cy + 4, 12); dc.endFill(); dc.beginFill(0x7a4a22); dc.drawCircle(cx, cy, 11); dc.endFill(); dc.beginFill(0x3a2412); dc.drawCircle(cx, cy, 8); dc.endFill(); for (let k = 0; k < 7; k++) { const a = k / 7 * TAU + r2(), l = 14 + r2() * 6; dc.beginFill(k % 2 ? 0x3f8a3a : 0x56a846); dc.drawEllipse(cx + Math.cos(a) * l * .55, cy + Math.sin(a) * l * .55, l * .55, 5); dc.endFill(); } }
    }
    ground.addChild(dc);
    // ---- the doors: frame, warm light, deck-planked porch with railing and steps, lantern (the door itself is a gate you open with ACT / E) ----
    const por = new PIXI.Graphics(), dr = new PIXI.Graphics(), PD = 72, PW = DW / 2 + 38;
    for (const [side, pos] of doors) {
      const nx = side === 1 ? 1 : side === 3 ? -1 : 0, ny = side === 2 ? 1 : side === 0 ? -1 : 0, tx0 = -ny, ty0 = nx, dcx = x + (side === 1 ? hw : side === 3 ? -hw : pos), dcy = y + (side === 2 ? hh : side === 0 ? -hh : pos);
      const P = (u, v) => [dcx + nx * u + tx0 * v, dcy + ny * u + ty0 * v], quad = (g, u0, v0, u1, v1) => { const a = P(u0, v0), b = P(u1, v0), c = P(u1, v1), d = P(u0, v1); g.drawPolygon([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]]); };
      por.beginFill(0x000000, .22); quad(por, 8, -PW + 8, PD + 8, PW + 8); por.endFill(); por.beginFill(0x9a7440); quad(por, 6, -PW, PD, PW); por.endFill();
      for (let v = -PW + 11; v < PW; v += 11) { por.lineStyle(1.3, 0x5a4024, .7); const a = P(6, v), b = P(PD, v); por.moveTo(a[0], a[1]); por.lineTo(b[0], b[1]); }
      por.lineStyle(2.5, 0x3a2812, .9); { const a = P(PD, -PW), b = P(PD, PW); por.moveTo(a[0], a[1]); por.lineTo(b[0], b[1]); } for (const sg of [-1, 1]) { const a = P(6, sg * PW), b = P(PD, sg * PW); por.moveTo(a[0], a[1]); por.lineTo(b[0], b[1]); }
      por.lineStyle(0); por.beginFill(0x7a4a22); quad(por, PD - 2, -30, PD + 16, 30); por.endFill(); por.beginFill(0x8f5c2e); quad(por, PD + 12, -26, PD + 28, 26); por.endFill();
      por.lineStyle(1.5, 0x2e1c0c, .8); { const a = P(PD - 2, -30), b = P(PD - 2, 30), c = P(PD + 12, -26), d = P(PD + 12, 26); por.moveTo(a[0], a[1]); por.lineTo(b[0], b[1]); por.moveTo(c[0], c[1]); por.lineTo(d[0], d[1]); } por.lineStyle(0);
      for (const [u, v] of [[PD, -PW], [PD, PW], [8, -PW], [8, PW]]) { const q = P(u, v); por.beginFill(0x000000, .3); por.drawCircle(q[0] + 2, q[1] + 3, 7); por.endFill(); por.beginFill(0x4a2f16); por.drawCircle(q[0], q[1], 6); por.endFill(); por.beginFill(0x9a6a36); por.drawCircle(q[0] - 1, q[1] - 1, 3.2); por.endFill(); }
      dr.beginFill(0xe2b469, .9); quad(dr, -12, -DW / 2, 12, DW / 2); dr.endFill(); dr.beginFill(0x2b1a0b); quad(dr, -14, -DW / 2 - 9, 14, -DW / 2); quad(dr, -14, DW / 2, 14, DW / 2 + 9); dr.endFill();
      { const lp = P(14, -DW / 2 - 16); dr.beginFill(0xffd86b, .28); dr.drawCircle(lp[0], lp[1], 26); dr.endFill(); dr.beginFill(0xffe08a, .45); dr.drawCircle(lp[0], lp[1], 14); dr.endFill(); dr.beginFill(0x3a2412); dr.drawRoundedRect(lp[0] - 4, lp[1] - 6, 8, 12, 2); dr.endFill(); dr.beginFill(0xffd04a); dr.drawCircle(lp[0], lp[1], 3); dr.endFill(); }
    }
    ground.addChild(por); ground.addChild(dr);
    // ---- the roof: stops short on the door sides so doors and porches always show; a stone chimney on the ridge ----
    const roof = new PIXI.Container(), rg = new PIXI.Graphics(), OV = 18, TR = OV + 20;
    const rx0 = x - hw - OV + (sides.has(3) ? TR : 0), rx1 = x + hw + OV - (sides.has(1) ? TR : 0), ry0 = y - hh - OV + (sides.has(0) ? TR : 0), ry1 = y + hh + OV - (sides.has(2) ? TR : 0), rw = rx1 - rx0, rh = ry1 - ry0;
    rg.beginFill(0x000000, .22); rg.drawRect(rx0 + 8, ry0 + 12, rw, rh); rg.endFill(); rg.beginFill(0x7a3b22); rg.drawRect(rx0, ry0, rw, rh); rg.endFill();
    const long = rw >= rh, rows = Math.ceil((long ? rh : rw) / 22) + 1;
    for (let k = 0; k < rows; k++) { const p = (long ? ry0 : rx0) + k * 22; rg.beginFill(k % 2 ? 0x8a4527 : 0x6e331c); if (long) rg.drawRect(rx0, p, rw, Math.min(22, ry1 - p)); else rg.drawRect(p, ry0, Math.min(22, rx1 - p), rh); rg.endFill(); }
    rg.lineStyle(2, 0x2e140a, .7); for (let k = 0; k < rows; k++) { const p = (long ? ry0 : rx0) + k * 22; if (long) { rg.moveTo(rx0, p); rg.lineTo(rx1, p); } else { rg.moveTo(p, ry0); rg.lineTo(p, ry1); } }
    rg.lineStyle(5, 0xc98a52, .9); if (long) { rg.moveTo(rx0, (ry0 + ry1) / 2); rg.lineTo(rx1, (ry0 + ry1) / 2); } else { rg.moveTo((rx0 + rx1) / 2, ry0); rg.lineTo((rx0 + rx1) / 2, ry1); }
    rg.lineStyle(3, 0x2e140a, .85); rg.drawRect(rx0, ry0, rw, rh);
    const chx = long ? rx0 + rw * (.25 + (id % 3) * .2) : (rx0 + rx1) / 2, chy = long ? (ry0 + ry1) / 2 : ry0 + rh * (.25 + (id % 3) * .2);
    rg.lineStyle(0); rg.beginFill(0x000000, .3); rg.drawRect(chx - 12, chy - 10, 30, 30); rg.endFill(); rg.beginFill(0x6f6a68); rg.drawRect(chx - 15, chy - 15, 30, 30); rg.endFill(); rg.beginFill(0x8c8684); rg.drawRect(chx - 15, chy - 15, 30, 8); rg.endFill(); rg.beginFill(0x2a2424); rg.drawRect(chx - 9, chy - 9, 18, 18); rg.endFill();
    rg.lineStyle(1.5, 0x3a3434, .8); rg.moveTo(chx - 15, chy - 1); rg.lineTo(chx + 15, chy - 1); rg.moveTo(chx, chy - 15); rg.lineTo(chx, chy - 1);
    roof.addChild(rg); roof.zIndex = 1e6; roof.alpha = 1;
    const cab = { id, x, y, w, h, roof, a: 1, chx, chy, beams, wins }; drawBeams(cab); CABINS.push(cab); cullList.push({ c: roof, x, y, m: Math.max(w, h) / 2 + 40 });
  }
}
function xInit(m) {
  window.mapInit && mapInit(m); xVillages(m); xLava(m); xCabins(m);
  LOOT = (m.loot || []).map(l => ({ id: l[0], x: l[1], y: l[2], b: l[3], seed: l[4], tier: l[5], cx: l[6], cy: l[7], trader: l[8], tx: l[9], ty: l[10], cab: l[11] || 0, kind: l[12] || 'chest' }));
  for (const l of LOOT) {
    if (l.cab) {   // furniture inside a cabin: no decoration ring, just the piece itself
      const c = new PIXI.Container(), tx = l.kind === 'chest' ? T_LCHEST[l.tier] : T_CAB[l.kind], sp = new PIXI.Sprite(tx[0]); sp.anchor.set(.5, .85); c.addChild(sp); c.position.set(l.cx, l.cy); c.zIndex = l.cy; cullList.push({ c, x: l.cx, y: l.cy });
      lootE[l.id] = { sp, c, tier: l.tier, kind: l.kind, tx, open: 0 }; continue;
    }
    const rng = mulberry(l.seed), list = DECOR[l.b] || DECOR.f, n = 6 + Math.floor(rng() * 4);
    const pad = new PIXI.Graphics(); pad.beginFill(l.b === 's' ? 0xcfe0ee : l.b === 'd' ? 0xb98d44 : l.b === 'l' ? 0x4a2a2e : 0x2e5a2a, .18); pad.drawEllipse(l.x, l.y + 6, 92, 62); pad.endFill(); ground.addChild(pad);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * 70, sp = new PIXI.Sprite(list[Math.floor(rng() * list.length)]);
      sp.anchor.set(.5, .88); sp.position.set(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * .75); sp.scale.set(.85 + rng() * .5); sp.zIndex = sp.y; cullList.push({ c: sp, x: sp.x, y: sp.y });
    }
    if (l.tier) { const c = new PIXI.Container(), sp = new PIXI.Sprite(T_LCHEST[l.tier][0]); sp.anchor.set(.5, .85); c.addChild(sp); c.position.set(l.cx, l.cy); c.zIndex = l.cy; cullList.push({ c, x: l.cx, y: l.cy }); lootE[l.id] = { sp, c, tier: l.tier, open: 0 }; }
    if (l.trader) {
      const c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(.8, .5); sh.y = 8;
      const body = new PIXI.Sprite(T_TRADER[l.trader]); body.anchor.set(.5); body.scale.set(.95); body.rotation = Math.atan2(l.y - l.ty, l.x - l.tx) + 0;
      const tag = new PIXI.Text(RC.TRADERS[l.trader].e + ' ' + RC.TRADERS[l.trader].n, { fontFamily: 'system-ui,sans-serif', fontSize: 13, fontWeight: '800', fill: 0xffe082, stroke: 0x000000, strokeThickness: 4 }); tag.anchor.set(.5, 1); tag.y = -34; tag.resolution = 2;
      c.addChild(sh, body, tag); c.position.set(l.tx, l.ty); c.zIndex = l.ty; cullList.push({ c, x: l.tx, y: l.ty }); trE[l.id] = c; SPR.npc(c, body, body.rotation, tag);
    }
  }
}
// ---------- weapon switch: one small button above ATTACK shows what ATTACK uses and cycles through the weapons you own (melee, pistol, rifle) ----------
const WPN = [['melee', () => (GEAR && GEAR.sword ? '🗡️' : '⚔️'), 'Melee'], ['pistol', () => '🔫', 'Pistol'], ['rifle', () => '🎯', 'Rifle']];
let wpnCur = 0, wpnBtn = null, wpnInfo = { mag: 0, res: 0, rl: 0 };
const wpnOwned = () => WPN.map((w, i) => i === 0 || (GEAR && GEAR[w[0]]) ? i : -1).filter(i => i >= 0);
function wpnCycle() {
  const own = wpnOwned(); if (own.length < 2) return; const nx = own[(own.indexOf(wpnCur) + 1) % own.length];
  wpnCur = nx; if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'wpn', w: WPN[nx][0] })); wpnShow(); SFX.pickup && SFX.pickup();
}
function wpnShow() {
  if (!wpnBtn) {
    wpnBtn = document.createElement('button'); wpnBtn.id = 'wpnBtn'; wpnBtn.setAttribute('aria-label', 'Switch weapon');
    wpnBtn.style.cssText = 'position:fixed;z-index:6;width:38px;height:38px;border-radius:50%;border:2px solid #ffd000;background:#0b1a2adf;font-size:20px;line-height:1;padding:0;touch-action:manipulation;display:none;right:calc(max(16px,env(safe-area-inset-right)) + clamp(52px,15vmin,76px) + 8px + (clamp(44px,12vmin,60px) - 38px) / 2);bottom:calc(max(24px,env(safe-area-inset-bottom)) + clamp(44px,12vmin,60px) + 18px)';
    wpnBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); wpnCycle(); }); $('btns').appendChild(wpnBtn);
    addEventListener('keydown', e => { const k = e.key.toLowerCase(); if ((k === 'x' || k === 'v') && !e.repeat && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '') && $('btns').style.display !== 'none') { if (k === 'x') wpnCycle(); else if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'reload' })); } });   // X switches weapon, V reloads
  }
  const own = wpnOwned(); if (!own.includes(wpnCur)) wpnCur = 0;
  wpnBtn.style.display = own.length > 1 && $('btns').style.display !== 'none' ? 'block' : 'none'; wpnBtn.title = WPN[wpnCur][2] + ' - tap (or X) to switch, V to reload';
  const gun = wpnCur > 0, w = wpnInfo, cap = wpnCur === 2 ? 1 : 6;   // a gun shows rounds loaded / rounds in reserve (a ring fills while it reloads; red when empty)
  wpnBtn.innerHTML = WPN[wpnCur][1]() + (gun ? '<span style="position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);font-size:10px;font-weight:800;color:' + (w.mag + w.res <= 0 ? '#ff6b6b' : '#fff') + ';text-shadow:0 1px 2px #000,0 0 3px #000;white-space:nowrap">' + (w.rl > 0 ? '⟳' : w.mag + '/' + w.res) + '</span>' : '');
  wpnBtn.style.background = gun && w.rl > 0 ? 'conic-gradient(#ffd000 ' + w.rl + '%, #0b1a2adf 0)' : '#0b1a2adf';
}
function xWeapon(m) {   // follow what the server says is selected (it also auto-selects a gun the moment you buy it)
  const mp = m.p.find(p => p[0] === myId); if (mp && mp[33] !== undefined) { wpnCur = mp[33]; wpnInfo = { mag: mp[34] || 0, res: mp[35] || 0, rl: mp[36] || 0 }; } wpnShow();
}
let VENDOR = null;   // the traveling vendor (drawn here; his stall entry lives in LOOT so ACT / the trade menu work as usual)
function xVendor(m) {
  const d = m.vd;
  if (!d) { if (VENDOR) { VENDOR.c.destroy({ children: true }); const k = LOOT.findIndex(l => l.vend); if (k >= 0) LOOT.splice(k, 1); VENDOR = null; } return; }
  const [id, type, x, y, st, fa, lid] = d;
  if (!VENDOR || VENDOR.id !== id) {
    if (VENDOR) { VENDOR.c.destroy({ children: true }); const k = LOOT.findIndex(l => l.vend); if (k >= 0) LOOT.splice(k, 1); }
    const c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(.8, .5); sh.y = 8;
    const body = new PIXI.Sprite(T_TRADER[type]); body.anchor.set(.5); body.scale.set(.95);
    const tag = new PIXI.Text(RC.TRADERS[type].e + ' ' + RC.TRADERS[type].n, { fontFamily: 'system-ui,sans-serif', fontSize: 13, fontWeight: '800', fill: 0xffe082, stroke: 0x000000, strokeThickness: 4 }); tag.anchor.set(.5, 1); tag.y = -34; tag.resolution = 2;
    const ex = new PIXI.Text('!', { fontFamily: 'system-ui,sans-serif', fontSize: 22, fontWeight: '900', fill: 0xffd000, stroke: 0x000000, strokeThickness: 4 }); ex.anchor.set(.5, 1); ex.y = -52; ex.visible = false;
    c.addChild(sh, body, tag, ex); c.position.set(x, y); ents.addChild(c);
    VENDOR = { id, type, c, body, ex, x, y, tx: x, ty: y, npc: SPR.npc(c, body, 0, tag) };
    LOOT.push({ id: lid, vend: 1, trader: 0, tx: x, ty: y, x, y, tier: 0, cx: 0, cy: 0, b: 'f', seed: 0, cab: 0, kind: '' });
  }
  VENDOR.tx = x; VENDOR.ty = y; VENDOR.body.rotation = fa / 100; VENDOR.st = st;
  const l = LOOT.find(q => q.vend); if (l) { l.tx = x; l.ty = y; l.x = x; l.y = y; l.id = lid; l.trader = (st === 2 || st === 6) ? type : 0; }
}
function xSnap(m) {
  xVendor(m); xWeapon(m);
  const op = new Set(m.lo || []);
  for (const id of m.tg || []) {   // a trader's twin was found elsewhere: this one has left (no longer on the map or in the world)
    const c = trE[id]; if (!c) continue; delete trE[id];
    const l = LOOT.find(q => q.id === id); if (l) l.trader = 0;
    const k = cullList.findIndex(o => o.c === c); if (k >= 0) cullList.splice(k, 1); if (!c.destroyed) { try { burst(c.x, c.y, 10, 0xffe082, 90, false, .2); } catch (e) { } c.destroy({ children: true }); }
  }
  const firstLoot = !window._lootSeen; window._lootSeen = 1;
  for (const id in lootE) { const e = lootE[id]; if (!e.open && op.has(+id)) { e.open = 1; e.openAt = firstLoot ? -1e9 : Date.now(); e.sp.texture = (e.tx || T_LCHEST[e.tier])[1]; }
    if (e.open && !e.gone) {   // an opened chest stays a few seconds, fades, then is gone (the ones opened before you joined are already gone)
      const age = (Date.now() - e.openAt) / 1000;
      if (age > 6.5) { e.gone = 1; const k = cullList.findIndex(o => o.c === e.c); if (k >= 0) cullList.splice(k, 1); e.c.destroy({ children: true }); }
      else e.c.alpha = age < 5 ? 1 : 1 - (age - 5) / 1.5;
    } }
  // campfires
  const seen = {};
  for (const c of m.cf || []) {
    seen[c[0]] = 1; let e = campE[c[0]];
    if (!e) {
      const flames = [0, 1, 2].map(() => { const s = new PIXI.Sprite(T_FLAME); s.anchor.set(.5, .9); s.blendMode = BM.ADD; overL.addChild(s); return s; });
      const glow = new PIXI.Sprite(T_GLOW); glow.anchor.set(.5); glow.blendMode = BM.ADD; glow.tint = 0xff8a30; overL.addChild(glow);
      const ring = new PIXI.Sprite(T_RING); ring.anchor.set(.5); ring.blendMode = BM.ADD; ring.tint = 0xffc266; overL.addChildAt(ring, 0);
      const stones = []; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, s = new PIXI.Sprite(T_ROCK); s.anchor.set(.5, .8); s.scale.set(.26); s.position.set(c[1] + Math.cos(a) * 30, c[2] + Math.sin(a) * 30 + 4); s.zIndex = s.y; s.tint = 0xbbbbbb; ents.addChild(s); stones.push(s); } SPR.pit(c[1], c[2], stones);
      e = campE[c[0]] = { flames, glow, ring, stones, ringR: 0, ph: rnd(0, TAU) };
    }
    if (e.d) {   // sounds for campfires, like the main fire has (only for ones you are near)
      if (c[5] > e.d[5]) fireSound(c[1], c[2], 'levelup'); else if (c[3] > e.d[3] + 5) fireSound(c[1], c[2], 'feed'); if (e.d[3] > 0 && c[3] <= 0) fireSound(c[1], c[2], 'fireOut');
    }
    e.d = c;
  }
  for (const id in campE) if (!seen[id]) { const e = campE[id]; e.flames.forEach(s => s.destroy()); e.glow.destroy(); e.ring.destroy(); e.stones.forEach(s => s.destroy()); delete campE[id]; }
  // bullets / zones / turrets
  const mk = (map, list, make) => { const sn = {}; for (const o of list || []) { sn[o[0]] = 1; if (!map[o[0]]) map[o[0]] = make(o); map[o[0]].d = o; map[o[0]].t0 = performance.now(); } for (const id in map) if (!sn[id]) { map[id].s.destroy(); delete map[id]; } };
  mk(bulletE, m.bl, () => { const s = new PIXI.Sprite(T_BULLET); s.anchor.set(1, .5); s.blendMode = BM.ADD; ents.addChild(s); return { s }; });
  mk(zoneE, m.zn, o => { const s = new PIXI.Sprite(T_RING); s.anchor.set(.5); s.blendMode = BM.ADD; s.tint = o[4] === 1 ? 0x7dffb0 : 0xfff08a; overL.addChildAt(s, 0); return { s }; });
  mk(turretE, m.tr, () => { const s = new PIXI.Sprite(T_TURRET); s.anchor.set(.5, .85); ents.addChild(s); return { s }; });
}
function xStep(dt, me) {
  const now = performance.now(), cr = Math.max(W, H) / Z / 2 + 160;
  if (VENDOR) { const k = Math.min(1, dt * 9); VENDOR.x += (VENDOR.tx - VENDOR.x) * k; VENDOR.y += (VENDOR.ty - VENDOR.y) * k; VENDOR.c.position.set(VENDOR.x, VENDOR.y); VENDOR.c.zIndex = VENDOR.y + 2; VENDOR.ex.visible = VENDOR.st === 2 || VENDOR.st === 6; VENDOR.ex.y = -52 + Math.sin(T * 5) * 3; VENDOR.body.y = Math.sin(T * 9) * (VENDOR.st === 1 || VENDOR.st === 3 || VENDOR.st === 5 ? 1.5 : .3); VENDOR.npc.ang = VENDOR.body.rotation; VENDOR.npc.sp = VENDOR.st === 1 || VENDOR.st === 3 || VENDOR.st === 5 ? 60 : 0; }
  for (const f of CAB_FIRES) f.g.alpha = .75 + Math.sin(T * 7 + f.ph) * .12 + Math.sin(T * 13 + f.ph * 2) * .08;
  const dayK = S && S.c !== undefined ? 1 - darkness(S.c) / .74 : 1;   // window light only while the sun is up
  for (const c of CABINS) { const inside = me && Math.abs(me.x - c.x) < c.w / 2 + 4 && Math.abs(me.y - c.y) < c.h / 2 + 4; c.a += ((inside ? .08 : 1) - c.a) * Math.min(1, dt * 6); c.roof.alpha = c.a;
    if (Math.abs(c.x - camX) < cr + c.w / 2 && Math.abs(c.y - camY) < cr + c.h / 2) {   // window sunbeams: they lean toward you while you are inside, and fade with the daylight
      c.beams.visible = dayK > .02; c.beams.alpha = dayK;
      if (c.beams.visible) { let ch = false; for (const o of c.wins) { let tg = 0; if (inside) { const lat = (me.x - o.cx) * o.tx + (me.y - o.cy) * o.ty, dep = (me.x - o.cx) * o.ix + (me.y - o.cy) * o.iy; tg = clamp(lat * o.D / Math.max(dep, 50), -110, 110); } const n = o.sh + (tg - o.sh) * Math.min(1, dt * 5); if (Math.abs(n - o.sh) > .2) { o.sh = n; ch = true; } } if (ch) drawBeams(c); }
    } if (c.a > .6 && Math.abs(c.chx - camX) < cr && Math.abs(c.chy - camY) < cr && Math.random() < dt * 2.4) emit(pfx, T_GLOW, c.chx + rnd(-4, 4), c.chy - 8, rnd(2, 12), rnd(-36, -22), 2.6, .08, .5, 0xd2d2d2, .3, false, 0); }   // the roof goes see-through while you are inside; the chimney smokes while it is on
  for (const o of cullList) { const cm = cr + (o.m || 0), nr = Math.abs(o.x - camX) < cm && Math.abs(o.y - camY) < cm; if (nr) { if (!o.c.parent) ents.addChild(o.c); } else if (o.c.parent && (Math.abs(o.x - camX) > cm * 1.3 || Math.abs(o.y - camY) > cm * 1.3)) ents.removeChild(o.c); }   // decorations, chests, traders: in the scene only near the camera
  for (const id in bulletE) { const e = bulletE[id], el = Math.min(.1, (now - e.t0) / 1000), a = e.d[3] / 100, v = BSPEED[e.d[4]] || 800; e.s.position.set(e.d[1] + Math.cos(a) * v * el, e.d[2] + Math.sin(a) * v * el); e.s.rotation = a; e.s.zIndex = e.s.y + 40; }
  for (const id in zoneE) { const e = zoneE[id]; e.s.position.set(e.d[1], e.d[2]); e.s.scale.set(e.d[3] * 2 / 256 * (1 + Math.sin(T * 3) * .02)); e.s.alpha = .35 + Math.sin(T * 5) * .08; }
  for (const id in turretE) { const e = turretE[id]; e.s.position.set(e.d[1], e.d[2]); e.s.zIndex = e.d[2]; }
  for (const L of LAVAP) { const near = Math.abs(L.x - camX) < W / Z / 2 + L.r + 200 && Math.abs(L.y - camY) < H / Z / 2 + L.r + 200; L.g.visible = L.gl.visible = near; if (!near) continue; L.gl.alpha = .45 + Math.sin(T * 2 + L.ph) * .12; L.g.scale.set(1 + Math.sin(T * 1.3 + L.ph) * .015); if (Math.random() < dt * 2.5) { const a = rnd(0, TAU), d = rnd(0, L.r * .8); emit(overL, T_GLOW, L.x + Math.cos(a) * d, L.y + Math.sin(a) * d * .8, rnd(-8, 8), rnd(-40, -20), rnd(.6, 1.1), .08, .02, 0xffb040, .9, true, -10); } }   // bubbling and sparks
  for (const v of VILL) { const fl = 1 + Math.sin(T * 14 + v.id) * .07 + Math.sin(T * 23) * .04; v.flames.forEach((f, i) => f.scale.set((.42 - i * .1) * fl, (.42 - i * .1) * fl * (1 + Math.sin(T * (10 + i * 4)) * .08))); }
  let tipCamp = null;
  for (const id in campE) {
    const e = campE[id], c = e.d, x = c[1], y = c[2], fuelK = clamp(c[3] / c[4], 0, 1), alive = c[3] > 0, fl = 1 + Math.sin(T * 17 + e.ph) * .06 + Math.sin(T * 29) * .04;
    e.flames.forEach((s, i) => { s.visible = alive; const w = (.5 + .5 * fuelK) * (1 - i * .22) * fl; s.scale.set(w * (1 + Math.sin(T * (9 + i * 3) + i) * .08), w * (1 + Math.sin(T * (13 + i * 4) + i * 2) * .14)); s.rotation = Math.sin(T * (6 + i * 2) + i) * .08; s.position.set(x + (i - 1) * 7, y + 2 - i * 3); });
    e.glow.visible = alive; e.glow.position.set(x, y - 6); e.glow.scale.set((1.6 + fuelK * 1.4) * fl); e.glow.alpha = .55;
    if (alive) e.ringR += (c[6] - (e.ringR || c[6])) * Math.min(1, dt * 2.5), e.ringR = e.ringR || c[6];
    e.ring.visible = alive; e.ring.position.set(x, y); e.ring.scale.set(e.ringR * 2 / 256); e.ring.alpha = .35 + Math.sin(T * 2) * .08;
    if (alive && Math.random() < dt * (10 + 30 * fuelK)) emit(overL, T_GLOW, x + rnd(-8, 8), y - 2, rnd(-14, 14), rnd(-70, -35), rnd(.6, 1.3), .08, .01, Math.random() < .5 ? 0xffb347 : 0xffe08a, 1, true, -10);
    if (me && Math.hypot(me.x - x, me.y - y) < 80 && !me.d[10]) tipCamp = c;
  }
  if (typeof fireTip !== 'undefined') {
    if (tipCamp) {
      const feed = (GC.BY[me.d[2]] || GC.BY.forester).feed || 1, need = tipCamp[4] - tipCamp[3], lines = [];
      if (need > 15 * feed * .5) lines.push('🪵 ×' + Math.ceil(need / (15 * feed)) + ' to refuel');
      lines.push(tipCamp[5] < RC.FIRE_MAX ? '⬆ Level ' + (tipCamp[5] + 1) + ': 🪨 ×' + 10 * tipCamp[5] : 'Fire is max level');
      const t = lines.join('\n'); if (fireTip.text !== t) fireTip.text = t; fireTip.position.set(tipCamp[1], tipCamp[2] - 78); fireTip.visible = true;
    } else fireTip.position.set(0, -78);
  }
  if (trOpen && me) { const l = LOOT.find(q => q.id === trOpen.id); if (!l || Math.hypot(me.x - l.tx, me.y - l.ty) > 190) closeTrader(); }
}
function xLights(li, sx, sy2) {   // campfire light holes in the night
  for (const id in campE) { const c = campE[id].d; if (c[3] <= 0) continue; const L = getLight(li++); L.visible = true; L.position.set((W / 2 + (c[1] - camX) * Z + sx) * LS, (H / 2 + (c[2] - camY) * Z + sy2) * LS); L.scale.set(c[6] * 1.25 * Z * 2 * LS / 128); L.alpha = 1; }
  return li;
}
// nearest campfire within reach (the ACT label)
function xCampNear(me) { for (const id in campE) { const c = campE[id].d; if (Math.hypot(me.x - c[1], me.y - c[2]) < 80) return c; } return null; }

// ---------- trader menu ----------
let trOpen = null;
(function () {
  const d = document.createElement('div'); d.className = 'ov'; d.id = 'trader'; d.style.cssText = 'pointer-events:none;background:transparent;justify-content:flex-end;z-index:16';
  d.innerHTML = '<div class="sheet"><div class="ch"><span id="trTitle"></span><span id="trInv" style="font-weight:700;font-size:13px"></span><button class="mini gray" id="trClose">Close</button></div><div id="trMsg" style="min-height:18px;padding:0 14px 4px;font-size:13px"></div><div id="trList" style="overflow-y:auto;padding:4px 12px 16px"></div></div>';
  document.body.appendChild(d); d.querySelector('#trClose').onclick = () => closeTrader();
})();
function closeTrader() { trOpen = null; $('trader').style.display = 'none'; }
function xOpenTrader(m) {
  if (m.ty === 5) { const mp = S && S.p.find(p => p[0] === myId), me = ents2['p' + myId]; if (mp && mp[25] > 0) { if (me) floatText(me.x, me.y - 20, 'He has nothing more to offer you.', 0xd1b3ff); return; } }   // the ability unlocker sells one ability per game: once it is bought he offers nothing else
  setCraft(false); closeChest(); closePot(); trOpen = { id: m.id, ty: m.ty }; $('trader').style.display = 'flex'; $('trMsg').textContent = ''; buildTrader(); SFX.chest(); }
const costStr = (cost, mp) => Object.entries(cost).map(([k, n]) => '<span class="' + ((mp[COSTX[k]] || 0) >= n ? '' : 'no') + '">' + COSTI[k] + ' ' + (mp[COSTX[k]] || 0) + '/' + n + '</span>').join(' &nbsp; ');
function buildTrader() {
  if (!trOpen) return; const T = RC.TRADERS[trOpen.ty], mp = S.p.find(p => p[0] === myId) || [], list = $('trList'); list.innerHTML = '';
  $('trTitle').textContent = T.e + ' ' + T.n; $('trInv').textContent = Object.keys(COSTI).filter(k => (mp[COSTX[k]] || 0) > 0).map(k => COSTI[k] + (mp[COSTX[k]] || 0)).join(' ');
  const rows = [];
  if (trOpen.ty === 5) { const c = GC.BY[mp[2]], ab = c && GC.ABIL[c.id]; if (ab) rows.push({ id: 'abil:' + c.id, e: ab.e, n: ab.n + ' (' + c.n + ')', d: ab.d + ' Cooldown ' + ab.cd + 's. Unlocks it for this game only.', cost: GC.abilCost(c), done: mp[25] > 0, doneT: 'Unlocked this game' }); }   // only the ability of the character you are playing, for this game only
  else for (const o of T.offers) rows.push({ id: o.id, e: o.e, n: o.n, d: o.d, cost: o.cost, done: o.armor ? (GEAR.armor || 0) >= o.armor : o.gear ? !!GEAR[o.gear] : false, doneT: o.armor ? 'Owned' : 'Owned' });
  for (const r of rows) {
    const ok = Object.entries(r.cost).every(([k, n]) => (mp[COSTX[k]] || 0) >= n), el = document.createElement('div'); el.className = 'rc' + (r.done ? ' dim' : ok ? ' pick' : ' pick dim');
    el.innerHTML = '<div class="ic">' + r.e + '</div><div class="tx"><div class="nm">' + r.n + (r.done ? ' <span style="color:#7fe9a0;font-size:12px">✔ ' + r.doneT + '</span>' : '') + '</div><div class="ds">' + r.d + '</div><div class="co">' + costStr(r.cost, mp) + '</div></div>';
    el.onclick = () => { if (r.done) return; if (!ok) { $('trMsg').textContent = 'You can\'t afford that yet.'; $('trMsg').style.color = '#ff8a80'; return; } if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'trade', id: trOpen.id, offer: r.id })); };
    list.appendChild(el);
  }
}

// ---------- ability button + dynamic slots ----------
let abilEl = null, slotCap = 3, slotSig2 = '', abilSig = '';
function xButtons() {
  const wrap = $('btns'); if (!wrap || abilEl) return;
  abilEl = document.createElement('div'); abilEl.className = 'btn'; abilEl.id = 'abil';
  abilEl.style.cssText = 'right:calc(max(16px,env(safe-area-inset-right)) + clamp(52px,15vmin,76px) + clamp(44px,12vmin,60px) + 18px);bottom:max(24px,env(safe-area-inset-bottom));width:clamp(42px,11.5vmin,56px);height:clamp(42px,11.5vmin,56px);background:radial-gradient(circle at 35% 30%,#8e6bd8,#4a2d94);font-size:22px;overflow:hidden';
  abilEl.innerHTML = '<span class="ai"></span><span class="ac" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#000a;font-size:15px;font-weight:800"></span><span class="al" style="position:absolute;right:3px;bottom:1px;font-size:13px">🔒</span>';
  wrap.appendChild(abilEl);
  abilEl.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); useAbility(); });
}
function useAbility() { if (ws && ws.readyState === 1 && myId) ws.send(JSON.stringify({ t: 'abil' })); }
function xHud(mp) {
  xButtons(); if (!mp) return;
  // slots: as many as you can carry right now (a bigger boat adds some)
  const cap = mp[24] || 3, items = mp[19] || [], box = $('slots'), sig = cap + ':' + items.join(',');
  if (sig !== slotSig2) {
    slotSig2 = sig; while (box.children.length < cap) { const el = document.createElement('div'), i = box.children.length; el.className = 'slot'; el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); const it = ((S && S.p.find(q => q[0] === myId)) || [])[19] || []; if (RC.BOATS[it[i]]) { startPlacingBoat(i); return; } if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'use', i })); }); box.appendChild(el); }
    while (box.children.length > cap) box.lastChild.remove();
    [...box.children].forEach((el, i) => { const f = RC.ITEM_BY[items[i]]; el.textContent = f ? f.e : ''; el.classList.toggle('full', !!f); el.title = f ? f.n + ' - tap to use' : 'empty'; });
  }
  // ability button: locked / ready / cooling down
  const ab = GC.ABIL[mp[2]], st = mp[25] || 0, key = mp[2] + ':' + st; if (!ab || key === abilSig) return; abilSig = key;
  abilEl.title = ab.n + ' - ' + ab.d; abilEl.querySelector('.ai').textContent = ab.e; abilEl.querySelector('.al').style.display = st === 0 ? '' : 'none';
  abilEl.style.filter = st === 0 ? 'grayscale(1) brightness(.7)' : ''; const ac = abilEl.querySelector('.ac'); ac.style.display = st > 1 ? 'flex' : 'none'; ac.textContent = st > 1 ? st - 1 : '';
  abilEl.style.boxShadow = st === 1 ? '0 0 14px #b388ffcc, 0 4px 14px #0008' : '0 4px 14px #0008';
}
// class select: the (locked/unlocked) hidden ability of each class
function xCard(c, el) {
  const ab = GC.ABIL[c.id]; if (!ab) return; const has = false;   // abilities start locked every game (unlock yours with the Ability Unlocker trader)
  el.insertAdjacentHTML('beforeend', '<div class="ab" style="margin-top:4px;font-size:11px;line-height:1.25;text-align:left;color:' + (has ? '#b9f6ca' : '#cfd8dc') + '"><b>' + (has ? '✔' : '🔒') + ' ' + ab.e + ' ' + ab.n + '</b> · ' + ab.cd + 's<br>' + ab.d + '</div>');
}

// ---------- messages from the server ----------
function xMsg(m) {
  const me = ents2['p' + myId];
  if (m.t === 'loot') { SFX.levelup(); if (me) floatText(me.x, me.y - 24, m.msg, 0xffe082); notice(m.msg); }
  else if (m.t === 'vendHome') { window.mapReveal && mapReveal(m.x, m.y); notice('🧳 You followed the ' + RC.TRADERS[m.ty].n + ' home - he is now marked on your map!'); SFX.levelup(); }
  else if (m.t === 'camped') { notice('Campfire lit! Feed it wood to keep it burning.'); SFX.levelup(); }
  else if (m.t === 'fish') { if (me) floatText(me.x, me.y - 14, m.n ? '+' + m.n + ' 🍓 fish!' : 'Nothing bit...', m.n ? 0x9be7ff : 0xcfd8dc); if (m.n) SFX.pickup(); }
  else if (m.t === 'fx') {
    if (m.k === 'boom') { const n = Math.min(40, 8 + Math.round(m.r / 12)); for (let i = 0; i < n; i++) { const a = rnd(0, TAU), d = Math.sqrt(Math.random()) * m.r; burst(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, 3, 0xffa24a, 110, true, .16); } shake = Math.max(shake, .25); }
    else if (m.k === 'heal' && me) floatText(me.x, me.y - 20, '✨ Revived!', 0xb9f6ca);
    else if (m.k === 'block') { burst(m.x, m.y, 8, 0xffe9a0, 170, true, .1); burst(m.x, m.y, 4, 0xffffff, 110, true, .08); if (me) SFX.clang(Math.hypot(m.x - me.x, m.y - me.y), m.x - me.x); }   // a shot blocked by a zealot's shield
  }
  else if (m.t === 'abilUsed') { if (m.b) { for (const k in BUFF) BUFF[k] = m.b[k] || 0; buffAt = performance.now(); } SFX.levelup(); if (me) floatText(me.x, me.y - 26, m.n + '!', 0xd1b3ff); }
  else if (m.t === 'saved') {
    const pi = $('pmInfo'); if (!pi) return;
    if (m.ok) { PF.save = { at: m.at, n: m.night, bytes: m.bytes, gz: m.gz }; pi.textContent = '✔ Saved: night ' + m.night + ', ' + m.players + ' player' + (m.players === 1 ? '' : 's') + '. Size ' + fmtBytes(m.bytes) + ' (' + fmtBytes(m.gz) + ' stored compressed).'; pi.style.color = '#b9f6ca'; }
    else { pi.textContent = 'Could not save right now.'; pi.style.color = '#ff8a80'; }
  }
  else if (m.t === 'traded') {
    GEAR = m.gear || GEAR; if (m.prof) PF.abil = m.prof.abil || PF.abil;
    const tm = $('trMsg'); if (tm) { tm.textContent = m.msg || ''; tm.style.color = m.ok ? '#7fe9a0' : '#ff8a80'; } if (m.ok) { SFX.cook(); const me2 = ents2['p' + myId]; if (me2) floatText(me2.x, me2.y - 20, m.msg, 0xffe082); }
    if (m.ok && trOpen && trOpen.ty === 5) closeTrader(); else buildTrader();   // buying the ability closes the unlocker's menu
    try { buildPicker(); } catch (e) { }
  }
}

// the ACT button names what it would do here (loot chest, trader, campfire, fishing)
function xActLabel(me) {
  for (const l of LOOT) { if (l.tier && !(lootE[l.id] || {}).open && Math.hypot(me.x - l.cx, me.y - l.cy) < 80) return 'OPEN'; if (l.trader && Math.hypot(me.x - l.tx, me.y - l.ty) < 100) return 'TRADE'; }
  const c = xCampNear(me); if (c) return c[4] - c[3] > 8 ? 'REFUEL' : c[5] < RC.FIRE_MAX ? 'UPGRADE' : 'ACT';
  const mp = S.p.find(q => q[0] === myId); if (GEAR.rod && mp && !mp[20]) { const fa = (mp[16] || 0) / 100; if (isWaterC(me.x + Math.cos(fa) * 80, me.y + Math.sin(fa) * 80)) return 'FISH'; }
  return null;
}

// ---------- Escape menu: resume / save the game to your account / exit ----------
(function () {
  const d = document.createElement('div'); d.className = 'ov'; d.id = 'pauseMenu'; d.style.cssText = 'display:none;align-items:center;justify-content:center;z-index:60;background:#06101ccc';
  d.innerHTML = '<div style="background:#14304a;border:2px solid #ffd000;border-radius:14px;padding:18px 22px;width:min(360px,90vw);max-height:92vh;overflow:auto;text-align:center;box-shadow:0 8px 30px #000a"><div style="font-size:20px;font-weight:800;margin-bottom:12px">Menu</div>' +
    '<button class="mini" id="pmResume" style="display:block;width:100%;margin:6px 0;padding:11px">Resume</button>' +
    '<button class="mini" id="pmSave" style="display:block;width:100%;margin:6px 0;padding:11px;background:#1565c0">💾 Save game</button>' +
    '<div id="pmInfo" style="font-size:12px;opacity:.85;min-height:34px;margin:4px 0 6px;line-height:1.35">Saves this whole game (every player, everything built and collected) to your account. One save per account; a new save replaces the old one.</div>' +
    '<button class="mini gray" id="pmKeys" style="display:block;width:100%;margin:6px 0;padding:11px">🎮 Controls</button>' +
    '<div id="pmCtl" style="display:none;text-align:left;font-size:12.5px;line-height:1.55;margin:6px 0 4px;background:#0b1a2a;border-radius:10px;padding:10px 12px">' +
    '<b>Keyboard + mouse</b><br>W A S D / arrows - move &nbsp;·&nbsp; Shift - run<br>Mouse - aim (your character faces the crosshair)<br>Click / Q / F / J - attack &nbsp;·&nbsp; Space / E - ACT (chop, mine, pick, open, refuel)<br>R - rotate what you are placing, or use your ability &nbsp;·&nbsp; X - switch weapon &nbsp;·&nbsp; V - reload<br>1-7 - use the item in that slot &nbsp;·&nbsp; M - map &nbsp;·&nbsp; Esc - this menu<br>' +
    '<b style="display:block;margin-top:6px">Touch</b>Left side of the screen: drag to move, push past the ring to run<br>ACT button: chop, mine, pick, open, refuel<br>ATTACK button: hold to keep attacking, drag it to aim<br>Weapon button (above ATTACK): tap to switch between melee and the guns you own<br>Slot buttons (right edge): tap to use an item &nbsp;·&nbsp; + / − zoom &nbsp;·&nbsp; 🗺️ map &nbsp;·&nbsp; ☰ this menu</div>' +
    '<button class="mini gray" id="pmExit" style="display:block;width:100%;margin:6px 0;padding:11px">Exit to main menu</button></div>';
  document.body.appendChild(d);
  d.querySelector('#pmResume').onclick = () => xPause(false);
  d.querySelector('#pmKeys').onclick = () => { const c = d.querySelector('#pmCtl'); c.style.display = c.style.display === 'none' ? 'block' : 'none'; };
  const mb = document.createElement('button'); mb.id = 'menuBtn'; mb.className = 'zb'; mb.textContent = '☰'; mb.setAttribute('aria-label', 'Menu'); mb.style.cssText = 'bottom:max(196px,calc(env(safe-area-inset-bottom) + 186px));font-size:18px'; $('btns').appendChild(mb);   // phones have no Escape key
  mb.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); xPause(); });
  d.querySelector('#pmSave').onclick = () => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ t: 'save' })); $('pmInfo').textContent = 'Saving...'; } };
  d.querySelector('#pmExit').onclick = () => { try { sessionStorage.removeItem('rejoin'); } catch (e) { } runOver = true; try { ws.send(JSON.stringify({ t: 'quit' })); ws.close(); } catch (e) { } location.reload(); };
})();
const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
function xPause(on) { const m = $('pauseMenu'), show = on === undefined ? m.style.display === 'none' : on; m.style.display = show ? 'flex' : 'none'; if (show && PF.save) $('pmInfo').textContent = 'Last save: night ' + PF.save.n + ', ' + fmtBytes(PF.save.bytes) + ' (' + fmtBytes(PF.save.gz) + ' stored compressed).'; }
// lobby: continue the saved game
function xLobby() {
  const b = $('loadBtn'); if (!b) return;
  if (PF.save) { b.style.display = ''; b.textContent = 'Continue saved game - night ' + PF.save.n + ' (' + new Date(PF.save.at).toLocaleString() + ')'; b.onclick = () => { window.loadSaveFlag = true; $('go').onclick(); }; } else b.style.display = 'none';
}
