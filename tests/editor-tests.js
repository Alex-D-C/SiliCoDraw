// SiliCoDraw browser test suite. It runs inside the editor page (figure-editor.html) and uses the page's own functions.
//
//   Headless, from a terminal:  tests/browser.ps1 (Windows) or sh tests/browser.sh (macOS / Linux)
//   In a browser:               http://localhost:8770/tests/run.html   (loads the editor in a frame and runs this file)
//   In an open editor tab on a scratch figure (?file=zz-<anything>.json), from the developer console:
//     eval(await (await fetch('tests/editor-tests.js')).text()); await runEditorTests()
//
// The tests replace the content of the open figure, so they only run on a figure whose name starts with zz-; without
// {keep: true} the figure's content is put back afterwards. Result: {ok, passed, failed, skipped, ms, env, tests: [{name, ok, skip, msg, ms}]}
// Options: {only: ['icons', 'examples', ...] (test names starting with these), keep: true (leave the round-trip figure),
//           onProgress: (name, i, n) => {}, strict: true (a missing internet connection fails instead of skipping PowerPoint)}
(function () {
  'use strict';
  const W = window, D = document;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // a frame (a hidden tab paints no frames: then a short wait instead)
  const frame = () => new Promise(r => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 60); });
  // async fill-ins (formula typesetting, pictures) finish before anything is measured
  async function settle(ms = 20000) { const t0 = Date.now(); await frame(); while (typeof PENDING !== 'undefined' && PENDING.size && Date.now() - t0 < ms) await sleep(80); await frame(); }
  const J = x => JSON.stringify(x);
  const short = (v, n = 160) => { const s = typeof v === 'string' ? v : J(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
  function ok(c, msg) { if (!c) throw new Error(msg || 'check failed'); }
  function eq(a, b, msg) { if (J(a) !== J(b)) throw new Error((msg ? msg + ': ' : '') + 'expected ' + short(b) + ', got ' + short(a)); }
  function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error((msg ? msg + ': ' : '') + 'expected ' + b + ' ± ' + tol + ', got ' + a); }
  const finiteBox = b => !!b && [b.x, b.y, b.w, b.h].every(Number.isFinite);
  const blank = (w = 1600, h = 900) => fig.set({ version: 4, w, h, bg: '#ffffff', palette: [], objects: [] });
  class Skip extends Error {}
  const OFFLINE = /internet|Could not load/i;

  // --- export checks: the bytes look like a valid file of that kind ---
  function checkSvg(s, what) {
    ok(typeof s === 'string' && s.startsWith('<?xml'), what + ': SVG text expected');
    const bad = s.match(/="[^"]*\b(NaN|Infinity)\b[^"]*"|="undefined"/);
    ok(!bad, what + ': SVG has ' + (bad && bad[0].slice(0, 80)));
    const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
    ok(!doc.querySelector('parsererror'), what + ': SVG does not parse: ' + short((doc.querySelector('parsererror') || {}).textContent || ''));
    return doc;
  }
  async function checkPng(W0, what) {
    const p = await makePng(W0, 96, {}), b = p.bytes;
    eq([...b.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], what + ': PNG signature');
    const w = new DataView(b.buffer, b.byteOffset).getUint32(16);
    eq(w, W0, what + ': PNG width');
  }
  async function checkPdf(what) {
    const r = await makePdf({ mm: 120, dpi: 150 }), b = new Uint8Array(await r.blob.arrayBuffer());
    const txt = new TextDecoder('latin1').decode(b);
    ok(txt.startsWith('%PDF-1.'), what + ': PDF header');
    ok(/%%EOF\s*$/.test(txt), what + ': PDF end marker');
    const m = txt.match(/startxref\s+(\d+)\s+%%EOF\s*$/); ok(m, what + ': no startxref');
    const xr = +m[1]; eq(txt.slice(xr, xr + 4), 'xref', what + ': startxref offset');
    const head = txt.slice(xr).match(/^xref\s+0 (\d+)\s+/); ok(head, what + ': xref table');
    const n = +head[1], rows = txt.slice(xr + head[0].length).split(/\r?\n/).slice(0, n);
    for (let i = 1; i < n; i++) { const off = parseInt(rows[i], 10); ok(txt.slice(off, off + 20).startsWith(i + ' 0 obj'), what + ': xref entry ' + i + ' does not point at its object'); }
    ok(!/\bNaN\b|\bInfinity\b/.test(txt.slice(xr)), what + ': NaN in the PDF trailer');
    ok(r.pages >= 1, what + ': no page');
  }
  async function checkTiff(what) {
    const r = await makeTiff(300, 96), b = new Uint8Array(await r.blob.arrayBuffer()), v = new DataView(b.buffer);
    ok(b[0] === 0x49 && b[1] === 0x49 && v.getUint16(2, true) === 42, what + ': TIFF header');
    ok(v.getUint32(4, true) < b.length, what + ': TIFF directory offset');
  }
  async function checkPptx(what, strict) {
    let r; try { r = await exportPptx(); } catch (e) { if (!strict && OFFLINE.test(e.message)) throw new Skip('PowerPoint library not reachable (offline): ' + e.message); throw e; }
    const b = new Uint8Array(await r.blob.arrayBuffer());
    ok(b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4, what + ': PPTX is no ZIP');
    ok(new TextDecoder('latin1').decode(b).includes('ppt/slides/slide1.xml'), what + ': PPTX has no slide');
    return r;
  }

  W.runEditorTests = async function (opts = {}) {
    const t00 = performance.now(), tests = [], errs = [];
    const onErr = e => errs.push(String(e.message || e)), onRej = e => errs.push('unhandled rejection: ' + String(e.reason && e.reason.message || e.reason));
    const env = { editor: location.pathname, web: typeof WEB !== 'undefined' && WEB, ua: navigator.userAgent, file: typeof FILE !== 'undefined' ? FILE : null };
    const list = [];
    const test = (name, fn, timeout = 120000) => list.push({ name, fn, timeout });
    const res = () => { const failed = tests.filter(t => !t.ok && !t.skip).length, skipped = tests.filter(t => t.skip).length;
      return { ok: failed === 0 && tests.length > 0, passed: tests.filter(t => t.ok).length, failed, skipped, total: tests.length, ms: Math.round(performance.now() - t00), env, tests }; };
    if (typeof fig === 'undefined' || typeof scene === 'undefined') { tests.push({ name: 'editor started', ok: false, msg: 'this is not the SiliCoDraw editor page (no fig / scene)' }); return res(); }
    if (!/^zz-/.test(env.file || '')) { tests.push({ name: 'editor started', ok: false, msg: 'open a scratch figure first (?file=zz-test.json): the tests replace the figure\'s content' }); return res(); }
    for (let i = 0; i < 300 && typeof fileReady !== 'undefined' && !fileReady; i++) await sleep(100);   // the figure file has been read (else the first save would be held back)
    const orig = J(scene);
    env.icons = Object.keys(ICONS).filter(k => !ICONS[k].user).length; env.types = Object.keys(DEF).length;
    W.addEventListener('error', onErr); W.addEventListener('unhandledrejection', onRej);

    // ---------- icons ----------
    test('icons: definitions (every icon draws, flat, listed in a group)', () => {
      const missing = ICON_GROUPS.flatMap(g => g[1]).filter(k => !ICONS[k]);
      ok(!missing.length, 'listed in ICON_GROUPS but not defined: ' + missing.slice(0, 10).join(', '));
      const grouped = new Set(ICON_GROUPS.flatMap(g => g[1])), ung = Object.keys(ICONS).filter(k => !grouped.has(k) && !ICONS[k].user);
      ok(!ung.length, 'defined but in no group (not in the Add panel): ' + ung.slice(0, 10).join(', '));
      const bad = [];
      for (const k of Object.keys(ICONS)) {
        const ic = ICONS[k];
        if (ic.user) continue;   // the user's own icons (assets/my-icons.json) may keep defs, gradients and ids; they are never published
        try { const s = ic.d('#e8eef9', '#6f86c8', '#555');
          if (!s || /NaN|undefined|Infinity/.test(s)) bad.push(k + ' (NaN/undefined)');
          else if (/<(defs|linearGradient|radialGradient|filter|mask|pattern|script)\b|\bid="/.test(s)) bad.push(k + ' (defs/gradient/filter/mask/id)');
          if (typeof ic.n !== 'string' || !ic.n) bad.push(k + ' (no name)');
        } catch (e) { bad.push(k + ': ' + e.message); }
      }
      ok(!bad.length, bad.length + ' bad icons: ' + bad.slice(0, 8).join('; '));
    });
    test('icons: every icon renders on the canvas with finite bounds', async () => {
      const keys = Object.keys(ICONS).filter(k => !ICONS[k].user), cols = 50, objs = keys.map((k, i) => ({ id: 'ic' + i, type: 'icon', kind: k, x: 20 + (i % cols) * 40, y: 20 + Math.floor(i / cols) * 40, s: 1, r: 0, size: 32, c1: '#cfe3f5', c2: '#6f86c8', label: '', labelSize: 10 }));
      fig.set({ version: 4, w: 2020, h: 40 + Math.ceil(keys.length / cols) * 40, bg: '#ffffff', palette: [], objects: objs }); await settle();
      const bad = [];
      objs.forEach((o, i) => { const n = D.querySelector('#content [data-id="' + o.id + '"]'), b = bbox(o.id); if (!n || !finiteBox(b) || !(b.w > 0 && b.h > 0)) bad.push(keys[i]); });
      ok(!bad.length, bad.length + ' icons draw nothing or have no finite bounds: ' + bad.slice(0, 10).join(', '));
      checkSvg(await svgString({}), 'all icons');
    });

    // ---------- element types ----------
    const types = Object.keys(DEF), at = i => ({ x: 110 + (i % 8) * 190, y: 100 + Math.floor(i / 8) * 165 });
    test('types: a blank figure', async () => { blank(); await settle(); eq(scene.objects.length, 0, 'objects'); });
    types.forEach((t, i) => test('type ' + t + ': add, render, panel, bounds', async () => {
      const id = fig.add(t, at(i)); await settle();
      const o = get(id); ok(o && o.type === t, 'not added');
      sel = new Set([id]); buildPanel();
      const P = D.querySelector('#props'); ok(P && P.childElementCount > 0, 'the side panel is empty');
      ok(P.querySelectorAll('input,select,textarea,button').length > 0, 'the side panel has no controls');
      ok(D.querySelector('#content [data-id="' + id + '"]') || t === 'sketch', 'not drawn');
      const b = bbox(id); ok(b && finiteBox(b), 'bounds not finite: ' + short(b));
      sel = new Set(); buildPanel();
    }));
    test('types: SVG of all types together parses, no NaN', async () => { await settle(); checkSvg(await svgString({}), 'all types'); checkSvg(await svgString({ transparent: true }), 'all types, transparent'); });
    test('types: PNG export', async () => checkPng(800, 'all types'));
    test('types: PDF export (structure, xref)', async () => checkPdf('all types'));
    test('types: TIFF export', async () => checkTiff('all types'));
    test('types: PowerPoint export', async () => { await checkPptx('all types', opts.strict); });

    // ---------- examples ----------
    let exList = null;   // listed before the run, so each example is a test of its own
    try { const r = await fetch('api/files?scope=examples', { cache: 'no-store' }); if (r.ok) exList = (await r.json()).map(f => f.name || f); } catch (e) {}
    test('examples: listed', () => { ok(Array.isArray(exList) && exList.length > 0, 'no examples listed (api/files?scope=examples)'); });
    // named "examples: <file>" so that only: ['examples'] runs all of them (the icon library's PowerPoint alone takes ~100 s here: 600 s for slow CI machines)
    (exList || []).forEach(n => test('examples: ' + n + ' loads, exports SVG, PNG, PDF, PowerPoint', async () => {
      const r = await fetch('examples/' + n, { cache: 'no-store' }); ok(r.ok, 'HTTP ' + r.status);
      fig.set(JSON.parse(await r.text())); await settle();
      ok(scene.objects.length > 0, 'no elements');
      for (const o of scene.objects) { if (o.hidden || o.type === 'comment') continue; const b = bbox(o.id); ok(!b || finiteBox(b), o.type + ' ' + o.id + ' has bounds ' + short(b)); }
      checkSvg(await svgString({}), 'SVG');
      await checkPng(Math.min(1200, Math.max(200, Math.round(scene.w / 2))), 'PNG');
      await checkPdf('PDF');
      await checkPptx('PPTX', opts.strict);
    }, 600000));

    // ---------- undo / redo ----------
    test('undo/redo: each step goes back and forward exactly', async () => {
      blank(); await settle();
      const st = [J(scene)];
      const a = fig.add('box', { x: 300, y: 300 }); await settle(); st.push(J(scene));
      const b = fig.add('text', { x: 700, y: 300, text: 'Undo me' }); await settle(); st.push(J(scene));
      fig.update(a, { fill: '#ffcc00', x: 350 }); await settle(); st.push(J(scene));
      fig.remove(b); await settle(); st.push(J(scene));
      fig.add('shape', { kind: 'diamond', x: 500, y: 600 }); await settle(); st.push(J(scene));
      for (let i = st.length - 2; i >= 0; i--) { undo(); await settle(); eq(J(scene), st[i], 'undo to step ' + i); }
      for (let i = 1; i < st.length; i++) { redo(); await settle(); eq(J(scene), st[i], 'redo to step ' + i); }
      undo(); undo(); await settle(); eq(J(scene), st[st.length - 3], 'two undos');
      fig.add('chip', { x: 200, y: 700 }); await settle(); eq(fut.length, 0, 'a new change after undo clears redo');
      const before = J(scene); redo(); await settle(); eq(J(scene), before, 'redo with nothing to redo');
    });
    test('undo/redo: big figures keep compact steps that give back exactly the same figure', async () => {
      const objs = []; for (let i = 0; i < 600; i++) objs.push({ id: 'k' + i, type: i % 3 ? 'text' : 'box', x: 40 + (i % 30) * 50, y: 40 + Math.floor(i / 30) * 40, text: 'Item ' + i });
      fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], objects: objs }); await settle();
      const st = [J(scene)]; ok(st[0].length > 5e4, 'the test figure is big enough to be packed');
      fig.update('k1', { text: 'changed "quoted" \\ text' }); await settle(); st.push(J(scene));
      fig.remove('k5'); await settle(); st.push(J(scene));
      fig.add('chip', { x: 300, y: 860, text: 'new' }); await settle(); st.push(J(scene));
      fig.update('k9', { x: 999 }); await settle(); st.push(J(scene));
      const raw = hist.raw || []; ok(raw.slice(-4).every(v => v && typeof v === 'object'), 'the steps are kept packed');
      for (let i = st.length - 2; i >= 0; i--) { undo(); await settle(); eq(J(scene), st[i], 'undo to step ' + i); }
      ok((fut.raw || []).slice(-1).every(v => v && typeof v === 'object'), 'redo steps are packed too');
      for (let i = 1; i < st.length; i++) { redo(); await settle(); eq(J(scene), st[i], 'redo to step ' + i); }
    });
    test('undo/redo: fig.set is one step', async () => {
      blank(); fig.add('box', { x: 200, y: 200 }); await settle(); const s1 = J(scene);
      fig.set({ version: 4, w: 800, h: 600, bg: '#eeeeee', palette: [], objects: [{ id: 'q1', type: 'text', x: 100, y: 100, text: 'replaced' }] }); await settle();
      eq(scene.w, 800, 'width'); undo(); await settle(); eq(J(scene), s1, 'undo of fig.set');
    });

    // ---------- connectors ----------
    test('connectors: attach, follow, undo, delete, copy and paste', async () => {
      blank(); const a = fig.add('box', { x: 300, y: 400 }), b = fig.add('box', { x: 900, y: 400 }); await settle();
      const id = fig.connect(a, b); await settle(); let o = get(id);
      ok(o && o.type === 'arrow' && o.from && o.to && o.from.id === a && o.to.id === b, 'not attached: ' + short(o));
      const A = get(a), B = get(b), gap = o.gap != null ? o.gap : 4;
      near(o.x1, A.x + A.w / 2 + A.sw / 2 + gap, 3, 'start on the right side of the first box');
      near(o.x2, B.x - B.w / 2 - B.sw / 2 - gap, 3, 'end on the left side of the second box'); near(o.y1, 400, 1, 'y1'); near(o.y2, 400, 1, 'y2');
      const e0 = [o.x2, o.y2];
      fig.update(b, { y: 750 }); await settle(); o = get(id);
      ok(o.y2 > 600 && o.y2 < 750 + B.h / 2 + 12 && Math.abs(o.x2 - B.x) < B.w / 2 + 12, 'the end did not follow the moved box: ' + short([o.x2, o.y2]));
      undo(); await settle(); o = get(id); near(o.x2, e0[0], .5, 'undo x2'); near(o.y2, e0[1], .5, 'undo y2');
      redo(); await settle(); o = get(id); ok(o.y2 > 600, 'redo: the end follows again');
      undo(); await settle();
      const x1 = get(id).x1; fig.remove(a); await settle(); o = get(id);
      ok(o && !o.from && o.to, 'deleting the start element frees that end only'); near(o.x1, x1, .5, 'a freed end keeps its place');
      undo(); await settle(); ok(get(id) && get(id).from && get(id).from.id === a, 'undo brings the attachment back');
      // copy writes the clipboard of every editor tab on this address (localStorage fig.clip) and the system clipboard: both are put back
      const clip0 = clip; let ls0 = null, cb = null; try { ls0 = localStorage.getItem('fig.clip'); } catch (e) {}
      try { if (navigator.clipboard) { cb = Object.getOwnPropertyDescriptor(navigator.clipboard, 'writeText'); navigator.clipboard.writeText = () => Promise.resolve(); } } catch (e) {}
      try {
        sel = new Set([a, b, id]); copySel(); pasteObjs(clip); await settle();
        const ids = [...sel], na = ids.map(get).find(x => x.type === 'arrow');
        ok(na && na.from && na.to && ids.includes(na.from.id) && ids.includes(na.to.id) && na.from.id !== a, 'pasted with both elements: attached to the copies');
        sel = new Set([id]); copySel(); pasteObjs(clip); await settle();
        const lone = get([...sel][0]); ok(lone && lone.type === 'arrow' && !lone.from && !lone.to, 'pasted alone: free');
      } finally {
        clip = clip0;
        try { if (ls0 == null) localStorage.removeItem('fig.clip'); else localStorage.setItem('fig.clip', ls0); } catch (e) {}
        try { if (navigator.clipboard) { if (cb) Object.defineProperty(navigator.clipboard, 'writeText', cb); else delete navigator.clipboard.writeText; } } catch (e) {}
      }
      const e = fig.connect({ id: a, side: 's' }, b, { route: 'elbowV' }); await settle();
      const eo = get(e); ok([eo.x1, eo.y1, eo.x2, eo.y2].every(Number.isFinite), 'elbow connector coordinates');
      let threw = false; try { fig.connect(a, a); } catch (er) { threw = true; } ok(threw, 'fig.connect(a, a) must throw');
      sel = new Set(); checkSvg(await svgString({}), 'connectors');
    });
    test('connectors: two-bend elbows, loops, spread ends, labels, connect many', async () => {
      blank(); const a = fig.add('box', { x: 200, y: 200, w: 160, h: 80 }), b = fig.add('box', { x: 600, y: 420, w: 160, h: 80 }); await settle();
      const z = fig.connect({ id: a, side: 'e' }, { id: b, side: 'w' }, { route: 'elbow', label: 'yes' }); await settle(); let o = get(z);
      eq(o.dirs, 'ew', 'right side to left side'); let g = elbowGeo(o); eq(g.k, 'Z', 'facing sides make a Z');
      near(g.pts[1][0], (o.x1 + o.x2) / 2, .6, 'middle leg halfway'); near(g.pts[1][1], o.y1, .1, 'first leg flat'); near(g.pts[2][1], o.y2, .1, 'last leg flat');
      fig.update(z, { mid: .25 }); await settle(); o = get(z); near(elbowGeo(o).pts[1][0], o.x1 + (o.x2 - o.x1) * .25, .6, 'mid moves the middle leg');
      const u = fig.connect({ id: b, side: 'e' }, { id: a, side: 'e' }, { route: 'elbow' }); await settle(); o = get(u); g = elbowGeo(o);
      eq(g.k, 'U', 'same-way sides make a loop'); ok(g.pts[1][0] > Math.max(o.x1, o.x2) + 10, 'the loop goes beyond both ends');
      fig.update(u, { mid: .5 }); await settle(); o = get(u); ok(elbowGeo(o).pts[1][0] >= Math.max(o.x1, o.x2) + 20, 'a Z middle-leg value does not pull the loop onto the box');
      fig.update(u, { loop: 64 }); await settle(); o = get(u); near(elbowGeo(o).pts[1][0], Math.max(o.x1, o.x2) + 64, .6, 'loop = px beyond the farther end');
      const A2 = fig.add('box', { x: 1200, y: 150, w: 600, h: 100 }), B2 = fig.add('box', { x: 1000, y: 500, w: 200, h: 100 }), C2 = fig.add('box', { x: 1400, y: 500, w: 200, h: 100 }); await settle();
      const v1 = fig.connect(A2, B2, { route: 'elbowV' }), v2 = fig.connect(A2, C2, { route: 'elbowV' }); await settle(); const V = [v1, v2].map(get);
      ok(V.every(q => q.x1 === q.x2) && V[0].x1 !== V[1].x1, 'straight connections through a shared stretch are not spread: ' + V.map(q => q.x1 + '/' + q.x2).join(', '));
      const h = fig.add('box', { x: 200, y: 700, w: 160, h: 80 }), t = [1, 2, 3].map(i => fig.add('box', { x: 700, y: 520 + i * 100, w: 120, h: 50 })); await settle();
      const ids = fig.connectMany([h, ...t], { mode: 'star', route: 'elbow' }); await settle(); eq(ids.length, 3, 'star makes one arrow per target');
      eq(fig.connectMany([h, ...t], { mode: 'star' }).length, 0, 'pairs already connected are not doubled');
      const ys = ids.map(i => get(i).y1); ok(new Set(ys).size === 3 && ys[0] < ys[1] && ys[1] < ys[2], 'ends on one side are spread in order: ' + ys.join(', '));
      const fan = fig.connectMany([...t, b], { mode: 'fan', route: 'line' }); await settle(); eq(fan.length, 3, 'fan-in');
      o = get(z); fig.update(z, { labelPos: .1, labelOff: 10, labelBg: 'none' }); await settle(); o = get(z);
      const m = arrowLabelAt(o), p = polyAt(arrowPoly(o), .1); ok(Math.hypot(m[0] - p[0], m[1] - p[1]) > 9, 'label offset from the line');
      scene.bg = '#1f2937'; fig.update(z, { labelBg: 'auto' }); await settle(); eq(labelFill(get(z)), '#1f2937', 'auto label backdrop = page color'); undo(); await settle();
      const leg = fig.add('arrow', { x1: 100, y1: 100, x2: 300, y2: 160, route: 'elbowH' }); await settle(); eq(elbowGeo(get(leg)).k, 'L', 'old elbows keep one bend');
      sel = new Set(); checkSvg(await svgString({}), 'two-bend connectors');
    });

    // ---------- off-page ----------
    test('off-page elements are left out of the SVG', async () => {
      blank(); const on = fig.add('text', { x: 300, y: 300, text: 'on the page' }), off = fig.add('text', { x: -3000, y: 300, text: 'parked' }), edge = fig.add('box', { x: 0, y: 450, w: 200, h: 100 }); await settle();
      const s = await svgString({});
      ok(s.includes('id="text-' + on + '"'), 'an element on the page is missing'); ok(!s.includes('id="text-' + off + '"'), 'an element parked off the page was exported');
      ok(s.includes('id="box-' + edge + '"'), 'an element half on the page is missing');
    });

    // ---------- clipboard (Copy as PNG / SVG, Paste from clipboard) and TIFF pictures ----------
    test('clipboard and TIFF: copy as picture, paste from clipboard, TIFF reader', async () => {
      if (typeof copySelPng !== 'function') throw new Skip('this editor has no Copy as picture');
      blank(); const a = fig.add('box', { x: 300, y: 300, w: 200, h: 100 }), t = fig.add('text', { x: 600, y: 300, text: 'Clip **me**' }); await settle();
      // the system clipboard is stubbed and put back: a test must not change what the user copied
      const cbd = navigator.clipboard, saved = {}, names = ['write', 'writeText', 'read', 'readText'], calls = [];
      if (!cbd) throw new Skip('no navigator.clipboard (not a secure page)');
      for (const k of names) saved[k] = Object.getOwnPropertyDescriptor(cbd, k);
      let inHandler = false, items = null, readAns = null;
      try {
        cbd.write = its => { calls.push({ sync: inHandler, types: its.map(i => i.types.join()).join(' | ') }); items = its; return Promise.resolve(); };
        cbd.writeText = () => Promise.resolve(); cbd.read = async () => readAns; cbd.readText = async () => '';
        sel = new Set([a, t]); render();
        if (window.ClipboardItem) {
          inHandler = true; const p = copySelPng(); inHandler = false; await p;
          ok(calls.length === 1 && calls[0].sync, 'the clipboard write starts inside the key press (Safari allows it only then)');
          eq(calls[0].types, 'image/png', 'Copy as picture puts a PNG on the clipboard');
          const b = new Uint8Array(await (await items[0].getType('image/png')).arrayBuffer()), dv = new DataView(b.buffer), [W, H] = selPngSize(selFrame());
          eq([b[1], b[2], b[3]].map(c => String.fromCharCode(c)).join(''), 'PNG', 'PNG signature'); eq(dv.getUint32(16), W, 'PNG width'); eq(dv.getUint32(20), H, 'PNG height');
          ok(W >= 2 * selFrame().w - 1 && Math.max(W, H) <= 4000, 'picture at 2x, long side at most 4000 px: ' + W + ' x ' + H);
          inHandler = true; const q = copySelSvg(); inHandler = false; await q;
          ok(calls.length === 2 && calls[1].sync && calls[1].types === 'text/plain', 'Copy as SVG starts its write at once as well');
          ok(/^<svg [^>]*viewBox/.test(await (await items[0].getType('text/plain')).text()), 'Copy as SVG gives an SVG');
        }   // a browser without ClipboardItem: Copy as picture only says so
        // Paste from clipboard: elements copied in another tab, plain text, at the right-click spot
        const n0 = scene.objects.length, tag = CLIP_TAG + JSON.stringify([{ ...get(a), id: 'zzclip1' }]);
        readAns = [{ types: ['text/plain'], getType: async () => new Blob([tag], { type: 'text/plain' }) }];
        await pasteSystem({ x: 900, y: 600 }); const pb = bbox([...sel][0]);
        eq(scene.objects.length, n0 + 1, 'tagged elements pasted'); near(pb.x + pb.w / 2, 900, 1, 'pasted where asked (x)'); near(pb.y + pb.h / 2, 600, 1, 'pasted where asked (y)');
        readAns = [{ types: ['text/plain'], getType: async () => new Blob(['plain words'], { type: 'text/plain' }) }];
        await pasteSystem(null); const pt = get([...sel][0]); ok(pt && pt.type === 'text' && pt.text === 'plain words', 'plain text becomes a text element');
        // cells from Excel / text from Word come with HTML and a picture of them: their text is pasted; a copied picture (no text, or only its address) stays a picture
        const cells = 'A\tB\n1\t2', blobs = { 'text/plain': new Blob([cells]), 'text/html': new Blob(['<table>']), 'image/png': new Blob([new Uint8Array(8)], { type: 'image/png' }) };
        readAns = [{ types: Object.keys(blobs), getType: async t => blobs[t] }]; await pasteSystem(null); const pc = get([...sel][0]); ok(pc && pc.type === 'text' && pc.text === cells, 'Office-style clipboard pastes its text');
        eq([picOverText(true, 'https://example.org/a.png'), picOverText(false, 'micro.png'), picOverText(true, '')].join(), 'true,true,true', 'a copied picture stays a picture');
        readAns = []; const n1 = scene.objects.length; await pasteSystem(null); eq(scene.objects.length, n1, 'an empty clipboard pastes nothing (not an older copy)');
      } finally {
        for (const k of names) { try { if (saved[k]) Object.defineProperty(cbd, k, saved[k]); else delete cbd[k]; } catch (e) {} }
      }
      // TIFF reader: the editor's own TIFF export read back (LZW and uncompressed, RGB and RGBA) = the PNG of the same figure
      sel = new Set(); render();
      let prev = null;
      for (const o of [{ lzw: true }, { lzw: false }, { lzw: true, transparent: true }]) {
        const { blob } = await makeTiff(240, 96, o), d = await tiffDecode(new Uint8Array(await blob.arrayBuffer()));
        if (prev && !o.transparent) ok(prev.every((v, i) => v === d.px[i]), 'LZW and uncompressed TIFF read back to the same pixels'); prev = d.px;
        const { bytes } = await makePng(240, 96, { transparent: !!o.transparent }), img = new Image(); img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); await imgReady(img);
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const r = x.getImageData(0, 0, c.width, c.height).data; URL.revokeObjectURL(img.src);
        eq(d.w + 'x' + d.h, c.width + 'x' + c.height, 'TIFF size ' + JSON.stringify(o));
        // the TIFF is drawn in bands, so a few edge pixels of text may be smoothed differently than in the PNG (Firefox): count the pixels that differ clearly
        let bad = 0; for (let i = 0; i < r.length; i += 4) { let m = Math.abs(r[i + 3] - d.px[i + 3]); if (r[i + 3] > 250) for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(r[i + k] - d.px[i + k])); if (m > 8) bad++; }
        ok(bad <= r.length / 4 * .005, 'TIFF pixels match the PNG ' + JSON.stringify(o) + ': ' + bad + ' of ' + r.length / 4 + ' differ');
      }
      // hand-made TIFFs: 16-bit gray (big-endian, two strips, stretched), PackBits, palette, 1-bit
      const tif = (le, W, H, tags, data) => { const n = tags.length, ifdAt = 8 + data.length + (data.length & 1), b = new Uint8Array(ifdAt + 2 + n * 12 + 4 + 2048), v = new DataView(b.buffer); b[0] = b[1] = le ? 73 : 77; v.setUint16(2, 42, le); v.setUint32(4, ifdAt, le); b.set(data, 8); v.setUint16(ifdAt, n, le); let ex = ifdAt + 2 + n * 12 + 4;
        tags.sort((p, q) => p[0] - q[0]).forEach(([tag, typ, vals], i) => { const e = ifdAt + 2 + i * 12, sz = typ === 3 ? 2 : 4, put = (o, x) => typ === 3 ? v.setUint16(o, x, le) : v.setUint32(o, x, le); v.setUint16(e, tag, le); v.setUint16(e + 2, typ, le); v.setUint32(e + 4, vals.length, le);
          if (vals.length * sz <= 4) vals.forEach((x, j) => put(e + 8 + j * sz, x)); else { v.setUint32(e + 8, ex, le); vals.forEach((x, j) => put(ex + j * sz, x)); ex += vals.length * sz; } }); return b.slice(0, ex); };
      { const raw = new Uint8Array(40), v = new DataView(raw.buffer); for (let i = 0; i < 20; i++) v.setUint16(i * 2, 1000 + i * 100, false);
        const d = await tiffDecode(tif(false, 5, 4, [[256, 3, [5]], [257, 3, [4]], [258, 3, [16]], [262, 3, [1]], [273, 4, [8, 28]], [278, 3, [2]], [279, 4, [20, 20]]], raw));
        eq([d.px[0], d.px[19 * 4]].join(), '0,255', '16-bit gray stretched black to white'); ok(/stretched from 1000/.test(d.note), '16-bit note: ' + d.note); }
      { const d = await tiffDecode(tif(true, 6, 1, [[256, 3, [6]], [257, 3, [1]], [258, 3, [8]], [259, 3, [32773]], [262, 3, [1]], [273, 4, [8]], [279, 4, [5]]], new Uint8Array([1, 7, 9, 256 - 3, 200])));
        eq([0, 1, 2, 5].map(i => d.px[i * 4]).join(), '7,9,200,200', 'PackBits literal + repeat run'); }
      { const cm = new Array(768).fill(0); cm[1] = 65535; cm[256 + 2] = 65535; const d = await tiffDecode(tif(true, 3, 1, [[256, 3, [3]], [257, 3, [1]], [258, 3, [8]], [262, 3, [3]], [273, 4, [8]], [279, 4, [3]], [320, 3, cm]], new Uint8Array([0, 1, 2])));
        eq([...d.px.slice(4, 12)].join(), '255,0,0,255,0,255,0,255', 'palette colors'); }
      // a 4-bit palette: its ColorMap has 3 × 16 entries (green and blue came out 0 when they were looked up as if it had 256)
      { const cm = []; for (let i = 0; i < 16; i++) cm[i] = i * 4096; for (let i = 0; i < 16; i++) cm[16 + i] = (15 - i) * 4096; for (let i = 0; i < 16; i++) cm[32 + i] = i * 2570;
        const d = await tiffDecode(tif(true, 4, 1, [[256, 3, [4]], [257, 3, [1]], [258, 3, [4]], [262, 3, [3]], [273, 4, [8]], [279, 4, [2]], [320, 3, cm]], new Uint8Array([0x12, 0x3F])));
        eq([0, 1, 2, 3].map(p => [...d.px.slice(p * 4, p * 4 + 3)].join(' ')).join(), '16 224 10,32 208 20,48 192 30,240 0 150', '4-bit palette colors'); }
      { const d = await tiffDecode(tif(true, 10, 1, [[256, 3, [10]], [257, 3, [1]], [258, 3, [1]], [262, 3, [1]], [273, 4, [8]], [279, 4, [2]]], new Uint8Array([0b10110000, 0b01000000])));
        eq([...Array(10)].map((_, i) => d.px[i * 4] ? 1 : 0).join(''), '1011000001', '1-bit rows'); }
      let msg = ''; try { await tiffDecode(tif(true, 2, 2, [[256, 3, [2]], [257, 3, [2]], [259, 3, [7]], [273, 4, [8]], [279, 4, [4]]], new Uint8Array(4))); } catch (e) { msg = e.message; }
      ok(/JPEG-compressed/.test(msg), 'unsupported compression explained: ' + msg);
    });

    // ---------- colors: series, ink on dark pages, color check, palette recolor ----------
    test('colors: survival series, dark-page ink, color check, recolor', async () => {
      blank(); const sv = fig.add('survival', { x: 300, y: 300, series: 'Control\nDrug A\nDrug B' }); await settle();
      const st = [...D.querySelectorAll(`#content [data-id="${sv}"] line`)].map(l => l.getAttribute('stroke'));
      eq(new Set(st).size, 3, 'three uncolored survival lines need three legend colors');
      const p = fig.add('plot', { x: 900, y: 300, kind: 'line', legend: true, data: 'WT: 1 2 3\nKO: 2 3 1\nHet: 3 1 2\nRescue: 1 3 2' }); await settle();
      const fillOf = id => D.querySelector(`#content [data-id="${id}"] text`).getAttribute('fill');
      eq(fillOf(p), '#374151', 'chart labels on a white page keep their dark gray');
      const cc = colorCheck(); ok(cc.alike.some(r => r.id === p && /protanopia/.test(r.msg)), 'blue and purple series not flagged for protanopia: ' + short(cc.alike));
      const c = fig.add('chip', { x: 300, y: 600, fill: '#f0a030' }); await settle(); ok(colorCheck().text.some(r => r.id === c), 'white text on orange not flagged');
      ok(fig.check().some(r => r.id === c && r.level === 'warn'), 'fig.check does not list the contrast problem');
      fig.set({ ...fig.get(), bg: '#1f2937' }); await settle(); eq(fillOf(p), '#d1d5db', 'chart labels on a dark page');
      const before = J(scene); const n = recolorFig({ '#6f86c8': '#0072b2' }); commit(); ok(n > 0, 'recolor changed nothing'); undo(); await settle(); eq(J(scene), before, 'undo after recolor');
      cvdPreview('protan'); const s = await svgString({}); cvdPreview(''); ok(!/cvdF|grayscale/.test(s), 'the colorblind preview reached the SVG export');
      // on the dark page: fig.add starts light unless the call sets a color; geometry gets a dark fill for its light labels
      const t1 = fig.add('text', { x: 200, y: 800, text: 'hi' }), t2 = fig.add('text', { x: 400, y: 800, text: 'x', color: '#1f2328' });
      eq([get(t1).color, get(t2).color].join(), '#e5e7eb,#1f2328', 'fig.add text on a dark page');
      const g = fig.add('geom', { x: 1200, y: 700 }); await settle(); ok(!colorCheck().text.some(r => r.id === g), 'geometry labels unreadable on a dark page: ' + short(colorCheck().text));
      // an explicit line in the element's color and an uncolored one stay apart
      const sv2 = survSer({ color: '#6f86c8', series: 'Control\nDrug A:#6f86c8\nDrug B' }); ok(sv2[2][1] !== '#6f86c8', 'Drug B took the color Drug A uses');
      // a series palette reaches a chart still in its default colors (series 1 and 2 stayed the default blue and orange)
      scene.seriesPal = ['#0072b2', '#e69f00', '#009e73']; const p2 = fig.add('plot', { kind: 'line', data: 'A: 1 2\nB: 2 3\nC: 3 1' });
      eq(serList(get(p2)).map(r => r[1]).join(), '#0072b2,#e69f00,#009e73', 'series palette on a new chart'); delete scene.seriesPal;
    });

    // ---------- rich text ----------
    test('rich text: inline formatting is parsed as documented', () => {
      const C = [['**bold**', [{ b: true, text: 'bold' }]], ['*italic*', [{ i: true, text: 'italic' }]], ['__u__', [{ u: true, text: 'u' }]], ['~~s~~', [{ s: true, text: 's' }]],
        ['x^2', [{ text: 'x' }, { sup: true, sub: false, text: '2' }]], ['x^{2+}', [{ text: 'x' }, { sup: true, sub: false, text: '2+' }]], ['Ca^{2+}', [{ text: 'Ca' }, { sup: true, sub: false, text: '2+' }]],
        ['H_2O', [{ text: 'H' }, { sub: true, sup: false, text: '2' }, { text: 'O' }]], ['CO_{2}', [{ text: 'CO' }, { sub: true, sup: false, text: '2' }]], ['x_{i}', [{ text: 'x' }, { sub: true, sup: false, text: 'i' }]],
        ['{#ff0000|red}', [{ color: '#ff0000', text: 'red' }]], ['***x***', [{ b: true, i: true, text: 'x' }]],
        ['**bold *it* b**', [{ b: true, text: 'bold ' }, { b: true, i: true, text: 'it' }, { b: true, text: ' b' }]],
        ['\\*lit\\*', [{ text: '*' }, { text: 'lit' }, { text: '*' }]],
        // left alone: lone stars, significance stars, snake_case, x^n without braces
        ['*p<0.05', [{ text: '*p<0.05' }]], ['***', [{ text: '***' }]], ['snake_case_name', [{ text: 'snake_case_name' }]], ['a*b*c', [{ text: 'a*b*c' }]], ['5 * 3', [{ text: '5 * 3' }]], ['x^n', [{ text: 'x^n' }]],
        // sample names stay as typed; formulas keep their subscripts
        ['rep_1', [{ text: 'rep_1' }]], ['ctrl_1 vs sample_2', [{ text: 'ctrl_1 vs sample_2' }]], ['day_7_treated', [{ text: 'day_7_treated' }]],
        ['C_6H_12O_6', [{ text: 'C' }, { sub: true, sup: false, text: '6' }, { text: 'H' }, { sub: true, sup: false, text: '12' }, { text: 'O' }, { sub: true, sup: false, text: '6' }]],
        ['t_0', [{ text: 't' }, { sub: true, sup: false, text: '0' }]], ['log_2', [{ text: 'log' }, { sub: true, sup: false, text: '2' }]],
        ['x_1x_2', [{ text: 'x' }, { sub: true, sup: false, text: '1' }, { text: 'x' }, { sub: true, sup: false, text: '2' }]], ['CO_2e', [{ text: 'CO' }, { sub: true, sup: false, text: '2' }, { text: 'e' }]]];
      const bad = C.filter(([s, want]) => J(richRuns(s).map(r => { const o = {}; Object.keys(r).sort().forEach(k => o[k] = r[k]); return o; })) !== J(want.map(r => { const o = {}; Object.keys(r).sort().forEach(k => o[k] = r[k]); return o; })));
      ok(!bad.length, bad.map(([s]) => s + ' → ' + short(richRuns(s), 120)).join(' | '));
      eq(plainText('H_2O and **x**'), 'H2O and x', 'plainText');
      const sp = rt('C. elegans and E. coli'); eq((sp.match(/font-style="italic"/g) || []).length, 2, 'species italics');
    });

    // ---------- files ----------
    test('old and broken files are repaired on load', () => {
      const s = healScene({ w: 'x', h: -5, bg: 7, palette: 'red', objects: [null, 5, { type: 'text', id: 'a', text: 'one' }, { type: 'box', id: 'a' }, { noType: 1 }, { type: 'text' }] });
      eq(s.objects.length, 3, 'objects kept'); eq(new Set(s.objects.map(o => o.id)).size, 3, 'unique ids');
      eq([s.w, s.h, s.bg], [1600, 900, '#ffffff'], 'page fields'); ok(Array.isArray(s.palette), 'palette');
    });
    test('fig API: clear errors for wrong calls', async () => {
      const th = f => { try { f(); return false; } catch (e) { return true; } };
      ok(th(() => fig.add('no-such-type')), 'fig.add of an unknown type'); ok(th(() => fig.update('no-such-id', {})), 'fig.update of a missing id');
      ok(th(() => fig.set({})), 'fig.set without objects'); ok(th(() => fig.reply('no-such-id', 'x')), 'fig.reply to a missing comment');
      if (typeof fig.check !== 'function') return;   // older editor
      ok(th(() => fig.remove(['no-such-id'])), 'fig.remove of a missing id');
      blank(); const has = (id, re) => fig.check([id]).some(m => m.id === id && re.test(m.msg));
      const a = fig.add('text', { txt: 'oops', colour: '#f00' }); ok(has(a, /“txt”.*“text”/), 'unknown field txt → text'); ok(has(a, /“colour”.*“color”/), 'unknown field colour → color');
      const b = fig.add('icon', { kind: 'mitochondria' }); ok(has(b, /mitochondria.*did you mean mito\b/), 'icon kind mitochondria → mito');
      const c = fig.add('arrow', { head: 'triangle' }); ok(has(c, /head: “triangle”/), 'arrow head not among the choices');
      const d = fig.add('text', { text: 'x' }); ok(fig.update(d, { size: 'abc' }).some(m => /size/.test(m.msg)), 'fig.update returns the warnings');
      eq(fig.findIcon('mitochondria', 3)[0].kind, 'mito', 'fig.findIcon'); ok(/did you mean text/.test((() => { try { fig.add('textbox'); } catch (e) { return e.message; } })()), 'type textbox → text');
      commit(); const h0 = hist.length, before = lastSaved; fig.batch(() => { const m = []; for (let i = 0; i < 20; i++) m.push(fig.add('chip', { x: 40 + i * 30, y: 600 })); m.forEach(id => fig.update(id, { y: 650 })); fig.remove(m.slice(0, 5)); });
      ok(hist[hist.length - 1] === before && (h0 >= 300 || hist.length - h0 === 1), 'fig.batch is one undo step'); undo(); eq(lastSaved, before, 'undo after fig.batch'); redo();
      if (typeof figEnd !== 'function') return;   // older editor
      const p1 = fig.add('box', { x: 300, y: 300, w: 200, h: 150 }), p2 = fig.add('box', { x: 600, y: 300, w: 200, h: 150 });
      ok(!fig.check(fig.labelPanels([p1, p2])).some(m => /unknown field/.test(m.msg)), 'panel letters have no unknown field');
      // Undo while an async batch waits: the batch ends first (its changes are a step), nothing is lost from the history
      commit(); const pre = lastSaved; let rel; const pr = fig.batch(async () => { fig.add('chip', { x: 60, y: 700 }); await new Promise(r => rel = r); fig.add('chip', { x: 90, y: 700 }); });
      undo(); ok(!figB.d && lastSaved === pre, 'Undo during an async fig.batch ends it and undoes it'); rel(); await pr; ok(!figB.d && hist.includes(pre), 'after the batch: ordinary steps, the state before it still in the history');
    });
    // last: the figure left behind is the one run.html reloads and compares (save → reload round trip)
    test('save → reload: the saved file holds exactly the figure', async () => {
      blank(); types.forEach((t, i) => fig.add(t, at(i))); await settle(); commit(); await settle();
      await flushSave(); await sleep(100); await flushSave();
      const r = await fetch(FILE, { cache: 'no-store' }); ok(r.ok, 'reading the file back: HTTP ' + r.status);
      const t = await r.text(); eq(t.replace(/\n/g, '') === lastSaved, true, 'the file differs from the last saved state');   // written one element per line; JSON has no raw line breaks inside strings
      ok(t.split('\n').length >= scene.objects.length, 'the file is not written one element per line');
      eq(J(healScene(JSON.parse(t))), J(scene), 'the file, loaded again, differs from the figure');
      W.__roundTrip = J(scene);
    });

    const only = Array.isArray(opts.only) && opts.only.length ? opts.only : null;
    const run = only ? list.filter(t => only.some(p => t.name.startsWith(p))) : list;
    if (!run.length) tests.push({ name: 'test selection', ok: false, msg: 'no test name starts with ' + (only || []).map(p => '"' + p + '"').join(', ') + ' (names start with: icons, types, type <name>, examples, undo/redo, connectors, off-page, rich text, old and broken, fig API, save)' });
    let stuck = null;   // a test that timed out and did not stop: the ones after it would share the figure with it
    for (let i = 0; i < run.length; i++) {
      const T = run[i], t0 = performance.now(), e0 = errs.length;
      if (stuck) { tests.push({ name: T.name, ok: false, skip: true, msg: 'not run: "' + stuck + '" timed out and was still running', ms: 0 }); continue; }
      if (opts.onProgress) try { opts.onProgress(T.name, i, run.length); } catch (e) {}
      let r, timedOut = false;
      const p = Promise.resolve().then(T.fn);
      try {
        const v = await Promise.race([p, sleep(T.timeout).then(() => { timedOut = true; throw new Error('timed out after ' + T.timeout / 1000 + ' s'); })]);
        r = { name: T.name, ok: true }; if (v && v.note) r.msg = v.note;
        if (errs.length > e0) r = { name: T.name, ok: false, msg: 'uncaught error: ' + errs.slice(e0).join(' | ') };
      } catch (e) { r = e instanceof Skip ? { name: T.name, ok: false, skip: true, msg: e.message } : { name: T.name, ok: false, msg: String(e && e.message || e) + (e && e.stack && !/expected|timed out/.test(e.message || '') ? ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' ').trim().slice(0, 200) : '') }; }
      r.ms = Math.round(performance.now() - t0); tests.push(r);
      if (timedOut) {   // let it finish (up to 60 s more) before the next test touches the figure; if it still runs, stop here
        let done = false; await Promise.race([p.then(() => { done = true; }, () => { done = true; }), sleep(60000)]);
        if (done) r.msg += ' (it finished ' + Math.round((performance.now() - t0 - T.timeout) / 1000) + ' s later)'; else { stuck = T.name; r.msg += ' (still running: the remaining tests are not run)'; }
      }
    }
    W.removeEventListener('error', onErr); W.removeEventListener('unhandledrejection', onRej);
    try { sel = new Set(); if (!opts.keep) { fig.set(JSON.parse(orig)); await settle(); await flushSave(); } buildPanel(); } catch (e) {}
    return res();
  };
})();
