'use strict';
// Island Night client: PixiJS renderer (water shader, dynamic lighting, particles) + net + input
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BM = PIXI.BLEND_MODES;
let RR = 900;
const edgeJ = (a, r, s, ss) => r * RC.shapeK(a, ss || 0) + 16 * Math.sin(3 * a + 1.3 + s) + 9 * Math.sin(7 * a + .4 + s * 2) + 5 * Math.sin(13 * a + 2.1 + s * 3);   // ss: the island's shape seed (0 = a round old island); s only phases the little ripples
const inIsl = (q, x, y, m) => Math.hypot(x - q[0], y - q[1]) < q[2] * RC.shapeK(Math.atan2(y - q[1], x - q[0]), q[4] || 0) - m;   // am I on island q = [x, y, r, biome, shape seed] (m: margin in; negative = out into the water)
const edge = a => edgeJ(a, RR, 0);
let updWaterAt = 0, ISL = [];   // the other islands: [x, y, radius, 'f'orest | 'd'esert]
const isWaterC = (x, y) => { if (Math.hypot(x, y) < RR + 40) return false; for (const s of ISL) if (Math.hypot(x - s[0], y - s[1]) < s[2] * RC.SHAPE_MAX + 40 && inIsl(s, x, y, -40)) return false; return true; };

// ---------- procedural textures ----------
const cv2 = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; };
const tex = (w, h, fn) => PIXI.Texture.from(cv2(w, h, fn));
const circ = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
const ell = (g, x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); };
const poly = (g, c, pts) => { g.fillStyle = c; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); };
const radial = (size, stops) => tex(size, size, g => { const h = size / 2, r = g.createRadialGradient(h, h, 0, h, h, h); stops.forEach(s => r.addColorStop(s[0], s[1])); g.fillStyle = r; g.fillRect(0, 0, size, size); });

const T_GLOW = radial(128, [[0, 'rgba(255,255,255,1)'], [.35, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]);
const T_LIGHT = radial(128, [[0, 'rgba(255,255,255,1)'], [.45, 'rgba(255,255,255,.75)'], [.8, 'rgba(255,255,255,.2)'], [1, 'rgba(255,255,255,0)']]);
const T_SHADOW = radial(64, [[0, 'rgba(0,0,0,.55)'], [.6, 'rgba(0,0,0,.3)'], [1, 'rgba(0,0,0,0)']]);
const T_RING = radial(256, [[0, 'rgba(255,255,255,0)'], [.86, 'rgba(255,255,255,0)'], [.96, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]);

function noiseTile(base, cols, bladeCols) {
  return tex(256, 256, g => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, r = rnd(6, 24); g.fillStyle = cols[i % cols.length];
      for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) { g.globalAlpha = .28; circ(g, x + dx, y + dy, r); }
    }
    g.globalAlpha = .5;
    for (let i = 0; i < 1100; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, h = rnd(3, 7);
      g.strokeStyle = bladeCols[i % bladeCols.length]; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd(-2, 2), y - h); g.stroke();
    }
    g.globalAlpha = 1;
  });
}
const T_GRASS = noiseTile('#3d7a3a', ['#4a9244', '#2f6a30', '#52a04a', '#357233'], ['#6cbb5d', '#2a5e2b', '#8fd070']);
const T_SAND = noiseTile('#dccb90', ['#e8d9a2', '#cdb97c', '#d5c284'], ['#f0e4b4', '#bfa96c']);

const drawTree = g => {
  g.fillStyle = '#4b2f17'; g.fillRect(58, 82, 14, 42); g.fillStyle = '#6b4423'; g.fillRect(58, 82, 6, 42);
  const blob = (x, y, r, c) => { g.fillStyle = c; circ(g, x, y, r); };
  [[65, 70, 34], [42, 78, 26], [88, 78, 26], [50, 48, 27], [80, 48, 27], [65, 36, 24]].forEach(b => blob(b[0], b[1], b[2], '#15462a'));
  [[65, 66, 28], [45, 74, 20], [85, 74, 20], [52, 46, 21], [78, 46, 21], [65, 36, 18]].forEach(b => blob(b[0], b[1], b[2], '#1f6a37'));
  [[56, 52, 12], [44, 70, 9], [70, 36, 9], [80, 56, 8]].forEach(b => blob(b[0], b[1], b[2], '#3f9a4d'));
  g.globalAlpha = .6; blob(52, 44, 5, '#8bd47a'); blob(70, 32, 4, '#8bd47a'); g.globalAlpha = 1;
};
const T_TREE = tex(130, 140, drawTree);
const T_TREE_S = tex(130, 140, g => { drawTree(g); g.fillStyle = '#f4f8fc'; for (const [x, y, rx, ry] of [[65, 17, 17, 7], [50, 30, 12, 5], [80, 30, 12, 5], [38, 58, 9, 4], [92, 58, 9, 4], [65, 50, 10, 4]]) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); } });   // a tree dusted with snow
const T_ROCK = tex(72, 60, g => {
  g.fillStyle = '#5b6068'; g.beginPath(); g.moveTo(8, 48); g.lineTo(14, 22); g.lineTo(32, 8); g.lineTo(54, 14); g.lineTo(66, 36); g.lineTo(58, 52); g.lineTo(20, 54); g.closePath(); g.fill();
  g.fillStyle = '#8a9099'; g.beginPath(); g.moveTo(14, 22); g.lineTo(32, 8); g.lineTo(54, 14); g.lineTo(40, 30); g.lineTo(18, 36); g.closePath(); g.fill();
  g.fillStyle = '#b5bbc4'; g.beginPath(); g.moveTo(24, 20); g.lineTo(34, 12); g.lineTo(46, 16); g.lineTo(34, 24); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(40, 30); g.lineTo(58, 52); g.stroke();
});
const T_BASALT = noiseTile('#2a2226', ['#352b2f', '#201a1d', '#3b3034', '#2e2428'], ['#ff6a1a', '#5a4046', '#c0451a']);   // dark volcanic ground with a few glowing embers
const T_SNOW = noiseTile('#e8eff6', ['#f6faff', '#d6e2ee', '#ffffff', '#cbd9e6'], ['#ffffff', '#c3d3e2']);
const T_PINE = tex(120, 170, g => {   // snowy pine: stacked dark-green tiers with snow on their tops and edges
  g.fillStyle = '#4b2f17'; g.fillRect(53, 122, 14, 34); g.fillStyle = '#6b4423'; g.fillRect(53, 122, 6, 34);
  for (const [cx, by, hw, h] of [[60, 132, 54, 58], [60, 100, 44, 52], [60, 70, 34, 46], [60, 42, 22, 38]]) {
    poly(g, '#173d2b', [cx, by - h, cx + hw, by, cx - hw, by]);
    poly(g, '#225a3c', [cx, by - h, cx + hw * .15, by - 4, cx - hw, by]);
    poly(g, '#f4f8fc', [cx, by - h, cx + hw * .55, by - h * .45, cx + hw * .3, by - h * .5, cx + hw * .1, by - h * .38, cx - hw * .2, by - h * .48, cx - hw * .55, by - h * .42]);
    g.fillStyle = '#eef4fa'; ell(g, cx - hw * .45, by - 3, hw * .35, 4); ell(g, cx + hw * .4, by - 2, hw * .3, 3.5);
  }
});
const T_GOLDV = tex(72, 60, g => {   // gold ore vein: a darker rock shot through with gold
  g.fillStyle = '#55504a'; g.beginPath(); g.moveTo(8, 48); g.lineTo(14, 22); g.lineTo(32, 8); g.lineTo(54, 14); g.lineTo(66, 36); g.lineTo(58, 52); g.lineTo(20, 54); g.closePath(); g.fill();
  g.fillStyle = '#7f7870'; g.beginPath(); g.moveTo(14, 22); g.lineTo(32, 8); g.lineTo(54, 14); g.lineTo(40, 30); g.lineTo(18, 36); g.closePath(); g.fill();
  g.strokeStyle = '#d9a21f'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(16, 42); g.lineTo(30, 30); g.lineTo(46, 34); g.lineTo(58, 26); g.stroke();
  g.fillStyle = '#f2c443'; [[22, 26, 3.6], [36, 18, 3], [48, 40, 4], [28, 44, 3], [56, 30, 2.6], [40, 28, 2.4]].forEach(b => circ(g, b[0], b[1], b[2]));
  g.fillStyle = '#fff3b0'; [[21, 25], [35, 17], [47, 39]].forEach(b => circ(g, b[0], b[1], 1.3));
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(40, 30); g.lineTo(58, 52); g.stroke();
});
const T_ORE = tex(30, 26, g => {   // a gold ore nugget
  poly(g, '#c98a17', [4, 16, 8, 6, 18, 3, 26, 9, 25, 19, 15, 23, 6, 22]); poly(g, '#f2c443', [8, 7, 18, 4, 22, 10, 12, 13]);
  g.fillStyle = '#fff3b0'; circ(g, 13, 8, 2); g.strokeStyle = 'rgba(70,40,0,.6)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(4, 16); g.lineTo(8, 6); g.lineTo(18, 3); g.lineTo(26, 9); g.lineTo(25, 19); g.lineTo(15, 23); g.lineTo(6, 22); g.closePath(); g.stroke();
});
const T_PELT = tex(40, 30, g => {   // a grey wolf pelt laid flat
  const P = [6, 10, 2, 4, 10, 8, 30, 8, 38, 4, 34, 10, 36, 22, 38, 28, 30, 23, 10, 23, 2, 28, 4, 22];
  poly(g, '#80868e', P); g.fillStyle = '#a3a9b0'; ell(g, 20, 15, 11, 5); g.fillStyle = '#5c6168'; ell(g, 20, 13, 9, 2);
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(P[0], P[1]); for (let i = 2; i < P.length; i += 2) g.lineTo(P[i], P[i + 1]); g.closePath(); g.stroke();
});
const WOODY = k => k === 't' || k === 'c' || k === 'p', ROCKY = k => k === 'r' || k === 'g';
const RHP = { t: 4, c: 4, p: 8, r: 3, g: 5, b: 1 };   // hits to break (matches the server)
const T_BUSH = tex(64, 56, g => {
  [[20, 36, 16, '#1d5a2a'], [44, 36, 16, '#1d5a2a'], [32, 28, 18, '#27763a'], [26, 24, 11, '#3a9a4a']].forEach(b => { g.fillStyle = b[3]; circ(g, b[0], b[1], b[2]); });
  g.fillStyle = '#e53935'; [[22, 30], [38, 26], [32, 40], [46, 36], [16, 40], [30, 20]].forEach(b => circ(g, b[0], b[1], 3.6));
  g.fillStyle = '#ff8a80'; [[21, 29], [37, 25], [31, 39]].forEach(b => circ(g, b[0], b[1], 1.2));
});
const T_TUFT = tex(24, 20, g => { g.strokeStyle = '#2d6b2e'; g.lineWidth = 2; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(12, 19); g.quadraticCurveTo(12 + (i - 2.5) * 3, 10, 12 + (i - 2.5) * 5, 2 + (i % 2) * 3); g.stroke(); } });
const T_FLOWER = tex(16, 16, g => { g.fillStyle = '#fff'; for (let i = 0; i < 5; i++) circ(g, 8 + Math.cos(i * 1.256) * 3.5, 8 + Math.sin(i * 1.256) * 3.5, 2.6); g.fillStyle = '#ffd54f'; circ(g, 8, 8, 2.2); });
const T_PEBBLE = tex(14, 10, g => { g.fillStyle = '#9aa0a8'; ell(g, 7, 5, 6, 4); g.fillStyle = '#c5cad2'; ell(g, 5.5, 3.5, 2.5, 1.5); });
const T_FLAME = tex(64, 100, g => {
  const gr = g.createRadialGradient(32, 70, 2, 32, 62, 38); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(.35, 'rgba(255,200,60,.95)'); gr.addColorStop(.7, 'rgba(255,110,20,.6)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(32, 2); g.bezierCurveTo(50, 36, 62, 56, 48, 82); g.bezierCurveTo(42, 96, 22, 96, 16, 82); g.bezierCurveTo(2, 56, 20, 40, 32, 2); g.fill();
});

// ---- hand-held tools and back items (drawn facing +x, origin at body centre) ----
const stroke = (g, c, w, x1, y1, x2, y2) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
const FRONTS = {
  axe: g => { stroke(g, '#7b4f24', 3, 10, 18, 30, 8); poly(g, '#cfd8dc', [26, 2, 34, 6, 30, 14]); },
  gun: g => { g.fillStyle = '#37474f'; g.fillRect(10, 8, 22, 6); g.fillStyle = '#90a4ae'; g.fillRect(26, 9, 8, 4); },
  flare: g => { g.fillStyle = '#fff59d'; circ(g, 22, 12, 4); },
  dagger: g => { stroke(g, '#cfd8dc', 3, 12, 14, 30, 8); stroke(g, '#6d4c41', 4, 10, 15, 14, 13); },
  pick: g => { stroke(g, '#7b4f24', 3, 10, 18, 30, 6); poly(g, '#90a4ae', [24, -2, 38, 6, 33, 11, 22, 4]); },
  torch: g => { stroke(g, '#6d4c41', 3, 10, 18, 26, 11); g.fillStyle = '#ff6d00'; circ(g, 29, 9, 6); g.fillStyle = '#ffee58'; circ(g, 29, 9, 3); },
  shield: g => { g.fillStyle = '#546e7a'; circ(g, 16, -17, 11); g.strokeStyle = '#263238'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#b0bec5'; circ(g, 16, -17, 5); },
  bow: g => { g.strokeStyle = '#8d6e63'; g.lineWidth = 3; g.beginPath(); g.arc(24, 0, 17, -1.2, 1.2); g.stroke(); stroke(g, '#eeeeee', 1, 24 + 17 * Math.cos(-1.2), 17 * Math.sin(-1.2), 24 + 17 * Math.cos(1.2), 17 * Math.sin(1.2)); },
  sword: g => { stroke(g, '#e0e0e0', 3, 12, 16, 36, 8); stroke(g, '#ffd54f', 3, 13, 11, 15, 20); },
  wrench: g => { stroke(g, '#9e9e9e', 4, 10, 18, 28, 8); g.fillStyle = '#bdbdbd'; circ(g, 31, 7, 6); g.fillStyle = '#37474f'; circ(g, 33, 6, 2.5); },
  cultstaff: g => { stroke(g, '#2b1b16', 3.5, 6, 20, 36, -12); stroke(g, '#5a3a2c', 1.2, 8, 19, 34, -11); g.fillStyle = '#ff5a1f'; circ(g, 38, -13, 6.5); g.fillStyle = '#ffd27a'; circ(g, 38, -13, 3.2); poly(g, '#ff8a3c', [34, -17, 38, -26, 42, -17]); },   // a cultist's staff, tipped with a burning orb
  cultshield: g => { stroke(g, '#2e2a2c', 4, 12, 15, 32, 8); g.fillStyle = '#4a4147'; circ(g, 33, 8, 5.5); g.fillStyle = '#2b1f24'; circ(g, 23, 0, 17); g.strokeStyle = '#8c8087'; g.lineWidth = 3; g.stroke(); g.fillStyle = '#7a1f2b'; circ(g, 23, 0, 11); g.fillStyle = '#c9bfc4'; circ(g, 23, 0, 4.5); g.strokeStyle = '#150c10'; g.lineWidth = 2; g.stroke(); },   // a zealot: a big round shield held up in front and a spiked mace
  staff: g => { stroke(g, '#6d4c41', 3, 6, 22, 32, -8); g.fillStyle = '#4db6ac'; circ(g, 33, -9, 5); g.fillStyle = '#e0f7fa'; circ(g, 32, -10, 2); },
  greataxe: g => { stroke(g, '#5d4037', 4, 6, 22, 30, 4); poly(g, '#b0bec5', [24, -8, 40, 0, 38, 14, 26, 10]); poly(g, '#e57373', [26, -4, 36, 1, 35, 9, 28, 7]); },
  lantern: g => { stroke(g, '#6d4c41', 2, 12, 16, 22, 13); g.fillStyle = '#ffee58'; g.fillRect(22, 8, 9, 11); g.strokeStyle = '#5d4037'; g.lineWidth = 2; g.strokeRect(22, 8, 9, 11); },
  clover: g => { g.fillStyle = '#66bb6a'; [[22, 8], [28, 8], [22, 14], [28, 14]].forEach(a => circ(g, a[0], a[1], 4)); stroke(g, '#2e7d32', 2, 25, 14, 20, 20); },
  fireorb: g => { g.fillStyle = '#ff5722'; circ(g, 26, 12, 8); g.fillStyle = '#ffab00'; circ(g, 26, 12, 5); g.fillStyle = '#fff59d'; circ(g, 26, 12, 2.5); },
  banner: g => { stroke(g, '#bdbdbd', 3, 14, 18, 28, -10); poly(g, '#e53935', [28, -10, 40, -6, 30, 1]); },
  twindagger: g => { stroke(g, '#e0e0e0', 3, 12, 15, 30, 20); stroke(g, '#e0e0e0', 3, 12, -15, 30, -20); },
  blade: g => { g.shadowColor = '#ffe082'; g.shadowBlur = 8; stroke(g, '#fff59d', 4, 10, 16, 38, 6); g.shadowBlur = 0; stroke(g, '#ffb300', 3, 12, 11, 15, 21); },
};
const BACKS = {
  radio: g => { stroke(g, '#cfd8dc', 2, -14, -6, -26, -16); g.fillStyle = '#546e7a'; g.fillRect(-18, -10, 10, 14); },
  medpack: g => { g.fillStyle = '#eceff1'; g.fillRect(-18, -9, 12, 18); g.fillStyle = '#e53935'; g.fillRect(-14, -6, 4, 12); g.fillRect(-17, -3, 10, 4); },
  pack: g => { g.fillStyle = '#6d4c41'; g.fillRect(-19, -9, 12, 18); g.fillStyle = '#8d6e63'; g.fillRect(-17, -6, 8, 6); },
  basket: g => { g.fillStyle = '#a1887f'; ell(g, -14, 0, 8, 11); g.fillStyle = '#e53935'; circ(g, -16, -3, 2.5); circ(g, -12, 2, 2.5); circ(g, -15, 5, 2.5); },
  quiver: g => { g.fillStyle = '#5d4037'; g.fillRect(-19, -7, 8, 15); stroke(g, '#cfd8dc', 1.5, -17, -7, -20, -14); stroke(g, '#cfd8dc', 1.5, -14, -7, -15, -15); },
};
function mkPlayerCanvas(L) {
  return cv2(64, 64, g => {
    g.translate(32, 32); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.5)';
    if (BACKS[L[4]]) BACKS[L[4]](g);
    g.fillStyle = L[1]; ell(g, -2, 0, 12, 19); g.stroke();
    g.fillStyle = L[0]; ell(g, -3, -1, 10, 16);
    g.fillStyle = '#f0c8a0'; circ(g, 12, -16, 5); circ(g, 12, 16, 5);
    if (FRONTS[L[3]]) FRONTS[L[3]](g);
    g.fillStyle = '#f0c8a0'; circ(g, 2, 0, 11); g.stroke();
    g.fillStyle = L[2]; g.beginPath(); g.arc(2, 0, 11, Math.PI * .5, Math.PI * 1.5); g.fill();
    g.fillStyle = 'rgba(255,255,255,.25)'; circ(g, 5, -4, 3);
    if (L[5] === 'hood') {   // a hooded cultist: a dark cowl over the head, a black opening and two glowing eyes
      g.fillStyle = L[2]; circ(g, 1, 0, 13); g.stroke(); poly(g, L[2], [-11, -6, -20, 0, -11, 6]); g.fillStyle = '#0d0506'; ell(g, 8, 0, 6, 8); g.fillStyle = '#ff7a1a'; circ(g, 10.5, -3, 1.5); circ(g, 10.5, 3, 1.5);
    }
  });
}
const T_PL = {}, PCAN = {};
GC.LIST.forEach(c => { const cv = mkPlayerCanvas(c.look); PCAN[c.id] = cv; T_PL[c.id] = PIXI.Texture.from(cv); });
// swing tools (handle runs along +x from the pivot)
const T_AXE = tex(72, 44, g => {
  stroke(g, '#7a4a22', 6, 4, 22, 50, 22); stroke(g, '#a56b34', 2, 6, 20, 48, 20);
  poly(g, '#b0bec5', [42, 5, 66, 10, 68, 22, 66, 34, 42, 39, 49, 22]); poly(g, '#eceff1', [50, 11, 64, 14, 65, 19, 50, 19]);
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(42, 5); g.lineTo(66, 10); g.lineTo(68, 22); g.lineTo(66, 34); g.lineTo(42, 39); g.stroke();
});
const T_SPEARP = tex(240, 18, g => {   // the spear for the poke: a long shaft with a steel head
  stroke(g, '#6d4320', 6, 2, 9, 200, 9); stroke(g, '#a56b34', 2, 4, 7.5, 198, 7.5);
  g.fillStyle = '#3e2723'; g.fillRect(186, 5, 10, 8);
  poly(g, '#b0bec5', [196, 2, 238, 9, 196, 16, 202, 9]); poly(g, '#eceff1', [200, 5, 232, 9, 200, 9]);
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(196, 2); g.lineTo(238, 9); g.lineTo(196, 16); g.stroke();
});
const T_THRUST = tex(200, 24, g => {   // the white streak left by a spear poke
  const gr = g.createLinearGradient(0, 0, 200, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.7, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(0, 12); g.lineTo(196, 4); g.lineTo(200, 12); g.lineTo(196, 20); g.closePath(); g.fill();
});
const T_PICK = tex(72, 56, g => {
  stroke(g, '#7a4a22', 6, 4, 28, 50, 28); stroke(g, '#a56b34', 2, 6, 26, 48, 26);
  g.fillStyle = '#90a4ae'; g.beginPath(); g.moveTo(34, 6); g.quadraticCurveTo(76, 28, 34, 50); g.lineTo(44, 28); g.closePath(); g.fill();
  g.fillStyle = '#cfd8dc'; g.beginPath(); g.moveTo(37, 10); g.quadraticCurveTo(62, 28, 37, 30); g.lineTo(44, 24); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(34, 6); g.quadraticCurveTo(76, 28, 34, 50); g.stroke();
});
const T_BLADE = tex(80, 40, g => {
  stroke(g, '#6d4423', 5, 4, 20, 16, 20); stroke(g, '#ffd54f', 4, 17, 11, 17, 29);
  poly(g, '#b0bec5', [20, 15, 70, 17, 78, 20, 70, 23, 20, 25]); poly(g, '#eceff1', [22, 17, 68, 18, 74, 20, 22, 20]);
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(20, 15); g.lineTo(70, 17); g.lineTo(78, 20); g.lineTo(70, 23); g.lineTo(20, 25); g.stroke();
});
const T_LOG = tex(44, 24, g => {
  g.fillStyle = '#6d4423'; g.beginPath(); g.roundRect ? g.roundRect(2, 4, 34, 16, 6) : g.rect(2, 4, 34, 16); g.fill();
  g.fillStyle = '#8d5a2b'; g.fillRect(6, 5, 28, 5); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(6, 15, 28, 4);
  g.strokeStyle = '#4e2f15'; g.lineWidth = 1; [12, 20, 27].forEach(x => { g.beginPath(); g.moveTo(x, 6); g.lineTo(x + 2, 18); g.stroke(); });
  g.fillStyle = '#d9b676'; ell(g, 36, 12, 5, 8); g.strokeStyle = '#a0733d'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(36, 12, 3, 5, 0, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(36, 12, 1, 2, 0, 0, TAU); g.stroke();
});
const T_STONE = tex(30, 26, g => {
  poly(g, '#6b7078', [3, 20, 6, 9, 15, 3, 25, 8, 28, 19, 18, 24]); poly(g, '#9aa1aa', [6, 9, 15, 3, 25, 8, 17, 13, 8, 14]); poly(g, '#c6ccd4', [11, 8, 16, 5, 21, 8, 16, 10]);
  g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(3, 20); g.lineTo(6, 9); g.lineTo(15, 3); g.lineTo(25, 8); g.lineTo(28, 19); g.lineTo(18, 24); g.closePath(); g.stroke();
});
const T_BERRY = tex(26, 28, g => {
  g.fillStyle = '#d32f2f'; ell(g, 13, 15, 9, 9); poly(g, '#d32f2f', [4.5, 17, 21.5, 17, 13, 27]);
  g.fillStyle = 'rgba(255,255,255,.28)'; ell(g, 9.5, 11, 2.5, 3.5);
  g.fillStyle = '#ffe082'; [[9, 15], [15, 13], [18, 17], [12, 19], [8, 20], [14, 23]].forEach(p => ell(g, p[0], p[1], .9, 1.3));
  poly(g, '#43a047', [13, 8, 5, 5, 9, 10]); poly(g, '#43a047', [13, 8, 21, 5, 17, 10]); poly(g, '#2e7d32', [13, 8, 10, 3, 16, 3]);
});
const T_GEM = tex(26, 26, g => {
  poly(g, '#26c6da', [13, 2, 23, 10, 13, 24, 3, 10]); poly(g, '#80deea', [13, 2, 23, 10, 13, 10, 3, 10]); poly(g, '#00acc1', [13, 10, 23, 10, 13, 24]);
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1; g.beginPath(); g.moveTo(3, 10); g.lineTo(23, 10); g.moveTo(13, 2); g.lineTo(9, 10); g.lineTo(13, 24); g.lineTo(17, 10); g.lineTo(13, 2); g.stroke();
});
const drawCactus = g => {
  g.fillStyle = '#2f7d3a'; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
  const cap = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke(); };
  g.beginPath(); g.moveTo(32, 120); g.lineTo(32, 38); g.arc(42, 38, 10, Math.PI, 0); g.lineTo(52, 120); g.closePath(); g.fill(); g.stroke();
  g.fillRect(14, 64, 20, 10); g.fillRect(14, 36, 10, 38); cap(19, 36, 5); cap(14, 70, 0.1);
  g.fillRect(50, 78, 20, 10); g.fillRect(60, 50, 10, 38); cap(65, 50, 5);
  g.fillStyle = '#43a35a'; g.fillRect(38, 40, 4, 78); g.fillRect(16, 38, 3, 34); g.fillRect(62, 52, 3, 34);
  g.fillStyle = '#f5f0c8'; [[36, 50], [48, 62], [37, 80], [47, 96], [38, 108], [19, 48], [65, 62]].forEach(p => { g.fillRect(p[0], p[1], 2, 2); });
};
const T_CACTUS = tex(84, 130, drawCactus);
const T_CACTUS_S = tex(84, 130, g => { drawCactus(g); g.fillStyle = '#f4f8fc'; g.strokeStyle = 'rgba(80,110,140,.5)'; g.lineWidth = 1.2; for (const [x, y, rx, ry] of [[42, 29, 13, 6], [19, 32, 8, 4], [65, 46, 8, 4], [36, 40, 5, 3], [50, 44, 5, 3]]) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); g.stroke(); } });   // a cactus dusted with snow (at a snow border)
const T_BOAT = tex(132, 74, g => {
  g.fillStyle = '#5a3818'; g.beginPath(); g.moveTo(8, 37); g.quadraticCurveTo(14, 8, 60, 8); g.quadraticCurveTo(112, 10, 126, 37); g.quadraticCurveTo(112, 64, 60, 66); g.quadraticCurveTo(14, 66, 8, 37); g.fill();
  g.fillStyle = '#a8773f'; g.beginPath(); g.moveTo(16, 37); g.quadraticCurveTo(22, 16, 60, 16); g.quadraticCurveTo(102, 18, 114, 37); g.quadraticCurveTo(102, 58, 60, 58); g.quadraticCurveTo(22, 58, 16, 37); g.fill();
  g.strokeStyle = '#7a5428'; g.lineWidth = 3; [38, 60, 82].forEach(x => { g.beginPath(); g.moveTo(x, 18); g.lineTo(x, 56); g.stroke(); });
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(8, 37); g.quadraticCurveTo(14, 8, 60, 8); g.quadraticCurveTo(112, 10, 126, 37); g.quadraticCurveTo(112, 64, 60, 66); g.quadraticCurveTo(14, 66, 8, 37); g.stroke();
});
const T_TRAP = tex(64, 56, g => {
  g.fillStyle = 'rgba(0,0,0,.25)'; ell(g, 32, 38, 26, 10);
  g.fillStyle = '#6b6f76'; ell(g, 32, 32, 26, 16); g.fillStyle = '#4b4f55'; ell(g, 32, 32, 20, 11);
  g.fillStyle = '#b8bec6'; for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, x = 32 + Math.cos(a) * 20, y = 32 + Math.sin(a) * 11; g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x, y - 9); g.lineTo(x + 3, y); g.closePath(); g.fill(); }
  g.fillStyle = '#d9a441'; circ(g, 32, 32, 4);
});
const T_SLASH = tex(80, 80, g => { g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 7; g.beginPath(); g.arc(8, 40, 52, -.75, .75); g.stroke(); g.lineWidth = 3; g.globalAlpha = .6; g.beginPath(); g.arc(8, 40, 44, -.6, .6); g.stroke(); });
const T_BENCH = tex(112, 84, g => {
  g.fillStyle = 'rgba(0,0,0,.0)';
  g.fillStyle = '#4a2f16'; g.fillRect(14, 48, 11, 30); g.fillRect(87, 48, 11, 30); g.fillStyle = '#6d4423'; g.fillRect(14, 48, 5, 30); g.fillRect(87, 48, 5, 30);
  poly(g, '#c18a4a', [14, 14, 98, 14, 110, 40, 2, 40]); g.strokeStyle = '#8a5a2b'; g.lineWidth = 1.5; for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(14 + i * 17 - i * 2, 14); g.lineTo(2 + i * 21.6, 40); g.stroke(); }
  g.fillStyle = '#8a5a2b'; g.fillRect(2, 40, 108, 11); g.fillStyle = '#a56b34'; g.fillRect(2, 40, 108, 4);
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 2; g.strokeRect(2, 40, 108, 11);
  // saw
  poly(g, '#cfd8dc', [24, 22, 56, 20, 57, 28, 24, 30]); g.fillStyle = '#8d6e63'; g.fillRect(18, 20, 9, 11); g.fillStyle = '#90a4ae'; for (let i = 0; i < 7; i++) poly(g, '#90a4ae', [28 + i * 4.2, 30, 30.5 + i * 4.2, 34, 33 + i * 4.2, 30]);
  // hammer
  stroke(g, '#7a4a22', 4, 66, 31, 88, 22); poly(g, '#78909c', [82, 15, 94, 20, 91, 29, 79, 24]);
  // little log stack
  g.fillStyle = '#6d4423'; ell(g, 70, 24, 8, 4); g.fillStyle = '#d9b676'; circ(g, 63, 24, 3);
});
const mkWall = P => tex(84, 72, g => {
  for (let i = 0; i < 5; i++) {
    const x = 6 + i * 15, h = 40 + (i % 2) * 8;
    poly(g, P.m, [x, 64, x + 12, 64, x + 12, 64 - h + 14, x + 6, 64 - h, x, 64 - h + 14]);
    poly(g, P.l, [x + 1, 62, x + 5, 62, x + 5, 64 - h + 12, x + 6, 64 - h + 3, x + 1, 64 - h + 14]);
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 64); g.lineTo(x, 64 - h + 14); g.lineTo(x + 6, 64 - h); g.lineTo(x + 12, 64 - h + 14); g.lineTo(x + 12, 64); g.stroke();
  }
  g.fillStyle = P.d; g.fillRect(2, 40, 80, 8); g.fillStyle = P.m; g.fillRect(2, 40, 80, 3); g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.strokeRect(2, 40, 80, 8);
});
const T_CHEST = tex(96, 80, g => {
  g.fillStyle = '#4a2f16'; g.beginPath(); g.roundRect ? g.roundRect(8, 30, 80, 42, 6) : g.rect(8, 30, 80, 42); g.fill();
  g.fillStyle = '#8a5a2b'; g.fillRect(10, 34, 76, 34); g.fillStyle = '#a56b34'; g.fillRect(10, 34, 76, 8);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(10, 34 + i * 8.5); g.lineTo(86, 34 + i * 8.5); g.stroke(); }
  g.fillStyle = '#6d4423'; g.beginPath(); g.moveTo(8, 32); g.quadraticCurveTo(48, 0, 88, 32); g.lineTo(88, 38); g.lineTo(8, 38); g.closePath(); g.fill();
  g.fillStyle = '#8a5a2b'; g.beginPath(); g.moveTo(11, 33); g.quadraticCurveTo(48, 6, 85, 33); g.lineTo(85, 36); g.lineTo(11, 36); g.closePath(); g.fill();
  g.fillStyle = '#90a4ae'; g.fillRect(8, 28, 10, 44); g.fillRect(78, 28, 10, 44); g.fillStyle = '#cfd8dc'; g.fillRect(9, 28, 3, 44); g.fillRect(79, 28, 3, 44);
  g.fillStyle = '#ffd54f'; g.fillRect(42, 34, 12, 14); g.fillStyle = '#6d4c00'; circ(g, 48, 41, 2.2);
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.strokeRect(8, 30, 80, 42);
});
const T_POT = tex(96, 84, g => {
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; g.fillStyle = '#7b8088'; ell(g, 48 + Math.cos(a) * 30, 62 + Math.sin(a) * 10, 9, 6); g.fillStyle = '#a9afb8'; ell(g, 48 + Math.cos(a) * 30 - 1, 61 + Math.sin(a) * 10, 6, 3.5); }
  g.fillStyle = 'rgba(255,120,30,.55)'; ell(g, 48, 60, 18, 7);
  g.fillStyle = '#252a30'; g.beginPath(); g.moveTo(18, 30); g.quadraticCurveTo(14, 66, 48, 68); g.quadraticCurveTo(82, 66, 78, 30); g.closePath(); g.fill();
  g.fillStyle = '#3a424b'; g.beginPath(); g.moveTo(22, 32); g.quadraticCurveTo(20, 56, 40, 62); g.lineTo(40, 34); g.closePath(); g.fill();
  g.fillStyle = '#1b1f24'; ell(g, 48, 30, 30, 9); g.fillStyle = '#c8742a'; ell(g, 48, 31, 26, 6.5); g.fillStyle = '#e8a050'; ell(g, 44, 30, 12, 3);
  g.strokeStyle = '#1b1f24'; g.lineWidth = 4; g.beginPath(); g.arc(48, 28, 34, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(18, 30); g.quadraticCurveTo(14, 66, 48, 68); g.quadraticCurveTo(82, 66, 78, 30); g.stroke();
});
const T_SMELTER = tex(108, 108, g => {
  g.fillStyle = '#3d4249'; g.fillRect(14, 8, 22, 36);                              // chimney
  g.fillStyle = '#5b626b'; g.fillRect(16, 8, 18, 34); g.fillStyle = '#2c3036'; g.fillRect(12, 4, 26, 8);
  g.fillStyle = '#4a5058'; g.beginPath(); g.moveTo(12, 96); g.lineTo(20, 34); g.lineTo(88, 34); g.lineTo(96, 96); g.closePath(); g.fill();   // furnace body
  g.fillStyle = '#6a727c'; g.beginPath(); g.moveTo(16, 96); g.lineTo(23, 38); g.lineTo(54, 38); g.lineTo(54, 96); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1.5;                               // brick lines
  for (let r = 0; r < 6; r++) { const y = 44 + r * 9; g.beginPath(); g.moveTo(18 - r * .5, y); g.lineTo(90 + r * .5, y); g.stroke(); for (let c = 0; c < 6; c++) { const x = 22 + c * 12 + (r % 2) * 6; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 9); g.stroke(); } }
  g.fillStyle = '#1b1d21'; g.beginPath(); g.moveTo(36, 96); g.lineTo(36, 64); g.quadraticCurveTo(54, 46, 72, 64); g.lineTo(72, 96); g.closePath(); g.fill();   // fire door
  const gr = g.createRadialGradient(54, 84, 2, 54, 80, 22); gr.addColorStop(0, '#fff0a0'); gr.addColorStop(.5, '#ff8a1c'); gr.addColorStop(1, 'rgba(160,40,0,.2)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(40, 96); g.lineTo(40, 68); g.quadraticCurveTo(54, 54, 68, 68); g.lineTo(68, 96); g.closePath(); g.fill();
  g.fillStyle = '#2c3036'; g.fillRect(10, 94, 88, 8); g.fillStyle = '#90a4ae'; g.fillRect(8, 36, 92, 5);                                                     // base + iron band
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(12, 96); g.lineTo(20, 34); g.lineTo(88, 34); g.lineTo(96, 96); g.stroke();
});
const T_SCRAP = tex(36, 28, g => {
  poly(g, '#7d8791', [3, 20, 8, 8, 28, 6, 33, 18, 26, 25, 8, 25]); poly(g, '#b9c3cc', [8, 8, 28, 6, 24, 13, 11, 14]); poly(g, '#e9eef2', [12, 9, 24, 8, 21, 11, 13, 12]);
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(3, 20); g.lineTo(8, 8); g.lineTo(28, 6); g.lineTo(33, 18); g.lineTo(26, 25); g.lineTo(8, 25); g.closePath(); g.stroke();
  g.fillStyle = '#ffb74d'; circ(g, 14, 20, 1.6); circ(g, 22, 19, 1.3);
});
const T_MEAT = tex(34, 26, g => {   // a raw meat scrap with a little bone
  g.fillStyle = '#f3e9d8'; g.fillRect(20, 10, 11, 4); circ(g, 31, 9.5, 2.6); circ(g, 31, 14.5, 2.6);
  poly(g, '#b8323a', [3, 14, 7, 5, 17, 3, 23, 9, 22, 19, 13, 23, 5, 21]); poly(g, '#e2626a', [7, 7, 16, 5, 19, 10, 10, 12]);
  g.fillStyle = '#f6d7c8'; ell(g, 11, 15, 4, 2); g.strokeStyle = 'rgba(60,0,10,.55)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(3, 14); g.lineTo(7, 5); g.lineTo(17, 3); g.lineTo(23, 9); g.lineTo(22, 19); g.lineTo(13, 23); g.lineTo(5, 21); g.closePath(); g.stroke();
});
const T_RABBIT = tex(44, 30, g => {   // seen from above, facing right: round body, head, long ears laid back, white tail
  g.fillStyle = '#8a6a4f'; ell(g, 18, 15, 12, 9.5);
  g.fillStyle = '#9c7a5c'; ell(g, 31, 15, 7, 6);
  g.fillStyle = '#7a5b42'; ell(g, 24, 10, 8, 2.6); ell(g, 24, 20, 8, 2.6);
  g.fillStyle = '#e8b4a8'; ell(g, 24, 10, 6, 1.2); ell(g, 24, 20, 6, 1.2);
  g.fillStyle = '#b8977a'; ell(g, 15, 15, 7, 5);
  g.fillStyle = '#ffffff'; circ(g, 6.5, 15, 3.6);
  g.fillStyle = '#1a1a1a'; circ(g, 34, 12.6, 1.2); circ(g, 34, 17.4, 1.2); g.fillStyle = '#e48a9a'; circ(g, 37.6, 15, 1.1);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(18, 15, 12, 9.5, 0, 0, TAU); g.stroke();
});
const T_WOLF = tex(76, 44, g => {   // seen from above, facing right
  g.fillStyle = '#5f6670'; ell(g, 9, 22, 10, 4.5);
  g.fillStyle = '#7e8792'; ell(g, 32, 22, 20, 11); g.fillStyle = '#5a616b'; ell(g, 30, 22, 15, 4);
  g.fillStyle = '#8b949f'; ell(g, 53, 22, 10, 9); g.fillStyle = '#9aa3ad'; ell(g, 63, 22, 7, 4.5);
  poly(g, '#4b5159', [47, 13, 51, 5, 55, 14]); poly(g, '#4b5159', [47, 31, 51, 39, 55, 30]);
  g.fillStyle = '#ffca28'; circ(g, 57, 18, 1.7); circ(g, 57, 26, 1.7); g.fillStyle = '#222'; circ(g, 70, 22, 1.7);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.3; g.beginPath(); g.ellipse(32, 22, 20, 11, 0, 0, TAU); g.stroke();
});
const T_WOLFA = tex(84, 50, g => {   // alpha wolf: near-black, scarred, a spiky mane over the shoulders
  g.fillStyle = '#2b2e33'; poly(g, '#2b2e33', [2, 25, 10, 19, 20, 22, 10, 31]);
  g.fillStyle = '#3c4046'; ell(g, 35, 25, 22, 13);
  for (let i = 0; i < 9; i++) { const x = 30 + i * 3.2, s = i % 2 ? 1 : -1; poly(g, '#1d1f23', [x - 3, 25 + s * 8, x, 25 + s * 17, x + 3, 25 + s * 8]); }   // bristling mane
  g.fillStyle = '#1d1f23'; ell(g, 34, 25, 17, 4.5);
  g.fillStyle = '#464b52'; ell(g, 59, 25, 11, 10); g.fillStyle = '#50565e'; ell(g, 70, 25, 8, 5);
  poly(g, '#1d1f23', [52, 15, 55, 5, 60, 15]); poly(g, '#1d1f23', [52, 35, 55, 45, 60, 35]);
  g.fillStyle = '#ff1a1a'; circ(g, 63, 20, 2.2); circ(g, 63, 30, 2.2); g.fillStyle = '#111'; circ(g, 78, 25, 1.9);
  g.fillStyle = '#f1f1f1'; poly(g, '#f1f1f1', [72, 21, 76, 22.5, 73, 23]); poly(g, '#f1f1f1', [72, 29, 76, 27.5, 73, 27]);   // fangs
  g.strokeStyle = '#8a2a2a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(56, 17); g.lineTo(62, 22); g.stroke();   // scar
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(35, 25, 22, 13, 0, 0, TAU); g.stroke();
});
const T_BEAR = tex(110, 70, g => {   // polar-ish bear from above, facing right
  g.fillStyle = '#d9d4c7'; ell(g, 18, 35, 14, 11); g.fillStyle = '#e8e4d8'; ell(g, 46, 35, 34, 23);
  g.fillStyle = '#cfc9b9'; ell(g, 44, 35, 24, 8);
  g.fillStyle = '#b9b3a2'; ell(g, 70, 15, 8, 5); ell(g, 70, 55, 8, 5); ell(g, 22, 18, 8, 5); ell(g, 22, 52, 8, 5);   // paws
  g.fillStyle = '#f0ece0'; ell(g, 82, 35, 17, 14); g.fillStyle = '#e0dccf'; ell(g, 95, 35, 9, 6);
  g.fillStyle = '#d9d4c7'; circ(g, 78, 21, 5); circ(g, 78, 49, 5); g.fillStyle = '#222'; circ(g, 102, 35, 3); circ(g, 89, 28, 2); circ(g, 89, 42, 2);
  g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1.6; g.beginPath(); g.ellipse(46, 35, 34, 23, 0, 0, TAU); g.stroke();
});
const T_MAMMOTH = tex(170, 120, g => {   // woolly mammoth from above, facing right: huge shaggy brown body, domed head, two curling tusks
  g.fillStyle = '#4a2e1c'; ell(g, 62, 60, 52, 40);
  g.fillStyle = '#5d3a24'; ell(g, 58, 60, 44, 33);
  g.strokeStyle = '#3a2214'; g.lineWidth = 2; for (let i = 0; i < 26; i++) { const x = 22 + (i % 13) * 7, y = i < 13 ? 36 + (i % 4) * 3 : 70 + (i % 4) * 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5, y + (i < 13 ? -9 : 9)); g.stroke(); }   // shaggy fur
  g.fillStyle = '#3a2214'; ell(g, 34, 60, 22, 7);
  g.fillStyle = '#6b4429'; ell(g, 112, 60, 28, 26); g.fillStyle = '#7a4f31'; ell(g, 106, 60, 14, 15);   // head with a high dome
  g.fillStyle = '#4a2e1c'; ell(g, 140, 60, 14, 8); ell(g, 156, 60, 12, 5);   // trunk
  g.strokeStyle = '#efe6cf'; g.lineWidth = 6; g.lineCap = 'round'; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(128, 60 + sg * 16); g.quadraticCurveTo(160, 60 + sg * 34, 166, 60 + sg * 10); g.stroke(); }
  g.fillStyle = '#4a2e1c'; ell(g, 96, 24, 8, 5); ell(g, 96, 96, 8, 5); ell(g, 36, 22, 8, 5); ell(g, 36, 98, 8, 5);
  g.fillStyle = '#111'; circ(g, 124, 49, 2.4); circ(g, 124, 71, 2.4);
  g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1.8; g.beginPath(); g.ellipse(62, 60, 52, 40, 0, 0, TAU); g.stroke();
});
const T_APELT = tex(40, 30, g => {   // an alpha wolf pelt: near-black with a pale mane stripe
  const P = [6, 10, 2, 4, 10, 8, 30, 8, 38, 4, 34, 10, 36, 22, 38, 28, 30, 23, 10, 23, 2, 28, 4, 22];
  poly(g, '#2e3238', P); g.fillStyle = '#4a4f57'; ell(g, 20, 15, 11, 5); g.fillStyle = '#c62828'; ell(g, 20, 13, 7, 1.6);
  g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(P[0], P[1]); for (let i = 2; i < P.length; i += 2) g.lineTo(P[i], P[i + 1]); g.closePath(); g.stroke();
});
const T_SCORP = tex(76, 60, g => {   // desert scorpion from above, facing right: tan armour, two claws, a curled stinger tail
  g.strokeStyle = '#7a5a2c'; g.lineWidth = 2.5; g.lineCap = 'round'; for (let i = 0; i < 4; i++) { const x = 26 + i * 7; g.beginPath(); g.moveTo(x, 30); g.lineTo(x - 4, 12 + i); g.moveTo(x, 30); g.lineTo(x - 4, 48 - i); g.stroke(); }
  g.fillStyle = '#b8863c'; g.beginPath(); g.ellipse(34, 30, 16, 10, 0, 0, TAU); g.fill(); g.fillStyle = '#9c6f2c'; for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(24 + i * 6, 30, 3, 8, 0, 0, TAU); g.fill(); }
  g.strokeStyle = '#a8742c'; g.lineWidth = 5; g.beginPath(); g.moveTo(18, 30); g.bezierCurveTo(4, 30, 2, 8, 20, 10); g.stroke(); g.fillStyle = '#6b1f10'; g.beginPath(); g.moveTo(20, 6); g.lineTo(28, 12); g.lineTo(18, 14); g.fill();   // tail and stinger
  g.strokeStyle = '#a8742c'; g.lineWidth = 4; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(48, 30 + sg * 5); g.lineTo(62, 30 + sg * 14); g.stroke(); g.fillStyle = '#b8863c'; g.beginPath(); g.ellipse(66, 30 + sg * 14, 7, 4.5, sg * -.5, 0, TAU); g.fill(); }
  g.fillStyle = '#111'; g.beginPath(); g.arc(50, 27, 1.6, 0, TAU); g.arc(50, 33, 1.6, 0, TAU); g.fill();
});
const T_PENG = tex(64, 48, g => {   // a penguin seen from above, facing right: black back, two flippers, a small head with a yellow beak
  g.fillStyle = 'rgba(0,0,0,.0)'; g.fillStyle = '#20242b'; g.beginPath(); g.ellipse(28, 24, 20, 14, 0, 0, TAU); g.fill();
  g.fillStyle = '#2f353f'; for (const sg of [-1, 1]) { g.beginPath(); g.ellipse(28, 24 + sg * 15, 11, 4, sg * .25, 0, TAU); g.fill(); }   // flippers
  g.fillStyle = '#e9edf2'; g.beginPath(); g.ellipse(24, 24, 9, 7, 0, 0, TAU); g.fill();   // a pale patch showing at the sides
  g.fillStyle = '#20242b'; g.beginPath(); g.arc(46, 24, 8, 0, TAU); g.fill(); g.fillStyle = '#f2b01e'; g.beginPath(); g.moveTo(52, 21); g.lineTo(61, 24); g.lineTo(52, 27); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(47, 20, 1.5, 0, TAU); g.arc(47, 28, 1.5, 0, TAU); g.fill();
});
const T_SAL = tex(76, 40, g => {   // a lava salamander: orange, long, spotted with glowing yellow
  g.strokeStyle = '#c4501a'; g.lineWidth = 4; g.lineCap = 'round'; for (const x of [24, 50]) for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(x, 20); g.lineTo(x + 6, 20 + sg * 13); g.stroke(); }
  g.fillStyle = '#e8641e'; g.beginPath(); g.moveTo(2, 20); g.quadraticCurveTo(24, 10, 52, 12); g.quadraticCurveTo(70, 12, 72, 20); g.quadraticCurveTo(70, 28, 52, 28); g.quadraticCurveTo(24, 30, 2, 20); g.fill();
  g.fillStyle = '#2a1410'; for (let i = 0; i < 4; i++) { g.fillRect(16 + i * 11, 12 + (i % 2), 5, 16 - (i % 2) * 2); }
  g.fillStyle = '#ffd84a'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(14 + i * 9, 20 + (i % 2 ? 4 : -4), 2, 0, TAU); g.fill(); }
  g.fillStyle = '#111'; g.beginPath(); g.arc(66, 16, 1.6, 0, TAU); g.arc(66, 24, 1.6, 0, TAU); g.fill();
});
const T_BOAR = tex(104, 64, g => {   // a wild boar from above, facing right: bristly brown, a tuft along the spine, pale tusks
  g.fillStyle = '#4a3322'; g.beginPath(); g.ellipse(46, 32, 34, 20, 0, 0, TAU); g.fill(); g.fillStyle = '#3a281a'; g.beginPath(); g.ellipse(44, 32, 28, 6, 0, 0, TAU); g.fill();
  g.strokeStyle = '#25180f'; g.lineWidth = 2; for (let i = 0; i < 10; i++) { const x = 24 + i * 4.5; g.beginPath(); g.moveTo(x, 28); g.lineTo(x - 2, 20); g.moveTo(x, 36); g.lineTo(x - 2, 44); g.stroke(); }
  g.fillStyle = '#5a4130'; g.beginPath(); g.ellipse(80, 32, 17, 13, 0, 0, TAU); g.fill(); g.fillStyle = '#c8a0a0'; g.beginPath(); g.ellipse(94, 32, 7, 6, 0, 0, TAU); g.fill();
  g.fillStyle = '#f1ead2'; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(88, 32 + sg * 5); g.lineTo(100, 32 + sg * 12); g.lineTo(92, 32 + sg * 3); g.fill(); }
  g.fillStyle = '#3a281a'; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(74, 32 + sg * 11); g.lineTo(70, 32 + sg * 20); g.lineTo(80, 32 + sg * 14); g.fill(); }
  g.fillStyle = '#111'; g.beginPath(); g.arc(84, 26, 1.6, 0, TAU); g.arc(84, 38, 1.6, 0, TAU); g.fill();
});
const T_GOLEM = tex(140, 120, g => {   // a magma golem from above, facing right: black rock with glowing orange cracks, big fists
  g.fillStyle = 'rgba(0,0,0,.0)';
  for (const sg of [-1, 1]) { g.fillStyle = '#2a2326'; g.beginPath(); g.ellipse(100, 60 + sg * 40, 26, 16, sg * .3, 0, TAU); g.fill(); g.strokeStyle = '#ff7a1a'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#4a3a3e'; g.beginPath(); g.ellipse(82, 60 + sg * 30, 20, 11, sg * .5, 0, TAU); g.fill(); }
  g.fillStyle = '#2b2427'; g.beginPath(); g.ellipse(58, 60, 44, 36, 0, 0, TAU); g.fill(); g.fillStyle = '#3a3034'; g.beginPath(); g.ellipse(52, 56, 30, 24, 0, 0, TAU); g.fill();
  g.strokeStyle = '#ff8a1a'; g.lineWidth = 3; g.lineCap = 'round'; for (const p of [[28, 40, 50, 58, 36, 80], [58, 30, 62, 52, 80, 66], [40, 62, 30, 76, 50, 90], [70, 76, 84, 62, 78, 48]]) { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.lineTo(p[4], p[5]); g.stroke(); }
  g.fillStyle = '#3a3034'; g.beginPath(); g.ellipse(104, 60, 17, 15, 0, 0, TAU); g.fill(); g.fillStyle = '#ffb02a'; g.beginPath(); g.arc(110, 53, 3.2, 0, TAU); g.arc(110, 67, 3.2, 0, TAU); g.fill();
});
const T_IMP = tex(70, 60, g => {   // a fire imp from above: small red body, bat wings, two horns and glowing eyes
  g.fillStyle = '#7a1c10'; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(26, 30); g.lineTo(10, 30 + sg * 28); g.lineTo(24, 30 + sg * 20); g.lineTo(20, 30 + sg * 30); g.lineTo(34, 30 + sg * 14); g.closePath(); g.fill(); }
  g.fillStyle = '#d63a18'; g.beginPath(); g.ellipse(34, 30, 15, 11, 0, 0, TAU); g.fill(); g.fillStyle = '#e8501e'; g.beginPath(); g.ellipse(48, 30, 9, 8, 0, 0, TAU); g.fill();
  g.fillStyle = '#2a0c08'; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(48, 30 + sg * 6); g.lineTo(54, 30 + sg * 15); g.lineTo(52, 30 + sg * 5); g.fill(); }
  g.fillStyle = '#ffe24a'; g.beginPath(); g.arc(53, 27, 2, 0, TAU); g.arc(53, 33, 2, 0, TAU); g.fill(); g.strokeStyle = '#d63a18'; g.lineWidth = 3; g.beginPath(); g.moveTo(20, 30); g.quadraticCurveTo(8, 26, 6, 36); g.stroke();
});
const T_VULF = tex(150, 120, g => {   // a vulture seen from above with its wings spread, facing right: dark body, ragged feather tips, a bald red head and a hooked beak
  g.save(); g.translate(75, 60);
  for (const sg of [-1, 1]) {
    g.fillStyle = '#2d2119'; g.beginPath(); g.moveTo(-6, 0); g.lineTo(-30, sg * 54); g.lineTo(-10, sg * 50); g.lineTo(-18, sg * 58); g.lineTo(4, sg * 46); g.lineTo(0, sg * 56); g.lineTo(14, sg * 40); g.lineTo(26, sg * 8); g.closePath(); g.fill();
    g.fillStyle = '#44322a'; g.beginPath(); g.moveTo(-4, sg * 2); g.lineTo(-20, sg * 32); g.lineTo(10, sg * 26); g.lineTo(20, sg * 6); g.closePath(); g.fill();
  }
  g.fillStyle = '#2d2119'; g.beginPath(); g.moveTo(-24, -6); g.lineTo(-46, -12); g.lineTo(-44, 0); g.lineTo(-46, 12); g.lineTo(-24, 6); g.closePath(); g.fill();   // tail
  g.fillStyle = '#3a2a20'; g.beginPath(); g.ellipse(0, 0, 30, 13, 0, 0, TAU); g.fill(); g.fillStyle = '#d9d2c4'; g.beginPath(); g.ellipse(26, 0, 7, 9, 0, 0, TAU); g.fill();   // body and a pale ruff
  g.fillStyle = '#c4524a'; g.beginPath(); g.ellipse(36, 0, 8, 6, 0, 0, TAU); g.fill(); g.fillStyle = '#e0c060'; g.beginPath(); g.moveTo(42, -3); g.lineTo(52, 1); g.lineTo(42, 4); g.closePath(); g.fill();
  g.fillStyle = '#111'; g.beginPath(); g.arc(38, -3, 1.4, 0, TAU); g.fill(); g.beginPath(); g.arc(38, 3, 1.4, 0, TAU); g.fill();
  g.restore();
});
const T_VULL = tex(90, 62, g => {   // landed: wings folded, hunched
  g.save(); g.translate(45, 31);
  g.fillStyle = '#2d2119'; g.beginPath(); g.moveTo(-34, -4); g.lineTo(-18, -14); g.lineTo(14, -12); g.lineTo(20, 0); g.lineTo(14, 12); g.lineTo(-18, 14); g.lineTo(-34, 4); g.closePath(); g.fill();
  g.strokeStyle = '#4b382d'; g.lineWidth = 2; g.beginPath(); g.moveTo(-26, -6); g.lineTo(8, -8); g.moveTo(-26, 6); g.lineTo(8, 8); g.stroke();
  g.fillStyle = '#d9d2c4'; g.beginPath(); g.ellipse(18, 0, 6, 9, 0, 0, TAU); g.fill();
  g.fillStyle = '#c4524a'; g.beginPath(); g.ellipse(28, 0, 8, 6, 0, 0, TAU); g.fill(); g.fillStyle = '#e0c060'; g.beginPath(); g.moveTo(34, -3); g.lineTo(43, 2); g.lineTo(34, 4); g.closePath(); g.fill();
  g.fillStyle = '#111'; g.beginPath(); g.arc(30, -3, 1.3, 0, TAU); g.fill(); g.beginPath(); g.arc(30, 3, 1.3, 0, TAU); g.fill();
  g.restore();
});
function mkWolf(w) {
  if (w[11]) {   // boar (1), magma golem (2), fire imp (3)
    const SP = { 1: { t: T_BOAR, sc: .7, hw: 36, hy: -30, sh: [1.3, .6], sy: 8 }, 2: { t: T_GOLEM, sc: .95, hw: 70, hy: -64, sh: [2.6, 1.1], sy: 14 }, 3: { t: T_IMP, sc: .8, hw: 28, hy: -32, sh: [.9, .45], sy: 6 } }[w[11]];
    const c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(SP.sh[0], SP.sh[1]); sh.y = SP.sy;
    const body = new PIXI.Sprite(SP.t); body.anchor.set(.5); body.scale.set(SP.sc); const hp = new PIXI.Graphics(); hp.visible = false; c.addChild(sh, body, hp); ents.addChild(c); c.alpha = 0;
    const eyes = w[11] === 3 ? [0, 1].map(() => { const s = new PIXI.Sprite(T_GLOW); s.anchor.set(.5); s.tint = 0xffa020; s.blendMode = BM.ADD; s.scale.set(.2); overL.addChild(s); return s; }) : [];   // imps glow
    return SPR.attach({ c, body, sh, hp, eyes, al: false, big: w[11] === 2 ? 1 : 0, hpW: SP.hw, hpY: SP.hy, kind: 'w', ang: w[3] / 100, age: 0, lh: -1, flash: 0, lunge: 0, gait: 0, st: w[6], impGlow: w[11] === 3 }, [0, 'boar', 'golem', 'imp'][w[11]]);
  }
  if (w[10]) {   // a vulture
    const c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); const body = new PIXI.Sprite(w[10] === 1 ? T_VULF : T_VULL); body.anchor.set(.5); body.scale.set(.7);
    const hp = new PIXI.Graphics(); hp.visible = false; c.addChild(sh, body, hp); ents.addChild(c); c.alpha = 0;
    return SPR.attach({ c, body, sh, hp, eyes: [], al: false, vul: 1, air: w[10] === 1, kind: 'w', ang: w[3] / 100, age: 0, lh: -1, flash: 0, lunge: 0, gait: 0, st: w[6], lift: w[10] === 1 ? 1 : 0 }, 'vulture');
  }
  if (w[9]) {   // bear (1) or woolly mammoth (2)
    const mm = w[9] === 2, c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(mm ? 3 : 1.7, mm ? 1.3 : .8); sh.y = mm ? 20 : 12;
    const body = new PIXI.Sprite(mm ? T_MAMMOTH : T_BEAR); body.anchor.set(.5); body.scale.set(mm ? 1.15 : .95); const hp = new PIXI.Graphics(); hp.visible = false;
    c.addChild(sh, body, hp); ents.addChild(c); c.alpha = 0;
    return SPR.attach({ c, body, sh, hp, eyes: [], al: false, big: w[9], kind: 'w', ang: w[3] / 100, age: 0, lh: -1, flash: 0, lunge: 0, gait: 0, st: w[6] }, mm ? 'mammoth' : 'bear');
  }
  const al = !!w[8], c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(al ? 1.25 : .9, al ? .6 : .45); sh.y = al ? 8 : 6;
  const body = new PIXI.Sprite(al ? T_WOLFA : T_WOLF); body.anchor.set(.5); body.scale.set(al ? 1.2 : .85); const hp = new PIXI.Graphics(); hp.visible = false;
  c.addChild(sh, body, hp); ents.addChild(c); c.alpha = 0;
  const eyes = al ? [0, 1].map(() => { const s = new PIXI.Sprite(T_GLOW); s.anchor.set(.5); s.tint = 0xff2a2a; s.blendMode = BM.ADD; s.scale.set(.16); overL.addChild(s); return s; }) : [];   // glowing red eyes
  return SPR.attach({ c, body, sh, hp, eyes, al, kind: 'w', ang: w[3] / 100, age: 0, lh: -1, flash: 0, lunge: 0, gait: 0, st: w[6] }, al ? 'alpha_wolf' : 'wolf');
}
function mkRabbit(b) {   // b[5]: 0 rabbit, 1 scorpion, 2 penguin, 3 lava salamander
  const c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(.55, .32); sh.y = 5;
  const tx = [T_RABBIT, T_SCORP, T_PENG, T_SAL][b[5] || 0], sc = [.8, .62, .6, .6][b[5] || 0];
  const body = new PIXI.Sprite(tx); body.anchor.set(.5); body.scale.set(sc); c.addChild(sh, body); ents.addChild(c); c.alpha = 0;
  return SPR.attach({ c, body, sh, kind: 'r', ang: b[3] / 100, age: 0, hop: 0, crit: b[5] || 0, bs: sc }, ['rabbit', 'scorpion', 'penguin', 'salamander'][b[5] || 0] || 'rabbit');
}
const T_ALIEN = tex(84, 84, g => {
  g.translate(42, 42);
  g.strokeStyle = '#2a0c3c'; g.lineWidth = 4; g.lineCap = 'round';
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + .2; g.beginPath(); g.moveTo(Math.cos(a) * 10, Math.sin(a) * 10); g.lineTo(Math.cos(a + .25) * 28, Math.sin(a + .25) * 28); g.lineTo(Math.cos(a) * 38, Math.sin(a) * 38); g.stroke(); }
  const gr = g.createRadialGradient(-4, -4, 2, 0, 0, 24); gr.addColorStop(0, '#b45fe0'); gr.addColorStop(.6, '#6b2191'); gr.addColorStop(1, '#2e0b46');
  g.fillStyle = gr; circ(g, 0, 0, 24); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = 'rgba(0,0,0,.25)'; circ(g, -8, 6, 6); circ(g, -4, -10, 4);
  g.fillStyle = '#d4ff3a'; circ(g, 12, -7, 3.4); circ(g, 12, 7, 3.4);
});

// ---------- renderer ----------
const app = new PIXI.Application({ resizeTo: window, backgroundColor: 0x0d2a40, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
document.body.insertBefore(app.view, document.body.firstChild);
app.view.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
const stage = app.stage;
let W = innerWidth, H = innerHeight, Z = 1;

const WATER_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vTextureCoord;
uniform float uTime; uniform vec2 uCam; uniform vec2 uRes; uniform float uZoom; uniform vec4 uIs[12]; uniform float uSh[12];
float shapeK(float a,float s){return s==0.?1.:1.+.17*sin(2.*a+s*2.1)+.11*sin(3.*a+s*3.7)+.06*sin(5.*a+s*1.3);}
float edgeI(float a,float r,float s,float ss){return r*shapeK(a,ss)+16.*sin(3.*a+1.3+s)+9.*sin(7.*a+.4+s*2.)+5.*sin(13.*a+2.1+s*3.);}
void main(){
  vec2 px=(vTextureCoord-.5)*uRes;
  vec2 p=uCam+px/uZoom;
  float d=1e9;
  for(int i=0;i<12;i++){vec2 q=p-uIs[i].xy;d=min(d,length(q)-edgeI(atan(q.y,q.x),uIs[i].z,uIs[i].w,uSh[i]));}
  float t=uTime;
  float w=(sin(p.x*.045+t*.9)+sin(p.y*.05-t*1.1)+sin((p.x*.7+p.y)*.03+t*.6)+sin(length(p)*.06-t*1.4))*.25;
  vec3 deep=vec3(.03,.13,.24),mid=vec3(.07,.33,.46),shallow=vec3(.22,.62,.62);
  float k=clamp(d/260.,0.,1.);
  vec3 c=mix(shallow,mid,smoothstep(0.,.35,k)); c=mix(c,deep,smoothstep(.25,1.,k));
  c+=vec3(.04,.07,.09)*w;
  float g=smoothstep(.5,.95,w+.12*sin(p.x*.2+t*2.)*sin(p.y*.2-t*1.7));
  c+=vec3(.5,.7,.8)*g*.1*(1.-k*.6);
  float f1=exp(-pow((d-(10.+7.*sin(t*1.2)))/7.,2.));
  float f2=exp(-pow((d-(34.+10.*sin(t*1.2+1.5)))/5.,2.))*.55*(.5+.5*sin(p.x*.08+p.y*.06+t));
  c=mix(c,vec3(.93,.98,1.),clamp(f1*.85+f2,0.,1.));
  gl_FragColor=vec4(c,1.);
}`;
const water = new PIXI.Sprite(PIXI.Texture.WHITE);
const waterF = new PIXI.Filter(undefined, WATER_FRAG, { uTime: 0, uCam: [0, 0], uRes: [W, H], uZoom: 1, uIs: new Float32Array(48), uSh: new Float32Array(12) });
water.filters = [waterF]; stage.addChild(water);

const world = new PIXI.Container(), overL = new PIXI.Container();
const ground = new PIXI.Container(), ents = new PIXI.Container(), pfx = new PIXI.Container();
ents.sortableChildren = true; world.addChild(ground, pfx, ents); stage.addChild(world);

// lighting: dark layer rendered to a half-res texture with erased holes
const LS = .5; let rt = null; const lightCont = new PIXI.Container(), darkBase = new PIXI.Sprite(PIXI.Texture.WHITE), lightSpr = new PIXI.Sprite();
lightCont.addChild(darkBase); const lightPool = [];
function getLight(i) { if (!lightPool[i]) { const s = new PIXI.Sprite(T_LIGHT); s.anchor.set(.5); s.blendMode = BM.ERASE; lightCont.addChild(s); lightPool[i] = s; } return lightPool[i]; }
stage.addChild(lightSpr);
const fogC = new PIXI.Container(); stage.addChild(fogC);
const fogs = []; for (let i = 0; i < 6; i++) { const s = new PIXI.Sprite(T_GLOW); s.anchor.set(.5); s.tint = 0x9db4dc; s.alpha = 0; s.ph = rnd(0, TAU); s.sp = rnd(.05, .12); s.sc = rnd(.9, 1.5); fogC.addChild(s); fogs.push(s); }
stage.addChild(overL);
// fireflies: fx/fy are fractions of the visible half-width/height, so they always span the screen at any zoom;
// the pool covers the widest view and only as many are shown as keep the density of ~22 per 760x760 world units
const FLY_MAX = 140, FLY_DENS = 22 / (760 * 760);
const flies = []; for (let i = 0; i < FLY_MAX; i++) { const s = new PIXI.Sprite(T_GLOW); s.anchor.set(.5); s.tint = 0xd8ff6a; s.blendMode = BM.ADD; s.scale.set(.14); s.fx = rnd(-1.08, 1.08); s.fy = rnd(-1.08, 1.08); s.ph = rnd(0, TAU); overL.addChild(s); flies.push(s); }

const UZ_MIN = .4 / .75, UZ_MAX = 1.8;   // furthest zoom-out shows 25% less than it used to (was .4)
let UZ = 0.85; try { const s = parseFloat(localStorage.getItem('in_zoom')); if (s > 0) UZ = Math.max(UZ_MIN, Math.min(UZ_MAX, s)); } catch (e) {}
function setZoom(v) { UZ = Math.max(UZ_MIN, Math.min(UZ_MAX, v)); try { localStorage.setItem('in_zoom', UZ); } catch (e) {} resize(); }
function resize() {
  W = innerWidth; H = innerHeight; Z = Math.min(W, H) / 620 * UZ;
  water.width = W; water.height = H; waterF.uniforms.uRes = [W, H]; waterF.uniforms.uZoom = Z;
  if (rt) rt.destroy(true);
  rt = PIXI.RenderTexture.create({ width: Math.ceil(W * LS), height: Math.ceil(H * LS) });
  lightSpr.texture = rt; lightSpr.scale.set(1 / LS);
}
addEventListener('resize', resize); resize();
$('zoomIn').addEventListener('click', () => setZoom(UZ * 1.15)); $('zoomOut').addEventListener('click', () => setZoom(UZ / 1.15));

// ---------- world building (after server init) ----------
let resNodes = [], built = false, fireStones = null;
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const polyOf = fn => { const p = []; for (let i = 0; i < 200; i++) { const a = i / 200 * TAU, r = fn(a); p.push(Math.cos(a) * r, Math.sin(a) * r); } return p; };
const islandCs = [];   // outer island ground layers: big, so the ones off screen are skipped when drawing
function buildIsland(is, idx) {   // is = [x, y, radius, biome]: the quarter facing home is forest, the rest is the biome ('d' desert)
  const [ix, iy, R, biome, ss] = is, s = ss || idx * 1.7, RS = R * (ss ? RC.SHAPE_MAX : 1), ef = a => edgeJ(a, R, s, ss), c = new PIXI.Container(); c.position.set(ix, iy); ground.addChild(c); islandCs.push({ c, x: ix, y: iy, r: RS + 80 });
  const inF = (x, y) => RC.inForestPart(ix, iy, R, ix + x, iy + y);   // local coords
  const shore = new PIXI.Graphics(); shore.beginFill(0x9d8c58, .5); shore.drawPolygon(polyOf(a => ef(a) + 10)); shore.endFill(); c.addChild(shore);
  const sand = new PIXI.TilingSprite(biome === 's' ? T_SNOW : biome === 'l' ? T_BASALT : T_SAND, RS * 2 + 120, RS * 2 + 120); sand.position.set(-RS - 60, -RS - 60); if (biome === 'd') sand.tint = 0xf2c076;
  const sm = new PIXI.Graphics(); sm.beginFill(0xffffff); sm.drawPolygon(polyOf(ef)); sm.endFill(); sand.mask = sm; c.addChild(sm, sand);
  if (biome === 'm') {   // a mixed island: the half away from the side facing home (w < 0 across the home direction) is snow, the other half desert
    const [hx, hy] = RC.homeDir(ix, iy), kx = -hy, ky = hx, B = R * 2.4, hp = new PIXI.Graphics(); hp.beginFill(0xffffff);
    hp.drawPolygon([[-B, -B], [B, -B], [B, 0], [-B, 0]].flatMap(([t, w]) => [hx * t + kx * w, hy * t + ky * w])); hp.endFill();
    const snowC = new PIXI.Container(), sm2 = new PIXI.Graphics(); sm2.beginFill(0xffffff); sm2.drawPolygon(polyOf(ef)); sm2.endFill();
    const snow = new PIXI.TilingSprite(T_SNOW, RS * 2 + 120, RS * 2 + 120); snow.position.set(-RS - 60, -RS - 60); snow.mask = hp; snowC.addChild(snow, hp); snowC.mask = sm2; c.addChild(sm2, snowC);
    { const ro = new PIXI.Graphics(), r3 = mulberry(idx * 53 + 5);   // runoff along the snow/desert line: snow drifts onto the sand, sand blows onto the snow
      for (let i = 0; i < 700; i++) { const t = (r3() * 2 - 1) * R * .95, w = (r3() * 2 - 1) * 150, k = 1 - Math.abs(w) / 150; if (r3() > k * k) continue; const x = hx * t + kx * w, y = hy * t + ky * w; if (!(Math.hypot(x, y) < ef(Math.atan2(y, x)) - 60) || inF(x, y)) continue; ro.beginFill(w > 0 ? 0xf4f8fc : 0xe3c78a, w > 0 ? .6 : .55); ro.drawEllipse(x, y, 8 + r3() * 18, 4 + r3() * 9); ro.endFill(); }
      ro.mask = sm; c.addChild(ro); }
  }
  const rng = mulberry(idx * 977 + 13);
  if (biome === 'd') {   // desert: a few darker dunes, kept off the forest
    const dn = new PIXI.Graphics(); dn.beginFill(0xc99a4e, .25);
    for (let i = 0; i < Math.round(R / 40); i++) { const a = rng() * TAU, d = Math.sqrt(rng()) * (ef(a) - 120), x = Math.cos(a) * d, y = Math.sin(a) * d; if (!inF(x, y)) dn.drawEllipse(x, y, 40 + rng() * 70, 14 + rng() * 22); }
    dn.endFill(); dn.mask = sm; c.addChild(dn);
  }
  { // forest quarter: grass along the coast facing home, closed off by the (wavy) forest edge across the island
    const grassR = a => ef(a) - 55 + 10 * Math.sin(5 * a + .7 + s) + 6 * Math.sin(11 * a);
    const [ux, uy] = RC.homeDir(ix, iy), vx = -uy, vy = ux, h = Math.atan2(uy, ux), pts = [];
    let wA = null, wB = null;
    for (let i = 0; i <= 400; i++) {   // sweep the coast from one side of the home direction to the other, keeping the forest stretch
      const a = h - Math.PI + i / 400 * TAU, r = grassR(a), x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (!inF(x, y)) continue; const w = (x * vx + y * vy) / R; if (wA === null) wA = w; wB = w; pts.push(x, y);
    }
    if (pts.length > 4) {
      for (let i = 0; i <= 60; i++) { const w = wB + (wA - wB) * i / 60, t = RC.forestEdge(ix, iy, w); pts.push((ux * t + vx * w) * R, (uy * t + vy * w) * R); }
      const gr = new PIXI.TilingSprite(T_GRASS, RS * 2, RS * 2); gr.position.set(-RS, -RS);
      const gm = new PIXI.Graphics(); gm.beginFill(0xffffff); gm.drawPolygon(pts); gm.endFill(); gr.mask = gm;
      const rim = new PIXI.Graphics(); rim.lineStyle(10, 0x25552a, .35); rim.drawPolygon(pts); rim.mask = sm; c.addChild(gm, gr, rim);
    }
  }
  const N = Math.round(Math.PI * R * R * 4e-5 / 1.5);   // (half the home density: these islands are huge now)
  for (let i = 0; i < N; i++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * (ef(a) - 90), k = rng(), x = Math.cos(a) * d, y = Math.sin(a) * d, f = inF(x, y);
    const tx = f ? (k < .6 ? T_TUFT : k < .85 ? T_FLOWER : T_PEBBLE) : (k < .55 ? T_PEBBLE : T_TUFT);
    const sp = new PIXI.Sprite(tx); sp.anchor.set(.5, .9); sp.position.set(x, y); sp.scale.set(.8 + rng() * .6); sp.rotation = (rng() - .5) * .4;
    if (!f && biome === 'l') sp.tint = tx === T_TUFT ? 0x4a3036 : 0x7a5a50; else if (!f && biome === 'd' && tx === T_TUFT) sp.tint = 0xb59a58; else if (!f && biome === 's') sp.tint = tx === T_TUFT ? 0xdfe9f2 : 0xaab6c2; else if (tx === T_FLOWER) sp.tint = [0xffffff, 0xff8aa0, 0xffe066, 0xa0c4ff][i % 4];
    c.addChild(sp);
  }
}
function biomeAtPt(x, y) {   // 'f' forest, 's' snow, 'd' desert (null at sea) - the same rules as the server
  if (Math.hypot(x, y) < RR + 120) return RC.inSnow(x, y) ? 's' : 'f';
  for (const q of ISL) if (Math.hypot(x - q[0], y - q[1]) < q[2] * RC.SHAPE_MAX + 120 && inIsl(q, x, y, -120)) return RC.biomeAt(q[0], q[1], q[2], q[3], x, y);
  return null;
}
function nearBiome(x, y, want, dist = 130) {   // is there another biome ('want') within `dist` of this spot? (decor near a border picks up a bit of the neighbour)
  for (let k = 0; k < 8; k++) { const a = k * TAU / 8; for (const d of [dist * .5, dist]) if (biomeAtPt(x + Math.cos(a) * d, y + Math.sin(a) * d) === want) return true; }
  return false;
}
function borderDist(x, y, want, max) {   // roughly how far to the nearest 'want' ground (max if none close)
  for (let d = 12; d <= max; d += 12) for (let k = 0; k < 12; k++) { const a = k * TAU / 12; if (biomeAtPt(x + Math.cos(a) * d, y + Math.sin(a) * d) === want) return d; } return max;
}
function updateWaterIslands(cx, cy) {   // the water shader can draw 12 islands: give it the ones nearest the camera (home + the closest outer ones)
  const all = [[0, 0, RR, 0, 0, 0]].concat(ISL.map((s, i) => [s[0], s[1], s[2], (s[4] || (i + 1) * 1.7), s[4] || 0, 1]));
  const near = all.map(q => ({ q, d: Math.hypot(cx - q[0], cy - q[1]) - q[2] * RC.SHAPE_MAX })).sort((a, b) => a.d - b.d).slice(0, 12);
  const u = waterF.uniforms.uIs, sh = waterF.uniforms.uSh;
  for (let i = 0; i < 12; i++) { const e = near[i]; if (e) { u[i * 4] = e.q[0]; u[i * 4 + 1] = e.q[1]; u[i * 4 + 2] = e.q[2]; u[i * 4 + 3] = e.q[3]; sh[i] = e.q[4]; } else { u[i * 4] = 1e7; u[i * 4 + 1] = 0; u[i * 4 + 2] = -1e5; u[i * 4 + 3] = 0; sh[i] = 0; } }
  waterF.uniforms.uIs = u; waterF.uniforms.uSh = sh;
}
function buildWorld(list) {
  updateWaterIslands(0, 0);
  const poly = fn => { const p = []; for (let i = 0; i < 200; i++) { const a = i / 200 * TAU, r = fn(a); p.push(Math.cos(a) * r, Math.sin(a) * r); } return p; };
  const shore = new PIXI.Graphics(); shore.beginFill(0x9d8c58, .5); shore.drawPolygon(poly(a => edge(a) + 10)); shore.endFill(); ground.addChild(shore);
  const sand = new PIXI.TilingSprite(T_SAND, RR * 2 + 120, RR * 2 + 120); sand.position.set(-RR - 60, -RR - 60);
  const sm = new PIXI.Graphics(); sm.beginFill(0xffffff); sm.drawPolygon(poly(a => edge(a))); sm.endFill(); sand.mask = sm; ground.addChild(sm, sand);
  const grassR = a => edge(a) - 55 + 10 * Math.sin(5 * a + .7) + 6 * Math.sin(11 * a);
  const gr = new PIXI.TilingSprite(T_GRASS, RR * 2, RR * 2); gr.position.set(-RR, -RR);
  const gm = new PIXI.Graphics(); gm.beginFill(0xffffff); gm.drawPolygon(poly(grassR)); gm.endFill(); gr.mask = gm;
  const rim = new PIXI.Graphics(); rim.lineStyle(10, 0x25552a, .35); rim.drawPolygon(poly(a => grassR(a) - 4)); rim.lineStyle(0);
  ground.addChild(gm, gr, rim);
  {   // the snow quarter (same shape as RC.inSnow on the server): out along one wavy side, round the shore, back down the other side, round the inner edge
    const sa = RC.SNOW_A, out = a => edge(a) - 6, pts = [], side = sgn => { const o = []; for (let d = 300; d < RR + 300; d += 30) { const a = sa + sgn * RC.snowHalf(d); if (d < RC.snowIn(a)) continue; if (d > out(a)) break; o.push([a, d]); } return o; };
    const sp = side(1), sm2 = side(-1);
    for (const [a, d] of sp) pts.push(Math.cos(a) * d, Math.sin(a) * d);
    const a1 = sp[sp.length - 1][0], a2 = sm2[sm2.length - 1][0]; for (let i = 0; i <= 80; i++) { const a = a1 + (a2 - a1) * i / 80; pts.push(Math.cos(a) * out(a), Math.sin(a) * out(a)); }
    for (let i = sm2.length - 1; i >= 0; i--) { const [a, d] = sm2[i]; pts.push(Math.cos(a) * d, Math.sin(a) * d); }
    const b1 = sm2[0][0], b2 = sp[0][0]; for (let i = 0; i <= 40; i++) { const a = b1 + (b2 - b1) * i / 40; pts.push(Math.cos(a) * RC.snowIn(a), Math.sin(a) * RC.snowIn(a)); }
    const sn = new PIXI.TilingSprite(T_SNOW, RR * 2, RR * 2); sn.position.set(-RR, -RR);
    const snm = new PIXI.Graphics(); snm.beginFill(0xffffff); snm.drawPolygon(pts); snm.endFill(); sn.mask = snm;
    const srim = new PIXI.Graphics(); srim.lineStyle(14, 0xffffff, .35); srim.drawPolygon(pts); srim.lineStyle(5, 0xb9cde0, .4); srim.drawPolygon(pts);
    ground.addChild(snm, sn, srim);
  }
  {   // snow blowing out of the snow quarter onto the grass: scattered white patches that thin out with distance
    const ro = new PIXI.Graphics(), r2 = mulberry(31); ro.beginFill(0xf2f7fc, .55);
    for (let i = 0; i < 1400; i++) {
      const a = RC.SNOW_A + (r2() - .5) * 2.4, d = 1000 + r2() * (RR - 1100), x = Math.cos(a) * d, y = Math.sin(a) * d; if (RC.inSnow(x, y)) continue;
      const bd = borderDist(x, y, 's', 140); if (bd >= 140 || r2() > 1 - bd / 140) continue;
      ro.drawEllipse(x, y, 7 + r2() * 15, 4 + r2() * 8);
    }
    ro.endFill(); ro.mask = sm; ground.addChild(ro);
  }
  const dirt = new PIXI.Graphics(); dirt.beginFill(0x5e4526, .5); dirt.drawCircle(0, 0, 78); dirt.beginFill(0x3d2c17, .55); dirt.drawCircle(0, 0, 46); dirt.endFill(); ground.addChild(dirt);
  const rng = mulberry(7), N = Math.round(320 * (RR / 900) * (RR / 900) / 1.5);
  const pcs = [T_TUFT, T_FLOWER, T_PEBBLE].map(() => { const pc = new PIXI.ParticleContainer(8000, { position: true, rotation: true, scale: true, tint: true }); ground.addChild(pc); return pc; });
  for (let i = 0; i < N; i++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * (RR - 110); if (d < 90) continue;
    const k = rng(), x = Math.cos(a) * d, y = Math.sin(a) * d, snow = RC.inSnow(x, y); let ti = k < .6 ? 0 : k < .85 ? 1 : 2; if (snow && ti === 1) ti = 2;   // no flowers in the snow
    const sp = new PIXI.Sprite([T_TUFT, T_FLOWER, T_PEBBLE][ti]);
    sp.anchor.set(.5, .9); sp.position.set(x, y); sp.scale.set(.8 + rng() * .6); sp.rotation = (rng() - .5) * .4;
    if (snow) sp.tint = ti === 0 ? 0xdfe9f2 : 0xaab6c2; else if (ti === 1) sp.tint = [0xffffff, 0xff8aa0, 0xffe066, 0xa0c4ff][i % 4];
    pcs[ti].addChild(sp);
  }
  // fire pit stones
  { const stones = []; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, s = new PIXI.Sprite(T_ROCK); s.anchor.set(.5, .8); s.scale.set(.26); s.position.set(Math.cos(a) * 30, Math.sin(a) * 30 + 4); s.zIndex = s.y; s.tint = 0xbbbbbb; ents.addChild(s); stones.push(s); } SPR.pit(0, 0, stones); }   // (replaced by the campfire picture once it has loaded)
  ISL.forEach((is, i) => buildIsland(is, i + 1));
  // resources
  list.forEach((r, i) => {
    const c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); c.addChild(sh);
    let s;
    if (r[0] === 'p') { s = new PIXI.Sprite(T_PINE); if (nearBiome(r[1], r[2], 'd')) s.tint = 0xe9d8ac; s.anchor.set(.5, .9); s.scale.set(.66 + (i % 5) * .03); sh.scale.set(1.6, .75); sh.y = 4; }
    else if (r[0] === 't') { s = new PIXI.Sprite(nearBiome(r[1], r[2], 's') ? T_TREE_S : T_TREE); s.anchor.set(.5, .88); s.scale.set(.62 + (i % 5) * .03); sh.scale.set(1.7, .8); sh.y = 4; }
    else if (r[0] === 'c') { s = new PIXI.Sprite(nearBiome(r[1], r[2], 's') ? T_CACTUS_S : T_CACTUS); s.anchor.set(.5, .9); s.scale.set(.62 + (i % 5) * .03); sh.scale.set(1.1, .6); sh.y = 4; }
    else if (r[0] === 'r' || r[0] === 'g') { s = new PIXI.Sprite(r[0] === 'g' ? T_GOLDV : T_ROCK); if (r[0] === 'r' && biomeAtPt(r[1], r[2]) === 'l') s.tint = 0x6e5a60; s.anchor.set(.5, .8); s.scale.set(.6); sh.scale.set(1.1, .6); sh.y = 4; }
    else { s = new PIXI.Sprite(T_BUSH); s.anchor.set(.5, .8); s.scale.set(.62); sh.scale.set(1, .5); sh.y = 4; }
    c.addChild(s); c.position.set(r[1], r[2]); c.zIndex = r[2];   // (attached to the scene only while near the camera: see the cull loop)
    const mhp = RHP[r[0]] || 1, bar = null;
    resNodes.push({ c, s, k: r[0], x: r[1], y: r[2], pop: 1, hp: mhp, mhp, bar, barT: 0, shake: 0, ph: rnd(0, TAU), base: s.scale.x });
  });
  built = true;
}

// campfire visuals (above darkness)
const flames = [0, 1, 2].map(i => { const s = new PIXI.Sprite(T_FLAME); s.anchor.set(.5, .9); s.blendMode = BM.ADD; overL.addChild(s); return s; });
const fireTip = new PIXI.Text('', { fontFamily: 'system-ui,sans-serif', fontSize: 16, fontWeight: '800', fill: 0xffffff, stroke: 0x000000, strokeThickness: 4, align: 'center' }); fireTip.anchor.set(.5, 1); fireTip.resolution = 2; fireTip.position.set(0, -78); fireTip.visible = false; overL.addChild(fireTip);
const fireGlow = new PIXI.Sprite(T_GLOW); fireGlow.anchor.set(.5); fireGlow.blendMode = BM.ADD; fireGlow.tint = 0xff8a30; overL.addChildAt(fireGlow, 0);
const ring = new PIXI.Sprite(T_RING); ring.anchor.set(.5); ring.blendMode = BM.ADD; ring.tint = 0xffc266; overL.addChildAt(ring, 0);

// ---------- particles ----------
const parts = [];
function emit(layer, t, x, y, vx, vy, life, s0, s1, col, a0, add, g) {
  const s = new PIXI.Sprite(t); s.anchor.set(.5); s.position.set(x, y); s.tint = col; s.blendMode = add ? BM.ADD : BM.NORMAL; s.scale.set(s0); layer.addChild(s);
  parts.push({ s, vx, vy, life, max: life, s0, s1, a0, g: g || 0 });
}
function burst(x, y, n, col, speed, add, size) { for (let i = 0; i < n; i++) { const a = rnd(0, TAU), v = rnd(.3, 1) * speed; emit(add ? overL : pfx, T_GLOW, x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(.3, .6), size || .12, 0, col, 1, add, 0); } }
const T_LEAF = tex(16, 10, g => { g.fillStyle = '#5fae3c'; g.beginPath(); g.ellipse(8, 5, 7, 3.5, 0, 0, TAU); g.fill(); g.strokeStyle = '#2f6a22'; g.lineWidth = 1; g.beginPath(); g.moveTo(2, 5); g.lineTo(14, 5); g.stroke(); });
const bushHit = new Map(), bushList = { n: -1, a: [] };   // bush node -> time it last rustled, so walking through does not spam
function rustleBushes(e, sp) {   // anyone brushing a berry bush sets it rustling: a swishing sound and a few leaves flying out
  const now = performance.now(); if (sp < 25) return;
  if (bushList.n !== resNodes.length) { bushList.n = resNodes.length; bushList.a = resNodes.filter(r => r.k === 'b'); }
  for (const r of bushList.a) { if (r.hp <= 0 || Math.abs(r.x - e.x) > 34 || Math.abs(r.y - e.y) > 34 || Math.hypot(r.x - e.x, r.y - e.y) > 30) continue;
    if (now - (bushHit.get(r) || 0) < 700) continue; bushHit.set(r, now); r.shake = .25;
    const me = ents2['p' + myId], d = me ? Math.hypot(r.x - me.x, r.y - me.y) : 0; SFX.rustle(d, me ? r.x - me.x : 0);
    for (let i = 0; i < 4; i++) { const a = rnd(0, TAU), v = rnd(70, 150); emit(pfx, T_LEAF, r.x, r.y - 14, Math.cos(a) * v, Math.sin(a) * v - 70, rnd(.45, .8), rnd(.8, 1.1), .25, [0x5fae3c, 0x7cb342, 0x4a9a3a][i % 3], 1, false, 260); } }
}
function stepParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { p.s.destroy(); parts.splice(i, 1); continue; }
    const k = 1 - p.life / p.max; p.s.x += p.vx * dt; p.s.y += p.vy * dt; p.vy += p.g * dt; p.s.scale.set(p.s0 + (p.s1 - p.s0) * k); p.s.alpha = p.a0 * (1 - k);
  }
}
function floatText(x, y, txt, col) {
  const t = new PIXI.Text(txt, { fontFamily: 'system-ui,sans-serif', fontSize: 16, fontWeight: '800', fill: col, stroke: 0x000000, strokeThickness: 4 });
  t.anchor.set(.5); t.position.set(x, y - 30); t.resolution = 2; overL.addChild(t); ftexts.push({ t, life: 1.1 });
}
const ftexts = [];

// ---------- entities ----------
let warnUntil = 0, lastMe = null, noticeUntil = 0, noticeText = '';
function notice(t) { noticeText = t; noticeUntil = performance.now() + 3000; }   // one-shot headline text, shown for 3 seconds
let S = null, myId = 0, roomCode = '', tipUntil = 0, ws = null, T = 0, shake = 0, lastInv = null, lastHp = null;
const ents2 = {}; // key -> {x,y,tx,ty,node...}
function mkPlayer(p) {
  const c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(.8, .5); sh.y = 8; sh.alpha = .9;
  const body = new PIXI.Sprite(T_PL[p[2]]); body.anchor.set(.5); body.scale.set(.85);
  const name = new PIXI.Text(p[1], { fontFamily: 'system-ui,sans-serif', fontSize: 13, fontWeight: '700', fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 }); name.anchor.set(.5, 1); name.y = -30; name.resolution = 2;
  const nb = new PIXI.Text('', { fontFamily: 'system-ui,sans-serif', fontSize: 13, fontWeight: '800', fill: 0x4fc3f7, stroke: 0x000000, strokeThickness: 3 }); nb.anchor.set(1, 1); nb.y = -30; nb.resolution = 2;   // most nights survived in one run, in blue, left of the name
  const hp = new PIXI.Graphics(); hp.y = -27; const sta = new PIXI.Graphics(); sta.y = 28; sta.visible = false;   // health bar above the head, stamina bar below the feet
  const tool = new PIXI.Sprite(T_AXE); tool.anchor.set(.08, .5); tool.scale.set(.62); tool.visible = false;
  c.addChild(sh, body, tool, name, nb, hp, sta); ents.addChild(c);
  return SPR.attach({ c, body, tool, name, nb, hp, sta, stv: 100, ang: Math.PI / 2, lh: -1, ld: -1, dust: 0, kind: 'p', sw: p[12], swing: null }, 'cls_' + p[2]);
}
// per-kind look: 0 = normal alien, 1 = brute (every 5th night), 2 = the Charger (3x a normal alien)
const AK = {
  0: { sc: .5, eo: 10, es: 6, hpW: 26, hpY: -26, shX: 1, shY: .55, eye: .24, tint: 0xffffff, eyeCol: 0xc6ff2a },
  1: { sc: .95, eo: 20, es: 12, hpW: 50, hpY: -42, shX: 1.8, shY: .9, eye: .42, tint: 0xff9ad0, eyeCol: 0xc6ff2a },
  2: { sc: 1.5, eo: 31, es: 18, hpW: 96, hpY: -78, shX: 3.4, shY: 1.4, eye: .72, tint: 0xff7043, eyeCol: 0xff2a2a },
  3: { sc: .85, eo: 0, es: 0, hpW: 34, hpY: -32, shX: .8, shY: .5, eye: 0, tint: 0xffffff, eyeCol: 0, human: true },   // raiding villager (melee)
  4: { sc: .85, eo: 0, es: 0, hpW: 34, hpY: -32, shX: .8, shY: .5, eye: 0, tint: 0xffffff, eyeCol: 0, human: true },   // raiding villager (archer)
  5: { sc: .9, eo: 0, es: 0, hpW: 34, hpY: -34, shX: .85, shY: .5, eye: 0, tint: 0xffffff, eyeCol: 0, human: true },   // cult mage
  6: { sc: 1.05, eo: 0, es: 0, hpW: 46, hpY: -40, shX: 1, shY: .6, eye: 0, tint: 0xffffff, eyeCol: 0, human: true },   // cult zealot
};
const T_VIL = { 3: PIXI.Texture.from(mkPlayerCanvas(['#b0432f', '#7a2a1c', '#3e2723', 'sword'])), 4: PIXI.Texture.from(mkPlayerCanvas(['#5d8f3a', '#33691e', '#3e2723', 'bow'])), 5: PIXI.Texture.from(mkPlayerCanvas(['#5a1424', '#2e0b14', '#1d0d12', 'cultstaff', null, 'hood'])), 6: PIXI.Texture.from(mkPlayerCanvas(['#3d3237', '#1f171a', '#261519', 'cultshield', null, 'hood'])) };
const T_ARROW = tex(40, 8, g => { g.fillStyle = '#c9a66b'; g.fillRect(2, 3, 28, 2); g.fillStyle = '#e0e0e0'; poly(g, '#e0e0e0', [38, 4, 29, 0, 29, 8]); g.fillStyle = '#d32f2f'; g.fillRect(0, 1, 6, 2); g.fillRect(0, 5, 6, 2); });
function mkAlien(a) {
  const ak = a[9] ? Object.assign({}, AK[0], { sc: .6, tint: 0x8dff7a, eyeCol: 0xffe600, eye: .3, hpW: 30 }) : (AK[a[5]] || AK[0]), c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(ak.shX, ak.shY); sh.y = a[5] === 2 ? 14 : 6;
  const body = new PIXI.Sprite(ak.human ? T_VIL[a[5]] : T_ALIEN); body.anchor.set(.5); body.scale.set(ak.sc); body.tint = ak.tint;
  const hp = new PIXI.Graphics(); c.addChild(sh, body, hp); ents.addChild(c); c.alpha = 0;
  const eyes = (ak.human ? [] : [0, 1]).map(() => { const s = new PIXI.Sprite(T_GLOW); s.anchor.set(.5); s.tint = ak.eyeCol; s.blendMode = BM.ADD; s.scale.set(ak.eye); overL.addChild(s); return s; });
  return SPR.attach({ c, body, hp, eyes, sc: ak.sc, ak, big: a[5] > 0, charger: a[5] === 2, ang: 0, age: 0, lh: -1, kind: 'a', flash: 0, trail: 0 }, a[9] ? 'spitter' : ['alien', 'brute', 'charger', 'villager', 'villager', 'mage', 'zealot'][a[5]] || 'alien');
}
function drawHp(g, w, f, col) { g.clear(); g.beginFill(0x000000, .55); g.drawRoundedRect(-w / 2, 0, w, 5, 2); g.endFill(); g.beginFill(col); g.drawRoundedRect(-w / 2, 0, Math.max(0, w * f), 5, 2); g.endFill(); }
function angLerp(a, b, k) { let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * k; }

// ---- swing / hit / fall / crumble / pickup effects ----
const ease = u => u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
function startSwing(e, p, d, dx) {
  const kind = p[13], ang = p[14] / 100;
  e.swing = { t: 0, kind, ang, hit: false }; e.ang = ang;
  if (kind === 1) e.tool.texture = T_AXE; else if (kind === 2) e.tool.texture = T_PICK; else if (kind === 4) e.tool.texture = T_BLADE; else if (kind === 5) e.tool.texture = T_SPEARP;
  e.tool.anchor.set(kind === 5 ? .16 : .08, .5); e.tool.scale.set(kind === 5 ? .3 : .62);
  SPR.tool(e.tool, kind); e.tool.visible = kind !== 3; SFX.whoosh(d, dx);
}
function pokeOff(t) {   // spear poke: pull back, shoot forward, slide back
  if (t < .12) return -10 * ease(t / .12);
  if (t < .2) { const u = (t - .12) / .08; return -10 + 38 * u; }
  return 28 * (1 - ease(Math.min(1, (t - .2) / .22)));
}
function swingOff(t) {   // relative tool angle: wind-up back, fast strike, recover
  if (t < .14) return .3 - 1.8 * ease(t / .14);
  if (t < .26) { const u = (t - .14) / .12; return -1.5 + 2.4 * u * u; }
  return .9 - .6 * ease(Math.min(1, (t - .26) / .16));
}
function drawPips(r) {
  const g = r.bar || (r.bar = r.c.addChild(new PIXI.Graphics())); g.clear(); if (r.hp <= 0 || r.hp >= r.mhp && r.barT <= 0) { return; }
  const w = 9, gap = 3, tot = r.mhp * w + (r.mhp - 1) * gap, y = -(r.s.height * r.s.anchor.y) - 14;
  g.beginFill(0x000000, .55); g.drawRoundedRect(-tot / 2 - 3, y - 3, tot + 6, 11, 4); g.endFill();
  for (let i = 0; i < r.mhp; i++) { g.beginFill(i < r.hp ? (WOODY(r.k) ? 0x7bd37b : r.k === 'g' ? 0xffd54f : 0xcfd8dc) : 0x444444); g.drawRoundedRect(-tot / 2 + i * (w + gap), y, w, 5, 2); g.endFill(); }
}
function hitFx(r, d, dx) {
  r.shake = .32; r.barT = 1.6;
  if (WOODY(r.k)) { SFX.chop(d, dx); burst(r.x, r.y - 30, 6, r.k === 'p' ? 0xf4f8ff : 0x6fcf6a, 90, false, .11); burst(r.x, r.y - 6, 5, 0xb98349, 80, false, .09); for (let i = 0; i < 4; i++) emit(pfx, T_GLOW, r.x + rnd(-14, 14), r.y - rnd(40, 70), rnd(-30, 30), rnd(20, 60), rnd(.8, 1.3), .09, .05, 0x4caf50, .9, false, 40); }
  else { SFX.mine(d, dx); burst(r.x, r.y - 8, 8, r.k === 'g' ? 0xf2c443 : 0xc5cbd3, 130, false, .1); burst(r.x, r.y - 10, 4, 0xfff59d, 90, true, .08); }
}
const fallers = [];
function breakFx(r, fromX, d, dx) {
  r.c.visible = false; if (r.bar) r.bar.clear();
  if (WOODY(r.k)) {
    const spr = new PIXI.Sprite(r.s.texture); spr.anchor.copyFrom(r.s.anchor); spr.tint = r.s.tint; spr.position.set(r.x, r.y); spr.scale.set(r.s.scale.x); spr.zIndex = r.y; ents.addChild(spr);
    const sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(1.7, .8); sh.position.set(r.x, r.y + 4); sh.zIndex = r.y - 1; ents.addChild(sh);
    fallers.push({ k: 't', spr, sh, t: 0, dir: r.x >= fromX ? 1 : -1, r, landed: false, d, dx });
  } else {
    const spr = new PIXI.Sprite(r.s.texture); spr.anchor.copyFrom(r.s.anchor); spr.tint = r.s.tint; spr.position.set(r.x, r.y); spr.scale.set(r.base); spr.zIndex = r.y; ents.addChild(spr);
    SFX.rockbreak(d, dx); shake = Math.max(shake, .08);
    burst(r.x, r.y - 8, 14, 0xaab0b8, 170, false, .16); burst(r.x, r.y - 10, 8, 0x8d939b, 120, false, .2);
    for (let i = 0; i < 7; i++) emit(pfx, T_STONE, r.x, r.y - 10, rnd(-110, 110), rnd(-150, -40), rnd(.5, .8), .5, .3, 0xffffff, 1, false, 420);
    fallers.push({ k: 'r', spr, t: 0 });
  }
}
function stepFallers(dt) {
  for (let i = fallers.length - 1; i >= 0; i--) {
    const f = fallers[i]; f.t += dt;
    if (f.k === 't') {
      const D = .85;
      if (f.t < D) {
        const u = f.t / D, a = f.dir * 1.5 * Math.pow(u, 2.3); f.spr.rotation = a; f.spr.skew.x = 0;
        if (Math.random() < dt * 14) emit(pfx, T_GLOW, f.r.x + f.dir * Math.sin(a) * 70 * f.spr.scale.x * 1.6, f.r.y - Math.cos(a) * 70 * f.spr.scale.x * 1.6, rnd(-20, 20), rnd(10, 50), rnd(.6, 1), .1, .05, 0x4caf50, .9, false, 90);
      } else {
        if (!f.landed) {
          f.landed = true; f.spr.rotation = f.dir * 1.5; SFX.treefall(f.d, f.dx); shake = Math.max(shake, .22);
          const tx = f.r.x + f.dir * 95 * f.spr.scale.x * 1.4;
          for (let j = 0; j < 12; j++) emit(pfx, T_GLOW, tx + rnd(-30, 30), f.r.y + rnd(-6, 10), rnd(-60, 60), rnd(-40, 10), rnd(.5, .9), .2, .5, 0xd9c79a, .5, false, 0);
          burst(tx, f.r.y - 10, 10, 0x5fbf5a, 120, false, .13);
        }
        const u = (f.t - D) / .7; f.spr.alpha = Math.max(0, 1 - Math.max(0, u - .35) / .65); f.sh.alpha = f.spr.alpha;
        if (u >= 1) { f.spr.destroy(); f.sh.destroy(); fallers.splice(i, 1); }
      }
    } else {
      const u = f.t / .38; f.spr.scale.set(f.spr.scale.x * (1 - dt * 7)); f.spr.alpha = Math.max(0, 1 - u); f.spr.x += rnd(-1.5, 1.5);
      if (u >= 1) { f.spr.destroy(); fallers.splice(i, 1); }
    }
  }
}

// ground pickups (logs from trees, stones from rocks): hop out, bob, fly to the player that grabs them
const dropE = {}, flyers = [], DROP_S = { w: .8, s: .85, m: .9, f: .75, d: .9, q: 1, n: .8, o: .85, h: .9, H: 1 };
function syncDrops(m, _d, _dx) {
  const seen = {};
  for (const d of m.dr || []) {
    seen[d[0]] = 1; let e = dropE[d[0]];
    if (!e) {
      const c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(.6, .35); sh.y = 4;
      const spr = d[1] === 'q' ? Object.assign(new PIXI.Text((RC.ITEM_BY[d[4]] || {}).e || '🍲', { fontSize: 30 }), { resolution: 2 }) : new PIXI.Sprite(d[1] === 'w' ? T_LOG : d[1] === 'm' ? T_SCRAP : d[1] === 'f' ? T_BERRY : d[1] === 'd' ? T_GEM : d[1] === 'n' ? SPR.get('steak') || T_MEAT : d[1] === 'o' ? T_ORE : d[1] === 'h' ? T_PELT : d[1] === 'H' ? T_APELT : T_STONE); spr.anchor.set(.5); spr.scale.set(DROP_S[d[1]]); spr.rotation = d[1] === 'w' ? rnd(-.8, .8) : rnd(-.4, .4);
      c.addChild(sh, spr); c.position.set(d[2], d[3]); c.zIndex = d[3]; ents.addChild(c);
      e = dropE[d[0]] = { c, spr, sh, x: d[2], y: d[3], t: 0, ph: rnd(0, TAU), k: d[1], dur: d[1] === 'm' || d[1] === 'q' ? .5 : .35, ds: d[1] === 'n' && spr.texture !== T_MEAT ? 27 / spr.texture.width : DROP_S[d[1]] };
      if (d[1] === 'm' || (d[1] === 'q' && d[4] !== 'foot')) {   // metal scrap jumps out of the nearest smelter; cooked food pops out of the nearest pot
        let bs = null, bd = 160; for (const id in structE) { const st = structE[id]; if (st.k !== (d[1] === 'q' ? 'pot' : 'smelter')) continue; const dd = Math.hypot(st.x - d[2], st.y - d[3]); if (dd < bd) { bd = dd; bs = st; } }
        if (bs) e.from = { x: bs.x, y: bs.y - 18 }; const me = ents2['p' + myId], dm = me ? Math.hypot(me.x - d[2], me.y - d[3]) : 0; if (d[1] === 'm') SFX.smeltDone(dm, me ? d[2] - me.x : 0);
      }
      overGlow(e);
    }
  }
  for (const id in dropE) if (!seen[id]) {
    const e = dropE[id]; delete dropE[id];
    let best = null, bd = 90; for (const p of m.p) { const dd = Math.hypot(p[3] - e.x, p[4] - e.y); if (dd < bd) { bd = dd; best = p; } }
    if (best) { flyers.push({ c: e.c, t: 0, fx: e.x, fy: e.y, pid: best[0] }); if (best[0] === myId) SFX.pickup(); }
    else { e.c.destroy({ children: true }); }
  }
}
function overGlow(e) { /* small sparkle when a pickup appears */ emit(overL, T_GLOW, e.x, e.y - 6, 0, -20, .5, .16, .02, e.k === 'w' ? 0xffd9a0 : e.k === 'f' ? 0xffb3b3 : e.k === 'd' ? 0x7fe9ff : e.k === 'q' ? 0xffe9a8 : 0xdfe8f5, .8, true, 0); }
function stepDrops(dt) {
  for (const id in dropE) {
    const e = dropE[id]; e.t += dt; const u = Math.min(1, e.t / e.dur), hop = Math.sin(u * Math.PI) * (e.from ? 46 : 26) * (1 - u * .3);
    if (e.from && u < 1) { e.c.x = e.from.x + (e.x - e.from.x) * u; e.c.y = e.from.y + (e.y - e.from.y) * u; } else if (e.from) { e.c.x = e.x; e.c.y = e.y; }
    e.spr.y = -hop + Math.sin(T * 3 + e.ph) * 1.2 * (u >= 1 ? 1 : 0); e.spr.rotation += e.from && u < 1 ? dt * 14 : 0; e.spr.scale.set(e.ds * (.3 + .7 * Math.min(1, u * 1.6))); e.sh.alpha = .4 + .5 * u;
  }
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i]; f.t += dt; const u = Math.min(1, f.t / .2), pe = ents2['p' + f.pid];
    if (pe) { f.c.x = f.fx + (pe.x - f.fx) * u * u; f.c.y = f.fy + (pe.y - f.fy) * u * u - Math.sin(u * Math.PI) * 14; }
    f.c.scale.set(1 - .6 * u); f.c.alpha = 1 - u * .6;
    if (u >= 1) { f.c.destroy({ children: true }); flyers.splice(i, 1); }
  }
}

// ---- villager arrows and archers' aim lines ----
const arrowE = {}, aimG = new PIXI.Graphics(); pfx.addChild(aimG);
function syncArrows(m) {
  const seen = {}, now = performance.now();
  for (const w of m.ar || []) {
    seen[w[0]] = 1; let e = arrowE[w[0]];
    if (!e) { const slow = w[4] === 1, fb = w[4] === 2; let s;
      if (fb) {   // a cult mage's fireball: a hot white-yellow core, an orange flame body and a red glow that flickers
        s = new PIXI.Container(); const gl = new PIXI.Sprite(T_GLOW); gl.anchor.set(.5); gl.scale.set(.85); gl.tint = 0xff5a1f; gl.blendMode = BM.ADD; gl.alpha = .75;
        const g = new PIXI.Graphics(); g.beginFill(0xff4a12, .95).drawCircle(0, 0, 12).endFill(); g.beginFill(0xff9a2e).drawCircle(0, 0, 8.5).endFill(); g.beginFill(0xffe9a0).drawCircle(-1, -1, 4.5).endFill();
        s.addChild(gl, g);
      } else if (slow) {   // the spitter's slow shot: a solid acid-green blob with a dark rim and a bright core, so it reads clearly against any ground
        s = new PIXI.Container(); const gl = new PIXI.Sprite(T_GLOW); gl.anchor.set(.5); gl.scale.set(.5); gl.tint = 0x9dff4a; gl.blendMode = BM.ADD; gl.alpha = .55;
        const g = new PIXI.Graphics(); g.lineStyle(3, 0x0d3b0d, 1).beginFill(0x6fdc1e).drawCircle(0, 0, 10).endFill(); g.lineStyle(0).beginFill(0xd4ff7a, .95).drawCircle(-3, -3, 4).endFill(); g.beginFill(0x2e7d12, .8).drawCircle(4, 4, 3).endFill();
        s.addChild(gl, g);
      } else { s = new PIXI.Sprite(T_ARROW); s.anchor.set(.9, .5); s.scale.set(.9); } ents.addChild(s); e = arrowE[w[0]] = { s, slow, fb }; }
    e.x = w[1]; e.y = w[2]; e.a = w[3] / 100; e.t0 = now; if (!e.slow && !e.fb) e.s.rotation = e.a;
  }
  for (const id in arrowE) if (!seen[id]) { arrowE[id].s.destroy(); delete arrowE[id]; }
}
function stepArrows() {
  const now = performance.now();
  for (const id in arrowE) { const e = arrowE[id], el = Math.min(.12, (now - e.t0) / 1000); { const v = e.fb ? 230 : e.slow ? 150 : 520; e.s.position.set(e.x + Math.cos(e.a) * v * el, e.y + Math.sin(e.a) * v * el); if (e.slow) { const pu = 1 + Math.sin(performance.now() / 90) * .12; e.s.scale.set(pu); } if (e.fb) { e.s.scale.set(1 + Math.sin(performance.now() / 45 + e.x) * .14); if (Math.random() < .7) emit(pfx, T_GLOW, e.s.x - Math.cos(e.a) * 10, e.s.y - Math.sin(e.a) * 10, rnd(-18, 18) - Math.cos(e.a) * 30, rnd(-18, 18) - Math.sin(e.a) * 30, .5, .16, .02, Math.random() < .5 ? 0xff7a1a : 0xffc04a, .8, true, 0); } } e.s.zIndex = e.s.y; }   // keep flying between snapshots
  aimG.clear();
  for (const k in ents2) { const e = ents2[k]; if (e.kind !== 'a' || !e.d || !(e.d[8] > 0)) continue; const f = e.d[8] / 100, a = e.d[6] != null ? e.d[6] / 100 : e.ang; aimG.lineStyle(1.5 + f * 2.5, 0xff5252, .25 + f * .55); aimG.moveTo(e.x, e.y); aimG.lineTo(e.x + Math.cos(a) * 300, e.y + Math.sin(a) * 300); }
}
// ---- boats (placed in the water; two riders; the first one steers) ----
const boatE = {};
function syncBoats(m) {
  const seen = {};
  for (const b of m.bt || []) {
    seen[b[0]] = 1; let e = boatE[b[0]];
    if (!e) {
      const c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5); sh.scale.set(2.2, 1); sh.alpha = .5;
      const bty = RC.BOATS[b[6]] || RC.BOATS.boat, sp = new PIXI.Sprite(T_BOAT); sp.anchor.set(.5); sp.scale.set(bty.sc); if (b[6] === 'sloop') sp.tint = 0xb8d4f0; else if (b[6] === 'galleon') sp.tint = 0xf0d48a; sh.scale.set(2.2 * bty.sc / .8, 1); c.addChild(sh, sp); ents.addChild(c);
      e = boatE[b[0]] = { c, sp, bk: b[6] || 'boat', x: b[1], y: b[2], tx: b[1], ty: b[2], ang: b[3] / 100, ta: b[3] / 100, ph: rnd(0, TAU) }; c.position.set(e.x, e.y);
    }
    e.tx = b[1]; e.ty = b[2]; e.ta = b[3] / 100; e.riders = b[4]; e.drv = b[5]; e.storm = b[8] || 0;
    const lf = b[7] == null ? 100 : b[7];   // how much of its life is left: the hull darkens and a bar shows once it is below half
    if (e.lf !== lf) { e.lf = lf; const base = b[6] === 'sloop' ? [0xb8, 0xd4, 0xf0] : b[6] === 'galleon' ? [0xf0, 0xd4, 0x8a] : [255, 255, 255], k = .45 + .55 * Math.min(1, lf / 60);
      e.sp.tint = (Math.round(base[0] * k) << 16) | (Math.round(base[1] * k * .9) << 8) | Math.round(base[2] * k * .8);
      if (!e.bar) { e.bar = new PIXI.Graphics(); e.c.addChild(e.bar); e.rl = 64 * (RC.BOATS[b[6]] || RC.BOATS.boat).sc; }   // the boat's health sits behind its stern
      e.bar.clear(); e.bar.beginFill(0x000000, .65); e.bar.drawRect(-22, -4, 44, 8); e.bar.endFill(); e.bar.beginFill(lf < 20 ? 0xff5252 : lf < 50 ? 0xffb74d : 0x66bb6a); e.bar.drawRect(-20, -2, 40 * lf / 100, 4); e.bar.endFill(); }
  }
  for (const id in boatE) if (!seen[id]) { boatE[id].c.destroy({ children: true }); delete boatE[id]; }
}
// ---- fishing pools (shimmering spots near the shore) and the fishing minigame ----
const poolE = {}, FISH = { 1: { n: 'Common fish', e: '🐟', col: 0x9fd8ff, zh: .34, fs: .55, chg: 1.6, fill: .30, drain: .10 }, 2: { n: 'Rare fish', e: '🐠', col: 0xc79bff, zh: .26, fs: .95, chg: 1.0, fill: .24, drain: .15 }, 3: { n: 'Legendary fish', e: '🐡', col: 0xffd54f, zh: .19, fs: 1.5, chg: .65, fill: .19, drain: .20 } };
let fishOpen = false, fishG = null;
const T_FIN = tex(46, 58, g => {   // a shark's dorsal fin sticking out of the water
  const gr = g.createLinearGradient(0, 0, 0, 58); gr.addColorStop(0, '#6f7f8f'); gr.addColorStop(1, '#2f3b48');
  g.fillStyle = gr; g.beginPath(); g.moveTo(8, 56); g.quadraticCurveTo(14, 20, 20, 2); g.quadraticCurveTo(26, 26, 42, 56); g.quadraticCurveTo(26, 48, 8, 56); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.5; g.stroke(); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(25, 56, 22, 3.5, 0, 0, TAU); g.fill();   // foam at the base
});
// a shark seen from above, nose to the right: torpedo body with counter-shading, swept pectoral fins, dorsal ridge, gill slits and eyes (the tail is a separate sprite so it can swish)
const T_SHARK = tex(260, 120, g => {
  const fin = (pts, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); g.strokeStyle = 'rgba(8,22,32,.7)'; g.lineWidth = 1.6; g.stroke(); };
  fin([168, 37, 124, 2, 146, 40], '#3b5565'); fin([168, 83, 124, 118, 146, 80], '#3b5565');          // pectoral fins
  fin([94, 42, 74, 24, 86, 44], '#3b5565'); fin([94, 78, 74, 96, 86, 76], '#3b5565');                // pelvic fins
  const body = () => { g.beginPath(); g.moveTo(254, 60); g.bezierCurveTo(238, 44, 206, 34, 160, 31); g.bezierCurveTo(110, 28, 70, 38, 40, 54); g.lineTo(28, 60); g.lineTo(40, 66); g.bezierCurveTo(70, 82, 110, 92, 160, 89); g.bezierCurveTo(206, 86, 238, 76, 254, 60); g.closePath(); };
  const gr = g.createLinearGradient(0, 28, 0, 92); gr.addColorStop(0, '#a9bfca'); gr.addColorStop(.22, '#6a8798'); gr.addColorStop(.5, '#34505f'); gr.addColorStop(.78, '#6a8798'); gr.addColorStop(1, '#a9bfca');
  body(); g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(8,22,32,.75)'; g.lineWidth = 2; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(232, 60); g.lineTo(46, 60); g.stroke();            // the pale line down the back
  g.strokeStyle = 'rgba(5,18,28,.45)'; g.lineWidth = 1.6; for (let i = 0; i < 5; i++) { const x = 188 - i * 6; g.beginPath(); g.moveTo(x, 38); g.quadraticCurveTo(x - 4, 43, x - 2, 49); g.stroke(); g.beginPath(); g.moveTo(x, 82); g.quadraticCurveTo(x - 4, 77, x - 2, 71); g.stroke(); }   // gill slits
  fin([150, 58, 104, 54, 112, 60, 104, 66, 150, 62], '#2a4150');                                       // dorsal fin, seen from above
  g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.ellipse(246, 60, 8, 4, 0, 0, TAU); g.fill();   // snout
  g.fillStyle = '#05121a'; for (const y of [46, 74]) { g.beginPath(); g.arc(222, y, 3.4, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(221, y - 1, 1, 0, TAU); g.fill(); g.fillStyle = '#05121a'; }   // eyes
  g.fillStyle = 'rgba(0,0,0,.4)'; for (const y of [54, 66]) { g.beginPath(); g.arc(243, y, 1.3, 0, TAU); g.fill(); }   // nostrils
});
const T_SHARK_TAIL = tex(100, 126, g => {   // the tail fin: the upper lobe is the longer one
  g.beginPath(); g.moveTo(99, 60); g.lineTo(72, 55); g.lineTo(14, 2); g.quadraticCurveTo(26, 38, 40, 62); g.quadraticCurveTo(30, 96, 22, 120); g.lineTo(72, 69); g.lineTo(99, 66); g.closePath();
  const gr = g.createLinearGradient(0, 0, 100, 0); gr.addColorStop(0, '#2c4452'); gr.addColorStop(1, '#4a6677'); g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(8,22,32,.75)'; g.lineWidth = 2; g.stroke();
});
const sharkE = {};
function syncSharks(m) {
  const seen = {};
  for (const s of m.sk || []) {
    seen[s[0]] = 1; let e = sharkE[s[0]];
    if (!e) {
      const c = new PIXI.Container(), wake = new PIXI.Graphics(), rot = new PIXI.Container(), shadow = new PIXI.Graphics(), tail = new PIXI.Sprite(T_SHARK_TAIL), body = new PIXI.Sprite(T_SHARK), jaws = new PIXI.Graphics(), foam = new PIXI.Graphics();
      shadow.beginFill(0x04202f, .3); shadow.drawEllipse(-6, 10, 118, 26); shadow.endFill();
      tail.anchor.set(1, .5); tail.position.set(-98, 0); body.anchor.set(.5, .5); jaws.alpha = 0;
      const fin = new PIXI.Sprite(T_FIN); fin.anchor.set(.5, .95);
      rot.addChild(shadow, tail, body, jaws, foam); rot.scale.set(.74); rot.visible = false; c.addChild(wake, rot, fin); ents.addChild(c);
      e = sharkE[s[0]] = { c, rot, tail, body, jaws, foam, wake, fin, x: s[1], y: s[2], tx: s[1], ty: s[2], a: s[3] / 100, ar: s[3] / 100, ph: rnd(0, TAU), age: 0, bite: 0, mode: 'fin', mt: 0 }; c.position.set(e.x, e.y);   // it arrives as just a fin, and leaps out of the water once it is close
    }
    if (s[5] && e.mode !== 'dive') { e.mode = 'dive'; e.mt = 0; e.splashed = 0; }   // leaving: leap up and crash back down
    e.tx = s[1]; e.ty = s[2]; e.a = s[3] / 100; if (s[4] && !e.bite) { e.bite = .5; burst(e.x, e.y, 14, 0xffffff, 170, false, .16); burst(e.x, e.y, 6, 0xb71c1c, 90, false, .1); } if (!s[4]) e.bite = Math.max(0, e.bite - .1);
  }
  for (const id in sharkE) if (!seen[id]) { sharkE[id].c.destroy({ children: true }); delete sharkE[id]; }
}
const sharkRip = [];   // expanding rings on the water where a shark broke the surface
function sharkSplash(e, big) {
  burst(e.x, e.y, big ? 26 : 18, 0xffffff, big ? 260 : 200, false, .2); burst(e.x, e.y, 10, 0x9fd8ef, 150, false, .16);
  for (let i = 0; i < (big ? 16 : 10); i++) emit(pfx, T_GLOW, e.x + rnd(-30, 30), e.y + rnd(-14, 14), rnd(-80, 80), rnd(-260, -130), rnd(.5, .8), .15, .05, 0xffffff, .9, false, 520);   // spray thrown up
  for (let i = 0; i < 2; i++) { const g = new PIXI.Graphics(); g.position.set(e.x, e.y); pfx.addChild(g); sharkRip.push({ g, t: -i * .18, big }); }
  const me = ents2['p' + myId]; if (me) SFX.splash(Math.hypot(e.x - me.x, e.y - me.y), e.x - me.x, big);
}
function stepSharkFx(dt) {
  for (let i = sharkRip.length - 1; i >= 0; i--) { const r = sharkRip[i]; r.t += dt; if (r.t >= 1.3) { r.g.destroy(); sharkRip.splice(i, 1); continue; } if (r.t < 0) continue; const R = (r.big ? 30 : 22) + r.t * (r.big ? 110 : 80); r.g.clear(); r.g.lineStyle(3, 0xffffff, .6 * (1 - r.t / 1.3)); r.g.drawEllipse(0, 0, R, R * .6); }
  for (const id in sharkE) {
    const e = sharkE[id], k = Math.min(1, dt * 9); e.age += dt; e.mt += dt; const ox = e.x, oy = e.y; e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k;
    e.c.position.set(e.x, e.y); e.c.zIndex = e.y + 200; e.c.alpha = Math.min(1, e.age * 2);
    if (e.mode === 'fin') { let nd = 1e9; for (const kk in ents2) { const q = ents2[kk]; if (q.kind === 'p') nd = Math.min(nd, Math.hypot(q.x - e.x, q.y - e.y)); } if (nd < 380 || e.bite > 0) { e.mode = 'breach'; e.mt = 0; e.splashed = 0; sharkSplash(e, false); } }   // close now: it bursts out of the water
    { const BS = .74; let sc = BS, lift = 0, ra = 1, fa = 0;
      if (e.mode === 'fin') { ra = 0; fa = 1; }
      else if (e.mode === 'breach') { const u = Math.min(1, e.mt / .75), j = Math.sin(u * Math.PI); sc = BS * (1 + .35 * j); lift = -26 * j; ra = Math.min(1, u * 3); fa = Math.max(0, 1 - u * 4); if (u > .85 && !e.splashed) { e.splashed = 1; burst(e.x, e.y, 12, 0xffffff, 160, false, .14); } if (u >= 1) e.mode = 'body'; }
      else if (e.mode === 'dive') { const u = Math.min(1, e.mt / 1.1), j = Math.sin(Math.min(1, u / .62) * Math.PI); sc = BS * (1 + .4 * j) * (u > .55 ? Math.max(.5, 1 - (u - .55) * 1.4) : 1); lift = -30 * j; ra = u < .58 ? 1 : Math.max(0, 1 - (u - .58) / .2); if (u >= .58 && !e.splashed) { e.splashed = 1; sharkSplash(e, true); } }   // leap, then crash back under
      e.rot.visible = ra > .01; e.rot.alpha = ra; e.rot.scale.set(sc); e.rot.position.y = lift; e.fin.visible = fa > .01; e.fin.alpha = fa; e.fin.y = Math.sin(T * 3 + e.ph) * 1.5; e.fin.scale.set(.9 + Math.sin(T * 5 + e.ph) * .03);
      e.wake.visible = !(e.mode === 'dive' && e.splashed); }
    { let da = ((e.a - e.ar + Math.PI) % TAU + TAU) % TAU - Math.PI; e.ar += da * Math.min(1, dt * 6); }   // turns smoothly toward where it is heading
    const sw = Math.sin(T * 6.5 + e.ph), fast = Math.hypot(e.x - ox, e.y - oy) > .5 ? 1 : .35;
    e.rot.rotation = e.ar + sw * .035 * fast; e.tail.rotation = Math.sin(T * 6.5 + e.ph - 1.1) * .34 * fast; e.body.rotation = Math.sin(T * 6.5 + e.ph - .5) * .04 * fast;
    e.jaws.clear(); if (e.bite > 0) { const o = Math.min(1, e.bite * 2.2); e.jaws.alpha = Math.min(1, o * 1.6); e.jaws.beginFill(0x4a0b0b, 1); e.jaws.drawEllipse(128, 0, 9 + 11 * o, 5 + 17 * o); e.jaws.endFill(); e.jaws.beginFill(0xf5f5f0, 1); for (let k = -3; k <= 3; k++) { const ya = k * (4.2 * (.4 + o)); e.jaws.drawPolygon([126 + Math.abs(k), ya - 2.2, 136 - Math.abs(k) * .6, ya, 126 + Math.abs(k), ya + 2.2]); } e.jaws.endFill(); }
    e.foam.clear(); e.foam.lineStyle(3, 0xffffff, .55 * fast); e.foam.arc(120, 0, 15, -1.1, 1.1); e.foam.lineStyle(2, 0xffffff, .3 * fast); e.foam.arc(108, 0, 26, -.9, .9);   // the bow wave
    const bx = -Math.cos(e.a), by = -Math.sin(e.a), px = -by, py = bx;   // the wake: a V of white lines trailing behind the fin
    const wr = Math.cos(e.ar), wq = Math.sin(e.ar), wbx = -wr, wby = -wq, wpx = -wby, wpy = wbx; e.wake.clear(); e.wake.lineStyle(3, 0xffffff, .5); for (const sg of [-1, 1]) { e.wake.moveTo(wbx * 60 + wpx * sg * 6, wby * 60 + wpy * sg * 6); e.wake.lineTo(wbx * 150 + wpx * sg * 34, wby * 150 + wpy * sg * 34); }
    if (Math.hypot(e.x - ox, e.y - oy) > .5 && Math.random() < dt * 14) emit(pfx, T_GLOW, e.x + bx * 30, e.y + by * 30, rnd(-10, 10), rnd(-10, 10), .8, .12, .3, 0xffffff, .45, false, 0);
  }
}
function syncPools(m) {
  const seen = {};
  for (const q of m.fp || []) {
    seen[q[0]] = 1; if (poolE[q[0]]) continue;
    const c = new PIXI.Container(), col = FISH[q[3]].col, g = new PIXI.Graphics();
    g.beginFill(0x2fa3c9, .38); g.drawEllipse(0, 0, 54, 34); g.endFill(); g.beginFill(col, .18); g.drawEllipse(0, 0, 40, 25); g.endFill();
    const r1 = new PIXI.Graphics(), r2 = new PIXI.Graphics(); for (const r of [r1, r2]) { r.lineStyle(2.5, col, .9); r.drawEllipse(0, 0, 40, 25); }
    const sh = new PIXI.Graphics(); sh.beginFill(q[3] === 3 ? 0xfff2a8 : 0x0a3550, .8); sh.drawEllipse(-10, 2, 13, 5); sh.drawPolygon([-22, 2, -32, -4, -32, 8]); sh.endFill();   // a fish shape under the surface
    c.addChild(g, r1, r2, sh); c.position.set(q[1], q[2]); c.zIndex = -5; ground.addChild(c);
    poolE[q[0]] = { c, r1, r2, sh, ph: rnd(0, TAU), k: q[3], x: q[1], y: q[2] };
  }
  for (const id in poolE) if (!seen[id]) { poolE[id].c.destroy({ children: true }); delete poolE[id]; }
}
function stepPoolFx(dt) {
  for (const id in poolE) {
    const e = poolE[id]; e.c.visible = Math.abs(e.x - camX) < W / Z / 2 + 100 && Math.abs(e.y - camY) < H / Z / 2 + 100; if (!e.c.visible) continue;
    for (const [r, o] of [[e.r1, 0], [e.r2, .5]]) { const u = (T * .45 + e.ph / TAU + o) % 1; r.scale.set(.55 + u * .7); r.alpha = (1 - u) * .9; }
    e.sh.x = Math.sin(T * .8 + e.ph) * 18; e.sh.y = Math.cos(T * .6 + e.ph) * 7; e.sh.rotation = Math.sin(T * .8 + e.ph + 1.2) * .5;
    if (e.k === 3 && Math.random() < dt * 3) emit(overL, T_GLOW, e.x + rnd(-40, 40), e.y + rnd(-22, 22), 0, -20, .8, .1, .02, 0xffe082, .9, true, 0);   // legendary pools sparkle
  }
}
function closeFish(ok) {
  if (!fishOpen) return; fishOpen = false; if (fishG.raf) cancelAnimationFrame(fishG.raf); $('fishG').style.display = 'none';
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'fishdone', id: fishG.id, ok: !!ok }));
}
function openFish(id, kind) {
  const F = FISH[kind] || FISH[1];
  if (!$('fishG')) {
    const d = document.createElement('div'); d.id = 'fishG'; d.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:40;background:#02101ccc;touch-action:none;user-select:none';
    d.innerHTML = '<div style="background:#14304a;border:2px solid #ffd000;border-radius:14px;padding:14px 18px;text-align:center;box-shadow:0 8px 30px #000a;width:min(300px,88vw)"><div id="fgT" style="font-weight:800;font-size:16px;margin-bottom:6px"></div><div id="fgH" style="font-size:12px;opacity:.85;margin-bottom:8px">Hold REEL (or Space) to raise the green zone. Keep the fish inside it!</div>' +
      '<div style="display:flex;gap:14px;justify-content:center"><div id="fgTrack" style="position:relative;width:54px;height:230px;border:2px solid #fff6;border-radius:10px;background:linear-gradient(#0e4a73,#0a2c46);overflow:hidden"><div id="fgZone" style="position:absolute;left:0;right:0;background:#4caf5088;border-top:2px solid #81c784;border-bottom:2px solid #81c784"></div><div id="fgFish" style="position:absolute;left:0;right:0;text-align:center;font-size:26px;line-height:26px"></div></div>' +
      '<div style="width:16px;height:230px;border:2px solid #fff6;border-radius:8px;background:#0a1a28;position:relative;overflow:hidden"><div id="fgProg" style="position:absolute;left:0;right:0;bottom:0;background:#ffd54f"></div></div></div>' +
      '<button class="mini" id="fgReel" style="display:block;width:100%;margin:10px 0 6px;padding:16px;font-size:16px;background:#2e7d32;touch-action:none">🎣 REEL (hold)</button><button class="mini gray" id="fgCancel" style="display:block;width:100%;padding:8px">Let it go</button></div>';
    document.body.appendChild(d);
    const down = e => { e.preventDefault(); e.stopPropagation(); if (fishG) fishG.hold = 1; }, up = e => { e.preventDefault(); if (fishG) fishG.hold = 0; };
    for (const el of [d.querySelector('#fgReel'), d.querySelector('#fgTrack')]) { el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up); el.addEventListener('pointercancel', up); }
    d.querySelector('#fgCancel').onclick = () => closeFish(false);
    addEventListener('keydown', e => { if (fishOpen && (e.key === ' ' || e.key.toLowerCase() === 'e')) { e.preventDefault(); e.stopImmediatePropagation(); if (fishG) fishG.hold = 1; } if (fishOpen && e.key === 'Escape') { e.stopImmediatePropagation(); closeFish(false); } }, true);
    addEventListener('keyup', e => { if (fishOpen && (e.key === ' ' || e.key.toLowerCase() === 'e')) { e.stopImmediatePropagation(); if (fishG) fishG.hold = 0; } }, true);
  }
  fishOpen = true; const zh = F.zh * (GEAR.rod ? 1.25 : 1);
  fishG = { id, kind, F, zh, zc: .5, zv: 0, fp: .5, ft: .5, tt: 0, prog: .2, t: 0, hold: 0, last: performance.now() };
  $('fgT').textContent = F.e + ' ' + F.n + (kind === 3 ? ' - very hard!' : kind === 2 ? ' - tricky' : ''); $('fishG').style.display = 'flex'; $('fgZone').style.height = zh * 100 + '%';
  const step = now => {
    if (!fishOpen) return; const dt = Math.min(.05, (now - fishG.last) / 1000); fishG.last = now; const g = fishG;
    g.t += dt; g.zv += (g.hold ? 2.4 : -2.0) * dt; g.zc += g.zv * dt;
    if (g.zc < zh / 2) { g.zc = zh / 2; g.zv = Math.max(0, g.zv) * -.2; } if (g.zc > 1 - zh / 2) { g.zc = 1 - zh / 2; g.zv = Math.min(0, g.zv) * -.2; }
    g.tt -= dt; if (g.tt <= 0) { g.tt = F.chg * (.6 + Math.random() * .8); g.ft = .07 + Math.random() * .86; }
    const dd = g.ft - g.fp, mv = F.fs * dt; g.fp += Math.abs(dd) < mv ? dd : Math.sign(dd) * mv;
    const inside = Math.abs(g.fp - g.zc) < zh / 2 + .02; g.prog += (inside ? F.fill : -F.drain) * dt;
    $('fgZone').style.bottom = (g.zc - zh / 2) * 100 + '%'; $('fgFish').style.bottom = 'calc(' + g.fp * 100 + '% - 13px)'; $('fgFish').textContent = F.e; $('fgProg').style.height = Math.max(0, Math.min(1, g.prog)) * 100 + '%'; $('fgProg').style.background = inside ? '#ffd54f' : '#ef6c00';
    const me = ents2['p' + myId], q = poolE[id]; if (me && q && Math.hypot(me.x - q.x, me.y - q.y) > 280) { closeFish(false); notice('You walked away from the pool.'); return; }
    if (g.prog >= 1) { closeFish(true); return; } if (g.prog <= 0 || g.t > 30) { closeFish(false); return; }
    g.raf = requestAnimationFrame(step);
  };
  fishG.raf = requestAnimationFrame(step);
}
let stormEl = null, stormLt = 3, stormFlash = 0;
function stormFx(dt) {   // aboard a boat at night: rain, whitecaps, dark sky and the odd flash of lightning
  const me = ents2['p' + myId], mp = S && S.p.find(q => q[0] === myId), on = !!(me && mp && mp[20] && S.ph === 2 && Object.values(boatE).some(e => e.storm));
  if (!stormEl) { stormEl = document.createElement('div'); stormEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;background:#06142a;opacity:0;transition:opacity .8s'; document.body.appendChild(stormEl); }
  if (!on) { if (stormEl.style.opacity !== '0') stormEl.style.opacity = '0'; return; }
  stormLt -= dt; if (stormLt <= 0) { stormLt = rnd(4, 11); stormFlash = .22; shake = Math.max(shake, .25); }
  stormFlash = Math.max(0, stormFlash - dt); stormEl.style.background = stormFlash > 0 ? '#dfeaff' : '#06142a'; stormEl.style.opacity = stormFlash > 0 ? .55 : .32;
  for (let i = 0; i < 5; i++) { const x = me.x + rnd(-W / Z / 2, W / Z / 2), y = me.y + rnd(-H / Z / 2, H / Z / 2); emit(overL, T_GLOW, x, y, -140, 520, .45, .05, .05, 0xbfd8ff, .55, false, 0); }   // rain
  if (Math.random() < dt * 14) { const a = rnd(0, TAU), d = rnd(60, 280); emit(pfx, T_GLOW, me.x + Math.cos(a) * d, me.y + Math.sin(a) * d, rnd(-30, 30), rnd(-20, 20), 1.1, .12, .5, 0xffffff, .5, false, 0); }   // whitecaps
}
function stepBoats(dt) {
  for (const id in boatE) {
    const e = boatE[id], k = Math.min(1, dt * 12); e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; e.ang = angLerp(e.ang, e.ta, Math.min(1, dt * 8));
    const rough = e.storm ? 1 : 0, wob = rough ? Math.sin(T * 2.6 + e.ph) * .09 + Math.sin(T * 6.1 + e.ph * 2) * .035 : 0;   // in a storm the boat pitches and bobs hard
    e.c.position.set(e.x, e.y + Math.sin(T * (rough ? 3.4 : 1.6) + e.ph) * (rough ? 6 : 1.5)); e.c.zIndex = e.y - 40; e.sp.rotation = e.ang + wob; SPR.boat(e);
    if (e.bar) e.bar.position.set(-Math.cos(e.ang) * e.rl, -Math.sin(e.ang) * e.rl + 4);
  }
  stormFx(dt);
}
// ---- placed structures (crafting bench, spike walls) ----
const structE = {}; let GEAR = {}, craftOpen = false, craftSig = '', chestId = null, chestSig = '', potOpen = false, potSig = '';
const mkGate = P => tex(168, 72, g => {   // a double-width gate, closed: a post at each end and planks between
  const post = x => { poly(g, P.d, [x, 66, x + 14, 66, x + 14, 14, x + 7, 6, x, 14]); poly(g, P.m, [x + 1, 64, x + 6, 64, x + 6, 14, x + 7, 8, x + 1, 15]); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.5; g.strokeRect(x, 14, 14, 52); };
  for (let i = 0; i < 9; i++) { const x = 18 + i * 14; g.fillStyle = i % 2 ? P.m2 : P.l; g.fillRect(x, 28, 13, 38); g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1.2; g.strokeRect(x, 28, 13, 38); }
  g.fillStyle = P.d; g.fillRect(16, 36, 136, 7); g.fillRect(16, 54, 136, 7); g.strokeStyle = 'rgba(0,0,0,.5)'; g.strokeRect(16, 36, 136, 7); g.strokeRect(16, 54, 136, 7);
  post(2); post(152);
});
const mkGateO = P => tex(168, 72, g => {   // the same gate swung open: just the posts and the leaf folded back against the left one
  const post = x => { poly(g, P.d, [x, 66, x + 14, 66, x + 14, 14, x + 7, 6, x, 14]); poly(g, P.m, [x + 1, 64, x + 6, 64, x + 6, 14, x + 7, 8, x + 1, 15]); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.5; g.strokeRect(x, 14, 14, 52); };
  g.fillStyle = P.m2; g.fillRect(16, 8, 8, 56); g.strokeStyle = 'rgba(0,0,0,.5)'; g.strokeRect(16, 8, 8, 56); g.fillStyle = P.d; g.fillRect(14, 20, 12, 5); g.fillRect(14, 46, 12, 5);
  post(2); post(152);
});
// wall / gate looks per material: wood (''), rock ('r') and metal ('m') - same shapes, different colours
const WPAL = { c: { d: '#25160a', m: '#46290f', l: '#7c4f22', m2: '#5c3a18' }, '': { d: '#5a3a1c', m: '#7a4a22', l: '#a56b34', m2: '#8a5a2b' }, r: { d: '#40454b', m: '#646c75', l: '#a2abb4', m2: '#7e8790' }, m: { d: '#2f3f48', m: '#566f7d', l: '#c3d2da', m2: '#7893a2' } };
const T_WALLS = {}, T_GATES = {}, T_GATEOS = {};
for (const k in WPAL) { T_WALLS[k] = mkWall(WPAL[k]); T_GATES[k] = mkGate(WPAL[k]); T_GATEOS[k] = mkGateO(WPAL[k]); }
const T_WALL = T_WALLS[''], T_GATE = T_GATES[''], T_GATEO = T_GATEOS[''];
const T_SPIKE = tex(84, 60, g => {   // a flat metal strip with a row of upward spikes
  g.fillStyle = '#4a4f57'; g.fillRect(4, 38, 76, 10); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1.5; g.strokeRect(4, 38, 76, 10); g.fillStyle = '#6b727c'; g.fillRect(4, 38, 76, 3);
  for (let i = 0; i < 6; i++) { const x = 8 + i * 12; poly(g, '#b8c0c8', [x, 38, x + 5, 12 + (i % 2) * 4, x + 10, 38]); poly(g, '#e7edf2', [x + 1, 37, x + 5, 14 + (i % 2) * 4, x + 5, 37]); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 38); g.lineTo(x + 5, 12 + (i % 2) * 4); g.lineTo(x + 10, 38); g.stroke(); }
});
const SDEF = { spike: { tex: T_SPIKE, ay: .7, base: .62, sh: 1.6, hy: 10 }, gate: { tex: T_GATE, ay: .85, base: .62, sh: 3.4, hy: 12 }, bench: { tex: T_BENCH, ay: .8, base: .72, sh: 2, hy: 14 }, wall: { tex: T_WALL, ay: .85, base: .62, sh: 1.6, hy: 12 }, chest: { tex: T_CHEST, ay: .8, base: .62, sh: 1.7, hy: 12 }, pot: { tex: T_POT, ay: .8, base: .62, sh: 1.5, hy: 12 }, smelter: { tex: T_SMELTER, ay: .84, base: .62, sh: 1.9, hy: 12 } , trap: { tex: T_TRAP, ay: .5, base: .8, sh: 1, hy: 10 }};
function syncStructs(m, first) {
  const seen = {}, me = ents2['p' + myId];
  for (const t of m.st || []) {
    seen[t[0]] = 1; let e = structE[t[0]];
    if (!e) {
      const D = SDEF[t[1]] || SDEF.wall, c = new PIXI.Container(), sh = new PIXI.Sprite(T_SHADOW); sh.anchor.set(.5);
      sh.scale.set(D.sh, .7); sh.y = 4;
      const mat0 = t[9] || '', spr = new PIXI.Sprite(t[1] === 'wall' ? T_WALLS[mat0] : t[1] === 'gate' ? (t[8] ? T_GATEOS[mat0] : T_GATES[mat0]) : D.tex); spr.anchor.set(.5, .5); const base = D.base; spr.scale.set(base);
      const rotc = new PIXI.Container(); rotc.y = -(D.ay - .5) * D.tex.height * base; rotc.rotation = (t[7] || 0) * Math.PI / 4; rotc.addChild(spr);   // turns about its own centre
      const hp = new PIXI.Graphics(); hp.y = D.hy; c.addChild(sh, rotc, hp); c.position.set(t[2], t[3]); c.zIndex = t[3]; ents.addChild(c);
      e = structE[t[0]] = { c, spr, rotc, mat: mat0, rot: t[7] || 0, hp, k: t[1], x: t[2], y: t[3], base, mhp: t[5], hpv: t[4], t: first ? 1 : 0, flash: 0, barT: 0 };
      if (!first) { const d = me ? Math.hypot(me.x - t[2], me.y - t[3]) : 0; SFX.build(d, me ? t[2] - me.x : 0); burst(t[2], t[3], 10, t[9] === 'm' ? 0xcfd8dc : t[9] === 'r' ? 0xb0b6bc : 0xd9c79a, 80, false, .16); }
    } else if (t[4] < e.hpv) { e.flash = .12; e.barT = 2; const d = me ? Math.hypot(me.x - t[2], me.y - t[3]) : 0; SFX.hit(d, me ? t[2] - me.x : 0); burst(t[2], t[3] - 14, 4, t[9] === 'm' ? 0xb0bec5 : t[9] === 'r' ? 0x9aa0a6 : 0xb98349, 80, false, .1); }
    if ((t[8] || 0) !== e.op) { e.op = t[8] || 0; if (t[1] === 'gate') e.spr.texture = e.op ? T_GATEOS[e.mat || ''] : T_GATES[e.mat || '']; }
    if ((t[7] || 0) !== e.rot) { e.rot = t[7] || 0; e.rotc.rotation = e.rot * Math.PI / 4; }
    if (t[1] === 'smelter') { const pq = e.smelt ? e.smelt[0] : t[6][0]; if (t[6][0] > pq) { const d = me ? Math.hypot(me.x - t[2], me.y - t[3]) : 0; SFX.smelterStart(d, me ? t[2] - me.x : 0); } e.smelt = t[6]; }
    else e.items = t[6];
    { const br = t[1] === 'gate' && t[5] > 0 && t[4] <= 0; if (br && !e.broke && !first) { const d = me ? Math.hypot(me.x - t[2], me.y - t[3]) : 0; SFX.rockbreak(d, me ? t[2] - me.x : 0); burst(t[2], t[3] - 10, 16, 0xb98349, 160, false, .15); } e.broke = br; }   // a cabin door smashed in: it hangs open, dark and splintered, until morning
    e.hpv = t[4]; e.x = t[2]; e.y = t[3];
  }
  for (const id in structE) if (!seen[id]) {
    const e = structE[id]; delete structE[id]; if (e.glow) e.glow.destroy(); const me2 = ents2['p' + myId], d = me2 ? Math.hypot(me2.x - e.x, me2.y - e.y) : 0;
    SFX.rockbreak(d, me2 ? e.x - me2.x : 0); burst(e.x, e.y - 12, 14, 0xb98349, 150, false, .15); e.c.destroy({ children: true });
  }
}
function stepStructs(dt) {
  for (const id in structE) {
    const e = structE[id];
    if (e.t < 1) { e.t = Math.min(1, e.t + dt * 4); const u = e.t, b = 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2); e.spr.scale.set(e.base * Math.max(.1, b)); }
    e.flash = Math.max(0, e.flash - dt); e.spr.tint = e.flash > 0 ? 0xffaaaa : e.broke ? 0x6b5a4a : 0xffffff; e.spr.alpha = e.broke ? .7 : 1; SPR.struct(e);
    if (e.k === 'smelter') {
      const sm = e.smelt || [0, 0], working = sm[0] > 0;
      if (!e.prog) { e.prog = new PIXI.Graphics(); e.prog.y = -66; e.c.addChild(e.prog); e.qt = new PIXI.Text('', { fontFamily: 'system-ui,sans-serif', fontSize: 13, fontWeight: '800', fill: 0xffe082, stroke: 0x000000, strokeThickness: 3 }); e.qt.anchor.set(.5, 1); e.qt.y = -72; e.qt.resolution = 2; e.c.addChild(e.qt); e.pv = 0; e.glow = new PIXI.Sprite(T_GLOW); e.glow.anchor.set(.5); e.glow.blendMode = BM.ADD; e.glow.tint = 0xff8a1c; overL.addChild(e.glow); }
      if (!working) e.pv = 0; else if (sm[1] < e.pv - .05) e.pv = sm[1]; else e.pv += (sm[1] - e.pv) * Math.min(1, dt * 10);
      e.prog.clear(); if (working) { e.prog.beginFill(0x000000, .65); e.prog.drawRoundedRect(-28, -5, 56, 11, 5); e.prog.endFill(); e.prog.beginFill(0xffa726); e.prog.drawRoundedRect(-26, -3, Math.max(2, 52 * e.pv), 7, 3); e.prog.endFill(); }
      const qs = sm[0] > 1 ? '×' + sm[0] : ''; if (e.qt.text !== qs) e.qt.text = qs;
      e.glow.position.set(e.x, e.y - 8); e.glow.scale.set(working ? 1.2 + Math.sin(T * 14) * .08 : .5); e.glow.alpha = working ? .75 : .12;
      if (working) { e.sm = (e.sm || 0) - dt; if (e.sm <= 0) { e.sm = .16; emit(pfx, T_GLOW, e.x - 16 + rnd(-3, 3), e.y - 52, rnd(-8, 8), rnd(-40, -22), 1.4, .14, .45, 0x888888, .35, false, 0); if (Math.random() < .5) emit(overL, T_GLOW, e.x - 16 + rnd(-4, 4), e.y - 52, rnd(-14, 14), rnd(-70, -40), .6, .06, .01, 0xffb347, 1, true, 60); } }
    }
    if (e.k === 'pot') { e.steam = (e.steam || 0) - dt; if (e.steam <= 0) { e.steam = .22; emit(pfx, T_GLOW, e.x + rnd(-8, 8), e.y - 34, rnd(-6, 6), rnd(-30, -16), 1.3, .12, .4, 0xffffff, .28, false, 0); } }
    if (e.k === 'wall' || e.k === 'gate' || e.k === 'spike') { if (e.barT > 0) { e.barT -= dt; e.hp.alpha = Math.min(1, e.barT * 2); if (e.lbar !== e.hpv) { e.lbar = e.hpv; drawHp(e.hp, 34, e.hpv / e.mhp, 0xffb74d); } } else if (e.hp.alpha) e.hp.alpha = 0; }
  }
}
// ---- placement ghost: craft a placeable item, walk to aim, press ACT to put it down ----
let placingId = null, ghost = null, ghostRot = null, ghostF = null, placeRot = 0, lastPlaceAt = 0;
const PLACE_AHEAD = 58;   // must match the server
function placeCheck(r, x, y) {   // mirrors the server's rules so the silhouette can show green/red; the server stays in charge
  const CF = curCamp({ x, y }) || curCamp(ents2['p' + myId]) || { x: 0, y: 0, r: RC.camp(S.f[2]), isl: 0 }, d = Math.hypot(x - CF.x, y - CF.y), campR = CF.r, sr = RC.RADIUS[r.kind], station = r.kind !== 'wall' && r.kind !== 'trap' && r.kind !== 'gate' && r.kind !== 'spike';
  if (d < RC.fireClear(r.kind)) return 'Too close to the fire';
  if (station && d > campR) return 'Must be inside the camp (the fire ring)';
  if (!station && d > campR + 200) return 'Too far from camp';
  { const is = CF.isl === 0 ? [0, 0, RR] : ISL.find(q => inIsl(q, CF.x, CF.y, 0)) || [0, 0, RR]; if (!inIsl(is, x, y, 50)) return 'Too close to the water'; }
  if ((S.st || []).filter(t => t[1] === r.kind && Math.hypot(t[2] - CF.x, t[3] - CF.y) < CF.r).length >= (r.max || 99)) return 'You built the maximum of these';
  for (const t of S.st || []) {
    const stWall = t[1] === 'wall' || t[1] === 'gate' || t[1] === 'spike', dd = Math.hypot(t[2] - x, t[3] - y), need = station && !stWall ? RC.STATION_GAP : (station || !stWall) ? RC.WALL_GAP : RC.RADIUS[t[1]] + sr - 4;
    if (dd < need) return need > 60 ? 'Too close to another structure' : 'Something is already there';
  }
  const pl = pooled(); if (pl.wood < r.cost.wood || pl.stone < r.cost.stone || pl.scrap < (r.cost.scrap || 0)) return 'Not enough materials';
  return '';
}
const lastRot = {};   // remember the last rotation used for each recipe (handy when lining up walls)
function startPlacing(r) {
  stopPlacing(); setCraft(false); closeChest(); closePot(); closeSmelt();
  const D = SDEF[r.kind]; placingId = r.id; placeRot = (lastRot[r.id] || 0) % 8;
  ghost = new PIXI.Container(); ghostRot = new PIXI.Container();
  const sp = new PIXI.Sprite(r.kind === 'wall' ? T_WALLS[r.mat || ''] : r.kind === 'gate' ? T_GATES[r.mat || ''] : D.tex); sp.anchor.set(.5, .5); sp.scale.set(D.base);
  ghostRot.y = -(D.ay - .5) * D.tex.height * D.base; ghostRot.addChild(sp); ghost.addChild(ghostRot); SPR.ghost(r.kind, r.mat, ghost, ghostRot, sp);
  ghostF = new PIXI.ColorMatrixFilter(); ghost.filters = [ghostF]; ents.addChild(ghost);
  $('placeRotR').style.display = r.norot ? 'none' : ''; $('placeBar').style.display = 'flex'; $('placeName').textContent = r.e + ' ' + r.n; $('placeMsg').textContent = '';
}
function rotatePlace() { if (!placingId || RC.BY[placingId].norot) return;   // square things (cooking pot, smelter) can't be turned
  placeRot = (placeRot + 1) % 8;   // one tap = 45° (two taps = a quarter turn), one direction only
  lastRot[placingId] = placeRot; SFX.pickup(); }
RC.BY.__boat = { id: '__boat', n: 'Boat', e: '⛵', kind: 'boat', norot: true, cost: { wood: 0, stone: 0 } };
let boatSlot = -1;
function startPlacingBoat(i) {   // tap the boat in a slot: a see-through boat follows you at the water's edge; ACT puts it down
  stopPlacing(); setCraft(false); closeChest(); closePot(); closeSmelt(); boatSlot = i; placingId = '__boat';
  ghost = new PIXI.Container(); ghostRot = new PIXI.Container();
  const sp = new PIXI.Sprite(T_BOAT); sp.anchor.set(.5); sp.scale.set(.8); SPR.boatGhost(sp); ghostRot.addChild(sp); ghost.addChild(ghostRot);
  ghostF = new PIXI.ColorMatrixFilter(); ghost.filters = [ghostF]; ents.addChild(ghost); markSlot();
  $('placeRotR').style.display = 'none'; $('placeBar').style.display = 'flex'; $('placeName').textContent = '⛵ Boat'; $('placeMsg').textContent = '';
}
function markSlot() { document.querySelectorAll('#slots .slot').forEach((el, i) => el.classList.toggle('sel', placingId === '__boat' && boatSlot === i)); }   // the equipped boat's slot is highlighted
function stopPlacing() {
  boatSlot = -1;
  if (ghost) { ghost.destroy({ children: true }); ghost = null; } ghostRot = null;
  ghostF = null; placingId = null; $('placeBar').style.display = 'none'; markSlot();
}
function updateGhost(me) {
  if (!placingId || !ghost) return;
  if (placingId === '__boat') {
    const mp = S.p.find(p => p[0] === myId), fa = mp && mp[16] !== undefined ? mp[16] / 100 : 0, x = me.x + Math.cos(fa) * 100, y = me.y + Math.sin(fa) * 100;
    let why = ''; if (mp && mp[20]) why = 'You are already in a boat'; else if (!isWaterC(x, y)) why = 'Boats only go in the water - stand at the shore and face the sea';
    else if ((S.bt || []).some(b => Math.hypot(b[1] - x, b[2] - y) < 90)) why = 'Too close to another boat';
    const ok = !why; ghost.position.set(x, y); ghost.zIndex = y + 1; ghost.alpha = .55 + Math.sin(T * 5) * .1; ghostRot.rotation = fa;
    ghostF.matrix = ok ? [0, 0, 0, 0, .35, 0, 0, 0, 0, 1, 0, 0, 0, 0, .5, 0, 0, 0, 1, 0] : [0, 0, 0, 0, 1, 0, 0, 0, 0, .3, 0, 0, 0, 0, .3, 0, 0, 0, 1, 0];
    const msg = ok ? 'Looks good - press ACT to put it down' : why, pm = $('placeMsg'); if (pm.textContent !== msg || pm.dataset.ok !== String(ok)) { pm.textContent = msg; pm.style.color = ok ? '#8dffa8' : '#ff8a80'; pm.dataset.ok = ok; }
    return;
  }
  const r = RC.BY[placingId], mp = S.p.find(p => p[0] === myId), fa = mp && mp[16] !== undefined ? mp[16] / 100 : 0;
  const x = me.x + Math.cos(fa) * PLACE_AHEAD, y = me.y + Math.sin(fa) * PLACE_AHEAD, why = placeCheck(r, x, y), ok = !why;
  ghost.position.set(x, y); ghost.zIndex = y + 1; ghost.alpha = .55 + Math.sin(T * 5) * .1; ghostRot.rotation = placeRot * Math.PI / 4;
  ghostF.matrix = ok ? [0, 0, 0, 0, .35, 0, 0, 0, 0, 1, 0, 0, 0, 0, .5, 0, 0, 0, 1, 0] : [0, 0, 0, 0, 1, 0, 0, 0, 0, .3, 0, 0, 0, 0, .3, 0, 0, 0, 1, 0];
  const msg = ok ? 'Looks good - press ACT to place' : why; const pm = $('placeMsg'); if (pm.textContent !== msg || pm.dataset.ok !== String(ok)) { pm.textContent = msg; pm.style.color = ok ? '#8dffa8' : '#ff8a80'; pm.dataset.ok = ok; }
}
function actPress() {   // rising edge of the ACT button while placing: ask the server to place (it pays and checks the rules)
  if (!placingId || !ws || ws.readyState !== 1) return;
  const now = performance.now(); if (now - lastPlaceAt < 250) return; lastPlaceAt = now;
  if (placingId === '__boat') { ws.send(JSON.stringify({ t: 'boat', i: boatSlot })); return; }
  ws.send(JSON.stringify({ t: 'craft', id: placingId, rot: placeRot }));
}
$('placeCancel').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); stopPlacing(); });
$('placeRotR').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); rotatePlace(); });

// ---- crafting menu ----
const pooled = () => {   // what you can spend on crafting: your bag plus everything in the chests
  const mp = S && S.p.find(p => p[0] === myId), o = mp ? { wood: mp[7], stone: mp[8], food: mp[9], scrap: mp[15] || 0 } : { wood: 0, stone: 0, food: 0, scrap: 0 };
  for (const t of (S && S.st) || []) if (t[1] === 'chest' && t[6]) { o.wood += t[6][0]; o.stone += t[6][1]; o.food += t[6][2]; o.scrap += t[6][3] || 0; }
  return o;
};
const inv = pooled;
const curCamp = me => {   // the campfire ring you stand in: home, or a camp you set up on another island
  if (!me || !S) return null; if (Math.hypot(me.x, me.y) < RC.camp(S.f[2])) return { x: 0, y: 0, r: RC.camp(S.f[2]), isl: 0 };
  for (const c of S.cf || []) { const r = RC.camp(c[5]); if (Math.hypot(me.x - c[1], me.y - c[2]) < r) return { x: c[1], y: c[2], r, isl: -1 }; } return null;
};
const hasBench = () => { const C = curCamp(ents2['p' + myId]); return !!(C && S && S.st && S.st.some(t => t[1] === 'bench' && Math.hypot(t[2] - C.x, t[3] - C.y) < C.r)); };
function buildCraft() {
  const iv = inv(), bench = hasBench(), list = $('craftList'); $('craftInv').textContent = '🪵' + iv.wood + '  🪨' + iv.stone + '  (chests incl.)';
  list.innerHTML = '';
  if (!bench) list.insertAdjacentHTML('beforeend', '<div class="lockhint">🔒 Place a Crafting Bench in your camp to unlock more recipes.</div>');
  for (const r of RC.LIST) {
    if (r.id === 'bench' ? bench : !bench) continue;   // bench recipe hides once one exists; other recipes appear once it does
    if (r.max && (S.st || []).filter(t => t[1] === r.kind && (() => { const C = curCamp(ents2['p' + myId]); return C && Math.hypot(t[2] - C.x, t[3] - C.y) < C.r; })()).length >= r.max) continue;   // one chest / pot / smelter per camp: the recipe disappears once it is built (and comes back if you dismantle it)
    if (r.scrap && !(S && S.sf) && !(((S && S.p.find(q => q[0] === myId)) || [])[15] >= 1)) continue;   // scrap recipes (the boat) appear once anyone has found scrap
    if (r.kind === 'gear' && GEAR[r.gear]) continue;   // tools you already made disappear from your menu (per player)
    const ok = iv.wood >= r.cost.wood && iv.stone >= r.cost.stone && iv.scrap >= (r.cost.scrap || 0);
    const co = [r.cost.wood ? '<span class="' + (iv.wood >= r.cost.wood ? '' : 'no') + '">🪵 ' + iv.wood + '/' + r.cost.wood + '</span>' : '', r.cost.stone ? '<span class="' + (iv.stone >= r.cost.stone ? '' : 'no') + '">🪨 ' + iv.stone + '/' + r.cost.stone + '</span>' : '', r.cost.scrap ? '<span class="' + (iv.scrap >= r.cost.scrap ? '' : 'no') + '">🔩 ' + iv.scrap + '/' + r.cost.scrap + '</span>' : ''].filter(Boolean).join(' &nbsp; ');
    const d = document.createElement('div'); d.className = 'rc';
    d.innerHTML = '<div class="ic">' + r.e + '</div><div class="tx"><div class="nm">' + r.n + '</div><div class="ds">' + r.d + '</div><div class="co">' + co + '</div></div>';
    const placeable = r.kind !== 'gear' && r.kind !== 'boat' && r.kind !== 'item';   // the whole row is the button: tap anywhere on it (items like the trap go into a slot)
    d.classList.add('pick'); if (!ok) d.classList.add('dim');
    d.onclick = () => {
      if (!ok) { const m = $('craftMsg'); m.textContent = 'Not enough materials for ' + r.n + '.'; m.style.color = '#ff8a80'; return; }
      if (placeable) startPlacing(r); else if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'craft', id: r.id }));
    };
    list.appendChild(d);
  }
  craftSig = refreshSig();
}
const refreshSig = () => { const iv = inv(); return ((S && S.st) || []).map(t => t[1]).join('') + iv.wood + ',' + iv.stone + ',' + iv.scrap + ',' + (S && S.sf) + ',' + hasBench() + ',' + JSON.stringify(GEAR); };
function setCraft(open) { if (open) { if ((S && S.st || []).some(t => t[1] === 'bench')) armDismantle($('craftDis'), () => nearestOf('bench')); else $('craftDis').style.display = 'none'; } craftOpen = open; $('craft').style.display = open ? 'flex' : 'none'; if (open) { $('craftMsg').textContent = ''; buildCraft(); } }
$('craftClose').onclick = () => setCraft(false);

// ---- shared chest + cooking pot menus ----
const BUFF = { speed: 0, regen: 0, dmg: 0, regen2: 0, invuln: 0 }; let buffAt = 0;
const nearStruct = id => { const e = structE[id], me = ents2['p' + myId]; return !!(e && me && Math.hypot(me.x - e.x, me.y - e.y) < 125); };
const anyPotNear = () => { for (const id in structE) if (structE[id].k === 'pot' && nearStruct(id)) return true; return false; };
function openChest(id) { setCraft(false); closePot(); closeSmelt(); chestId = id; chestSig = ''; $('chest').style.display = 'flex'; armDismantle($('chestDis'), () => chestId); buildChest(); }
function closeChest() { chestId = null; $('chest').style.display = 'none'; }
function buildChest() {
  const e = structE[chestId]; if (!e) { closeChest(); return; }
  const mp = S && S.p.find(p => p[0] === myId), it = e.items || [0, 0, 0, 0], me = mp ? [mp[7], mp[8], mp[9], mp[15] || 0] : [0, 0, 0, 0];
  const sig = it.join() + '|' + me.join(); if (sig === chestSig) return; chestSig = sig;
  const list = $('chestList'); list.innerHTML = '';
  [['wood', '🪵', 'Wood'], ['stone', '🪨', 'Stone'], ['food', '🍓', 'Berries'], ['scrap', '🔩', 'Metal scrap']].forEach((r, i) => {
    const d = document.createElement('div'); d.className = 'rc';
    d.innerHTML = '<div class="ic">' + r[1] + '</div><div class="tx"><div class="nm">' + r[2] + '</div><div class="co">In chest: <b>' + it[i] + '</b> &nbsp; You: <b>' + me[i] + '</b></div></div>';
    const bx = document.createElement('div'); bx.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
    [['Put 1', 1, me[i] <= 0], ['Put all', 1e6, me[i] <= 0]].forEach(b => {
      const bt = document.createElement('button'); bt.textContent = b[0]; bt.disabled = b[2]; bt.style.cssText = 'min-width:78px;padding:9px 6px;font-size:13px';
      bt.onclick = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'chest', id: chestId, res: r[0], n: b[1] })); SFX.pickup(); }; bx.appendChild(bt);
    });
    d.appendChild(bx); list.appendChild(d);
  });
}
// dismantle buttons (bench / chest / pot panels): first tap asks "Sure?", second tap within 3 s does it
function armDismantle(btn, getId) {
  let t = null; btn.style.display = '';
  btn.onclick = () => {
    if (t) { clearTimeout(t); t = null; btn.textContent = 'Dismantle'; const id = getId(); if (id != null && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'dismantle', id })); return; }
    btn.textContent = 'Sure?'; t = setTimeout(() => { t = null; btn.textContent = 'Dismantle'; }, 3000);
  };
}
const nearestOf = kind => { const me = ents2['p' + myId]; let best = null, bd = 1e9; for (const id in structE) { const e = structE[id]; if (e.k !== kind || !me) continue; const d = Math.hypot(me.x - e.x, me.y - e.y); if (d < bd) { bd = d; best = id; } } return best == null ? null : +best; };
function openPot() { setCraft(false); closeChest(); closeSmelt(); armDismantle($('potDis'), () => nearestOf('pot')); potOpen = true; potSig = ''; $('pot').style.display = 'flex'; $('potMsg').textContent = ''; buildPot(); }
function closePot() { potOpen = false; $('pot').style.display = 'none'; }
function buildPot() {
  const pl = pooled(), mpp = (S && S.p.find(p => p[0] === myId) || []), food = pl.food, meat = mpp[21] || 0, fish1 = mpp[27] || 0, fish2 = mpp[28] || 0, fish3 = mpp[29] || 0, sig = food + ',' + meat + ',' + fish1 + ',' + fish2 + ',' + fish3; if (sig === potSig) return; potSig = sig;
  $('potInv').textContent = '🍓 ' + food + (meat ? '  🍖 ' + meat : '') + (fish1 ? '  🐟 ' + fish1 : '') + (fish2 ? '  🐠 ' + fish2 : '') + (fish3 ? '  🐡 ' + fish3 : '') + ' (chests incl.)'; const list = $('potList'); list.innerHTML = '';
  for (const f of RC.FOOD) {
    const have = { food, meat, fish1, fish2, fish3 }, FI = { meat: '🍖', fish1: '🐟', fish2: '🐠', fish3: '🐡' }, ok = Object.entries(f.cost).every(([k, n]) => (have[k] || 0) >= n), d = document.createElement('div'); d.className = 'rc';
    const co = Object.entries(f.cost).map(([k, n]) => '<span class="' + ((have[k] || 0) >= n ? '' : 'no') + '">' + (FI[k] || '🍓') + ' ' + (have[k] || 0) + '/' + n + '</span>').join(' &nbsp; ');
    d.innerHTML = '<div class="ic">' + f.e + '</div><div class="tx"><div class="nm">' + f.n + ' <span style="font-weight:400;opacity:.7;font-size:11px">' + f.type + '</span></div><div class="ds">' + f.d + '</div><div class="co">' + co + '</div></div>';
    d.classList.add('pick'); if (!ok) d.classList.add('dim');   // the whole row is the button: tap anywhere on it to cook
    d.onclick = () => {
      if (!ok) { const m = $('potMsg'); m.textContent = 'Not enough ingredients for ' + f.n + '.'; m.style.color = '#ff8a80'; return; }
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'cook', id: f.id }));
    };
    list.appendChild(d);
  }
}
// smelter menu: nothing happens until you put rocks in (5 rocks = 1 metal scrap); it shows what is loaded and how far along it is
let smeltId = null, smeltSig = '';
function openSmelt(id) { setCraft(false); closeChest(); closePot(); smeltId = id; smeltSig = ''; $('smelt').style.display = 'flex'; $('smeltMsg').textContent = ''; armDismantle($('smeltDis'), () => smeltId); buildSmelt(); }
function closeSmelt() { smeltId = null; $('smelt').style.display = 'none'; }
function buildSmelt() {
  const e = structE[smeltId]; if (!e) { closeSmelt(); return; }
  const stone = pooled().stone, q = (e.smelt || [0, 0])[0], C = RC.SMELT.cost, free = RC.SMELT.queue - q, can = Math.min(free, Math.floor(stone / C));
  const sig = stone + '|' + q; if (sig === smeltSig) return; smeltSig = sig;
  $('smeltInv').textContent = '🪨 ' + stone + ' (chests incl.)';
  const list = $('smeltList'); list.innerHTML = '';
  const d = document.createElement('div'); d.className = 'rc';
  d.innerHTML = '<div class="ic">🔩</div><div class="tx"><div class="nm">Metal scrap</div><div class="ds">' + C + ' rocks smelt into 1 scrap in ' + RC.SMELT.time + ' s. Tap here to put in ' + C + ' rocks (1 scrap) each time.</div>' +
    '<div class="co">' + (q ? 'Smelting: <b>' + q + '</b> scrap (' + q * C + ' rocks inside)' : '<span style="opacity:.8">Empty. Put rocks in to start it.</span>') + ' &nbsp; Room for ' + free + ' more</div></div>';
  d.classList.add('pick'); if (can < 1) d.classList.add('dim');   // the whole row is the button: each tap puts in 5 rocks = 1 metal scrap
  d.onclick = () => { if (can < 1) { $('smeltMsg').textContent = free ? 'You need ' + C + ' rocks (your bag plus the chests).' : 'The smelter is full.'; $('smeltMsg').style.color = '#ff8a80'; return; } if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'smelt', id: smeltId, n: 1 })); };
  list.appendChild(d);
  if (!free) { $('smeltMsg').textContent = 'The smelter is full.'; $('smeltMsg').style.color = '#ffd000'; }
  else if (can < 1) { $('smeltMsg').textContent = 'You need ' + C + ' rocks (your bag plus the chests).'; $('smeltMsg').style.color = '#ff8a80'; }
}
$('chestClose').onclick = closeChest; $('potClose').onclick = closePot; $('smeltClose').onclick = closeSmelt;

// ---- teammate pointers: like the campfire one, a badge pinned to the screen edge toward each other player who is off screen ----
const plPtrs = {}; let plPtrBox = null;
const PL_COL = ['#4fc3f7', '#ba68c8', '#81c784', '#ff8a65', '#f06292', '#fff176', '#90a4ae', '#a1887f'];
function updatePlayerPtrs(ox, oy) {   // (ox, oy) = where world (0,0) is on screen right now
  if (!plPtrBox) { plPtrBox = document.createElement('div'); plPtrBox.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6'; document.body.appendChild(plPtrBox); }
  const cx = W / 2, cy = H / 2, margin = 26, L = 34, Rr = W - 34, Tp = 124, Bt = H - 56, seen = {};
  for (const p of S.p) {
    if (p[0] === myId) continue; const e = ents2['p' + p[0]]; if (!e) continue; seen[p[0]] = 1;
    let el = plPtrs[p[0]];
    if (!el) {
      const col = PL_COL[(p[0] - 1) % PL_COL.length], d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
      d.innerHTML = '<div class="pb" style="position:absolute;left:-19px;top:-19px;width:38px;height:38px;border-radius:50%;background:#0b1a2acc;border:3px solid ' + col + ';display:flex;align-items:center;justify-content:center;font-size:20px"></div>' +
        '<div class="pa" style="position:absolute;left:-8px;top:-10px;width:16px;line-height:20px;font-size:17px;text-align:center;color:' + col + ';text-shadow:0 1px 3px #000">▶</div>' +
        '<div class="pn" style="position:absolute;left:-40px;top:21px;width:80px;text-align:center;font-size:11px;font-weight:700;text-shadow:0 1px 3px #000"></div>';
      plPtrBox.appendChild(d); el = plPtrs[p[0]] = { d, b: d.children[0], a: d.children[1], n: d.children[2], icon: '', txt: '' };
    }
    const sx = ox + e.x * Z, sy = oy + e.y * Z;
    if (sx > margin && sx < W - margin && sy > margin && sy < H - margin) { el.d.style.display = 'none'; continue; }   // already on screen
    const dx = sx - cx, dy = sy - cy; let t = Infinity;
    if (dx > 0) t = Math.min(t, (Rr - cx) / dx); else if (dx < 0) t = Math.min(t, (L - cx) / dx);
    if (dy > 0) t = Math.min(t, (Bt - cy) / dy); else if (dy < 0) t = Math.min(t, (Tp - cy) / dy);
    let px = cx + dx * t, py = cy + dy * t; if (px > W - 250) py = Math.min(py, H - 290);
    const icon = p[10] ? '🆘' : ((GC.BY[p[2]] || {}).e || '🙂'), txt = (p[1] || '').slice(0, 9) + ' · ' + Math.round(Math.hypot(e.x - (me0x()), e.y - (me0y())) / 10) + 'm';
    el.d.style.display = 'block'; el.d.style.transform = 'translate(' + Math.round(px) + 'px,' + Math.round(py) + 'px)';
    el.a.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad) translateX(30px)';
    if (el.icon !== icon) { el.icon = icon; el.b.textContent = icon; } if (el.txt !== txt) { el.txt = txt; el.n.textContent = txt; el.n.style.color = p[10] ? '#ff8a80' : '#fff'; }
  }
  for (const id in plPtrs) if (!seen[id]) { plPtrs[id].d.remove(); delete plPtrs[id]; }
}
const me0x = () => { const m = ents2['p' + myId]; return m ? m.x : 0; }, me0y = () => { const m = ents2['p' + myId]; return m ? m.y : 0; };
// ---- campfire pointer: a little 🔥 icon pinned to the screen edge, in the direction of the camp (hidden while the campfire is on screen) ----
function updateCampPtr(wx, wy) {   // (wx, wy) = where world (0,0) is on screen right now; the pointer aims at the campfire nearest to you (home fire or a camp)
  let fx = 0, fy = 0, fuelOn = S && S.f && S.f[0] > 0, bd = Math.hypot(camX, camY);
  for (const c of (S && S.cf) || []) { const d = Math.hypot(c[1] - camX, c[2] - camY); if (d < bd) { bd = d; fx = c[1]; fy = c[2]; fuelOn = c[3] > 0; } }
  const ox = wx + fx * Z, oy = wy + fy * Z;
  if (!fuelOn) { $('campPtr').style.display = 'none'; return; }   // the marker disappears while that fire is out
  const ptr = $('campPtr'), cx = W / 2, cy = H / 2, dx = ox - cx, dy = oy - cy, margin = 26;
  if (ox > margin && ox < W - margin && oy > margin && oy < H - margin) { ptr.style.display = 'none'; return; }   // you can already see it
  const L = 34, Rr = W - 34, Tp = 124, Bt = H - 56;   // keep clear of the top HUD and the screen edges
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (Rr - cx) / dx); else if (dx < 0) t = Math.min(t, (L - cx) / dx);
  if (dy > 0) t = Math.min(t, (Bt - cy) / dy); else if (dy < 0) t = Math.min(t, (Tp - cy) / dy);
  let px = cx + dx * t, py = cy + dy * t;
  if (px > W - 250) py = Math.min(py, H - 290);   // stay above the ACT / ATTACK / CRAFT buttons
  const lit = fuelOn;
  ptr.style.display = 'block'; ptr.style.transform = 'translate(' + Math.round(px) + 'px,' + Math.round(py) + 'px)';
  $('campArrow').style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad) translateX(35px)';
  $('campBadge').style.opacity = lit ? 1 : .55; $('campBadge').style.filter = lit ? '' : 'grayscale(1)';
  const ds = Math.round(bd / 10) + 'm'; if ($('campDist').textContent !== ds) $('campDist').textContent = ds;
}

let snapDur = .066, lastSnapAt = 0;
function aim(e, x, y, now) { e.px = e.x; e.py = e.y; if (Math.hypot(x - e.x, y - e.y) > 250) { e.px = e.x = x; e.py = e.y = y; } e.tx = x; e.ty = y; e.t0 = now; }
const islandIdx = (x, y) => { if (Math.hypot(x, y) < RR + 160) return 0; const i = ISL.findIndex(q => inIsl(q, x, y, -160)); return i < 0 ? -1 : i + 1; };
function fireSound(fx, fy, name) {   // a fire's sound comes from the fire: quieter the farther away, silent from another island (or at sea)
  const me = ents2['p' + myId]; if (!me) return; const a = islandIdx(fx, fy); if (a < 0 || a !== islandIdx(me.x, me.y)) return;
  SFX[name](Math.hypot(fx - me.x, fy - me.y), fx - me.x);
}
function onSnap(m) {
  const nowS = performance.now(); if (lastSnapAt) snapDur += (Math.max(.04, Math.min(.15, (nowS - lastSnapAt) / 1000)) - snapDur) * .2; lastSnapAt = nowS;
  const prevS = S; S = m; const seen = {};
  const meE = ents2['p' + myId], _d = (x, y) => meE ? Math.hypot(x - meE.x, y - meE.y) : 0, _dx = x => meE ? x - meE.x : 0;
  for (const p of m.p) {
    const k = 'p' + p[0]; seen[k] = 1; let e = ents2[k];
    if (!e) { e = ents2[k] = mkPlayer(p); e.x = e.tx = p[3]; e.y = e.ty = p[4]; e.c.position.set(e.x, e.y); }
    aim(e, p[3], p[4], nowS); e.d = p;
    if (p[12] !== e.sw) { e.sw = p[12]; startSwing(e, p, _d(e.x, e.y), _dx(e.x)); }
  }
  for (const a of m.a) {
    const k = 'a' + a[0]; seen[k] = 1; let e = ents2[k];
    if (!e) { e = ents2[k] = mkAlien(a); e.x = e.tx = a[1]; e.y = e.ty = a[2]; e.c.position.set(e.x, e.y); if (a[5] === 2 && prevS) { SFX.roar(); shake = Math.max(shake, .4); warnUntil = performance.now() + 7000; } }
    if (e.lh >= 0 && a[3] < e.lh) { e.flash = .12; burst(e.x, e.y, 6, 0xc6ff2a, 120, true, .1); SFX.hit(_d(e.x, e.y), _dx(e.x)); }
    e.lh = a[3]; aim(e, a[1], a[2], nowS); e.d = a;
  }
  for (const w of m.wf || []) {   // snow wolves
    const k = 'w' + w[0]; seen[k] = 1; let e = ents2[k];
    if (!e) { e = ents2[k] = mkWolf(w); e.x = e.tx = w[1]; e.y = e.ty = w[2]; e.c.position.set(e.x, e.y); }
    if (e.lh >= 0 && w[4] < e.lh) { e.flash = .12; burst(e.x, e.y, 6, 0xffffff, 110, false, .1); SFX.hit(_d(e.x, e.y), _dx(e.x)); }
    if (w[6] === 1 && e.st !== 1) SFX.growl(_d(e.x, e.y), _dx(e.x));   // it noticed you
    if (w[7] && !(e.d && e.d[7])) e.lunge = .25;   // bite
    if (e.vul) e.air = w[10] === 1;
    e.st = w[6]; e.lh = w[4]; aim(e, w[1], w[2], nowS); e.d = w;
  }
  for (const b of m.rb || []) {   // rabbits
    const k = 'r' + b[0]; seen[k] = 1; let e = ents2[k];
    if (!e) { e = ents2[k] = mkRabbit(b); e.x = e.tx = b[1]; e.y = e.ty = b[2]; e.c.position.set(e.x, e.y); }
    aim(e, b[1], b[2], nowS); e.d = b;
  }
  for (const k in ents2) if (!seen[k]) {
    const e = ents2[k];
    if (e.kind === 'w') { e.eyes.forEach(s => s.destroy()); SFX.hit(_d(e.x, e.y), _dx(e.x)); burst(e.x, e.y, 12, 0x9aa3ad, 140, false, .14); burst(e.x, e.y, 6, 0xc62828, 90, false, .1); }
    if (e.kind === 'r') { SFX.hit(_d(e.x, e.y), _dx(e.x)); burst(e.x, e.y, 9, 0xc62828, 110, false, .1); burst(e.x, e.y, 5, 0xf5f5f5, 70, false, .08); }
    if (e.kind === 'a') { SFX.alienDie(_d(e.x, e.y), _dx(e.x)); burst(e.x, e.y, 14, 0xb45fe0, 160, true, .2); burst(e.x, e.y, 8, 0xc6ff2a, 90, true, .12); e.eyes.forEach(s => s.destroy()); }
    e.c.destroy({ children: true }); delete ents2[k];
  }
  const resUp = (i, hp) => {   // one resource's new health (the full list arrives once when you join, after that only the ones that changed)
    const r = resNodes[i]; if (!r) return;
    if (!r.init) { r.init = true; r.hp = hp; if (hp <= 0) r.c.visible = false; return; }
    if (hp < r.hp) {
      let who = null, wd = 110; for (const p of m.p) { const dd = Math.hypot(p[3] - r.x, p[4] - r.y); if (dd < wd) { wd = dd; who = p; } }
      const fromX = who ? who[3] : r.x - 1;
      if (r.k === 'b') { SFX.pick(_d(r.x, r.y), _dx(r.x)); burst(r.x, r.y - 8, 10, 0xe53935, 140, false, .12); r.c.visible = false; }
      else {
        const d0 = _d(r.x, r.y), dx0 = _dx(r.x);
        r.barT = 1.6; r.hp = hp; drawPips(r);
        setTimeout(() => { hitFx(r, d0, dx0); if (hp <= 0) breakFx(r, fromX, d0, dx0); }, 170);
      }
    }
    if (hp > r.hp) { if (r.hp <= 0) { r.c.visible = true; r.pop = 0; r.s.rotation = 0; r.s.alpha = 1; } r.barT = 0; }
    r.hp = hp;
  };
  if (built && m.r) for (let i = 0; i < resNodes.length; i++) resUp(i, +m.r[i]);
  if (built && m.rd) for (let j = 0; j < m.rd.length; j += 2) resUp(m.rd[j], m.rd[j + 1]);
  syncDrops(m, _d, _dx);
  syncStructs(m, !prevS); syncBoats(m); syncSharks(m); syncPools(m); syncArrows(m); window.xSnap && xSnap(m);
  if (chestId !== null) { if (!nearStruct(chestId)) closeChest(); else buildChest(); }
  if (potOpen) { if (!anyPotNear()) closePot(); else buildPot(); }
  if (smeltId !== null) { if (!nearStruct(smeltId)) closeSmelt(); else buildSmelt(); }
  if (craftOpen) { const bid = nearestOf('bench'), me2 = ents2['p' + myId], benchNear = bid != null && nearStruct(bid) ? true : !!curCamp(me2); if (!benchNear) setCraft(false); else if (refreshSig() !== craftSig) buildCraft(); }
  const mp = m.p.find(p => p[0] === myId);
  if (mp) {
    if (lastInv) { const dw = mp[7] - lastInv[0], ds = mp[8] - lastInv[1], df = mp[9] - lastInv[2], e = ents2['p' + myId];
      if (e) { if (dw > 0) floatText(e.x, e.y, '+' + dw + ' wood', 0xffcc80); if (ds > 0) floatText(e.x, e.y, '+' + ds + ' stone', 0xcfd8dc); if (df > 0) floatText(e.x, e.y, '+' + df + ' food', 0xff8a80); } }
    lastInv = [mp[7], mp[8], mp[9]];
    if (lastHp !== null && mp[5] < lastHp && lastMe && Math.hypot(mp[3] - lastMe[0], mp[4] - lastMe[1]) > 140) { shake = .7; SFX.slam(); }   // sent flying by the Charger
    lastMe = [mp[3], mp[4]];
    if (lastHp !== null && mp[5] < lastHp) { shake = Math.max(shake, .3); SFX.hurt(); const h = $('hurt'); h.style.opacity = '1'; setTimeout(() => h.style.opacity = '0', 120); }
    lastHp = mp[5];
  }
  if (prevS && m.n > prevS.n) floatText(0, -120, 'Night ' + m.n + ' begins', 0xffffff);
  if (prevS) {
    if (m.ph === 1 && prevS.ph !== 1) notice('Night is approaching...');
    if (prevS.f[0] >= 25 && m.f[0] < 25 && m.f[0] > 0) notice('Fire is low - bring wood!');
    for (const c of m.cf || []) { const o = (prevS.cf || []).find(q => q[0] === c[0]); if (o && o[3] >= 25 && c[3] < 25 && c[3] > 0) notice('A campfire is low - bring wood!'); }   // everyone hears about any campfire running low
    if (m.ph !== prevS.ph) { if (m.ph === 1) SFX.horn(); else if (m.ph === 2) SFX.night(); else SFX.dawn(); }
    if (m.f[0] > prevS.f[0] + 5) fireSound(0, 0, 'feed');
    if (m.f[2] > prevS.f[2]) fireSound(0, 0, 'levelup');
    if (prevS.f[0] > 0 && m.f[0] <= 0) fireSound(0, 0, 'fireOut');
    for (const p of m.p) { const o = prevS.p.find(q => q[0] === p[0]); if (!o) continue; if (!o[10] && p[10] && p[0] === myId) SFX.down(); if (o[10] && !p[10]) SFX.revive(); }
  }
}

// ---------- frame ----------
function darkness(c) { return c < 5 ? .74 * (1 - c / 5) : c < 90 ? 0 : c < 120 ? .74 * (c - 90) / 30 : .74; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
const rgb = c => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
let camX = 0, camY = 0, fireTick = 0, smokeTick = 0, ringR = 0;

app.ticker.add(() => {
  const dt = Math.min(.1, app.ticker.deltaMS / 1000); T += dt;
  const me = ents2['p' + myId];
  if (!S || !me || !built) return;
  water.visible = true;
  // smoothing + node updates
  for (const k in ents2) {
    const e = ents2[k], ox = e.x, oy = e.y;
    if (e.ph === undefined) { e.vx = e.vy = 0; e.ph = Math.random() * 6.28; }
    if (e.t0 === undefined) { e.px = e.x; e.py = e.y; e.t0 = -1e9; }
    // constant-speed glide from where we were to the newest server position over one snapshot interval (no exponential chasing)
    const u = Math.min(1.25, (performance.now() - e.t0) / 1000 / snapDur);
    e.x = e.px + (e.tx - e.px) * u; e.y = e.py + (e.ty - e.py) * u;
    const ks = Math.min(1, dt * 10); e.vx += ((e.x - ox) / dt - e.vx) * ks; e.vy += ((e.y - oy) / dt - e.vy) * ks;
    const vx = e.vx, vy = e.vy, sp = Math.hypot(vx, vy);
    e.c.position.set(e.x, e.y); e.c.zIndex = e.y;
    if (e.kind === 'p') {
      const p = e.d, down = p[10];
      { const la = p[0] === myId ? currentAim() : null;   // you face your crosshair / aim stick right away (no waiting for the server); everyone else faces where the server says they face
        if (!down && !e.swing) { if (la !== null) e.ang = angLerp(e.ang, la, Math.min(1, dt * 30)); else if (p[16] !== undefined && p[0] !== myId) e.ang = angLerp(e.ang, p[16] / 100, Math.min(1, dt * 14)); else if (sp > 12) e.ang = angLerp(e.ang, Math.atan2(vy, vx), Math.min(1, dt * 12)); } }
      if (e.swing) {
        const sw = e.swing; sw.t += dt;
        if (sw.t >= .42) { e.swing = null; e.tool.visible = false; }
        else {
          e.ang = sw.ang;
          if (sw.kind === 5) { const po = 6 + pokeOff(sw.t); e.tool.rotation = sw.ang; e.tool.position.set(Math.cos(sw.ang) * po, Math.sin(sw.ang) * po); }
          else { e.tool.rotation = sw.ang + swingOff(sw.t); e.tool.position.set(Math.cos(sw.ang) * 6, Math.sin(sw.ang) * 6); }
          if (sw.kind === 5 && !sw.hit && sw.t >= .2) {   // a long white streak along the poke, and a spark at the tip
            sw.hit = true; const th = new PIXI.Sprite(T_THRUST); th.anchor.set(0, .5); th.rotation = sw.ang; th.position.set(e.x + Math.cos(sw.ang) * 24, e.y + Math.sin(sw.ang) * 24); th.blendMode = BM.ADD; th.scale.set(.35); overL.addChild(th);
            parts.push({ s: th, vx: 0, vy: 0, life: .2, max: .2, s0: .35, s1: .4, a0: .85, g: 0 });
            const tip = 24 + 200 * .35; burst(e.x + Math.cos(sw.ang) * tip, e.y + Math.sin(sw.ang) * tip, 5, 0xffffff, 90, true, .08);
          }
          if (!sw.hit && sw.t >= .2) { sw.hit = true; const sl = new PIXI.Sprite(T_SLASH); sl.anchor.set(.1, .5); sl.rotation = sw.ang; sl.position.set(e.x + Math.cos(sw.ang) * 16, e.y + Math.sin(sw.ang) * 16); sl.blendMode = BM.ADD; sl.scale.set(.75); overL.addChild(sl); parts.push({ s: sl, vx: 0, vy: 0, life: .16, max: .16, s0: .75, s1: 1, a0: .75, g: 0 }); }
        }
      }
      { const rl = p[36] || 0;   // reloading: a ring fills around the feet and the magazine slides out, wobbles and snaps back in
        if (rl > 0 && !down) {
          if (!e.rlg) { e.rlg = new PIXI.Graphics(); e.c.addChild(e.rlg); }
          if (!e.rl) { e.rl = 1; SFX.reloadStart(Math.hypot(e.x - me.x, e.y - me.y), e.x - me.x); }
          const f = rl / 100, a = e.ang, g = e.rlg, out = Math.sin(Math.min(1, f) * Math.PI), wob = Math.sin(f * 22) * 2 * out;
          g.clear(); g.lineStyle(3, 0x000000, .45); g.arc(0, 8, 24, 0, TAU); g.lineStyle(3, 0xffd000, .95); g.arc(0, 8, 24, -Math.PI / 2, -Math.PI / 2 + TAU * f);
          const ox = Math.cos(a) * (14 + out * 14) - Math.sin(a) * wob, oy = Math.sin(a) * (14 + out * 14) + Math.cos(a) * wob + 2 + out * 4;
          g.lineStyle(1.5, 0x000000, .85); g.beginFill(0xb8bec6); g.drawRoundedRect(ox - 4, oy - 7, 8, 14, 2); g.endFill(); g.lineStyle(0); g.beginFill(0xd9a441); g.drawRect(ox - 3, oy - 10, 6, 3.5); g.endFill();
        } else if (e.rlg && e.rl) { e.rlg.clear(); e.rl = 0; if (!down) SFX.reloadEnd(Math.hypot(e.x - me.x, e.y - me.y), e.x - me.x); }
      }
      e.fall = Math.max(0, Math.min(1, (e.fall === undefined ? (down ? 1 : 0) : e.fall) + (down ? dt * 2.2 : -dt * 3)));   // 0 = standing, 1 = lying on the ground: tips over with a little stumble
      if (down && !e.wasDown) { burst(e.x, e.y + 6, 8, 0xd9c79a, 70, false, .12); } e.wasDown = down;
      const fu = ease(e.fall), tint = Math.round(255 - (255 - 0x77) * fu) & 255;
      e.body.rotation = e.ang + (((1.2 - e.ang + Math.PI) % TAU + TAU) % TAU - Math.PI) * fu; e.body.tint = (tint << 16) | (tint << 8) | tint;
      e.body.y = down || e.fall > 0 ? -Math.sin(fu * Math.PI) * 7 : Math.sin(T * 16 + e.ph) * (sp > 12 ? 1.8 : .4); e.body.scale.y = (.85 - .25 * fu) * (1 + (sp > 12 && !down ? Math.sin(T * 16) * .04 : 0));
      { const bn = p[30] > 0 ? String(p[30]) : ''; if (e.nbT !== bn + '|' + p[1]) { e.nbT = bn + '|' + p[1]; e.nb.text = bn; e.name.text = p[1]; e.nb.x = -e.name.width / 2 - 4; } }
      if (k === 'p' + myId) {   // stamina bar over your own character: shown while it's below full, red when winded
        const smx = p[32] || 100, tgt = p[17] === undefined ? smx : p[17]; e.stv += (tgt - e.stv) * Math.min(1, dt * 14);
        const show = e.stv < smx * .99 || p[18]; e.sta.visible = !!show && !down && !p[20];
        if (e.sta.visible) { const f = Math.max(0, e.stv / smx), tired = !!p[18], col = tired ? (Math.sin(T * 12) > 0 ? 0xff5252 : 0xb71c1c) : f < .3 ? 0xffb74d : 0xffee58; if (e.stDraw !== col + ':' + Math.round(f * 60)) { e.stDraw = col + ':' + Math.round(f * 60); drawHp(e.sta, 34, f, col); if (tired) { e.sta.beginFill(0xffffff, .85); e.sta.drawRect(-17 + 34 * .3 - .5, -1, 1, 7); e.sta.endFill(); } } }
      }
      if (e.lh !== p[5] || e.ld !== p[10] || e.lr !== p[11]) { e.lh = p[5]; e.ld = p[10]; e.lr = p[11]; if (p[10]) drawHp(e.hp, 40, Math.min(1, p[11] / 10), 0x4caf50); else drawHp(e.hp, 34, p[5] / p[6], 0xef5350); }
      if (!down && !p[20]) rustleBushes(e, sp);
      if (sp > 30 && !down && !p[20]) { e.st = (e.st || 0) - dt; if (e.st <= 0) { e.st = .3; SFX.step(Math.hypot(e.x - me.x, e.y - me.y), e.x - me.x); } e.dust -= dt; if (e.dust <= 0) { e.dust = .14; emit(pfx, T_GLOW, e.x, e.y + 8, rnd(-8, 8), rnd(-8, 4), .5, .12, .3, 0xd9c79a, .35, false, 0); } }
    } else if (e.kind === 'w' && e.vul) {   // vulture: wings beating high above the ground (its shadow stays on the ground), folded up when it has landed
      const w = e.d; e.age += dt; e.c.alpha = Math.min(1, e.age * 2); e.lift += ((e.air ? 1 : 0) - e.lift) * Math.min(1, dt * 3);
      e.c.renderable = Math.abs(e.x - camX) < W / Z / 2 + 120 && Math.abs(e.y - camY) < H / Z / 2 + 120;
      e.ang = angLerp(e.ang, w[3] / 100, Math.min(1, dt * 6)); e.body.rotation = e.ang; e.c.zIndex = e.y + (e.lift > .5 ? 4000 : 0);
      const tex2 = e.air ? T_VULF : T_VULL; if (e.body.texture !== tex2) e.body.texture = tex2;
      const flap = e.air ? 1 + Math.sin(T * 9 + e.x * .01) * .18 : 1; e.body.scale.set(.7, .7 * flap); e.body.y = -e.lift * 46; e.sh.scale.set(1.5 - e.lift * .3, .6 - e.lift * .15); e.sh.alpha = .55 - e.lift * .25; e.sh.y = 8;
      e.lunge = Math.max(0, e.lunge - dt); if (e.lunge > 0 && !e.air) { const lo = Math.sin(e.lunge / .25 * Math.PI) * 9; e.body.x = Math.cos(e.ang) * lo; e.body.y += Math.sin(e.ang) * lo; } else e.body.x = 0;
      e.flash = Math.max(0, e.flash - dt); e.body.tint = e.flash > 0 ? 0xff8a80 : 0xffffff;
      if (w[4] < w[5] && e.lh2 !== w[4]) { e.lh2 = w[4]; drawHp(e.hp, 34, w[4] / w[5], 0xef5350); e.hp.y = -34; e.hp.visible = true; } e.hp.alpha = e.air ? 0 : 1;
    } else if (e.kind === 'w') {   // wolf: trots when roaming, gallops when chasing or running home, lunges when it bites
      const w = e.d; e.age += dt; e.c.alpha = Math.min(1, e.age * 2);
      e.c.renderable = Math.abs(e.x - camX) < W / Z / 2 + (e.big ? 160 : 90) && Math.abs(e.y - camY) < H / Z / 2 + (e.big ? 160 : 90);
      e.ang = angLerp(e.ang, w[3] / 100, Math.min(1, dt * 10)); e.body.rotation = e.ang;
      const run = sp > 60; e.gait += dt * (e.big ? (run ? 6 : 3) : run ? 16 : sp > 6 ? 8 : 0);
      e.lunge = Math.max(0, e.lunge - dt); const lo = e.lunge > 0 ? Math.sin(e.lunge / .25 * Math.PI) * 10 : 0;
      e.body.x = Math.cos(e.ang) * lo; e.body.y = (sp > 6 ? -Math.abs(Math.sin(e.gait)) * (run ? 3 : 1.5) : 0) + Math.sin(e.ang) * lo;
      e.flash = Math.max(0, e.flash - dt); e.body.tint = e.flash > 0 ? 0xff8a80 : 0xffffff;
      if (w[4] < w[5] && e.lh2 !== w[4]) { e.lh2 = w[4]; drawHp(e.hp, e.hpW || (e.big === 2 ? 90 : e.big ? 60 : e.al ? 42 : 30), w[4] / w[5], 0xef5350); e.hp.y = e.hpY || (e.big === 2 ? -78 : e.big ? -48 : e.al ? -34 : -24); e.hp.visible = true; }
      if (e.eyes.length) { const ca = Math.cos(e.ang), sa = Math.sin(e.ang), o = e.impGlow ? 18 : 28 * 1.2 / 1, sy = e.impGlow ? 4 : 6; const bx = e.x + e.body.x, by = e.y + e.body.y;
        e.eyes[0].position.set(bx + ca * o - sa * -sy, by + sa * o + ca * -sy); e.eyes[1].position.set(bx + ca * o - sa * sy, by + sa * o + ca * sy);
        e.eyes.forEach(s => { s.visible = e.c.renderable; s.alpha = e.c.alpha * (.75 + Math.sin(T * 7 + e.x) * .25); }); }
    } else if (e.kind === 'r') {   // rabbit: faces where it hops, bounces while moving, fast hops when it runs
      const b = e.d; e.age += dt; e.c.alpha = Math.min(1, e.age * 2);
      e.c.renderable = Math.abs(e.x - camX) < W / Z / 2 + 80 && Math.abs(e.y - camY) < H / Z / 2 + 80;
      e.ang = angLerp(e.ang, b[3] / 100, Math.min(1, dt * 10)); e.body.rotation = e.ang;
      const moving = sp > 6; e.hop = moving ? e.hop + dt * (b[4] === 1 ? 13 : 7) : 0;
      const h = moving ? Math.abs(Math.sin(e.hop)) : 0, hopK = e.crit ? .25 : 1;   // only rabbits really hop; the others scuttle / waddle (a little rocking)
      e.body.y = -h * (b[4] === 1 ? 6 : 3.5) * hopK; e.sh.scale.set(.55 - h * .12 * hopK, .32 - h * .07 * hopK);
      e.body.scale.set(e.bs * (1 + h * .08 * hopK), e.bs * (1 - h * .05 * hopK)); if (e.crit) e.body.rotation = e.ang + (moving ? Math.sin(e.hop * (e.crit === 2 ? .9 : 1.6)) * (e.crit === 2 ? .22 : .1) : 0);
    } else {
      const a = e.d; e.age += dt; e.c.alpha = Math.min(1, e.age * 2);
      if (a[6] != null) e.ang = angLerp(e.ang, a[6] / 100, Math.min(1, dt * (e.charger ? 14 : 10)));   // turn toward the player it is going for (works while standing still, e.g. against the fire ring)
      else if (sp > 8) e.ang = angLerp(e.ang, Math.atan2(vy, vx), Math.min(1, dt * 8));
      e.body.rotation = e.ang; const pulse = 1 + Math.sin(T * 9 + e.x * .1) * .05; e.body.scale.set(e.sc * pulse);
      if (S.ph === 2 && Math.random() < dt * .12) { const gd = Math.hypot(e.x - me.x, e.y - me.y); if (gd < 520) SFX.growl(gd, e.x - me.x); }
      e.flash = Math.max(0, e.flash - dt); e.body.tint = e.flash > 0 ? 0xffffff : e.ak.tint;
      if (a[7] > 0) {   // caught in a trap: tinted, struggling, with a countdown over its head
        if (e.flash <= 0) e.body.tint = 0x8fb4ff; e.body.rotation += Math.sin(T * 34) * .06;
        if (!e.trapTxt) { e.trapTxt = new PIXI.Text('', { fontFamily: 'system-ui,sans-serif', fontSize: 15, fontWeight: '800', fill: 0xffe082, stroke: 0x000000, strokeThickness: 4 }); e.trapTxt.anchor.set(.5, 1); e.trapTxt.resolution = 2; e.trapTxt.y = e.ak.hpY - 14; e.c.addChild(e.trapTxt); }
        const tt = 'TRAPPED ' + a[7]; if (e.trapTxt.text !== tt) e.trapTxt.text = tt; e.trapTxt.visible = true;
      } else if (e.trapTxt) e.trapTxt.visible = false;
      if (a[3] < a[4] && e.lh2 !== a[3]) { e.lh2 = a[3]; drawHp(e.hp, e.ak.hpW, a[3] / a[4], e.charger ? 0xff5252 : 0xb6ff3c); e.hp.y = e.ak.hpY; e.hp.visible = true; }
      const ca = Math.cos(e.ang), sa = Math.sin(e.ang), o = e.ak.eo, sy = e.ak.es;
      if (e.eyes.length) e.eyes[0].position.set(e.x + ca * o - sa * -sy, e.y + sa * o + ca * -sy); if (e.eyes.length) e.eyes[1].position.set(e.x + ca * o - sa * sy, e.y + sa * o + ca * sy);
      e.eyes.forEach(s => s.alpha = e.c.alpha * (.75 + Math.sin(T * 6 + e.x) * .25));
      if (e.charger && sp > 90) { e.trail -= dt; if (e.trail <= 0) { e.trail = .04; emit(pfx, T_GLOW, e.x - Math.cos(e.ang) * 40 + rnd(-14, 14), e.y + 18 + rnd(-8, 8), -Math.cos(e.ang) * 30, rnd(-14, 6), .7, .32, .8, 0xd9c79a, .45, false, 0); } }   // dust kicked up by the charge
    }
    SPR.step(e, dt, sp);   // a loaded picture takes over from the code-drawn body (sprites.js)
  }
  SPR.stepNpcs(dt); SPR.stepPits();
  // resources: sway + pop-in
  const cullR = Math.max(W, H) / Z / 2 + 140;
  for (const ic of islandCs) ic.c.visible = Math.hypot(ic.x - camX, ic.y - camY) < ic.r + cullR * 1.42;   // island ground: drawn only when any of it can be on screen
  for (const r of resNodes) {
    const near = Math.abs(r.x - camX) < cullR && Math.abs(r.y - camY) < cullR;   // only resources near the camera are in the scene (there are thousands in the world)
    if (near) { if (!r.c.parent) ents.addChild(r.c); } else if (r.c.parent && (Math.abs(r.x - camX) > cullR * 1.3 || Math.abs(r.y - camY) > cullR * 1.3)) ents.removeChild(r.c);
    r.c.renderable = near; if (near && r.sv !== SPR.ver) SPR.res(r);
    if (r.barT > 0 && r.bar) { r.barT -= dt; if (r.barT <= 0) r.bar.clear(); else if (r.barT < .4) r.bar.alpha = r.barT / .4; else r.bar.alpha = 1; }
    if (r.shake > 0) r.shake = Math.max(0, r.shake - dt);
    if (!r.c.visible || !r.c.parent) continue;
    if (r.shake > 0) { const sh = Math.sin(T * 55) * r.shake; r.s.skew.x = sh * .22; r.s.x = sh * 3; r.s.y = Math.abs(sh) * -1.2; }
    else if (r.s.x !== 0 || r.s.y !== 0) { r.s.x = 0; r.s.y = 0; }
    if (r.pop < 1) { r.pop = Math.min(1, r.pop + dt * 2.5); const b = 1 - Math.pow(1 - r.pop, 3); r.s.scale.set(r.base * (.2 + .8 * b)); }
    if (r.shake <= 0) { if (WOODY(r.k)) r.s.skew.x = Math.sin(T * 1.3 + r.ph) * .035 + Math.sin(T * 3.1 + r.ph) * .01; else if (r.k === 'b') r.s.skew.x = Math.sin(T * 2 + r.ph) * .02; }
  }
  updateGhost(me);
  { // the ACT button names whatever ACT would do right now (same priority and ranges as the server)
    let lab = 'ACT';
    if (placingId) lab = 'PLACE';
    else if (me.d[20]) lab = GEAR.rod && (S.fp || []).some(q => Math.hypot(q[1] - me.x, q[2] - me.y) < 150) && !fishOpen ? 'FISH' : 'EXIT';
    else if (!me.d[10]) {
      const dist = (x, y) => Math.hypot(x - me.x, y - me.y); let st = null, sd = 1e9;   // the nearest station in reach (same rule as the server)
      for (const t of S.st || []) { if (t[1] !== 'bench' && t[1] !== 'chest' && t[1] !== 'pot' && t[1] !== 'smelter') continue; const dd = dist(t[2], t[3]); if (dd < RC.RADIUS[t[1]] + 62 && dd < sd) { sd = dd; st = t; } }
      if (st && Math.hypot(me.x, me.y) < 80 && Math.hypot(me.x, me.y) < sd) st = null;   // the fire is closer than the station
      let gt = null, gd = 70; for (const t of S.st || []) if (t[1] === 'gate') { const a = (t[7] || 0) * Math.PI / 4, ux = Math.cos(a), uy = Math.sin(a), u = Math.max(-52, Math.min(52, (me.x - t[2]) * ux + (me.y - t[3]) * uy)), d = Math.hypot(me.x - (t[2] + ux * u), me.y - (t[3] + uy * u)); if (d < gd) { gd = d; gt = t; } }   // a gate in reach: ACT swings it open / shut
      const pool = GEAR.rod && (S.fp || []).find(q => dist(q[1], q[2]) < 150);
      const nb = (S.bt || []).find(b => b[0] > 0 && dist(b[1], b[2]) < 125);   // (the visiting vendor's boat, id < 0, cannot be boarded)
      if (S.p.some(q => q[10] && q[0] !== myId && dist(q[3], q[4]) < 60)) lab = 'REVIVE';
      else if (nb) lab = nb[4] >= 2 ? 'FULL' : 'ENTER';
      else if (window.xActLabel && xActLabel(me)) lab = xActLabel(me);
      else if (pool && !fishOpen) lab = 'FISH';
      else if (gt) lab = gt[8] ? 'CLOSE' : 'OPEN';
      else if (st) lab = st[1] === 'bench' ? 'CRAFT' : st[1] === 'chest' ? 'OPEN' : st[1] === 'pot' ? 'COOK' : 'SMELT';
      else if (Math.hypot(me.x, me.y) < 80) {
        const feed = (GC.BY[me.d[2]] || GC.BY.forester).feed || 1;
        lab = S.f[1] - S.f[0] > 15 * feed * .5 ? 'REFUEL' : S.f[2] < RC.FIRE_MAX ? 'UPGRADE' : 'ACT';
      } else {
        let bd = 55, near = null; for (const r of resNodes) if (r.hp > 0) { const dd = dist(r.x, r.y); if (dd < bd) { bd = dd; near = r; } }
        if (near) lab = WOODY(near.k) ? 'CHOP' : ROCKY(near.k) ? 'MINE' : 'PICK';
        else if (curCamp(me) && !hasBench()) lab = 'BUILD';   // no bench yet: ACT in camp opens the build menu
      }
    }
    if (S.dr && !me.d[10] && (me.d[19] || []).length >= 3 && performance.now() - slotFullAt > 2500 && S.dr.some(q => q[1] === 'q' && Math.hypot(q[2] - me.x, q[3] - me.y) < 34)) { slotFullAt = performance.now(); floatText(me.x, me.y - 14, 'Slots full', 0xff8a80); }
    const ab = $('act'); if (ab.textContent !== lab) { ab.textContent = lab; ab.style.fontSize = lab.length > 6 ? '9.5px' : lab.length > 4 ? '11px' : ''; }
  }
  // camera
  camX += (me.x - camX) * Math.min(1, dt * 10); camY += (me.y - camY) * Math.min(1, dt * 10);
  if (T < 1) { camX = me.x; camY = me.y; }
  shake = Math.max(0, shake - dt); const sx = shake > 0 ? rnd(-1, 1) * shake * 18 : 0, sy2 = shake > 0 ? rnd(-1, 1) * shake * 18 : 0;
  const ox = W / 2 - camX * Z + sx, oy = H / 2 - camY * Z + sy2;
  world.position.set(ox, oy); world.scale.set(Z); overL.position.set(ox, oy); overL.scale.set(Z);
  updateCampPtr(ox, oy); updatePlayerPtrs(ox, oy);
  if ((updWaterAt = (updWaterAt || 0) + dt) > .25) { updWaterAt = 0; updateWaterIslands(camX, camY); }
  waterF.uniforms.uTime = T; waterF.uniforms.uCam = [camX - sx / Z, camY - sy2 / Z];
  // campfire
  const f = S.f, fuelK = clamp(f[0] / f[1], 0, 1), alive = f[0] > 0, fl = 1 + Math.sin(T * 17) * .06 + Math.sin(T * 29) * .04;
  flames.forEach((s, i) => { s.visible = alive; const w = (.5 + .5 * fuelK) * (1 - i * .22) * fl; s.scale.set(w * (1 + Math.sin(T * (9 + i * 3) + i) * .08), w * (1 + Math.sin(T * (13 + i * 4) + i * 2) * .14)); s.rotation = Math.sin(T * (6 + i * 2) + i) * .08; s.position.set((i - 1) * 4, 6); });
  { // standing at the fire: show what it needs (same rules as the server: ACT refuels with wood, then levels up with stone)
    const near = Math.hypot(me.x, me.y) < 80 && !me.d[10]; fireTip.visible = near;
    if (near) {
      const feed = (GC.BY[me.d[2]] || GC.BY.forester).feed || 1, need = f[1] - f[0], lines = [];
      if (need > 15 * feed * .5) lines.push('🪵 ×' + Math.ceil(need / (15 * feed)) + ' to refuel');
      lines.push(f[2] < RC.FIRE_MAX ? '⬆ Level ' + (f[2] + 1) + ': 🪨 ×' + 10 * f[2] : 'Fire is max level');
      const t = lines.join('\n'); if (fireTip.text !== t) fireTip.text = t;
    }
  }
  fireGlow.visible = alive; fireGlow.position.set(0, -6); fireGlow.scale.set((1.6 + fuelK * 1.4) * fl); fireGlow.alpha = .55;
  if (alive) { if (!ringR) ringR = f[3]; ringR += (f[3] - ringR) * Math.min(1, dt * 2.5); }
  ring.visible = alive; ring.scale.set(ringR * 2 / 256 * 1.0); ring.alpha = .35 + Math.sin(T * 2) * .08;
  if (alive) { fireTick += dt * (20 + 40 * fuelK); while (fireTick > 1) { fireTick--; emit(overL, T_GLOW, rnd(-8, 8), -2, rnd(-14, 14), rnd(-70, -35), rnd(.6, 1.3), .08, .01, Math.random() < .5 ? 0xffb347 : 0xffe08a, 1, true, -10); } }
  smokeTick += dt * (alive ? 4 : 9); while (smokeTick > 1) { smokeTick--; emit(pfx, T_GLOW, rnd(-6, 6), -14, rnd(-6, 6), rnd(-26, -14), 2.2, .25, .9, alive ? 0x555555 : 0x444444, alive ? .22 : .35, false, 0); }
  stepParts(dt); stepFallers(dt); stepDrops(dt); stepStructs(dt); stepBoats(dt); stepSharkFx(dt); stepPoolFx(dt); stepArrows(); window.xStep && xStep(dt, me);
  for (let i = ftexts.length - 1; i >= 0; i--) { const q = ftexts[i]; q.life -= dt; q.t.y -= dt * 34; q.t.alpha = clamp(q.life * 2, 0, 1); if (q.life <= 0) { q.t.destroy(); ftexts.splice(i, 1); } }
  // lighting
  const d = darkness(S.c);
  let col, al;
  if (S.c >= 90 && S.c < 120) { const k = (S.c - 90) / 30; col = mix([255, 140, 70], [10, 14, 46], Math.pow(k, .7)); al = .12 + (d - .12) * k; } else { col = [10, 14, 46]; al = d; }
  darkBase.visible = d > .005; darkBase.width = rt.width; darkBase.height = rt.height; darkBase.tint = rgb(col); darkBase.alpha = al;
  if (darkBase.visible) {
    let li = 0;
    if (window.xLights) li = xLights(li, sx, sy2);
    if (alive) { const L = getLight(li++); L.visible = true; L.position.set((W / 2 + (0 - camX) * Z + sx) * LS, (H / 2 + (0 - camY) * Z + sy2) * LS); const r = f[3] * 1.25 * Z * (1 + Math.sin(T * 13) * .012); L.scale.set(r * 2 * LS / 128); }
    for (const p of S.p) { const e = ents2['p' + p[0]]; if (!e) continue; const L = getLight(li++); L.visible = true; L.position.set((W / 2 + (e.x - camX) * Z + sx) * LS, (H / 2 + (e.y - camY) * Z + sy2) * LS); L.scale.set(((GC.BY[p[2]] || GC.BY.forester).light) * Z * 2 * LS / 128); L.alpha = p[10] ? .3 : 1; }
    for (let j = li; j < lightPool.length; j++) lightPool[j].visible = false;
    app.renderer.render(lightCont, { renderTexture: rt, clear: true });
  }
  lightSpr.visible = darkBase.visible;
  // fog + fireflies react to darkness
  const nk = d / .74, sailing = !!((S.p.find(p => p[0] === myId) || [])[20]);   // no night fog or fireflies while you are out on a boat
  fogs.forEach(s => { s.visible = nk > .05 && !sailing; s.alpha = .13 * nk; s.scale.set(Math.max(W, H) / 128 * s.sc * 1.2); s.position.set(W / 2 + Math.sin(T * s.sp + s.ph) * W * .35 - camX * .15 % 50, H / 2 + Math.cos(T * s.sp * .8 + s.ph) * H * .3); });
  { const hw = W / Z / 2, hh = H / Z / 2, nf = Math.min(FLY_MAX, Math.round(4 * hw * hh * FLY_DENS));
    flies.forEach((s, i) => { s.visible = nk > .1 && i < nf && !sailing; if (!s.visible) return; s.position.set(camX + s.fx * hw + Math.sin(T * .6 + s.ph) * 40, camY + s.fy * hh + Math.cos(T * .5 + s.ph) * 30);
      if (isWaterC(s.x, s.y)) { s.visible = false; return; }   // fireflies only over land, never out on the sea
      s.alpha = nk * (.4 + .6 * Math.abs(Math.sin(T * 1.7 + s.ph))); }); }
  const md = Math.hypot(me.x, me.y);
  // ocean sound: only when water is actually on screen. How far is the shore in the direction it lies, compared with how far the screen reaches that way?
  let sAng = Math.atan2(me.y, me.x), shoreDist = Math.abs(edge(sAng) - md);   // how far is the nearest coast (of home or of whichever island is close), and in which direction
  for (let qi = 0; qi < ISL.length; qi++) { const q = ISL[qi], dx = me.x - q[0], dy = me.y - q[1], d = Math.hypot(dx, dy); if (d > q[2] * RC.SHAPE_MAX + 4000) continue; const an = Math.atan2(dy, dx), g = Math.abs(edgeJ(an, q[2], q[4] || (qi + 1) * 1.7, q[4] || 0) - d); if (g < shoreDist) { shoreDist = g; sAng = an; } }
  const ux = Math.max(Math.abs(Math.cos(sAng)), 1e-3), uy = Math.max(Math.abs(Math.sin(sAng)), 1e-3);
  const reach = Math.min(W / Z / 2 / ux, H / Z / 2 / uy), shoreVis = clamp((reach - shoreDist) / (reach * .55), 0, 1);
  SFX.update({ night: d / .74, shore: shoreVis * shoreVis, fire: alive ? clamp(1 - md / 520, 0, 1) : 0, alive });
  hud(me);
});

// ---------- HUD (DOM) ----------
let slotSig = '', slotFullAt = 0, menuClosedAt = 0;
function useSlotAt(i) {   // tap a slot (or press 1-3): the boat starts placement, anything else (food, trap) is used
  const it = ((S && S.p.find(q => q[0] === myId)) || [])[19] || []; if (!it[i]) return;
  if (RC.BOATS[it[i]]) { if (placingId === '__boat' && boatSlot === i) stopPlacing(); else startPlacingBoat(i); return; }   // tap the same boat again: put it away (unequip)
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'use', i }));
}
document.querySelectorAll('#slots .slot').forEach((el, i) => el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); useSlotAt(i); }));
function myFire() {   // [fuel, max, level] of the campfire on the island you are standing on (home's, or that island's camp); nearest one if your island has none
  const me = ents2['p' + myId]; if (!me) return S.f;
  const onHome = Math.hypot(me.x, me.y) < RR + 160, is = onHome ? null : ISL.find(q => inIsl(q, me.x, me.y, -160));
  if (onHome) return S.f;
  if (is) for (const c of S.cf || []) if (inIsl(is, c[1], c[2], 0)) return [c[3], c[4], c[5]];
  let best = S.f, bd = Math.hypot(me.x, me.y); for (const c of S.cf || []) { const d = Math.hypot(c[1] - me.x, c[2] - me.y); if (d < bd) { bd = d; best = [c[3], c[4], c[5]]; } } return best;
}
function hud() {
  const f = myFire(), mp = S.p.find(p => p[0] === myId), PH = ['DAY', 'DUSK', 'NIGHT'][S.ph], left = Math.ceil(S.ph === 0 ? 90 - S.c : S.ph === 1 ? 120 - S.c : 180 - S.c);
  $('t1').textContent = 'Night ' + S.n + ' · ' + PH + ' ' + left + 's · 🔥 Lv' + f[2];
  $('bar').firstElementChild.style.width = (100 * f[0] / f[1]) + '%';
  if (mp) $('inv').textContent = '🪵' + mp[7] + '  🪨' + mp[8] + '  🍓' + mp[9] + (mp[15] ? '  🔩' + mp[15] : '') + (mp[21] ? '  🍖' + mp[21] : '') + (mp[22] ? '  🪙' + mp[22] : '') + (mp[23] ? '  🐺' + mp[23] : '') + (mp[26] ? '  🐾' + mp[26] : '') + (mp[27] ? '  🐟' + mp[27] : '') + (mp[28] ? '  🐠' + mp[28] : '') + (mp[29] ? '  🐡' + mp[29] : '') + '   ❤ ' + mp[5] + '/' + mp[6];
  if (window.xHud) xHud(mp);
  if (mp && !window.xHud) { const sl = mp[19] || [], sig = sl.join(','); if (sig !== slotSig) { slotSig = sig; document.querySelectorAll('#slots .slot').forEach((el, i) => { const f = RC.ITEM_BY[sl[i]]; el.textContent = f ? f.e : ''; el.classList.toggle('full', !!f); el.title = f ? f.n + ' - tap to use' : 'empty'; }); } }
  { const sig = S.p.map(p => p[1] + '|' + p[31] + '|' + p[0] + '|' + p[2]).join('\n'); const pe = $('pl');   // every player, stacked, with their class level
    if (pe._sig !== sig) { pe._sig = sig; pe.textContent = ''; for (const p of S.p) { const row = document.createElement('div'), ic = document.createElement('span'), nm = document.createElement('span'), lv = document.createElement('span'); ic.textContent = (GC.BY[p[2]] || {}).e || '🙂'; ic.style.cssText = 'margin-right:5px'; nm.textContent = p[1] || 'Player'; lv.textContent = ' Lv ' + (p[31] || 1); lv.style.cssText = 'color:#ffd54f;font-weight:700;margin-left:4px'; row.style.cssText = 'font-size:13px;font-weight:700;text-shadow:0 1px 3px #000;line-height:1.35' + (p[0] === myId ? ';color:#fff' : ';color:#cfe8ff'); row.append(ic, nm, lv); pe.appendChild(row); } } }
  { const el = (performance.now() - buffAt) / 1000, bt = []; if (BUFF.speed - el > 0) bt.push('⚡' + Math.ceil(BUFF.speed - el) + 's'); if (BUFF.regen - el > 0) bt.push('💚' + Math.ceil(BUFF.regen - el) + 's'); if (BUFF.dmg - el > 0) bt.push('⚔' + Math.ceil(BUFF.dmg - el) + 's'); if (BUFF.regen2 - el > 0) bt.push('💖' + Math.ceil(BUFF.regen2 - el) + 's'); if (BUFF.invuln - el > 0) bt.push('✨' + Math.ceil(BUFF.invuln - el) + 's'); const bs = bt.join('  '); if ($('buffs').textContent !== bs) $('buffs').textContent = bs; }
  const now = performance.now(); let b = '';
  if (S.o) b = 'Everyone is down... heading back to the title screen';
  else if (now < warnUntil) b = '⚠ A CHARGER is hunting! It cannot be killed - stay inside the fire ring until dawn!';
  else if (mp && mp[10]) b = 'You are down - a teammate can revive you (they stand next to you and hold ACT for 10 s)';
  else if (now < noticeUntil) b = noticeText;
  else if (S.ph === 2 && f[0] <= 0) b = '⚠ The fire is out!';
  const bn = $('banner'); if (bn.textContent !== b) { bn.textContent = b; bn.style.fontSize = b.length > 60 ? '15px' : '22px'; }
}

// ---------- accounts (Google or emailed code) / lobby ----------
// In the Android/iPhone app the game files are inside the app and window.GAME_BASE (set when the app is built) is the server's address; on the website it is empty.
const BASE = window.GAME_BASE || '', WSBASE = BASE ? BASE.replace(/^http/, 'ws') : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const post = async (path, body) => { try { const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); } catch (e) { return { ok: false, err: 'Network problem. Check your connection.' }; } };
let token = '', myEmail = '', cfg = {}, runOver = false;
try { token = localStorage.getItem('tok') || ''; } catch (e) { }
function xpHud() {   // top-left: your level for the class you are playing and progress to the next one
  const el = $('xpL'); if (!el) return; const xp = PF.xp[sel] || 0, lv = GC.lvlOf(xp);
  el.textContent = lv >= GC.LV_MAX ? '⭐ Lv ' + lv + ' (max)' : '⭐ Lv ' + lv + ' · ' + (xp - GC.xpAt(lv)) + '/' + (GC.xpAt(lv + 1) - GC.xpAt(lv)) + ' xp';
}
const PF = { d: 0, owned: GC.DEFAULT_OWNED.slice(), xp: {}, bn: 0 };
let sel = 'forester', hadCls = false; try { const sc = localStorage.getItem('cls'); if (sc) { sel = sc; hadCls = true; } } catch (e) { }
function chosen() {
  const c = GC.BY[sel] || GC.BY.forester, ic = $('cIcon');
  ic.textContent = '';
  if (PCAN[c.id]) { const cv = document.createElement('canvas'); cv.width = cv.height = 64; cv.getContext('2d').drawImage(PCAN[c.id], 0, 0); SPR.icon(cv, c.id); cv.style.cssText = 'width:36px;height:36px;display:block'; ic.appendChild(cv); }
  else ic.textContent = c.e;
  $('cName').textContent = c.n + ' · Lv ' + GC.lvlOf(PF.xp[c.id]);
}
// ---------- game-over screen: what you killed, how the gems add up, and they fly into your gem pool ----------
const KILLN = { alien: ['👾', 'Aliens'], brute: ['👹', 'Brutes'], villager: ['🏹', 'Villagers'], mage: ['🔥', 'Cult mages'], zealot: ['🛡️', 'Zealots'], spitter: ['🤢', 'Spitters'], wolf: ['🐺', 'Wolves'], alpha: ['🐺', 'Alpha wolves'], bear: ['🐻', 'Bears'], mammoth: ['🦣', 'Mammoths'], boar: ['🐗', 'Boars'], golem: ['🪨', 'Magma golems'], imp: ['👺', 'Fire imps'], vulture: ['🦅', 'Vultures'], rabbit: ['🐇', 'Rabbits'], scorpion: ['🦂', 'Scorpions'], penguin: ['🐧', 'Penguins'], sal: ['🦎', 'Lava salamanders'] };
async function showGameOver(m) {
  const sleepMs = ms => new Promise(r => setTimeout(r, skip ? Math.min(ms, 30) : ms)); let skip = false;
  const countTo = (el, to, ms, fmt, sound) => new Promise(res => { const t0 = performance.now(); let last = -1; const step = now => { const u = skip ? 1 : Math.min(1, (now - t0) / ms), v = Math.round(to * (u * (2 - u))); if (v !== last) { last = v; el.textContent = fmt(v); if (sound && v > 0 && v <= to) SFX.coin(); } if (u < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
  let o = $('overScr'); if (o) o.remove();
  o = document.createElement('div'); o.id = 'overScr'; o.style.cssText = 'position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;align-items:center;background:radial-gradient(ellipse at 50% 30%,#1b2f4a,#060d18 70%);overflow-y:auto;padding:22px 14px 90px;color:#fff;font-family:system-ui,sans-serif;opacity:0;transition:opacity .6s';
  const kills = Object.entries(m.kills || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]), g = m.gems || {}, rows = [['Days survived', m.n + (m.n === 1 ? ' day' : ' days'), g.days || 0, '🌙'], ['Kill bonuses', '', g.kills || 0, '⚔️'], ['Chests & finds', '', (g.chest || 0) + (g.other || 0), '🧰']].filter(r => r[2] > 0 || r[0] === 'Days survived');
  o.innerHTML = '<div style="font-size:44px;font-weight:900;letter-spacing:3px;color:#ff6b5e;text-shadow:0 3px 14px #000;margin:6px 0 2px">GAME OVER</div>' +
    '<div style="opacity:.85;margin-bottom:14px">You survived <b>' + m.n + '</b> day' + (m.n === 1 ? '' : 's') + '</div>' +
    '<div style="width:min(440px,94vw);background:#10243a;border:2px solid #ffd000;border-radius:14px;padding:12px 16px;margin-bottom:12px"><div style="font-weight:800;margin-bottom:8px">Creatures defeated</div><div id="ovKills">' + (kills.length ? '' : '<div style="opacity:.7">Nothing this time.</div>') + '</div></div>' +
    '<div style="width:min(440px,94vw);background:#10243a;border:2px solid #7fe9ff;border-radius:14px;padding:12px 16px"><div style="font-weight:800;margin-bottom:8px">Gems earned</div><div id="ovGems"></div>' +
    '<div id="ovTotalRow" style="display:none;justify-content:space-between;align-items:center;border-top:1px solid #fff4;margin-top:8px;padding-top:8px;font-weight:800;font-size:20px"><span>Total</span><span id="ovTotal">💎 0</span></div></div>' +
    '<div id="ovPool" style="display:none;margin-top:14px;font-size:22px;font-weight:800;color:#7fe9ff">Your gems: <span id="ovPoolN">💎 ' + m.before + '</span></div>' +
    '<div style="position:fixed;left:0;right:0;bottom:0;padding:14px;background:linear-gradient(transparent,#060d18 40%);display:flex;justify-content:center"><button id="ovAgain" style="min-width:min(300px,80vw);padding:15px 24px;font-size:20px;font-weight:900;border:0;border-radius:14px;background:linear-gradient(#3fd196,#17835a);color:#fff;box-shadow:0 4px 14px #0008;opacity:.45" disabled>Try again</button></div>';
  document.body.appendChild(o); requestAnimationFrame(() => o.style.opacity = 1);
  $('ovAgain').onclick = () => { try { ws.close(); } catch (e) { } location.reload(); };
  setTimeout(() => { const b = $('ovAgain'); if (b) { b.disabled = false; b.style.opacity = 1; } }, 25000);   // never leave anyone stuck here
  o.addEventListener('pointerdown', e => { if (e.target.id !== 'ovAgain') skip = true; });   // tap anywhere to speed the count-up
  await sleepMs(700);
  for (const [k, n] of kills) {   // kills count up one creature type at a time
    const [em, nm] = KILLN[k] || ['❓', k], row = document.createElement('div'); row.style.cssText = 'display:flex;justify-content:space-between;padding:3px 0;font-size:17px';
    row.innerHTML = '<span>' + em + ' ' + nm + '</span><b class="cnt">0</b>'; $('ovKills').appendChild(row); await countTo(row.querySelector('.cnt'), n, 380 + Math.min(500, n * 20), v => '× ' + v, true); await sleepMs(120);
  }
  await sleepMs(500);
  for (const [nm, note, gems, em] of rows) {   // the gem tally, line by line
    const row = document.createElement('div'); row.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;font-size:17px';
    row.innerHTML = '<span>' + em + ' ' + nm + (note ? ' <span style="opacity:.65">(' + note + ')</span>' : '') + '</span><b class="cnt">💎 0</b>'; $('ovGems').appendChild(row); await countTo(row.querySelector('.cnt'), gems, 600, v => '💎 ' + v, true); await sleepMs(180);
  }
  const all = (g.days || 0) + (g.kills || 0) + (g.chest || 0) + (g.other || 0);
  $('ovTotalRow').style.display = 'flex'; await countTo($('ovTotal'), all, 700, v => '💎 ' + v, true); SFX.levelup(); await sleepMs(500);
  $('ovPool').style.display = 'block';
  const from = $('ovTotal').getBoundingClientRect(), to = $('ovPoolN').getBoundingClientRect(), flyN = Math.min(14, Math.max(3, all));   // gems fly from the total into the gem pool
  for (let i = 0; i < flyN; i++) {
    const f = document.createElement('div'); f.textContent = '💎'; f.style.cssText = 'position:fixed;z-index:80;font-size:22px;left:' + (from.left + from.width / 2) + 'px;top:' + (from.top + from.height / 2) + 'px;transition:transform .7s cubic-bezier(.5,0,.8,.6),opacity .7s;pointer-events:none'; document.body.appendChild(f);
    setTimeout(() => { f.style.transform = 'translate(' + (to.left + to.width / 2 - from.left - from.width / 2 + (Math.random() * 30 - 15)) + 'px,' + (to.top + to.height / 2 - from.top - from.height / 2) + 'px) scale(.6)'; f.style.opacity = .3; setTimeout(() => { f.remove(); SFX.coin(); }, 720); }, skip ? 0 : i * 70);
    await sleepMs(70);
  }
  await sleepMs(750); await countTo($('ovPoolN'), m.total - m.before, 900, v => '💎 ' + (m.before + v), true); setDia(m.total);
  $('ovAgain').disabled = false; $('ovAgain').style.opacity = 1;
}
function setDia(n) { PF.d = n; document.querySelectorAll('.diaN').forEach(e => e.textContent = n); }
function applyProfile(pr, useLast) {
  PF.owned = pr.owned; PF.xp = pr.xp || {}; PF.bn = pr.bn || 0; PF.abil = pr.abil || PF.abil; PF.save = pr.save || null; setDia(pr.d); window.xLobby && xLobby();
  if (useLast || !PF.owned.includes(sel)) sel = PF.owned.includes(pr.last) ? pr.last : 'forester';
  try { localStorage.setItem('cls', sel); } catch (e) { }
  chosen(); buildPicker();
}
try { $('name').value = localStorage.getItem('nm') || ''; } catch (e) { }
const q = new URLSearchParams(location.search).get('room'); if (q) $('room').value = q;

// class picker
const TIERS = [[0, 'Unlocked'], [50, 'Tier 1 · 50 💎'], [120, 'Tier 2 · 120 💎'], [250, 'Tier 3 · 250 💎'], [400, 'Tier 4 · 400 💎']];
function buildPicker() {
  const box = $('grid'); box.innerHTML = '';
  for (const [price, title] of TIERS) {
    const h = document.createElement('div'); h.className = 'tier'; h.textContent = title; box.appendChild(h);
    const row = document.createElement('div'); row.className = 'row'; box.appendChild(row);
    for (const c of GC.LIST.filter(x => x.price === price)) {
      const owned = PF.owned.includes(c.id), d = document.createElement('div'); d.className = 'card' + (c.id === sel ? ' sel' : '') + (owned ? '' : ' locked');
      const cvs = document.createElement('canvas'); cvs.width = cvs.height = 64; cvs.getContext('2d').drawImage(PCAN[c.id], 0, 0); SPR.icon(cvs, c.id); d.appendChild(cvs);
      const st = '❤' + c.hp + '  ⚔' + c.dmg + '  👟' + c.spd;
      d.insertAdjacentHTML('beforeend', '<div class="cn">' + c.e + ' ' + c.n + (owned ? ' <span style="color:#ffd54f;font-size:12px">Lv ' + GC.lvlOf(PF.xp[c.id]) + '</span>' : '') + '</div><div class="cd">' + c.d + '</div><div class="cs">' + st + '</div><div class="cb">' + (c.id === sel ? '✔ Selected' : owned ? 'Tap to select' : '🔒 ' + c.price + ' 💎') + '</div>');
      window.xCard && xCard(c, d);
      d.onclick = () => owned ? pick(c.id) : askBuy(c.id);
      row.appendChild(d);
    }
  }
}
function pick(id) { sel = id; try { localStorage.setItem('cls', id); } catch (e) { } chosen(); buildPicker(); $('picker').style.display = 'none'; }
let buying = null;
function askBuy(id) {
  const c = GC.BY[id]; buying = id; const need = c.price - PF.d;
  $('buyTxt').innerHTML = '<b>' + c.e + ' ' + c.n + '</b><br>' + c.d + '<br><br>Price: ' + c.price + ' 💎<br>You have: ' + PF.d + ' 💎' + (need > 0 ? '<br><span style="color:#ff8a80">Need ' + need + ' more 💎 (earn them by surviving nights)</span>' : '');
  $('buyGo').style.display = need > 0 ? 'none' : ''; $('buy').style.display = 'flex';
}
$('buyNo').onclick = () => { $('buy').style.display = 'none'; };
$('buyGo').onclick = async () => {
  $('buyGo').disabled = true;
  try {
    const r = await post('/api/buy', { token, cls: buying });
    if (r.err === 'auth') { logoutUI('Please sign in again.'); return; }
    if (r.ok) { applyProfile(r.profile); SFX.init(); SFX.levelup(); pick(buying); }
    else if (r.profile) { applyProfile(r.profile); buildPicker(); if (r.err === 'need') { } }
    if (!r.ok) { $('buyTxt').insertAdjacentHTML('beforeend', '<br><span style="color:#ff8a80">' + (r.err === 'need' ? 'Not enough 💎' : 'Could not buy') + '</span>'); }
  } catch (e) { }
  $('buyGo').disabled = false; $('buy').style.display = 'none';
};
$('chooseBtn').onclick = () => { buildPicker(); $('picker').style.display = 'flex'; };
$('pickDone').onclick = () => { $('picker').style.display = 'none'; };


// ---- sign in ----
function showLogin(msg) { $('login').style.display = 'flex'; $('lmsg').textContent = msg || ''; $('stepEmail').style.display = ''; $('stepCode').style.display = 'none'; }
function logoutUI(msg) { token = ''; myEmail = ''; try { localStorage.removeItem('tok'); } catch (e) { } if (ws) { try { ws.close(); } catch (e) { } ws = null; } myId = 0; $('picker').style.display = 'none'; $('buy').style.display = 'none'; showLogin(msg); }
function loggedIn(r) {
  token = r.token || token; myEmail = r.email; try { localStorage.setItem('tok', token); localStorage.removeItem('pid'); } catch (e) { }
  $('who').textContent = myEmail; $('login').style.display = 'none'; applyProfile(r.profile, !hadCls); hadCls = true; $('err').textContent = '';
  try { const rr = JSON.parse(sessionStorage.getItem('runres') || 'null'); sessionStorage.removeItem('runres'); if (rr) $('runres').textContent = 'Last run: ' + rr.n + ' day' + (rr.n === 1 ? '' : 's') + ' survived  ·  +' + rr.d + ' 💎'; } catch (e) { }
  let rj = 0; try { rj = +sessionStorage.getItem('rejoin') || 0; sessionStorage.removeItem('rejoin'); } catch (e) { }
  if (rj && Date.now() - rj < 20 * 60 * 1000 && $('room').value) setTimeout(() => $('go').onclick(), 0);   // dropped mid-game: jump straight back into the same room
}
const legacyPid = () => { try { return localStorage.getItem('pid') || ''; } catch (e) { return ''; } };
let pendingEmail = '';
$('sendCode').onclick = async () => {
  const em = $('email').value.trim(); if (!em) { $('lmsg').textContent = 'Enter your email address.'; return; }
  $('sendCode').disabled = true; $('lmsg').textContent = 'Sending...';
  const r = await post('/api/auth/email/start', { email: em });
  $('sendCode').disabled = false;
  if (r.ok) { pendingEmail = em; $('lmsg').textContent = ''; $('sentTo').textContent = em; $('stepEmail').style.display = 'none'; $('stepCode').style.display = ''; $('code').value = ''; $('code').focus(); }
  else $('lmsg').textContent = r.err || 'Could not send the code.';
};
$('email').addEventListener('keydown', e => { if (e.key === 'Enter') $('sendCode').click(); });
$('verify').onclick = async () => {
  const c = $('code').value.replace(/\D/g, ''); if (c.length !== 6) { $('lmsg').textContent = 'Enter the 6-digit code from the email.'; return; }
  $('verify').disabled = true; $('lmsg').textContent = 'Checking...';
  const r = await post('/api/auth/email/verify', { email: pendingEmail, code: c, pid: legacyPid() });
  $('verify').disabled = false;
  if (r.ok) loggedIn(r); else $('lmsg').textContent = r.err || 'Could not sign in.';
};
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('verify').click(); });
$('backEmail').onclick = () => { $('lmsg').textContent = ''; $('stepCode').style.display = 'none'; $('stepEmail').style.display = ''; };
$('signout').onclick = async () => { await post('/api/auth/logout', { token }); logoutUI(''); };
$('delacct').onclick = async () => {
  if (!confirm('Delete your account and ALL of your progress (diamonds, classes, saved game)? This cannot be undone.')) return;
  if (!confirm('Really delete everything? Last chance.')) return;
  const r = await post('/api/account/delete', { token }); if (r.ok) { try { localStorage.removeItem('tok'); } catch (e) { } logoutUI('Your account was deleted.'); } else alert(r.err || 'Could not delete the account. Try again.');
};
function initGoogle(clientId) {
  const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
  sc.onload = () => {
    google.accounts.id.initialize({ client_id: clientId, callback: async resp => {
      $('lmsg').textContent = 'Signing in...'; const r = await post('/api/auth/google', { credential: resp.credential, pid: legacyPid() });
      if (r.ok) loggedIn(r); else $('lmsg').textContent = r.err || 'Google sign-in failed.';
    }, auto_select: false });
    google.accounts.id.renderButton($('gbtn'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', width: 280 });
    $('gwrap').style.display = ''; $('orline').style.display = '';
  };
  sc.onerror = () => { $('gwrap').style.display = 'none'; };
  document.head.appendChild(sc);
}
function initApple(clientId) {
  const sc = document.createElement('script'); sc.async = true; sc.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
  sc.onload = () => {
    try { AppleID.auth.init({ clientId, scope: 'name email', redirectURI: location.origin + '/', usePopup: true }); } catch (e) { return; }
    $('awrap').style.display = ''; $('orline').style.display = '';
  };
  sc.onerror = () => { $('awrap').style.display = 'none'; };
  document.head.appendChild(sc);
  document.addEventListener('AppleIDSignInOnSuccess', async ev => {
    const cred = ev.detail && ev.detail.authorization && ev.detail.authorization.id_token; if (!cred) return;
    $('lmsg').textContent = 'Signing in...'; const r = await post('/api/auth/apple', { credential: cred, pid: legacyPid() });
    if (r.ok) loggedIn(r); else $('lmsg').textContent = r.err || 'Apple sign-in failed.';
  });
  document.addEventListener('AppleIDSignInOnFailure', ev => { const e = ev.detail && ev.detail.error; if (e && e !== 'popup_closed_by_user' && e !== 'user_cancelled_authorize') $('lmsg').textContent = 'Apple sign-in was cancelled or failed.'; });
}
(async function boot() {
  try { cfg = await (await fetch(BASE + '/api/config', { cache: 'no-store' })).json(); } catch (e) { cfg = {}; }
  if (cfg.google && !window.IN_APP) initGoogle(cfg.google);   // (Google / Apple pop-ups do not work inside an app's web view: the app signs in with an emailed code)
  if (cfg.apple && !window.IN_APP) initApple(cfg.apple);
  if (token) { const r = await post('/api/auth/session', { token }); if (r.ok) { loggedIn(r); return; } token = ''; try { localStorage.removeItem('tok'); } catch (e) { } }
  showLogin('');
})();

$('go').onclick = () => {
  if (!token) { showLogin('Please sign in to play.'); return; }
  SFX.init();
  const name = $('name').value.trim() || 'Survivor'; try { localStorage.setItem('nm', name); } catch (e) { }
  $('err').textContent = 'Connecting...';
  ws = new WebSocket(WSBASE);
  const wantLoad = !!window.loadSaveFlag; window.loadSaveFlag = false;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, cls: sel, room: $('room').value, token, load: wantLoad }));
  ws.onerror = () => $('err').textContent = 'Could not connect';
  ws.onclose = () => {
    if (!myId || runOver) return; $('banner').textContent = 'Connection lost - reconnecting...';
    try { sessionStorage.setItem('rejoin', String(Date.now())); } catch (e) { }
    const tryBack = async () => { try { const r = await fetch(BASE + '/api/config', { cache: 'no-store' }); if (r.ok) { location.reload(); return; } } catch (e) { } setTimeout(tryBack, 2000); };
    setTimeout(tryBack, 1500);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'err') { if (m.m === 'auth') logoutUI('Your session expired. Please sign in again.'); else { $('err').textContent = m.m; ws.close(); ws = null; } }
    else if (m.t === 'init') {
      myId = m.id; RR = m.R; ISL = m.isl ? m.isl.slice(1) : []; roomCode = m.room; GEAR = m.gear || {}; buildWorld(m.res); if (m.prof) { PF.owned = m.prof.owned; PF.xp = m.prof.xp || PF.xp; PF.bn = m.prof.bn || 0; PF.abil = m.prof.abil || []; setDia(m.prof.d); } window.xInit && xInit(m);
      xpHud(); $('lobby').style.display = 'none'; $('hud').style.display = 'block'; $('btns').style.display = 'block';
      $('rm').textContent = 'Room ' + roomCode; tipUntil = performance.now() + 14000; history.replaceState(null, '', '?room=' + roomCode);
    } else if (m.t === 'crafted') {
      GEAR = m.gear || GEAR; const msg = $('craftMsg'); msg.textContent = m.msg || ''; msg.style.color = m.ok ? '#7fe9a0' : '#ff8a80';
      if (placingId && m.id === placingId) { if (m.ok) { const r = RC.BY[placingId], pl = pooled(); if ((r.kind !== 'wall' && r.kind !== 'trap' && r.kind !== 'gate' && r.kind !== 'spike') || pl.wood < r.cost.wood || pl.stone < r.cost.stone || pl.scrap < (r.cost.scrap || 0)) stopPlacing(); } else { const me0 = ents2['p' + myId]; if (me0) floatText(me0.x, me0.y - 6, m.msg || 'Cannot place here', 0xff8a80); } }
      if (m.ok) { SFX.levelup(); const me = ents2['p' + myId]; if (me) floatText(me.x, me.y - 10, m.msg, 0xffe082); }
      if (craftOpen) buildCraft();
    } else if (m.t === 'bite') { shake = Math.max(shake, .6); SFX.hit(0, 0); SFX.build(0, 0); notice('🦈 The shark bit the boat!');
    } else if (m.t === 'toast') {
      const me = ents2['p' + myId]; if (me) floatText(me.x, me.y - 6, m.msg, 0xff8a80); SFX.pickup();
    } else if (m.t === 'open') {
      if (performance.now() - menuClosedAt < 700) return;   // you just closed it with E / Space: the server's reply to that same key press must not pop it open again
      if (m.what === 'trader') { window.xOpenTrader && xOpenTrader(m); return; }
      SFX.init(); if (m.what === 'chest') { SFX.chest(); openChest(m.id); } else if (m.what === 'bench') { if (!craftOpen) { SFX.chest(); closeChest(); closePot(); closeSmelt(); setCraft(true); } } else if (m.what === 'smelter') { SFX.chest(); openSmelt(m.id); } else { SFX.chest(); openPot(); }
    } else if (m.t === 'smelted') {
      const msg = $('smeltMsg'); msg.textContent = m.msg || ''; msg.style.color = m.ok ? '#7fe9a0' : '#ff8a80'; if (m.ok) SFX.pickup();
    } else if (m.t === 'cooked') {
      const msg = $('potMsg'); msg.textContent = m.msg || ''; msg.style.color = m.ok ? '#7fe9a0' : '#ff8a80';
      if (m.b) { for (const k in BUFF) BUFF[k] = m.b[k] || 0; buffAt = performance.now(); }
      if (m.ok) { SFX.cook(); const me = ents2['p' + myId]; if (me) floatText(me.x, me.y - 10, m.msg, 0xffe082); }
    } else if (m.t === 'raid') {
      notice('Villagers are raiding the camp!'); SFX.horn();
    } else if (m.t === 'trapped') {
      notice('The big monster is trapped for 20 seconds!');
    } else if (m.t === 'boatPlaced') {
      if (m.ok) { stopPlacing(); actBlock = true; SFX.levelup(); const me = ents2['p' + myId]; if (me) floatText(me.x, me.y - 14, m.msg, 0xffe082); }
      else { const pm = $('placeMsg'); pm.textContent = m.msg || 'Could not place it there.'; pm.style.color = '#ff8a80'; }
    } else if (m.t === 'dism') {
      const me = ents2['p' + myId]; if (me) floatText(me.x, me.y - 12, m.msg, m.ok ? 0xffe082 : 0xff8a80);
      if (m.ok) { SFX.levelup(); closeChest(); closePot(); closeSmelt(); setCraft(false); }
    } else if (m.t === 'rk') {   // a rock grew back as a gold ore vein (or a mined vein came back as a rock)
      const r = resNodes[m.i]; if (r) { r.k = m.k; r.mhp = RHP[m.k] || 3; r.s.texture = m.k === 'g' ? T_GOLDV : T_ROCK; if (r.b0 !== undefined) { r.base = r.b0; r.s.anchor.set(.5, .8); r.s.scale.set(r.base); } r.sv = 0; }
    } else if (m.t === 'trapSet') {
      const me = ents2['p' + myId]; if (me) floatText(me.x, me.y - 10, 'Trap set!', 0xffe082);   // (the trap appearing already plays the build sound)
    } else if (m.t === 'fishgame') { openFish(m.id, m.kind);
    } else if (m.t === 'fishCaught') { const F = FISH[m.kind] || FISH[1]; SFX.levelup(); const me = ents2['p' + myId]; if (me) floatText(me.x, me.y - 24, F.e + ' ' + F.n + '!', 0xffe082); notice('You caught a ' + F.n.toLowerCase() + '!' + (m.left > 0 ? ' ' + m.left + ' more in this pool.' : ' That was the last fish here.') + ' Cook it in a pot.');
    } else if (m.t === 'ate') {
      if (m.b) { for (const k in BUFF) BUFF[k] = m.b[k] || 0; buffAt = performance.now(); }
      SFX.cook(); const me = ents2['p' + myId]; if (me) floatText(me.x, me.y - 10, m.msg, 0xffe082);
    } else if (m.t === 'over') {   // everyone went down: remember the result, then back to the title screen
      runOver = true; try { sessionStorage.setItem('runres', JSON.stringify({ n: m.n, d: m.d })); sessionStorage.removeItem('rejoin'); } catch (e) { }
      showGameOver(m);
    } else if (window.xMsg && ['loot', 'camped', 'fish', 'fx', 'abilUsed', 'traded', 'saved', 'vendHome'].includes(m.t)) { xMsg(m);
    } else if (m.t === 'xp') {
      PF.xp[sel] = m.xp; const me = ents2['p' + myId]; if (me && m.g >= 3) floatText(me.x + 18, me.y - 40, '+' + m.g + ' xp', 0xb39ddb);
      if (m.up && me) { floatText(me.x, me.y - 56, '⭐ Level ' + m.lv + '!', 0xffd54f); SFX.coin(); }
      xpHud();
    } else if (m.t === 'dia') {
      setDia(m.d); const me = ents2['p' + myId];
      if (me) floatText(me.x, me.y - 24, '+' + m.n + ' 💎' + (m.why === 'milestone' ? ' milestone!' : ''), 0x7fe9ff);
      SFX.coin();
    } else if (m.t === 's') onSnap(m);
  };
};
function popup(msg) {   // a small pop-up that fades by itself
  let el = $('popMsg'); if (!el) { el = document.createElement('div'); el.id = 'popMsg'; el.style.cssText = 'position:fixed;left:50%;top:max(70px,calc(env(safe-area-inset-top) + 60px));transform:translateX(-50%);background:#0b1a2af0;border:2px solid #ffd000;color:#fff;font-weight:800;font-size:15px;padding:8px 18px;border-radius:20px;z-index:80;pointer-events:none;opacity:0;transition:opacity .25s'; document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = 1; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = 0; }, 1600);
}
$('rm').onclick = () => { const u = (BASE || location.origin) + '/?room=' + roomCode; const fail = () => prompt('Share this link', u); try { navigator.clipboard.writeText(u).then(() => popup('Link copied'), fail); } catch (e) { fail(); } };

const snd = $('snd'); const sndIcon = () => snd.style.backgroundImage = SFX.isMuted() ? 'url(ui/mute.webp)' : 'url(ui/sound.webp)'; sndIcon();
snd.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); SFX.init(); SFX.setMuted(!SFX.isMuted()); sndIcon(); });
addEventListener('pointerdown', () => SFX.resume());
// ---------- input ----------
let joy = null, act = 0, hit = 0; const keys = {};
const jb = $('jbase'), jk = $('jknob');
app.view.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || joy || e.clientX > innerWidth * .6) return; joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY }; app.view.setPointerCapture(e.pointerId); jb.style.display = jk.style.display = 'block'; jpos(); });
app.view.addEventListener('pointermove', e => { if (joy && joy.id === e.pointerId) { joy.x = e.clientX; joy.y = e.clientY; jpos(); } });
const jend = e => { if (joy && joy.id === e.pointerId) { joy = null; jb.style.display = jk.style.display = 'none'; } };
app.view.addEventListener('pointerup', jend); app.view.addEventListener('pointercancel', jend);
function jpos() { const dx = joy.x - joy.ox, dy = joy.y - joy.oy, m = Math.min(100, Math.hypot(dx, dy)), a = Math.atan2(dy, dx); jk.style.background = m > 63 ? '#ffb74dd0' : ''; jb.style.left = joy.ox + 'px'; jb.style.top = joy.oy + 'px'; jk.style.left = (joy.ox + Math.cos(a) * m) + 'px'; jk.style.top = (joy.oy + Math.sin(a) * m) + 'px'; }
function bind(id, set) { const b = $(id); b.addEventListener('pointerdown', e => { e.preventDefault(); set(1); b.setPointerCapture(e.pointerId); b.style.transform = 'scale(.92)'; }); ['pointerup', 'pointercancel'].forEach(t => b.addEventListener(t, () => { set(0); b.style.transform = ''; })); }
bind('act', v => { act = v; if (v) actPress(); }); bind('hit', v => { hit = v; if (v && placingId) actPress(); });
(function () {   // ATTACK is also the aim stick: hold it to keep attacking, drag to aim (the knob is the button itself)
  const b = $('hit'); let st = null;
  b.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; const r = b.getBoundingClientRect(); st = aimStick = { id: e.pointerId, ox: r.left + r.width / 2, oy: r.top + r.height / 2, x: e.clientX, y: e.clientY }; aimPadDraw(); });
  b.addEventListener('pointermove', e => { if (aimStick && aimStick.id === e.pointerId) { aimStick.x = e.clientX; aimStick.y = e.clientY; aimPadDraw(); } });
  const end = e => { if (aimStick && aimStick.id === e.pointerId) { aimStick = null; aimPadDraw(); } };
  b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
})();   // while a silhouette is out, ATTACK places it (and attacking is off)
addEventListener('keydown', e => { const k = e.key.toLowerCase(); if (placingId && !keys[k] && (k === 'q' || k === 'f' || k === 'j') && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) actPress(); if (placingId && k === 'r') rotatePlace(); else if (k === 'r' && !keys[k] && window.useAbility && $('btns').style.display !== 'none' && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) useAbility(); if (!keys[k] && (k === ' ' || k === 'e') && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) {
    if (craftOpen || chestId !== null || potOpen || smeltId !== null || (typeof trOpen !== 'undefined' && trOpen)) { setCraft(false); closeChest(); closePot(); closeSmelt(); window.closeTrader && closeTrader(); menuClosedAt = performance.now(); }   // E / Space closes whatever menu is open
    else actPress();
  }
  if (!keys[k] && /^[1-7]$/.test(k) && $('btns').style.display !== 'none' && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) useSlotAt(+k - 1);   // 1-3 use the item in that slot (only in game, not while typing)
  if (k === 'escape') { if (craftOpen || chestId !== null || potOpen || smeltId !== null || (typeof trOpen !== 'undefined' && trOpen)) { setCraft(false); closeChest(); closePot(); closeSmelt(); window.closeTrader && closeTrader(); menuClosedAt = performance.now(); } else if (placingId) stopPlacing(); else if (typeof mapOpen !== 'undefined' && mapOpen) { /* the map closes itself */ } else if (window.xPause) xPause(); }   // Escape closes menus / cancels placing
  keys[k] = 1; }); addEventListener('keyup', e => { keys[e.key.toLowerCase()] = 0; });
// never let a lost touch/key leave the character walking: drop all held input whenever the page loses focus or no finger is down
function clearInput() { joy = null; mouse.down = false; if (aimStick) { aimStick = null; aimPadDraw(); } jb.style.display = jk.style.display = 'none'; act = hit = 0; for (const k in keys) keys[k] = 0; ['act', 'hit'].forEach(i => { $(i).style.transform = ''; }); }
addEventListener('blur', clearInput); document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); }); addEventListener('pagehide', clearInput);
app.view.addEventListener('lostpointercapture', jend);
addEventListener('touchend', e => { if (!e.touches.length) clearInput(); }, { passive: true }); addEventListener('touchcancel', clearInput, { passive: true });
app.view.addEventListener('contextmenu', e => e.preventDefault());
let actBlock = false;   // set after placing something so a still-held ACT doesn't instantly act again (e.g. hop into the boat you just put down)
// ---- aiming: you face where you aim and ATTACK goes that way. Mouse: the cursor. Touch: the aim stick next to ATTACK (drag, release to attack); without it, attacks auto-aim as before ----
const mouse = { on: false, x: 0, y: 0, down: false }; let aimStick = null, aimHold = { until: 0, ang: 0 }, hitPulse = 0, crossEl = null, handEl = null;
function mouseAngle() { const me = ents2['p' + myId]; if (!me) return null; return Math.atan2(mouse.y - (H / 2 + (me.y - camY) * Z), mouse.x - (W / 2 + (me.x - camX) * Z)); }
function aimPadDraw() {   // touch: the ATTACK button itself is the stick - it slides toward where you drag
  const b = $('hit'); if (!b) return;
  if (aimStick) { let dx = aimStick.x - aimStick.ox, dy = aimStick.y - aimStick.oy; const m = Math.hypot(dx, dy), L = 40; if (m > L) { dx *= L / m; dy *= L / m; } b.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.92)'; } else b.style.transform = '';
}
(function () {
  const cs = document.createElement('style'); cs.textContent = 'body.ingame, body.ingame * { cursor: none !important; }'; document.head.appendChild(cs);   // in a game the real mouse cursor is hidden everywhere (menus too); the crosshair is the pointer
  setInterval(() => document.body.classList.toggle('ingame', !!myId && $('btns').style.display !== 'none'), 250);
  crossEl = document.createElement('div'); crossEl.style.cssText = 'position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;pointer-events:none;z-index:99;display:none;border:2px solid #ff5252;border-radius:50%;box-shadow:0 0 6px #000a,inset 0 0 4px #000a;';
  crossEl.innerHTML = '<div style="position:absolute;left:50%;top:-7px;width:2px;height:8px;margin-left:-1px;background:#ff5252"></div><div style="position:absolute;left:50%;bottom:-7px;width:2px;height:8px;margin-left:-1px;background:#ff5252"></div><div style="position:absolute;top:50%;left:-7px;height:2px;width:8px;margin-top:-1px;background:#ff5252"></div><div style="position:absolute;top:50%;right:-7px;height:2px;width:8px;margin-top:-1px;background:#ff5252"></div>';
  document.body.appendChild(crossEl);
  handEl = document.createElement('div'); handEl.textContent = '👆'; handEl.style.cssText = 'position:fixed;font-size:26px;line-height:1;margin:-3px 0 0 -13px;pointer-events:none;z-index:99;display:none;filter:drop-shadow(0 1px 2px #000a)';   // over a button or menu item the crosshair becomes a hand
  document.body.appendChild(handEl);
  const CLICKY = 'button,a,label,select,[role=button],.btn,.zb,.slot,.mini,.card,.link,.tier+.row>*,#rm,#snd,#chooseBtn,#mapBtn';
  const clicky = t => { for (let el = t, n = 0; el && el !== document.body && n < 7; el = el.parentElement, n++) { if (el === app.view) return false; if (el.matches && el.matches(CLICKY)) return true; if (typeof el.onclick === 'function') return true; } return false; };
  const mv = e => { if (e.pointerType !== 'mouse') return; mouse.on = true; mouse.x = e.clientX; mouse.y = e.clientY; const ing = document.body.classList.contains('ingame'), hand = ing && clicky(e.target);
    crossEl.style.display = ing && !hand ? 'block' : 'none'; crossEl.style.left = e.clientX + 'px'; crossEl.style.top = e.clientY + 'px';
    handEl.style.display = hand ? 'block' : 'none'; handEl.style.left = e.clientX + 'px'; handEl.style.top = e.clientY + 'px'; };
  addEventListener('pointermove', mv, true); document.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { crossEl.style.display = 'none'; handEl.style.display = 'none'; } }, true); document.documentElement.addEventListener('mouseleave', () => { crossEl.style.display = 'none'; handEl.style.display = 'none'; });
  app.view.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) { mouse.down = true; mv(e); if (placingId) actPress(); } });
  addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && e.button === 0) mouse.down = false; });
})();
function currentAim() {   // the direction you are aiming right now (aim stick, a just-released stick, or the mouse cursor), or null when not aiming
  const nowT = performance.now();
  if (aimStick && Math.hypot(aimStick.x - aimStick.ox, aimStick.y - aimStick.oy) > 16) return Math.atan2(aimStick.y - aimStick.oy, aimStick.x - aimStick.ox);
  if (nowT < aimHold.until) return aimHold.ang; return mouse.on ? mouseAngle() : null;
}
function readInput() {
  let dx = 0, dy = 0;
  let rn = 0; if (actBlock && !(act || keys[' '] || keys.e)) actBlock = false;
  if (joy) { const px = joy.x - joy.ox, py = joy.y - joy.oy, d = Math.hypot(px, py), m = d / 55;   // responsive stick: full walking speed after only 24 px of drag (was 55), a 3 px dead zone, and the direction is exact
    if (d < 3) dx = dy = 0; else { const k = Math.min(1, d / 24) / d; dx = px * k; dy = py * k; if (m > 1.15) rn = Math.min(1, (m - 1.15) / .75); } }   // past the ring = run, faster the further you push
  if (keys.a || keys.arrowleft) dx -= 1; if (keys.d || keys.arrowright) dx += 1; if (keys.w || keys.arrowup) dy -= 1; if (keys.s || keys.arrowdown) dy += 1;
  if (keys.shift && (dx || dy)) rn = 1;
  const aim = currentAim(), nowT = performance.now();
  return { dx, dy, am: aim === null ? 0 : 1, aim: aim === null ? 0 : Math.round(aim * 100) / 100, rn: Math.round(rn * 100) / 100, act: !placingId && !actBlock && (act || keys[' '] || keys.e) ? 1 : 0, hit: !placingId && !fishOpen && (hit || keys.q || keys.f || keys.j || mouse.down || nowT < hitPulse) ? 1 : 0 };   // no attacking while placing something
}
setInterval(() => { if (ws && ws.readyState === 1 && myId) ws.send(JSON.stringify(Object.assign({ t: 'in' }, readInput()))); }, 25);   // 40 messages a second: the server steps at 30 Hz, so it always has the freshest stick position
