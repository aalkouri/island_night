'use strict';
// Island Night sprites: loads the pictures in public/sprites/ and shows them in place of the code-drawn art in game.js / extras.js.
// Everything here is optional: until a picture has loaded (or if it is missing) the code-drawn version stays on screen. Add ?nosprites to the address to turn the pictures off.
// Creatures and players are not turned by their heading: they show a front, side (drawn facing left, mirrored for right) or back picture, and the walking motion is done in code.
const SPR = (() => {
  const OFF = /[?&]nosprites\b/.test(location.search);
  const CLS = 'berserker duelist engineer forager forester guard hunter legend lucky marine medic miner phantom pyro pyromancer scout sentinel shaman tech warden'.split(' ');
  const V3 = 'alien spitter brute charger villager mage zealot survivor wolf alpha_wolf bear mammoth boar golem imp rabbit penguin'.split(' ');   // these have _front, _side and _back
  const ONE = 'salamander scorpion vulture tree pine cactus rock gold_ore berry_bush bench chest pot smelter spike_trap campfire wall rock_wall metal_wall gate boat sloop galleon axe pick sword spear pistol rifle steak'.split(' ');
  const has = new Set(ONE), TX = {}, st = {}; let ver = 1;   // ver goes up each time a picture arrives, so things waiting for one can look again
  for (const n of V3.concat(CLS.map(c => 'cls_' + c))) for (const v of ['_front', '_side', '_back']) has.add(n + v);
  const load = n => {
    if (OFF || st[n] || !has.has(n)) return; st[n] = 1; const im = new Image();
    im.onload = () => { const t = PIXI.Texture.from(im); t.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON; TX[n] = t; st[n] = 2; ver++; }; im.onerror = () => { st[n] = 3; }; im.src = 'sprites/' + n + '.webp';
  };
  const get = n => TX[n] || (load(n), null);
  const views = n => { const f = get(n + '_front'), s = get(n + '_side'), b = get(n + '_back'); return f && s && b ? { f, s, b } : null; };
  const preload = () => { for (const n of has) if (n.slice(0, 4) !== 'cls_') load(n); };   // the world's pictures (about 0.9 MB); class pictures load when a player of that class shows up
  if (!OFF) addEventListener('load', () => setTimeout(preload, 600));

  // ---- creatures and players ----
  // h: height on screen (world px), fy: how far below the entity's centre the feet stand, w: how it moves, sp: speed (px/s) of a normal walk,
  // eyes: where the night glows sit per view, as [sideways, up from the feet] in units of h (side view as drawn, facing left), es: glow size
  const CRE = {
    alien: { h: 32, fy: 6, w: 'float', eyes: { f: [[.11, .54]], s: [[-.24, .54]] }, es: .22 },
    spitter: { h: 42, fy: 7, w: 'squish', eyes: { f: [[-.12, .38], [.13, .38]], s: [[-.33, .56]] }, es: .2 },
    brute: { h: 72, fy: 12, w: 'stomp', sp: 70, eyes: { f: [[.07, .8], [.17, .8]], s: [[-.17, .82]] }, es: .2 },
    charger: { h: 92, fy: 18, w: 'trot', sp: 160 },   // the two-headed dog: no night glow on its eyes
    villager: { h: 44, fy: 10, w: 'walk' }, mage: { h: 46, fy: 10, w: 'walk' }, zealot: { h: 54, fy: 11, w: 'walk' }, survivor: { h: 46, fy: 10, w: 'walk', sp: 70 },
    wolf: { h: 50, fy: 8, w: 'trot', sp: 150 }, alpha_wolf: { h: 70, fy: 11, w: 'trot', sp: 150, eyes: { f: [[-.08, .35], [.07, .35]], s: [[-.28, .61]] }, es: .16 },
    bear: { h: 68, fy: 14, w: 'stomp', sp: 90 }, mammoth: { h: 136, fy: 26, w: 'stomp', sp: 70 }, boar: { h: 48, fy: 9, w: 'trot', sp: 130 }, golem: { h: 124, fy: 18, w: 'stomp', sp: 60 },
    imp: { h: 42, fy: 7, w: 'walk', eyes: { f: [[-.05, .52], [.13, .52]] }, es: .11 },
    rabbit: { h: 30, fy: 5, w: 'hop' }, penguin: { h: 34, fy: 5, w: 'waddle', sp: 60 },
    // seen from above: these keep turning with their heading (len = length on screen along the heading)
    scorpion: { top: 1, len: 50 }, salamander: { top: 1, len: 52 }, vulture: { top: 1, len: 52 },
  };
  const PLAYER = { h: 44, fy: 10, w: 'walk', sp: 150 };
  function attach(e, name) {   // e: an entity from mkPlayer / mkAlien / mkWolf / mkRabbit. The picture itself is added by step() once it has loaded.
    const d = name.slice(0, 4) === 'cls_' ? PLAYER : CRE[name]; if (OFF || !d || !has.has(d.top ? name : name + '_front')) return e;
    e.sv = { n: name, d, view: 'f', flip: 1, vf: 1, t: Math.random() * 6, ph: Math.random() * 6.28 }; return e;
  }
  // held things (a class's own tool, or the pistol / rifle when a gun is selected): drawn in code as before, but as their own picture placed at the hand
  const HPIV = { shield: [16, -17], bow: [24, 0], twindagger: [12, 0], fireorb: [26, 12], clover: [25, 14], flare: [22, 12], gun: [12, 11] }, HT = {};
  const heldTex = k => HT[k] || (HT[k] = tex(96, 96, g => { const p = HPIV[k] || [12, 16]; g.translate(48 - p[0], 48 - p[1]); FRONTS[k](g); }));
  function heldStep(e, q, s, h, sy, down) {
    const p = e.d, gun = p ? p[33] : 0, cl = p && GC.BY[p[2]], kind = gun === 1 ? 'pistol' : gun === 2 ? 'rifle' : cl && cl.look[3], hd = e.held;
    if (q.hk !== kind) {
      const t = gun ? get(kind) : FRONTS[kind] ? heldTex(kind) : null; q.ht = !!t;
      if (t) { hd.texture = t; if (gun) { hd.anchor.set(gun === 1 ? .25 : .3, gun === 1 ? .6 : .5); q.hs = (gun === 1 ? 20 : 40) / t.width; } else { hd.anchor.set(.5); q.hs = .85; } }
      if (t || !gun) q.hk = kind;   // (a gun picture that has not arrived yet: look again next frame)
    }
    hd.visible = !!q.ht && !(down > 0) && !e.tool.visible;
    if (!hd.visible) return;
    const back = q.view === 'b', side = q.view === 's', dir = side ? -q.flip : 1;   // dir: which way the thing points on screen
    if (q.hb !== back) { q.hb = back; e.c.removeChild(hd); e.c.addChildAt(hd, e.c.getChildIndex(s) + (back ? 0 : 1)); }   // facing away: the hand and what it holds are tucked behind the body
    hd.position.set(s.x + (side ? dir * .15 : .27) * h, s.y - .27 * h * sy); hd.scale.set(q.hs * dir, q.hs); hd.rotation = s.rotation + (gun ? 0 : -.35 * dir);
  }
  function step(e, dt, sp) {   // once a frame, after the code has moved the entity: pick the view, animate the walk, copy tints
    const q = e.sv; if (!q) return; const d = q.d; let s = e.spr;
    if (!s) {
      if (d.top) { q.tx = get(q.n); if (!q.tx) return; } else { q.v = views(q.n); if (!q.v) return; }
      s = e.spr = new PIXI.Sprite(d.top ? q.tx : q.v.f); s.anchor.set(.5, d.top ? .5 : .98);
      e.c.addChildAt(s, e.c.getChildIndex(e.body) + 1); e.body.visible = false;
      if (e.kind === 'p') { const top = d.fy - d.h; e.name.y = e.nb.y = top - 12; e.hp.y = top - 9; e.held = new PIXI.Sprite(PIXI.Texture.EMPTY); e.held.visible = false; e.c.addChildAt(e.held, e.c.getChildIndex(s) + 1); }
      if (e.tag) e.tag.y = d.fy - d.h - 8;
      if (d.es && e.eyes) e.eyes.forEach(g => g.scale.set(d.es));
    }
    const a = e.ang || 0, cx = Math.cos(a), sn = Math.sin(a), moving = sp > 8;
    const tint = e.kind === 'a' ? (e.flash > 0 ? 0xff9a90 : e.d && e.d[7] > 0 ? 0x8fb4ff : 0xffffff) : e.body.tint;   // (the old alien kinds were one picture in different colours; these have their own)
    const lo = e.lunge > 0 ? Math.sin(e.lunge / .25 * Math.PI) * 10 : 0, ox = cx * lo, oy = sn * lo;   // a bite lunges toward the target
    if (d.top) {
      if (q.vf > 0 ? cx < -.2 : cx > .2) q.vf = -q.vf;   // heading left: mirrored top to bottom, so it never ends up on its back
      let k = d.len / q.tx.width, ky = k, lift = 0;
      if (e.vul) { const L = e.lift || 0; k *= .62 + .38 * L; ky = k * (e.air ? 1 + Math.sin(T * 9 + e.x * .01) * .18 : 1); lift = L * 46; }   // a landed vulture is drawn smaller; in the air its wings beat
      else if (moving) q.t += dt;
      s.rotation = a + (e.vul || !moving ? 0 : Math.sin(q.t * 14) * .1); s.scale.set(k, ky * q.vf); s.position.set(ox, oy - lift); s.tint = tint; return;
    }
    const ax = Math.abs(cx), ay = Math.abs(sn);   // which picture: mostly sideways = side, else down = front, up = back (with some slack so it does not flicker between two)
    if (q.view === 's') { if (ax < ay * .8) q.view = sn > 0 ? 'f' : 'b'; } else if (ax > ay * 1.25) q.view = 's'; else q.view = sn > 0 ? 'f' : 'b';
    q.flip = q.view === 's' && cx > 0 ? -1 : 1;
    const tx = q.v[q.view]; if (s.texture !== tx) s.texture = tx;
    const h = d.h, k = h / tx.height, w = d.w, down = e.kind === 'p' ? e.fall || 0 : 0; let sx = 1, sy = 1, lift = 0, rock = 0;
    q.t += dt * (moving ? clamp(sp / (d.sp || 110), .7, 1.7) : 0);
    if (down > 0) { /* lying on the ground: no walk */ }
    else if (w === 'float') { const b = Math.sin(T * 3.2 + q.ph); lift = h * (.16 + .05 * b); sy = 1 + .03 * Math.sin(T * 3.2 + q.ph + 1.2); sx = 2 - sy; if (moving) rock = .09; }   // hovers; leans into the way it glides
    else if (!moving) { const b = Math.sin(T * 2.4 + q.ph); sy = 1 + .025 * b; sx = 1 - .015 * b; }   // breathing
    else if (w === 'hop') { const ph = (q.t * 2.6) % 1, air = Math.sin(Math.PI * Math.min(1, ph / .72)); lift = air * h * .3; if (ph > .72) { const u = Math.sin(Math.PI * (ph - .72) / .28); sy = 1 - .16 * u; sx = 1 + .14 * u; } else { sy = 1 + .08 * air; sx = 1 - .05 * air; } }
    else if (w === 'squish') { const b = Math.sin(q.t * 7); sx = 1 + .11 * b; sy = 1 - .11 * b; lift = Math.max(0, -b) * h * .04; }
    else if (w === 'trot') { const b = Math.abs(Math.sin(q.t * 11)); lift = b * h * .06; rock = Math.sin(q.t * 11) * .07; sy = 1 - .03 * b; }
    else if (w === 'stomp') { const b = Math.abs(Math.sin(q.t * 6)); lift = b * h * .035; rock = Math.sin(q.t * 6) * .04; sy = 1 - .035 * (1 - b); sx = 1 + .02 * (1 - b); }
    else if (w === 'waddle') { const b = Math.sin(q.t * 9); lift = Math.abs(b) * h * .04; rock = b * .16; }
    else { const b = Math.abs(Math.sin(q.t * 10)); lift = b * h * .06; rock = Math.sin(q.t * 10) * .06; sy = 1 - .03 * (1 - b); }   // walk: a bob on each step and a slight rock
    const fu = down > 0 ? ease(down) : 0;
    s.rotation = fu > 0 ? fu * 1.45 : q.view === 's' ? rock * -q.flip : w === 'trot' || w === 'hop' || w === 'squish' ? 0 : rock * .5;
    s.scale.set(q.flip * k * sx, k * sy); s.position.set(ox - fu * h * .3, d.fy - lift + oy - Math.sin(fu * Math.PI) * 7); s.tint = tint;
    if (e.kind === 'p') { heldStep(e, q, s, h, sy, down); if (e.tool.visible) e.tool.y += d.fy - h * .42; }   // a swing comes from the chest, not from the feet
    else if (e.hp) { e.hp.y = d.fy - h - 9 - (w === 'float' ? h * .16 : 0); if (e.trapTxt) e.trapTxt.y = e.hp.y - 14; }
    if (e.eyes && e.eyes.length) {
      const E = d.eyes && d.eyes[q.view];
      for (let i = 0; i < e.eyes.length; i++) { const g = e.eyes[i], p = E && E[i]; if (!p) { g.alpha = 0; continue; } g.position.set(e.x + s.x + p[0] * h * q.flip * sx, e.y + s.y - p[1] * h * sy); }
    }
  }
  // people who are not in the snapshot's entity list (traders, the traveling vendor): the survivor picture
  const npcs = [];
  function npc(c, body, ang, tag) { const e = attach({ c, body, ang, tag, kind: 'n', sp: 0 }, 'survivor'); if (e.sv) npcs.push(e); return e; }
  function stepNpcs(dt) { for (let i = npcs.length - 1; i >= 0; i--) { const e = npcs[i]; if (e.c.destroyed) npcs.splice(i, 1); else step(e, dt, e.sp); } }

  // ---- swing tools: turned in the build step so the handle runs along +x from the grip, like the code-drawn ones ----
  const TOOLS = { 1: ['axe', 46, .1, .53], 2: ['pick', 46, .1, .59], 4: ['sword', 50, .08, .52], 5: ['spear', 72, .16, .44] };   // picture, length on screen, grip x, grip y
  function tool(sp, kind) { const d = TOOLS[kind], t = d && get(d[0]); if (!t) return; sp.texture = t; sp.anchor.set(d[2], d[3]); sp.scale.set(d[1] / t.width); }

  // ---- trees, rocks, bushes ----
  const RES = { t: ['tree', 0, 98, .97, .62], p: ['pine', 0, 120, .97, .66], c: ['cactus', 0, 82, .97, .62], r: ['rock', 46, 0, .9, .6], g: ['gold_ore', 46, 0, .9, .6], b: ['berry_bush', 44, 0, .92, .62] };   // picture, width or height on screen, anchor y, the code-drawn base scale
  function res(r) {   // r: a resNodes entry; called for the ones near the camera whenever r.sv is out of date
    r.sv = ver; const d = RES[r.k], t = d && get(d[0]); if (!t || r.s.texture === t) return;
    const snowy = r.s.texture === T_TREE_S || r.s.texture === T_CACTUS_S; if (r.b0 === undefined) r.b0 = r.base;
    r.base = (d[1] ? d[1] / t.width : d[2] / t.height) * (r.b0 / d[4]);   // keeps the small size differences between trees
    r.s.texture = t; r.s.anchor.set(.5, d[3]); if (r.pop >= 1) r.s.scale.set(r.base); if (snowy) r.s.tint = 0xd6e6f4;
  }

  // ---- placed structures ----
  const STR = { bench: ['bench', 72, 10], chest: ['chest', 58, 8], pot: ['pot', 56, 8], smelter: ['smelter', 62, 10], spike: ['spike_trap', 56, 14] };   // picture, width on screen, where its bottom edge sits
  const WALLS = { '': 'wall', r: 'rock_wall', m: 'metal_wall' }, GATE_TINT = { '': 0xffffff, r: 0xa3a9b3, m: 0x86aacb };   // (there is one gate picture: rock and metal gates are tinted; cabin doors stay code-drawn)
  function mkStruct(k, mat) {   // the picture(s) for one structure, or null if there is none (yet). rot: turns with the piece (walls and gates); the rest always face the camera
    mat = mat || '';
    if (k === 'wall') { const t = WALLS[mat] && get(WALLS[mat]); if (!t) return null; const s = new PIXI.Sprite(t); s.anchor.set(.5); s.k0 = 54 / t.width; s.y = 5; return { list: [s], rot: 1 }; }
    if (k === 'gate') {   // a double gate: two leaves side by side, each as wide as a wall piece
      const t = mat in GATE_TINT && get('gate'); if (!t) return null;
      return { list: [-1, 1].map(sg => { const s = new PIXI.Sprite(t); s.anchor.set(.5); s.k0 = 52 / t.width; s.sg = sg; return s; }), rot: 1, tint: GATE_TINT[mat] };
    }
    const d = STR[k], t = d && get(d[0]); if (!t) return null;
    const s = new PIXI.Sprite(t); s.anchor.set(.5, 1); s.k0 = d[1] / t.width; s.y = d[2]; return { list: [s], rot: 0 };
  }
  function layStruct(q, k, tint, alpha, open) {
    for (const s of q.list) {
      s.tint = tint === 0xffffff ? q.tint || 0xffffff : tint; s.alpha = alpha;
      if (s.sg) { s.scale.set(s.k0 * k * s.sg * (open ? -.26 : -1), s.k0 * k); s.x = s.sg * (open ? 45 : 26) * k; }   // open: both leaves swung back against their posts
      else s.scale.set(s.k0 * k);
    }
  }
  function struct(e) {   // once a frame from stepStructs: follows the code sprite's pop-in, hit flash and open / shut state
    let q = e.sq;
    if (!q) {
      q = mkStruct(e.k, e.mat); if (!q) return; e.sq = q; e.spr.visible = false;
      for (const s of q.list) if (q.rot) e.rotc.addChild(s); else e.c.addChildAt(s, e.c.getChildIndex(e.rotc) + 1);
      if (e.k === 'pot') { const f = q.fl = new PIXI.Sprite(T_FLAME); f.anchor.set(.5, .9); f.blendMode = BM.ADD; f.position.set(0, q.list[0].y - 2); e.c.addChildAt(f, e.c.getChildIndex(q.list[0]) + 1); }   // the pot picture is unlit: a small fire under it
    }
    layStruct(q, e.spr.scale.x / e.base, e.spr.tint, e.spr.alpha, e.op);
    if (q.fl) q.fl.scale.set(.17 * (1 + Math.sin(T * 11 + e.x) * .1), .17 * (1 + Math.sin(T * 15 + e.y) * .16));
  }
  function ghost(kind, mat, gh, ghRot, sp) {   // the see-through preview while placing
    const q = mkStruct(kind, mat); if (!q) return; sp.visible = false; for (const s of q.list) (q.rot ? ghRot : gh).addChild(s); layStruct(q, 1, 0xffffff, 1, 0);
  }

  // ---- fire pits (home fire and placed campfires): the ring of code-drawn stones becomes the unlit campfire picture; the flames stay code-drawn on top ----
  const pits = [];
  function pit(x, y, stones) { if (!OFF) pits.push({ x, y, stones }); }
  function stepPits() {
    for (let i = pits.length - 1; i >= 0; i--) {
      const p = pits[i]; if (p.stones[0].destroyed) { pits.splice(i, 1); continue; }
      const t = get('campfire'); if (!t) return;
      const s = new PIXI.Sprite(t); s.anchor.set(.5); s.scale.set(84 / t.width); s.position.set(p.x, p.y + 4); s.zIndex = p.y; p.stones[0].parent.addChild(s);
      p.stones.forEach(o => o.visible = false); p.stones.push(s); pits.splice(i, 1);   // (pushed onto the same list, so whoever removes the stones removes the picture too)
    }
  }

  // ---- boats: the rowing boat is seen from above and turns with its heading; the sloop and galleon are side-on pictures that only mirror ----
  const BOATS = { boat: { len: 106, ay: .5, rot: 1 }, sloop: { len: 132, ay: .8 }, galleon: { len: 166, ay: .8 } };
  function boat(e) {   // once a frame from stepBoats, after the code has set e.sp.rotation
    const n = BOATS[e.bk] ? e.bk : 'boat', d = BOATS[n], t = get(n); if (!t) return;
    if (e.sp.texture !== t) { e.sp.texture = t; e.sp.anchor.set(.5, d.ay); e.bs = d.len / t.width; e.bf = 1; }
    const cx = Math.cos(e.ang); if (e.bf > 0 ? cx < -.15 : cx > .15) e.bf = -e.bf;
    if (d.rot) e.sp.scale.set(e.bs, e.bs * e.bf); else { e.sp.rotation -= e.ang; e.sp.scale.set(e.bs * e.bf, e.bs); }
    const k = .45 + .55 * Math.min(1, (e.lf == null ? 100 : e.lf) / 60), v = Math.round(255 * k); e.sp.tint = (v << 16) | (Math.round(v * .96) << 8) | Math.round(v * .92);   // a worn-out boat darkens
  }
  function boatGhost(sp) { const t = get('boat'); if (t) { sp.texture = t; sp.scale.set(BOATS.boat.len / t.width); } }

  // class picture for the menus: drawn over the code-drawn one in the same 64x64 canvas once it has loaded
  function icon(cv, id) {
    if (OFF || !has.has('cls_' + id + '_front')) return; const im = new Image();
    im.onload = () => { const g = cv.getContext('2d'), k = Math.min(cv.width / im.width, cv.height / im.height); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(im, (cv.width - im.width * k) / 2, (cv.height - im.height * k) / 2, im.width * k, im.height * k); };
    im.src = 'sprites/cls_' + id + '_front.webp';
  }
  return { get, attach, step, npc, stepNpcs, tool, res, struct, ghost, pit, stepPits, boat, boatGhost, icon, get ver() { return ver; } };
})();
