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
  // a double tap by a finger: both taps' events are made first, so their times stay within the 400 ms the editor counts (a loaded machine's redraw after the first tap is not the user's delay); the second press goes to what is under it by then
  const doubleTap = async (w, x1, y1, x2 = x1, y2 = y1, afterFirst) => { const d = w.document, svg = d.querySelector('#svg'), E = [['pointerdown', x1, y1], ['pointerup', x1, y1], ['pointerdown', x2, y2], ['pointerup', x2, y2]].map(([type, clientX, clientY]) => new w.PointerEvent(type, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX, clientY, bubbles: true, cancelable: true, composed: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    let t = d.elementFromPoint(x1, y1); t.dispatchEvent(E[0]); (t.isConnected ? t : svg).dispatchEvent(E[1]); if (afterFirst) afterFirst(); await sleep(100); t = d.elementFromPoint(x2, y2); t.dispatchEvent(E[2]); (t.isConnected ? t : svg).dispatchEvent(E[3]); };
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
    const watch = f => { f.addEventListener('error', e => { if (!/ResizeObserver loop/.test(e.message || '')) onErr(e); }); f.addEventListener('unhandledrejection', onRej); return f; };   // a frame's own uncaught errors fail the test too (the frames are resized: that browser notice is no error)
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
      const cs = getComputedStyle(document.querySelector('#svg')); ok(cs.overflowX === 'visible' && parseFloat(cs.borderTopLeftRadius) === 0, 'the page must show what lies off it: overflow ' + cs.overflowX + ', radius ' + cs.borderTopLeftRadius + ' (Safari clips an svg to its border radius)');
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
      eq(healScene({ objects: [{ type: 'sketch', id: 'k' }] }).objects[0].strokes, [], 'a sketch without strokes (it made the load throw: no polling, and the next change went over the file)');
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
    test('a request that is never answered gives up, says so, and the save follows when the server answers again', async () => {
      if (typeof FETCH_MS === 'undefined') throw new Skip('this editor has no request limits');
      const F = W.fetch, M = { ...FETCH_MS }, status = () => D.querySelector('#status').textContent, wait = async (f, ms) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await sleep(40); return f(); };
      blank(); await settle(); await flushSave();
      try {
        W.fetch = (u, o) => new Promise((_, no) => { if (o && o.signal) o.signal.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError'))); });
        FETCH_MS.read = FETCH_MS.save = 200;
        const id = fig.add('text', { x: 100, y: 100, text: 'kept' });
        ok(await wait(() => /offline|Not saved/.test(status()), 8000), 'still "' + status() + '" with no answer');
        W.fetch = F; Object.assign(FETCH_MS, M);
        ok(await wait(() => status() === 'Saved' && fileSame(), 15000), 'not saved after the server answered again: "' + status() + '"');
        ok(get(id), 'the change went');
      } finally { W.fetch = F; Object.assign(FETCH_MS, M); }
    });
    // the page going away commits what was typed in a panel field, and leaves a field that was only clicked into alone (width px rescales from its rounded value)
    test('a tab going to the background changes nothing, and saves a panel field typed in', async () => {
      blank(); const id = fig.add('shape', { kind: 'rect', x: 500, y: 300, w: 123.4, h: 81.7 }); await settle(); sel = new Set([id]); buildPanel(); await frame();
      const P = D.querySelector('#props'), fields = [...P.querySelectorAll('input,textarea')].filter(f => !['checkbox', 'radio', 'color', 'range', 'file'].includes(f.type) && f.getClientRects().length), hide = on => Object.defineProperty(D, 'hidden', { get: () => on, configurable: true }), fire = () => D.dispatchEvent(new Event('visibilitychange'));
      ok(fields.length > 2, 'the panel has no fields to try'); const before = J(scene);
      try { hide(true); for (const f of fields) { f.focus(); if (D.activeElement !== f) continue; fire(); } eq(J(scene), before, 'a field only clicked into changed the figure when the tab was hidden');
        const f = [...P.querySelectorAll('input,textarea')].find(x => x.type === 'number' || x.type === 'text'); f.focus(); if (D.activeElement === f) { const v0 = f.value, h0 = hist.length; f.value = String(parseFloat(v0 || 0) + 7); f.dispatchEvent(new Event('input', { bubbles: true })); fire(); ok(hist.length > h0 || lastSaved !== before, 'a field typed in was not committed when the tab was hidden'); }
      } finally { delete D.hidden; D.activeElement && D.activeElement.blur && D.activeElement.blur(); sel = new Set(); buildPanel(); }
    });
    // a closing page's beacon is refused above 64 KB in most browsers: the next start sends the change, with the version it was made from
    test('a closing page\'s refused save goes out at the next start', async () => {
      if (typeof closingRetry !== 'function') throw new Skip('this editor has no retry');
      const name = String(FILE).replace(/\.json$/i, '') + '-phone.json', wait = async (f, ms) => { const t0 = Date.now(); for (;;) { let v = false; try { v = f(); } catch (e) {} if (v) return true; if (Date.now() - t0 > ms) return false; await sleep(40); } };
      let fr = null;
      const open = async () => { if (fr) fr.remove(); fr = D.createElement('iframe'); fr.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:800px;border:0;z-index:2147483000;background:#fff'; fr.src = location.pathname + '?file=' + encodeURIComponent(name); D.body.appendChild(fr); ok(await wait(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 180000), 'the editor did not start in the frame'); const w = watch(fr.contentWindow); w.onbeforeunload = null; return fr; };
      try {
        fr = await open(); let w = fr.contentWindow; w.fig.add('text', { x: 100, y: 100, text: 'saved first' }); await w.flushSave();
        w.navigator.sendBeacon = () => false; const id = w.fig.add('text', { x: 100, y: 200, text: 'only in this browser' }); w.dispatchEvent(new w.Event('pagehide'));
        ok(localStorage.getItem('fig.closing:' + w.eval('DIR') + name), 'the refused save left no mark'); fr.remove(); fr = null; await sleep(100);
        fr = await open(); w = fr.contentWindow; ok(w.fig.list().some(o => o.id === id), 'the change is gone after the next start');
        await w.flushSave(); const a = await fetch(name, { cache: 'no-store' }); ok((await a.text()).includes('only in this browser'), 'the change did not reach the figure file'); eq(localStorage.getItem('fig.closing:' + w.eval('DIR') + name), null, 'the mark stayed');
      } finally {
        if (fr) { try { await fr.contentWindow.flushSave(); } catch (e) {} fr.remove(); } await sleep(200);
        try { await fetch('api/move?file=' + encodeURIComponent(name) + '&from=&to=trash', { method: 'POST' }); await fetch('api/delete?file=' + encodeURIComponent(name), { method: 'POST' }); } catch (e) {}
        try { localStorage.removeItem('figEditor.scene.v1:' + name); localStorage.removeItem('fig.closing:' + DIR + name); } catch (e) {}
      }
    });
    // ---------- where figures are kept ----------
    const waitFor = async (f, ms = 8000) => { const t0 = Date.now(); for (;;) { let v = false; try { v = f(); } catch (e) {} if (v) return true; if (Date.now() - t0 > ms) return false; await sleep(30); } };
    test('where figures are kept: running from a folder, the dialog sets a sync app\'s folder and says what happened', async () => {
      if (WEB) throw new Skip('the website has its own choices');
      const F = W.fetch, posts = []; let answer = { status: 200, json: { dir: 'C:\\Users\\a\\Dropbox\\SiliCoDraw', isDefault: false, copied: 3, differ: ['a.json'] } }, info = { dir: 'C:\\app', isDefault: true, missing: '', canChange: true, program: 'C:\\app', options: [{ name: 'Dropbox', path: 'C:\\Users\\a\\Dropbox' }, { name: 'iCloud Drive', path: 'C:\\Users\\a\\iCloudDrive' }] };
      let gone = 0; storeReload.fn = () => { gone++; };
      W.fetch = (u, o) => { if (!String(u).startsWith('api/storage')) return F(u, o); if (o && o.method === 'POST') { posts.push(u); return Promise.resolve(new Response(answer.text || JSON.stringify(answer.json), { status: answer.status })); } return Promise.resolve(new Response(JSON.stringify(info), { status: 200 })); };
      const box = () => D.querySelector('#modalBox');
      try {
        await storageDialog(); ok(/Where figures are kept/.test(box().textContent), 'no dialog'); const opts = box().querySelectorAll('.stOpt'); eq(opts.length, 2, 'the sync folders found'); ok(/Dropbox\\SiliCoDraw/.test(opts[0].textContent), 'a folder of its own inside the sync folder: ' + opts[0].textContent);
        answer = { status: 400, text: 'This folder cannot be used: no room' }; box().querySelector('#stPath').value = 'relative'; box().querySelector('#stUse').click(); ok(await waitFor(() => /no room/.test(box().querySelector('#stErr').textContent)), 'a refused folder says nothing'); eq(gone, 0, 'a refused folder reloaded the page');
        answer = { status: 200, json: { dir: 'C:\\Users\\a\\Dropbox\\SiliCoDraw', isDefault: false, copied: 3, differ: ['a.json'] } }; opts[0].click(); ok(await waitFor(() => gone === 1), 'the page was not reloaded after the switch');
        ok(/dir=C%3A%5CUsers%5Ca%5CDropbox%5CSiliCoDraw&copy=1/.test(posts[posts.length - 1]), 'the request: ' + posts[posts.length - 1]); const msg = sessionStorage.getItem('fig.storeMsg'); ok(/in Dropbox/.test(msg) && /3 files copied/.test(msg) && /a\.json/.test(msg), 'the message: ' + msg);
        info = { ...info, canChange: false, options: [] }; await storageDialog(); ok(!box().querySelector('#stPath') && /fixed folder/.test(box().textContent), 'a fixed folder offers a change'); closeModal();
      } finally { W.fetch = F; storeReload.fn = null; try { sessionStorage.removeItem('fig.storeMsg'); } catch (e) {} if (!D.querySelector('#modal').hidden) closeModal(); }
    });
    // what must never go over a figure
    // these tests answer the figure's requests themselves: no poll of the editor's own may be on its way (it would bring the real file in the middle), or start
    const pollHold = async () => { await waitFor(() => pollFile.tm, 8000); clearTimeout(pollFile.tm); pollFile.tm = 0; }, pollGo = () => { pollFile.tm = setTimeout(pollFile, 1500); };
    const countPosts = async fn => { const F = W.fetch; let posts = 0; W.fetch = (u, o) => { if (o && o.method === 'POST') posts++; return F(u, o); }; try { await fn(); } finally { W.fetch = F; } return posts; };
    test('saving: a file that cannot be read is no new figure: nothing goes over it, and it is read when it can be', async () => {
      blank(); await settle(); await flushSave(); const F = W.fetch; let posts = 0, answer = 500; const keep = { fileReady, fileText, fileVer, baseState, newHold };
      W.fetch = (u, o) => { if (o && o.method === 'POST') { posts++; return Promise.resolve(new Response(null, { status: 204 })); } if (String(u) === FILE || String(u).startsWith(FILE)) return Promise.resolve(new Response('', { status: answer })); return F(u, o); };
      await pollHold(); try { fileReady = false; for (const code of [500, 503, 423]) { answer = code; await pollOnce(); ok(!fileReady, 'HTTP ' + code + ' counted as a new figure'); await sleep(320); eq(posts, 0, 'written over a file that answered ' + code); }
      } finally { W.fetch = F; fileReady = keep.fileReady; fileText = keep.fileText; fileVer = keep.fileVer; baseState = keep.baseState; newHold = keep.newHold; setStatus('saved', 'Saved'); pollGo(); }
    });
    test('saving: a figure not in a chosen folder or service is not written there by itself; a change writes it', async () => {
      if (WEB) throw new Skip('the same code, by another signal');
      const id = fig.add('text', { x: 100, y: 100, text: 'an old copy' }); await settle(); await flushSave(); const F = W.fetch; let posts = 0; const keep = { fileReady, fileText, fileVer, baseState, newHold, startBase0 }; startBase0 = J(scene);
      W.fetch = (u, o) => { if (o && o.method === 'POST') { posts++; return Promise.resolve(new Response(null, { status: 204, headers: { ETag: '"x"' } })); } if (String(u).startsWith('api/files')) return Promise.resolve(new Response('[]', { status: 200 })); if (String(u) === FILE) return Promise.resolve(new Response('', { status: 404, headers: { 'X-SiliCoDraw-Chosen': '1' } })); return F(u, o); };
      await pollHold(); try { fileReady = false; fileText = null; fileVer = null; await pollOnce(); ok(fileReady, 'a real 404 is a new figure'); await sleep(320); eq(posts, 0, 'this browser\'s copy went to the chosen folder by itself'); ok(newHeld(), 'not held'); fig.update(id, { text: 'changed' }); ok(await waitFor(() => posts > 0, 3000), 'a change was not saved');
      } finally { W.fetch = F; clearTimeout(pushTimer); await waitFor(() => !pushBusy, 3000); fileReady = keep.fileReady; fileText = keep.fileText; fileVer = keep.fileVer; baseState = keep.baseState; newHold = null; startBase0 = keep.startBase0; fileGone = null; await sleep(50); setStatus('saved', 'Saved'); pollGo(); }
    });
    test('saving: an empty figure file is a file: it opens as broken, and nothing goes over it unasked', async () => {
      blank(); await settle(); await flushSave(); const F = W.fetch; let posts = 0; const keep = { fileReady, fileText, fileVer, baseState, newHold, badText, badKeep, badMsg };
      W.fetch = (u, o) => { if (o && o.method === 'POST') { posts++; return Promise.resolve(new Response(null, { status: 204 })); } if (String(u) === FILE) return Promise.resolve(new Response('', { status: 200 })); return F(u, o); };
      await pollHold(); try { fileReady = false; await pollOnce(); ok(fileReady, 'an empty file stays "cannot be read" for good'); ok(badText !== null, 'it did not count as broken'); await sleep(320); eq(posts, 0, 'written over without asking');
      } finally { W.fetch = F; Object.assign(window, {}); fileReady = keep.fileReady; fileText = keep.fileText; fileVer = keep.fileVer; baseState = keep.baseState; newHold = keep.newHold; badText = keep.badText; badKeep = keep.badKeep; badMsg = keep.badMsg; setStatus('saved', 'Saved'); pollGo(); }
    });
    test('saving: edits made before the file could be read are no untouched new figure: they are saved', async () => {
      if (WEB) throw new Skip('the same code, by another signal');
      const F = W.fetch; let posts = 0; const keep = { fileReady, fileText, fileVer, baseState, newHold, startBase0 }; blank(); await settle(); const before = J(scene); fig.add('text', { x: 100, y: 100, text: 'drawn while the folder was away' }); await settle();
      W.fetch = (u, o) => { if (o && o.method === 'POST') { posts++; return Promise.resolve(new Response(null, { status: 204, headers: { ETag: '"y"' } })); } if (String(u).startsWith('api/files')) return Promise.resolve(new Response('[]', { status: 200 })); if (String(u) === FILE) return Promise.resolve(new Response('', { status: 404, headers: { 'X-SiliCoDraw-Chosen': '1' } })); return F(u, o); };
      await pollHold(); try { fileReady = false; fileText = null; fileVer = null; startBase0 = before; await pollOnce(); ok(fileReady, 'a real 404'); ok(!newHeld(), 'held as if untouched'); ok(await waitFor(() => posts > 0, 3000), 'the drawing was not saved');
      } finally { W.fetch = F; clearTimeout(pushTimer); await waitFor(() => !pushBusy, 3000); fileReady = keep.fileReady; fileText = keep.fileText; fileVer = keep.fileVer; baseState = keep.baseState; newHold = null; startBase0 = keep.startBase0; fileGone = null; await sleep(50); setStatus('saved', 'Saved'); pollGo(); }
    });
    test('saving: a change kept through a close while the folder was away is not lost when more edits follow and the folder returns', async () => {
      blank(); await settle(); await flushSave(); const t0 = fileText, v0 = fileVer, F = W.fetch, sent = []; const keep = { fileReady, startBase0 };
      await pollHold(); W.fetch = (u, o) => { if (o && o.method === 'POST') { sent.push(String(o.body)); return Promise.resolve(new Response(null, { status: 204, headers: { ETag: '"after"' } })); } return F(u, o); };
      try { const x = fig.add('text', { x: 100, y: 100, text: 'kept through the close' }); clearTimeout(pushTimer); fileReady = false; startBase0 = J(scene); const y = fig.add('text', { x: 100, y: 200, text: 'made after the reopen' }); closingRetry.keep = v0; readFile.ver = v0; firstRead(t0);
        ok(get(x) && get(y), 'a change was dropped: ' + fig.list().map(o => o.text).join()); ok(await waitFor(() => sent.some(s => /kept through the close/.test(s) && /made after the reopen/.test(s)), 3000), 'both did not reach the file'); eq(closingRetry.keep, 0, 'the mark stayed');
      } finally { W.fetch = F; clearTimeout(pushTimer); await waitFor(() => !pushBusy, 3000); fileReady = keep.fileReady; startBase0 = keep.startBase0; blank(); await settle(); await flushSave(true).catch(() => {}); setStatus('saved', 'Saved'); pollGo(); }
    });
    test('saving: Ctrl+S does not write over a broken file with nothing changed here; a base without a browser copy counts for nothing', async () => {
      blank(); await settle(); await flushSave(); const keepK = badKeep, keepB = badText, keepM = badMsg; const c = W.fileSame;
      try { badText = 'broken'; badKeep = false; badMsg = 'a test'; eq(await countPosts(() => saveNow()), 0, 'Ctrl+S wrote over a broken file'); } finally { badKeep = keepK; badText = keepB; badMsg = keepM; setStatus('saved', 'Saved'); }
    });
    test('where figures are kept: a switch stops for another tab with unsaved work, clears this browser\'s copies, and keeps one with a change on its way', async () => {
      const k1 = 'figEditor.scene.v1:zz-a.json', k2 = 'figEditor.scene.v1:zz-b.json', m2 = 'fig.closing:' + DIR + 'zz-b.json', b0 = 'fig.base0:' + DIR + 'zz-a.json';
      try { localStorage.setItem(k1, 'x'); localStorage.setItem(k2, 'y'); localStorage.setItem(m2, 'v'); localStorage.setItem(b0, 'z'); const keepName = 'figEditor.scene.v1:' + FILE, keepV = localStorage.getItem(keepName), main = localStorage.getItem('figEditor.scene.v1'); storeClear(); eq(localStorage.getItem(k1), null, 'an old copy stayed'); eq(localStorage.getItem(b0), null, 'a base stayed'); eq(localStorage.getItem(k2), 'y', 'a copy with a change on its way went'); if (keepV !== null) localStorage.setItem(keepName, keepV); if (main !== null) localStorage.setItem('figEditor.scene.v1', main); } finally { [k1, k2, m2, b0].forEach(k => localStorage.removeItem(k)); }
      if (typeof BroadcastChannel !== 'function') return; const other = new BroadcastChannel('silicodraw-files'); other.onmessage = e => { if (e.data && e.data.switching && e.data.dir === DIR) other.postMessage({ dir: DIR, busy: true }); }; try { ok(await storeAsk(), 'a tab with unsaved work was not heard'); } finally { other.close(); } ok(!(await storeAsk()), 'no other tab: still busy');
    });
    test('saving: opening the storage dialog or flushing writes nothing unchanged, and not over a broken file', async () => {
      blank(); await settle(); await flushSave(); const keepK = badKeep, keepB = badText;
      eq(await countPosts(() => flushSave()), 0, 'a flush with nothing changed wrote the file');
      try { badKeep = true; badText = 'broken'; const keepFs = fileText; eq(await countPosts(() => flushSave(true)), 0, 'written over a broken file with nothing changed here'); } finally { badKeep = keepK; badText = keepB; }
    });
    test('saving: a message from a tab on another place is no version of this figure', async () => {
      if (!fileBC) throw new Skip('no BroadcastChannel here');
      blank(); await settle(); const before = J(scene); fileBC.onmessage({ data: { saved: FILE, dir: DIR, place: 'dropbox:Dropbox', text: J({ version: 4, w: 100, h: 100, bg: '#000000', objects: [] }), ver: '"z"' } }); await sleep(60); eq(J(scene), before, 'another place\'s save was taken in');
    });
    // a real reload, in the phone layout: closing the dialog's Back entry must not cancel it (a stub of the reload hid that)
    test('where figures are kept: on a phone the switch really reloads the page and says what happened', async () => {
      if (WEB) throw new Skip('the same code, on the website through its own choices');
      const name = String(FILE).replace(/\.json$/i, '') + '-phone.json'; let fr = D.createElement('iframe'); fr.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;border:0;z-index:2147483000;background:#fff'; fr.src = location.pathname + '?file=' + encodeURIComponent(name) + '&phone=1'; D.body.appendChild(fr);
      try {
        ok(await waitFor(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 180000), 'the editor did not start in the frame'); const w = watch(fr.contentWindow); w.onbeforeunload = null; w.applyUIClasses && w.applyUIClasses(); w.dispatchEvent(new w.Event('resize')); await sleep(250); ok(w.eval('PHONE()'), 'no phone layout');
        const F = w.fetch; w.fetch = (u, o) => { const s = String(u); if (s.startsWith('api/storage')) return Promise.resolve(new Response(JSON.stringify(o && o.method === 'POST' ? { dir: 'D:\\Sync\\SiliCoDraw', isDefault: false, copied: 0, differ: [] } : { dir: 'C:\\app', isDefault: true, missing: '', canChange: true, program: 'C:\\app', options: [{ name: 'Dropbox', path: 'D:\\Sync' }] }), { status: 200 })); return F(u, o); };
        w.storeTell = () => {}; /* (the page running the tests is a tab too: it must not reload with this one) */ await w.storageDialog(); w.__before = 1; const opt = w.document.querySelector('#modalBox .stOpt'); ok(opt, 'no choice in the dialog'); opt.click();
        ok(await waitFor(() => { const n = fr.contentWindow; return !n.__before && n.fig && n.eval('typeof fileReady!=="undefined"&&fileReady'); }, 30000), 'the page did not reload after the switch');
        ok(await waitFor(() => /Figures are now kept in Dropbox/.test(fr.contentWindow.document.querySelector('#toast').textContent), 4000), 'no message after the reload: ' + fr.contentWindow.document.querySelector('#toast').textContent); eq(sessionStorage.getItem('fig.storeMsg'), null, 'the message stayed');
      } finally { try { await fr.contentWindow.flushSave(); } catch (e) {} fr.remove(); await sleep(200); try { sessionStorage.removeItem('fig.storeMsg'); sessionStorage.removeItem('fig.switchHold'); await fetch('api/move?file=' + encodeURIComponent(name) + '&from=&to=trash', { method: 'POST' }); await fetch('api/delete?file=' + encodeURIComponent(name), { method: 'POST' }); localStorage.removeItem('figEditor.scene.v1:' + name); } catch (e) {} }
    }, 300000);
    test('where figures are kept: Save a copy uses the system\'s Save dialog, and cancelling it saves nothing', async () => {
      if (PHONE()) throw new Skip('the phone layout uses the share sheet');
      const P = W.showSaveFilePicker, dl = W.download; let wrote = '', asked = null, downloads = 0;
      W.download = () => { downloads++; };
      try {
        W.showSaveFilePicker = async o => { asked = o; return { name: 'copy.json', createWritable: async () => ({ write: async b => { wrote = await b.text(); }, close: async () => {} }) }; };
        await menuActs.savejson(); eq(asked.suggestedName, FILE, 'the name offered'); ok(JSON.parse(wrote).objects, 'the figure was not written'); eq(downloads, 0, 'it also downloaded');
        W.showSaveFilePicker = async () => { throw new DOMException('no', 'AbortError'); }; await menuActs.savejson(); eq(downloads, 0, 'cancelling downloaded it');
        W.showSaveFilePicker = async () => { throw new Error('not allowed'); }; await menuActs.savejson(); eq(downloads, 1, 'a Save dialog that fails: no download instead');
      } finally { W.showSaveFilePicker = P; W.download = dl; }
    });
    // File ▾ → Save all figures to a folder… / Open a folder of figures…: this run's own figures only (named after the scratch figure, so browser.ps1 removes leftovers)
    const wsPre = () => BASE + '-ws', wsPng = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const wsFig = (t, src) => JSON.stringify({ version: 4, w: 400, h: 300, objects: [{ id: 't1', type: 'text', x: 10, y: 20, s: 1, r: 0, text: t }].concat(src ? [{ id: 'i1', type: 'image', x: 100, y: 100, s: 1, r: 0, src, w: 10, h: 10 }] : []) });
    const wsClean = async () => { for (const sc of ['', 'archive', 'trash']) for (const f of (await listFiles(sc)) || []) if (f.name.startsWith(wsPre())) { if (sc !== 'trash') await fetch(`api/move?file=${encodeURIComponent(f.name)}&from=${sc}&to=trash`, { method: 'POST' }); await fetch('api/delete?file=' + encodeURIComponent(f.name), { method: 'POST' }); } };
    const wsMine = g => ({ ...g, files: g.files.filter(f => f.name.includes(wsPre())) });
    test('all figures to a folder: the menu and the dialogs offer what this browser can do', async () => {
      ok(!document.querySelector('#fileMenu [data-act=saveall]').hidden && !document.querySelector('#fileMenu [data-act=openfolder]').hidden, 'the menu items are hidden');
      ok((await fetch(encodeURIComponent(wsPre() + '-m.json'), { method: 'POST', body: wsFig('menu') })).ok, 'a figure');   // (the website saves the scratch figure only at its first change)
      await saveAllDialog(); const box = document.querySelector('#modalBox'); try { ok(/Save all figures to a folder/.test(box.textContent), 'no dialog: ' + box.textContent.slice(0, 80)); ok(box.querySelector('#saZip'), 'no .zip choice'); eq(!!box.querySelector('#saFolder'), typeof W.showDirectoryPicker === 'function', 'the folder choice'); } finally { closeModal(); }
      openFolderDialog(); try { ok(document.querySelector('#modalBox #ofFiles'), 'no file choice'); eq(!!document.querySelector('#modalBox #ofDir'), typeof W.showDirectoryPicker === 'function' || !WS_MOBILE, 'the folder choice'); } finally { closeModal(); }
      await wsClean();
    });
    test('all figures to a folder: saved into a folder and opened back, with the archive and pictures; nothing doubles', async () => {
      let root; try { root = await (await navigator.storage.getDirectory()).getDirectoryHandle('zz-ws-test', { create: true }); const w = await (await root.getFileHandle('probe.txt', { create: true })).createWritable(); await w.close(); await root.removeEntry('probe.txt'); } catch (e) { throw new Skip('no writable private file system here: ' + e.message); }
      const pre = wsPre(), A = pre + '-a.json', B = pre + '-b.json', C = pre + '-c.json', P = 'assets/' + pre + '.png', P2 = pre + '-new.png', SDP = W.showDirectoryPicker;
      const rd = async (d, n) => (await (await d.getFileHandle(n)).getFile()).text(), put = async (d, n, body) => { const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(body); await w.close(); };
      try {
        const pic = !WEB && (await fetch(P, { method: 'POST', body: wsPng() })).ok; if (!WEB) ok(pic, 'the server took no picture');
        ok((await fetch(encodeURIComponent(A), { method: 'POST', body: wsFig('first', pic ? P : '') })).ok, 'figure a'); ok((await fetch(encodeURIComponent(B), { method: 'POST', body: wsFig('second') })).ok, 'figure b'); ok(await moveFile(B, 'active', 'archive'), 'b to the archive');
        const g = wsMine(await wsGather()), names = g.files.map(f => f.name); ok(names.includes(A) && names.includes('archive/' + B), 'gathered: ' + names.join()); if (pic) ok(names.includes(P), 'the picture was not gathered: ' + names.join());
        W.showDirectoryPicker = async () => root;
        const r1 = await wsToFolder(g); eq(r1.failed, 0, 'write failures'); eq(r1.wrote, g.files.length, 'written: ' + J(r1));
        eq(JSON.parse(await rd(root, A)).objects[0].text, 'first', 'a in the folder'); eq(JSON.parse(await rd(await root.getDirectoryHandle('archive'), B)).objects[0].text, 'second', 'b in archive/');
        const r2 = await wsToFolder(g); eq(r2.wrote, 0, 'the same files were written again'); eq(r2.same, g.files.length, 'the same files');
        await put(root, A, wsFig('changed there', pic ? P : ''));   // a file there that differs is replaced only when the user says so
        const p3 = wsToFolder(g); ok(await waitFor(() => document.querySelector('#rfNo'), 3000), 'no question about the different file'); document.querySelector('#rfNo').click(); const r3 = await p3;
        eq(r3.kept, 1, 'kept'); eq(JSON.parse(await rd(root, A)).objects[0].text, 'changed there', 'the different file was replaced');
        await put(root, C, wsFig('third', 'assets/' + P2)); await put(await root.getDirectoryHandle('assets', { create: true }), P2, wsPng());   // a figure whose picture is only in the folder
        await wsClean(); const list = await wsWalk(root); ok(list.some(x => x.path === 'archive/' + B) && list.some(x => x.path === 'assets/' + P2), 'the walk: ' + list.map(x => x.path).join());
        await webRestore(list);
        const act = ((await listFiles()) || []).map(f => f.name), ar = ((await listFiles('archive')) || []).map(f => f.name); ok(act.includes(A) && act.includes(C), 'a or c did not come back: ' + act.filter(n => n.startsWith(pre)).join()); ok(ar.includes(B) && !act.includes(B), 'b did not come back to the archive');
        const fa = JSON.parse(await (await fetch(encodeURIComponent(A), { cache: 'no-store' })).text()), fc = JSON.parse(await (await fetch(encodeURIComponent(C), { cache: 'no-store' })).text());
        eq(fa.objects[0].text, 'changed there', 'the folder\'s version'); if (pic) eq(fa.objects[1].src, P, 'a picture already here keeps its address');
        if (WEB) ok(/^data:image\/png;base64,/.test(fc.objects[1].src), 'the website keeps the picture in the figure: ' + String(fc.objects[1].src).slice(0, 40));
        else { eq(fc.objects[1].src, 'assets/' + P2, 'the picture\'s address'); const r = await fetch('assets/' + P2, { cache: 'no-store' }); ok(r.ok && (await r.arrayBuffer()).byteLength === wsPng().length, 'the picture is not in assets/'); }
        await webRestore(await wsWalk(root)); const again = ((await listFiles()) || []).map(f => f.name).filter(n => n.startsWith(pre)); eq(again.length, 2, 'opened twice made copies: ' + again.join());
      } finally { W.showDirectoryPicker = SDP; closeModal(); await wsClean().catch(() => {}); await (await navigator.storage.getDirectory()).removeEntry('zz-ws-test', { recursive: true }).catch(() => {}); }
    });
    test('all figures to a folder: archived on one side is no copy, a system tool\'s .zip, the same picture twice, plain files, My icons merged, old figures named', async () => {
      const pre = wsPre(), A = pre + '-x.json', L = pre + '-loose.png', Q = pre + '-p.png', PD = W.download; let root = null;
      const put = async (d, n, body) => { const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(body); await w.close(); }, act = async () => ((await listFiles()) || []).map(f => f.name).filter(n => n.startsWith(pre));
      try {
        // archived here, at the top of the folder (still active on the other device): already here, no -restored copy
        ok((await fetch(encodeURIComponent(A), { method: 'POST', body: wsFig('archived') })).ok, 'figure'); ok(await moveFile(A, 'active', 'archive'), 'to the archive');
        await webRestore([new File([wsFig('archived')], A, { type: 'application/json' })]); eq((await act()).length, 0, 'an archived figure came in again: ' + (await act()).join());
        // a .zip of a folder named "archive" made by the system's own tool (its name before every entry, backslashes from PowerShell): the figures land at the top
        await wsClean(); const zip = zipStore([{ name: 'archive\\' + A, data: wsFig('wrapped') }, { name: 'archive\\assets\\' + L, data: wsPng() }, { name: '__MACOSX/archive/._' + A, data: 'x' }]);
        await webRestore([new File([zip], 'archive.zip', { type: 'application/zip' })]); ok((await act()).includes(A), 'the wrapped figure is not at the top: ' + (await act()).join()); eq(((await listFiles('archive')) || []).filter(f => f.name.startsWith(pre)).length, 0, 'it went to the archive');
        // a figure with a loose picture chosen beside it (a phone's Files app): the picture comes along
        await wsClean(); await webRestore([new File([wsFig('loose', 'assets/' + L)], A, { type: 'application/json' }), new File([wsPng()], L, { type: 'image/png' })]);
        const fl = JSON.parse(await (await fetch(encodeURIComponent(A), { cache: 'no-store' })).text()).objects[1].src; if (WEB) ok(/^data:image\/png/.test(fl), 'the loose picture: ' + fl.slice(0, 30)); else { eq(fl, 'assets/' + L, 'the loose picture\'s address'); ok((await fetch('assets/' + L, { cache: 'no-store' })).ok, 'the loose picture is not in assets/'); }
        if (!WEB) { // a different picture with a name taken here: a name made from the picture, and opening it again makes nothing new
          await wsClean(); ok((await fetch('assets/' + Q, { method: 'POST', body: wsPng() })).ok, 'a picture'); const other = wsPng(); other[other.length - 1] ^= 1;
          const two = () => [new File([wsFig('other picture', 'assets/' + Q)], A, { type: 'application/json' }), new File([other], Q, { type: 'image/png' })];
          await webRestore(two()); const s1 = JSON.parse(await (await fetch(encodeURIComponent(A), { cache: 'no-store' })).text()).objects[1].src; ok(s1 !== 'assets/' + Q && s1.endsWith('-' + Q), 'the different picture\'s name: ' + s1);
          await webRestore(two()); eq((await act()).length, 1, 'opened twice made copies: ' + (await act()).join()); }
        // a folder from the browser's own picker that gave plain files (no folder paths): they come in
        await wsClean(); const dt = new DataTransfer(); dt.items.add(new File([wsFig('plain')], A, { type: 'application/json' })); const inp = document.querySelector('#folderIn'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
        let inn = false; for (let i = 0; i < 100 && !inn; i++) { inn = (await act()).includes(A); if (!inn) await sleep(50); } ok(inn, 'plain files from the folder picker were dropped');   // (waitFor takes no async check)
        // a folder that holds My icons and an older figure: the icons are merged, the older figure is named
        try { root = await (await navigator.storage.getDirectory()).getDirectoryHandle('zz-ws-test2', { create: true }); } catch (e) { root = null; }
        if (root) { const as = await root.getDirectoryHandle('assets', { create: true }); await put(as, 'my-icons.json', JSON.stringify({ theirs: { n: 'Theirs', svg: '<g/>' } })); await put(root, pre + '-old.json', wsFig('old'));
          const SDP = W.showDirectoryPicker; W.showDirectoryPicker = async () => root;
          try { const r = await wsToFolder({ files: [{ name: USER_FILE, data: JSON.stringify({ mine: { n: 'Mine', svg: '<g/>' } }) }], n: 0, bad: 0, scopeBad: [] }); ok(document.querySelector('#modal').hidden, 'asked about My icons'); closeModal();   // (a closed dialog stays in the page, hidden)
            const ic = JSON.parse(await (await (await as.getFileHandle('my-icons.json')).getFile()).text()); ok(ic.theirs && ic.mine, 'My icons not merged: ' + Object.keys(ic).join()); ok(r.stale.some(x => x.p === pre + '-old.json'), 'the older figure is not named: ' + J(r.stale.map(x => x.p)));
          } finally { W.showDirectoryPicker = SDP; } }
      } finally { W.download = PD; closeModal(); await wsClean().catch(() => {}); if (root) await (await navigator.storage.getDirectory()).removeEntry('zz-ws-test2', { recursive: true }).catch(() => {}); }
    });
    test('all figures to a folder: the .zip holds the same and opens back; a folder\'s own name is no reason to skip it', async () => {      if (PHONE()) throw new Skip('the phone layout shares the .zip');
      const pre = wsPre(), A = pre + '-z.json', D = pre + '-d.json', PD = W.download, NS = navigator.storage, had = NS && Object.getOwnPropertyDescriptor(NS, 'persisted'); let got = null;
      if (NS && NS.persisted) Object.defineProperty(NS, 'persisted', { configurable: true, value: async () => true });   // (asking to keep the site's storage is a prompt in Firefox, which nobody answers here)
      try {
        ok((await fetch(encodeURIComponent(A), { method: 'POST', body: wsFig('zipped') })).ok, 'figure');
        W.download = (n, b) => { got = { n, b }; }; await webBackup(wsMine(await wsGather())); ok(got && /\.zip$/.test(got.n), 'no .zip'); const z = await unzip(await got.b.arrayBuffer()); ok(z.some(x => x.name === A), 'in the .zip: ' + z.map(x => x.name).join());
        await wsClean(); await webRestore([new File([got.b], got.n, { type: 'application/zip' })]); ok(((await listFiles()) || []).some(f => f.name === A), 'the .zip did not open back');
        const f = new File([wsFig('fourth')], D, { type: 'application/json' }); Object.defineProperty(f, 'webkitRelativePath', { value: 'history/' + D });   // a folder chosen with the browser's own picker, named "history"
        await webRestore([f]); ok(((await listFiles()) || []).some(x => x.name === D), 'a folder named history was skipped');
      } finally { W.download = PD; if (NS) { if (had) Object.defineProperty(NS, 'persisted', had); else delete NS.persisted; } await wsClean().catch(() => {}); }
    });
    // the website's places: a real folder handle (the browser's private file system has the same interface) and each service against a stand-in with its rules
    const WEBS = () => W.SiliCoDrawWeb && W.SiliCoDrawWeb.createStore ? W.SiliCoDrawWeb : null;
    const memBackend = () => { const m = new Map(); return { m, get: async k => m.get(k), put: async (k, v) => { m.set(k, v); }, del: async k => { m.delete(k); }, keys: async () => [...m.keys()] }; };
    const storeCycle = async (B, what) => { const S = WEBS(), st = S.createStore(B, () => storeCycle.t), Q = o => new URLSearchParams(o || {}), H = o => new Headers(o || {}); storeCycle.t = Date.now();
      const a = await st.handle('POST', 'one.json', Q(), '{"objects":[1]}', H()); eq(a.status, 204, what + ': first save'); const g = await st.handle('GET', 'one.json', Q(), null, H()); eq(g.body, '{"objects":[1]}', what + ': read it back'); ok(g.etag, what + ': no version');
      const b = await st.handle('POST', 'one.json', Q(), '{"objects":[2]}', H({ 'If-Match': g.etag })); eq(b.status, 204, what + ': save on its version');
      const c = await st.handle('POST', 'one.json', Q(), '{"objects":[3]}', H({ 'If-Match': g.etag })); eq(c.status, 409, what + ': a save from an older version'); eq(c.body, '{"objects":[2]}', what + ': the refusal gives the current text');
      ok((await B.keys()).some(k => /^history\/one\/.+\.json$/.test(k)), what + ': no version-history copy'); eq((await st.handle('POST', 'api/move', Q({ file: 'one.json', from: '', to: 'archive' }), null, H())).status, 204, what + ': archive'); ok((await st.handle('GET', 'archive/one.json', Q(), null, H())).status === 200, what + ': read from the archive'); eq((await st.handle('GET', 'one.json', Q(), null, H())).status, 404, what + ': gone from the figures'); eq(JSON.parse((await st.handle('GET', 'api/files', Q({ scope: 'archive' }), null, H())).body).map(x => x.name), ['one.json'], what + ': the archive list');
      eq((await st.handle('POST', 'api/move', Q({ file: 'one.json', from: 'archive', to: 'trash' }), null, H())).status, 204, what + ': trash'); eq((await st.handle('POST', 'api/delete', Q({ file: 'one.json' }), null, H())).status, 204, what + ': delete'); eq((await st.handle('GET', 'trash/one.json', Q(), null, H())).status, 404, what + ': deleted'); };
    test('where figures are kept: a linked folder works as the desktop folder does', async () => {
      const S = WEBS(); if (!S) throw new Skip('the website\'s storage script is not loaded here');
      let root; try { root = await (await navigator.storage.getDirectory()).getDirectoryHandle('zz-folder-test', { create: true }); const w = await (await root.getFileHandle('probe.txt', { create: true })).createWritable(); await w.close(); await root.removeEntry('probe.txt'); } catch (e) { throw new Skip('no writable private file system here: ' + e.message); }
      try { const B = S.folderBackend(root); await storeCycle(B, 'folder');
        await B.put('assets/my-icons.json', { body: '{}' }); const f = await (await root.getFileHandle('note.txt', { create: true })).createWritable(); await f.close(); await B.put('two.json', { body: '{"objects":[]}' }); const ks = await B.keys(); ok(ks.includes('assets/my-icons.json') && ks.includes('two.json') && !ks.includes('note.txt'), 'what is listed: ' + ks.join());
        const to = memBackend(); to.m.set('two.json', { body: 'other' }); await B.put('three.json', { body: '{"objects":[3]}' }); const r = await S.copyAll(B, to); eq(to.m.get('two.json').body, 'other', 'a copy replaced what was there'); ok(r.differ.includes('two.json') && to.m.get('three.json').body === '{"objects":[3]}', 'the copy: ' + J(r));
      } finally { await (await navigator.storage.getDirectory()).removeEntry('zz-folder-test', { recursive: true }).catch(() => {}); }
    });
    // stand-ins for the services' file calls: each keeps files with a version, as the service's documentation describes
    const jsonR = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    const fakeDropbox = () => { const m = new Map(); let n = 0; const meta = k => ({ '.tag': 'file', name: k.split('/').pop(), path_display: '/' + k, rev: m.get(k).rev, server_modified: '2026-11-01T10:00:00Z', size: m.get(k).body.length });
      return async (u, o) => { const arg = o.headers && o.headers['Dropbox-API-Arg'] ? JSON.parse(o.headers['Dropbox-API-Arg']) : null; if (arg) ok(/^[\x20-\x7e]*$/.test(o.headers['Dropbox-API-Arg']), 'Dropbox: a header outside ASCII');
        if (/list_folder$/.test(u)) return jsonR({ entries: [...m.keys()].map(meta), has_more: false }); if (/files\/upload$/.test(u)) { const k = arg.path.slice(1), mode = arg.mode; if (fakeDropbox.full) return jsonR({ error_summary: 'path/insufficient_space/..' }, 409); if (mode === 'add' && m.has(k) || mode['.tag'] === 'update' && (!m.has(k) || m.get(k).rev !== mode.update)) return jsonR({ error_summary: 'path/conflict/file/..' }, 409); m.set(k, { body: o.body, rev: 'r' + (++n) }); return jsonR(meta(k)); }
        if (/files\/download$/.test(u)) return m.has(arg.path.slice(1)) ? new Response(m.get(arg.path.slice(1)).body) : jsonR({}, 409); if (/delete_v2$/.test(u)) { const k = JSON.parse(o.body).path.slice(1); if (!m.has(k)) return jsonR({}, 409); m.delete(k); return jsonR({}); } throw new Error('Dropbox stand-in: ' + u); }; };
    const fakeOneDrive = () => { const m = new Map(), R = 'https://graph.microsoft.com/v1.0/me/drive/special/approot'; let n = 0; const item = k => ({ name: k.split('/').pop(), file: {}, eTag: m.get(k).rev, lastModifiedDateTime: '2026-11-01T10:00:00Z', size: m.get(k).body.length });
      const call = async (u, o) => { o = o || {}; const us = String(u); if (us.startsWith('data:')) return F0(u); if (!us.startsWith(R)) throw new Error('OneDrive stand-in: ' + u); const rest = us.slice(R.length); if (/^\/children/.test(rest)) return jsonR({ value: [...m.keys()].filter(k => !k.includes('/')).map(item) }); let x = rest.match(/^:\/(\w+):\/children/); if (x) { const inside = [...m.keys()].filter(k => k.startsWith(x[1] + '/')); return inside.length ? jsonR({ value: inside.map(item) }) : jsonR({}, 404); }
        x = rest.match(/^:\/(.+):\/content$/); if (x && o.method === 'PUT') { const k = decodeURIComponent(x[1]), h = o.headers['If-Match']; if (h && (!m.has(k) || m.get(k).rev !== h) || o.headers['If-None-Match'] === '*' && m.has(k)) return jsonR({}, 412); m.set(k, { body: o.body, rev: '"e' + (++n) + '"' }); return jsonR(item(k)); }
        x = rest.match(/^:\/(.+?)(\?select=.*)?$/); const k = decodeURIComponent(x[1]); if (o.method === 'DELETE') { if (!m.has(k)) return jsonR({}, 404); m.delete(k); return new Response(null, { status: 204 }); } return m.has(k) ? jsonR({ '@microsoft.graph.downloadUrl': 'data:application/json,' + encodeURIComponent(m.get(k).body) }) : jsonR({}, 404); }; return call; };
    const F0 = u => fetch(u);
    const fakeGoogle = () => { const files = new Map(); let n = 0; const Fd = 'application/vnd.google-apps.folder', mk = (name, parent, mimeType, body) => { const id = 'f' + (++n); files.set(id, { id, name, parents: [parent], mimeType, body: body || '', version: String(n), modifiedTime: '2026-11-01T10:00:00Z', size: String((body || '').length) }); return files.get(id); }, pub = f => { const { body, ...o } = f; return o; };
      return async (u, o) => { o = o || {}; const url = new URL(u), m = o.method || 'GET', id = url.pathname.split('/').pop(); if (url.pathname === '/drive/v3/files' && m === 'GET') { const q = url.searchParams.get('q'), nm = (q.match(/name='([^']*)'/) || [])[1], par = (q.match(/'([^']+)' in parents/) || [])[1], folder = /mimeType='application\/vnd\.google-apps\.folder'/.test(q); return jsonR({ files: [...files.values()].filter(f => f.parents.includes(par) && (!nm || f.name === nm) && (!folder || f.mimeType === Fd)).map(pub) }); }
        if (url.pathname === '/drive/v3/files' && m === 'POST') { const j = JSON.parse(o.body); return jsonR(pub(mk(j.name, j.parents[0], j.mimeType))); } if (url.pathname === '/upload/drive/v3/files' && m === 'POST') { const parts = o.body.split(/\r\n--silicodraw\d+/), j = JSON.parse(parts[0].split('\r\n\r\n')[1]), body = parts[1].split('\r\n\r\n')[1]; return jsonR(pub(mk(j.name, j.parents[0], 'application/json', body))); }
        const f = files.get(id); if (!f) return jsonR({}, 404); if (m === 'PATCH') { f.body = o.body; f.version = String(++n); f.size = String(o.body.length); return jsonR(pub(f)); } if (m === 'DELETE') { files.delete(id); return new Response(null, { status: 204 }); } return new Response(f.body); }; };
    [['dropbox', fakeDropbox], ['onedrive', fakeOneDrive], ['google', fakeGoogle]].forEach(([kind, fake]) => test('where figures are kept: ' + kind + ' (a stand-in for the service): saves, versions, archive, trash, the history stays in this browser', async () => {
      const S = WEBS(); if (!S) throw new Skip('the website\'s storage script is not loaded here');
      const local = memBackend(), B = S.cloudBackend(S.providers[kind](fake()), local, 0); await storeCycle(B, kind); const st2 = S.createStore(B), Q2 = () => new URLSearchParams(), H2 = () => new Headers(); await st2.handle('POST', 'h.json', Q2(), '{"objects":[1]}', H2()); await st2.handle('POST', 'h.json', Q2(), '{"objects":[2]}', H2()); ok([...local.m.keys()].some(k => k.startsWith('history/h/')), kind + ': the history went to the service'); ok(![...local.m.keys()].some(k => !k.startsWith('history/')), kind + ': a figure stayed in this browser');
      await B.put('åäö figure.json', { body: '{"objects":[9]}' }); eq((await B.get('åäö figure.json')).body, '{"objects":[9]}', kind + ': a name outside ASCII'); await B.put('assets/my-icons.json', { body: '{}' }); ok((await B.keys()).includes('assets/my-icons.json'), kind + ': a subfolder');
    }));
    test('where figures are kept: a service\'s own errors are no conflicts, a listing is no download, a listing under way loses nothing, one file per name', async () => {
      const S = WEBS(); if (!S) throw new Skip('the website\'s storage script is not loaded here');
      fakeDropbox.full = false; let reads = 0; const call0 = fakeDropbox(), call = async (u, o) => { if (/download$/.test(u)) reads++; return call0(u, o); }; const local = memBackend(), P = S.providers.dropbox(call), B = S.cloudBackend(P, local, 0), st = S.createStore(B), Q = o => new URLSearchParams(o || {}), H = o => new Headers(o || {});
      await st.handle('POST', 'a.json', Q(), '{"objects":["a"]}', H()); await st.handle('POST', 'b.json', Q(), '{"objects":["b"]}', H()); const g = await st.handle('GET', 'a.json', Q(), null, H()); reads = 0;
      const B2 = S.cloudBackend(P, local, 0); await S.createStore(B2).handle('GET', 'api/files', Q(), null, H()); eq(reads, 0, 'listing the figures downloaded them');
      fakeDropbox.full = true; let threw = ''; try { await st.handle('POST', 'a.json', Q(), '{"objects":["more"]}', H({ 'If-Match': g.etag })); } catch (e) { threw = e.message; } fakeDropbox.full = false; ok(/full/.test(threw), 'a full Dropbox was not reported as a failed save: ' + threw);
      let before = 0; const calls = () => before; const slow = fakeDropbox(); let n = 0; const count = async (u, o) => { n++; return slow(u, o); }; const B3 = S.cloudBackend(S.providers.dropbox(async (u, o) => { n++; return jsonR({ error_summary: 'too_many_requests' }, 500); }), local, 0); await B3.keys().catch(() => {}); const after1 = n; await B3.keys().catch(() => {}); await B3.keys().catch(() => {}); eq(n, after1, 'a failing service was asked again at once');
      // a listing on its way when a new figure is saved: its answer does not make the figure "gone"
      const call4 = fakeDropbox(); let gateL = null, gateU = null; const P4 = S.providers.dropbox(async (u, o) => { if (gateL && /list_folder$/.test(u)) { const r = await call4(u, o); await gateL; return r; } if (gateU && /upload$/.test(u)) { await gateU; } return call4(u, o); }); const B4 = S.cloudBackend(P4, local, 0); await B4.keys(); let relU, relL; gateU = new Promise(r => { relU = r; }); const saving = B4.put('new.json', { body: '{"objects":["new"]}' }); await sleep(20); gateL = new Promise(r => { relL = r; }); const pending = B4.keys(); await sleep(20); gateU = null; relU(); await saving; const gl = gateL; gateL = null; relL(); await pending; const got = await B4.get('new.json'); ok(got && got.body === '{"objects":["new"]}', 'a figure saved during a listing counts as gone');
      // names differing only in case are one file there: not replaced
      // a figure that reached the place after the copy began stays; two names differing in case make one file, reported
      const late = memBackend(); late.m.set('x.json', { body: 'old copy' }); const dest = S.cloudBackend(S.providers.dropbox(fakeDropbox()), memBackend(), 0); const realGet = late.get; late.get = async k => { if (k === 'x.json') await dest.put('x.json', { body: 'the user drew this' }); return realGet(k); }; const rl = await S.copyAll(late, dest); eq((await dest.get('x.json')).body, 'the user drew this', 'the copy replaced a figure made after it began'); ok(rl.differ.includes('x.json'), 'not reported: ' + J(rl));
      const two = memBackend(); two.m.set('Fig.json', { body: 'a' }); two.m.set('fig.json', { body: 'b' }); const dest2 = S.cloudBackend(S.providers.dropbox(fakeDropbox()), memBackend(), 0); const r2 = await S.copyAll(two, dest2); eq(r2.copied, 1, 'two names differing in case both counted as copied'); eq(r2.differ.length, 1, 'the second is reported');
      // an empty icon library made there first does not stand in the way
      const ic = memBackend(); ic.m.set('assets/my-icons.json', { body: '{"a":1}' }); const dest3 = S.cloudBackend(S.providers.dropbox(fakeDropbox()), memBackend(), 0); await dest3.put('assets/my-icons.json', { body: '{}' }); await S.copyAll(ic, dest3); eq((await dest3.get('assets/my-icons.json')).body, '{"a":1}', 'the icon library was not copied');
      // Google Drive: two writes at once make one folder
      const gf = fakeGoogle(); let folders = 0; const P5 = S.providers.google(async (u, o) => { if (o && o.method === 'POST' && /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/.test(u)) folders++; return gf(u, o); }); const B5 = S.cloudBackend(P5, memBackend(), 0); await Promise.all([B5.add('a.json', { body: '{}' }), B5.add('b.json', { body: '{}' })]); eq(folders, 1, 'Google Drive: folders made for two writes at once');
      const to = S.cloudBackend(S.providers.dropbox(fakeDropbox()), memBackend(), 0); await to.put('fig1.json', { body: 'theirs' }); const from = memBackend(); from.m.set('Fig1.json', { body: 'mine' }); const r = await S.copyAll(from, to); eq(r.differ, ['Fig1.json'], 'the copy reported'); eq((await to.get('fig1.json')).body, 'theirs', 'a name differing in case replaced the file');
      const sk = memBackend(); sk.m.set('trash/x.json', { body: 'thrown away' }); sk.m.set('history/x/1.json', { body: 'old' }); sk.m.set('y.json', { body: 'kept' }); const to2 = memBackend(); await S.copyAll(sk, to2, { skipTrash: true, skipHistory: true }); eq([...to2.m.keys()], ['y.json'], 'what a service gets');
    });
    test('where figures are kept: a linked folder that is away is no folder without the figure', async () => {
      const S = WEBS(); if (!S) throw new Skip('the website\'s storage script is not loaded here');
      let root; try { const top = await navigator.storage.getDirectory(); root = await top.getDirectoryHandle('zz-away-test', { create: true }); const w = await (await root.getFileHandle('a.json', { create: true })).createWritable(); await w.write('{}'); await w.close(); const B = S.folderBackend(root); eq(await B.get('nope.json'), undefined, 'a figure not there'); await top.removeEntry('zz-away-test', { recursive: true }); let threw = false; try { await B.get('a.json'); } catch (e) { threw = true; } ok(threw, 'a folder that went answered as if only the figure were missing'); } catch (e) { if (e instanceof Error && /answered|figure not there/.test(e.message)) throw e; throw new Skip('no writable private file system here: ' + e.message); }
    });
    // the whole way on the website: link a folder, reload, work there, go back. The browser's private file system stands in for the folder the picker would give
    test('where figures are kept: the website, from this browser to a folder and back, across reloads', async () => {
      if (!WEBS() || !WEBS().storage) throw new Skip('only on the website build');
      let top, dir; try { top = await navigator.storage.getDirectory(); dir = await top.getDirectoryHandle('zz-link-test', { create: true }); const w0 = await (await dir.getFileHandle('p.txt', { create: true })).createWritable(); await w0.close(); await dir.removeEntry('p.txt'); if (typeof dir.queryPermission !== 'function') throw new Error('no permission calls on this handle'); } catch (e) { throw new Skip('not testable here: ' + e.message); }
      const name = String(FILE).replace(/\.json$/i, '') + '-phone.json'; let fr = null;
      const open = async () => { if (fr) fr.remove(); fr = D.createElement('iframe'); fr.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:800px;border:0;z-index:2147483000;background:#fff'; fr.src = location.pathname + '?file=' + encodeURIComponent(name); D.body.appendChild(fr); ok(await waitFor(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 180000), 'the editor did not start in the frame'); const w = watch(fr.contentWindow); w.onbeforeunload = null; w.confirm = () => true; w.alert = () => {}; return w; };
      const inFolder = async f => { try { return await (await (await dir.getFileHandle(f)).getFile()).text(); } catch (e) { return null; } };
      try {
        let w = await open(); const a = w.fig.add('text', { x: 100, y: 100, text: 'from the browser' }); await w.flushSave(); const S1 = w.SiliCoDrawWeb.storage; eq(S1.current().kind, 'browser', 'it starts in the browser');
        w.showDirectoryPicker = async () => dir; const r = await S1.linkFolder(true); ok(r.copied >= 1, 'nothing was copied: ' + J(r)); ok(/from the browser/.test(await inFolder(name) || ''), 'the figure is not in the folder');
        w.eval('storeClear()'); w = await open(); const S2 = w.SiliCoDrawWeb.storage; await S2.whenReady; eq(S2.current().kind, 'folder', 'after the reload the folder is in use'); ok(w.fig.list().some(o => o.id === a), 'the figure did not open from the folder');
        const b = w.fig.add('text', { x: 100, y: 200, text: 'in the folder now' }); await w.flushSave(); ok(/in the folder now/.test(await inFolder(name) || ''), 'a change was not saved in the folder'); ok(/your folder/.test(w.eval('webWhere().saved')), 'the tooltip does not say the folder: ' + w.eval('webWhere().saved'));
        // an edit outside (a sync app bringing another computer's change) comes in by itself
        const cur = JSON.parse(await inFolder(name)); cur.objects.push({ id: 'synced', type: 'text', x: 100, y: 300, s: 1, r: 0, text: 'from another computer', size: 20 }); const w2 = await (await dir.getFileHandle(name)).createWritable(); await w2.write(JSON.stringify(cur)); await w2.close(); ok(await waitFor(() => w.fig.list().some(o => o.id === 'synced'), 8000), 'a change made by a sync app did not come in');
        // a figure that is not in the folder, with an old copy in this browser: not written there by itself
        const stale = String(FILE).replace(/\.json$/i, '') + '-phone-stale.json';
        await w.SiliCoDrawWeb.storage.useBrowser(false); w.eval('storeClear()'); w = await open(); eq(w.SiliCoDrawWeb.storage.current().kind, 'browser', 'back in the browser'); ok(w.fig.list().some(o => o.id === a), 'the copy in the browser stayed'); ok(!w.fig.list().some(o => o.id === b), 'the folder\'s change came along without asking');
      } finally {
        if (fr) { try { await fr.contentWindow.SiliCoDrawWeb.storage.useBrowser(false); await fr.contentWindow.flushSave(); } catch (e) {} fr.remove(); } await sleep(200);
        try { await top.removeEntry('zz-link-test', { recursive: true }); } catch (e) {}
        try { await fetch('api/move?file=' + encodeURIComponent(name) + '&from=&to=trash', { method: 'POST' }); await fetch('api/delete?file=' + encodeURIComponent(name), { method: 'POST' }); localStorage.removeItem('figEditor.scene.v1:' + name); } catch (e) {}
      }
    }, 300000);
    test('where figures are kept: signing in: the right address, its challenge, and only an answer this tab asked for', async () => {
      const S = WEBS(), A = S && S.storage; if (!A) throw new Skip('only on the website build');
      W.__SILICODRAW_CLOUD_IDS__ = { dropbox: 'db-id', google: 'g-id', onedrive: 'ms-id' };
      try {
        eq(A.services().map(x => x.kind).sort(), ['dropbox', 'google', 'onedrive'], 'the services offered');
        const sha = async v => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        for (const [kind, host, scope] of [['dropbox', 'www.dropbox.com', null], ['onedrive', 'login.microsoftonline.com', 'Files.ReadWrite.AppFolder offline_access']]) {
          const go = await A._authStart(kind, true), u = new URL(go.url), q = u.searchParams; eq(u.hostname, host, kind + ': the address'); eq(q.get('response_type'), 'code', kind + ': code flow'); eq(q.get('code_challenge_method'), 'S256', kind + ': challenge method'); eq(q.get('code_challenge'), await sha(go.rec.verifier), kind + ': the challenge fits its verifier'); eq(q.get('state'), go.rec.state, kind + ': state'); eq(q.get('redirect_uri'), location.origin + location.pathname, kind + ': back to this page'); ok(go.rec.verifier.length >= 43, kind + ': a verifier of the length required'); ok(!/secret/i.test(go.url), kind + ': a secret'); if (scope) eq(q.get('scope'), scope, kind + ': only its own folder'); else eq(q.get('token_access_type'), 'offline', 'dropbox: a token that renews'); }
        const g = await A._authStart('google', false), gq = new URL(g.url).searchParams; eq(gq.get('response_type'), 'token', 'google: browser flow'); eq(gq.get('scope'), 'https://www.googleapis.com/auth/drive.file', 'google: only what this app makes');
        const rec = { state: 'abc', kind: 'dropbox' }; eq(A._parseBack('?state=abc&code=C1', '', rec).code, 'C1', 'a code'); eq(A._parseBack('', '#state=abc&access_token=T1&expires_in=3599', rec).token, 'T1', 'a token'); eq(A._parseBack('?state=abc&error=access_denied', '', rec).error, 'access_denied', 'a refusal'); eq(A._parseBack('?state=WRONG&code=EVIL', '', rec), null, 'an answer this tab did not ask for'); eq(A._parseBack('?code=EVIL', '', rec), null, 'an answer without state'); eq(A._parseBack('?state=abc&code=C', '', null), null, 'nothing asked');
      } finally { delete W.__SILICODRAW_CLOUD_IDS__; }
    });
    test('where figures are kept: the website\'s dialog offers what this browser and the registered services allow', async () => {
      const S = WEBS(), A = S && S.storage; if (!A) throw new Skip('only on the website build');
      const box = () => D.querySelector('#modalBox'), keep = { connect: A.connect, canFolder: A.canFolder, current: A.current }; let asked = null;
      W.__SILICODRAW_CLOUD_IDS__ = { dropbox: 'db-id', google: '', onedrive: 'ms-id' };
      try {
        A.connect = (k, c) => { asked = [k, c]; }; A.canFolder = true; await storageDialog();
        ok(/Now:.*this browser/.test(box().textContent), 'where it is now'); ok(box().querySelector('#stFolder'), 'no folder choice'); const kinds = [...box().querySelectorAll('[data-k]')].map(b => b.dataset.k); eq(kinds, ['dropbox', 'onedrive'], 'a service without its registration is not offered'); ok(!box().querySelector('#stBrowser'), 'back to the browser while in it'); ok(/iCloud Drive, Box/.test(box().textContent), 'the by-hand way is not explained');
        box().querySelector('[data-k=dropbox]').click(); ok(await waitFor(() => asked, 4000), 'signing in did not start'); eq(asked, ['dropbox', true], 'signing in'); closeModal();
        A.canFolder = false; W.__SILICODRAW_CLOUD_IDS__ = { dropbox: '', google: '', onedrive: '' }; await storageDialog(); ok(!box().querySelector('#stFolder') && !box().querySelector('#stCopy') && /By hand/.test(box().textContent), 'a phone without services: the by-hand way only'); closeModal();
        A.current = () => ({ kind: 'dropbox', name: 'Dropbox', needs: 'signin' }); await storageDialog(); ok(box().querySelector('#stAgain') && box().querySelector('#stBrowser') && /run out/.test(box().textContent), 'signing in again is not offered'); ok(/sign in again/.test(webWhere().offline), 'the tooltip: ' + webWhere().offline); closeModal();
      } finally { Object.assign(A, keep); delete W.__SILICODRAW_CLOUD_IDS__; if (!D.querySelector('#modal').hidden) closeModal(); }
    });
    test('where figures are kept: closing a figure too large for the closing store: the change waits in this browser\'s own store', async () => {
      const S = WEBS(), A = S && S.storage; if (!A) throw new Skip('only on the website build');
      if (A.current().kind !== 'browser') throw new Skip('a place is in use');
      const set = Storage.prototype.setItem; let threw = false; try { Storage.prototype.setItem = function () { threw = true; throw new DOMException('full', 'QuotaExceededError'); }; eq(navigator.sendBeacon(FILE + '?base=x', '{"objects":["big"]}'), false, 'told as not delivered'); } finally { Storage.prototype.setItem = set; } ok(threw, 'the closing store was not tried');
    });
    test('where figures are kept: on the website a figure\'s text never goes to the web host', async () => {
      if (!WEB || !WEBS() || !WEBS().storage) throw new Skip('only on the website build');
      const sent = []; const O = PerformanceObserver; const po = new O(l => l.getEntries().forEach(e => sent.push(e.name))); po.observe({ type: 'resource', buffered: false });
      const name = 'zz-ålder-' + Date.now().toString(36) + '.json', set = Storage.prototype.setItem; let beacon;
      try { const a = await fetch(name, { method: 'POST', body: '{"objects":[]}' }); eq(a.status, 204, 'a non-Latin name is stored here'); eq((await fetch('zz-unknown.bin', { method: 'POST', body: 'x' })).status, 404, 'an unknown write');
        Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; beacon = navigator.sendBeacon(FILE + '?base=x', '{"objects":["closing"]}'); Storage.prototype.setItem = set; eq(beacon, false, 'a closing page\'s text that does not fit is refused'); await sleep(300);
        const out = sent.filter(u => /zz-|\.json/.test(u) && !/examples|exports\//.test(u)); eq(out, [], 'figure requests that reached the network');
      } finally { Storage.prototype.setItem = set; po.disconnect(); try { await fetch('api/move?file=' + encodeURIComponent(name) + '&from=&to=trash', { method: 'POST' }); await fetch('api/delete?file=' + encodeURIComponent(name), { method: 'POST' }); } catch (e) {} }
    });
    // tablets (a touch screen in the desktop layout): the menu of a press and hold
    test('tablet: the click after a press and hold does not run the menu row under the finger; lifting keeps the selection behind the menu', async () => {
      if (PHONE()) throw new Skip('this window has the phone layout');
      const mk = (type, x, y) => new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 });
      const cm = D.querySelector('#ctxMenu'), S = D.querySelector('#svg'), wait = async (f, ms) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await sleep(40); return f(); };
      blank(); const a = fig.add('shape', { kind: 'rect', x: 400, y: 300, w: 300, h: 200 }), b = fig.add('shape', { kind: 'rect', x: 1100, y: 300, w: 300, h: 200 }); fit(true); await settle();
      const at = id => { const r = D.querySelector('#content [data-id="' + id + '"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      try {
        let p = at(a), t = D.elementFromPoint(p.x, p.y); t.dispatchEvent(mk('pointerdown', p.x, p.y)); ok(await wait(() => cm.classList.contains('open'), 3000), 'no menu after the press and hold');
        (t.isConnected ? t : S).dispatchEvent(mk('pointerup', p.x, p.y)); ok(PH.ghost > Date.now(), 'the lift set no guard'); const row = [...cm.querySelectorAll('button')].find(x => /^Delete/.test(x.textContent)); ok(row, 'no Delete in the menu'); row.click();
        ok(get(a), 'the click of the lifting finger ran Delete'); ok(cm.classList.contains('open'), 'the click of the lifting finger closed the menu'); eq(PH.ghost, 0, 'the guard is used up'); cm.classList.remove('open');
        await sleep(850); sel = new Set([a, b]); render(); buildPanel(); await frame(); const pa = at(a), pb = at(b), x = (pa.x + pb.x) / 2, y = pa.y; t = D.elementFromPoint(x, y); t.dispatchEvent(mk('pointerdown', x, y));
        S.dispatchEvent(new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true })); ok(cm.classList.contains('open'), 'no menu for a long press in the gap'); (t.isConnected ? t : S).dispatchEvent(mk('pointerup', x, y));
        eq([...sel].sort(), [a, b].sort(), 'lifting cleared the selection behind the menu');
      } finally { cm.classList.remove('open'); if (touches.has(7)) touchEnd({ type: 'pointercancel', pointerType: 'touch', pointerId: 7, timeStamp: performance.now(), clientX: 0, clientY: 0 }); PH.ghost = 0; sel = new Set(); render(); buildPanel(); }
    });
    // Fewer animations (Appearance, or a system set to reduce motion, as GitHub's Windows and Mac machines are): nothing may lag behind. A tiny transition on everything kept a new size at its old value until the next frame in Firefox
    test('fewer animations: a zoom counts at once, no transitions or animations', async () => {
      blank(); const id = fig.add('shape', { kind: 'rect', x: 800, y: 500, w: 300, h: 200 }); await settle();
      const H = D.documentElement, S = D.querySelector('#svg'), still = H.classList.contains('ui-still'), z0 = zoom, width = e => Math.round(e.getBoundingClientRect().width);
      H.classList.add('ui-still');
      try {
        for (const z of [2.5, 1, 2, .5]) { setZoom(z); eq(width(S), Math.round(scene.w * z), 'the canvas right after a zoom to ' + z); near(width(D.querySelector('#content [data-id="' + id + '"]')) / z, 302, 2, 'the element right after a zoom to ' + z); await sleep(30); }
        const cs = getComputedStyle(S); eq(cs.transitionProperty, 'none', 'transition on the canvas'); const cm = D.querySelector('#ctxMenu'); cm.classList.add('open'); const an = getComputedStyle(cm).animationName; cm.classList.remove('open'); eq(an, 'none', 'animation on an open menu');
      } finally { H.classList.toggle('ui-still', still); setZoom(z0); }
    });
    // phone touch tests (M2)
    // synthetic touch PointerEvents (pointerType touch, own pointerIds) in a frame of a phone's size on a figure of its own (removed afterwards); ?phone=1 forces the phone layout
    test('phone touch: scroll vs move, tap select, 10 px slop, pinch with one render, press and hold menus, a handle press undone, double taps at 390 × 844 and 844 × 390', async () => {
      if (typeof phDown !== 'function') throw new Skip('this editor has no phone touch code');
      const name = String(FILE).replace(/\.json$/i, '') + '-phone.json';   // the phone layout test's name too (one after the other, each removes it), so browser.ps1 / browser.sh clear it after a crash
      let fr = null;
      const until = async (f, ms = 3000) => { const t0 = Date.now(); for (;;) { let v = false; try { v = f(); } catch (e) {} if (v) return true; if (Date.now() - t0 > ms) return false; await sleep(40); } };
      const checks = async (w, wh) => {
        const d = w.document, V = s => w.eval(s), $$ = s => d.querySelector(s), svg = $$('#svg'), st = $$('#stage'), cm = $$('#ctxMenu'), tg = {}, at = ' (' + wh + ')';
        // a finger: the press goes to what is under it, the rest of the gesture to the same element (the canvas, if a redraw replaced it), as the browser's capture does
        const ev = (type, x, y, id = 1) => { let t = type === 'pointerdown' ? d.elementFromPoint(x, y) : tg[id]; ok(t, 'nothing under ' + Math.round(x) + ', ' + Math.round(y) + at); if (!t.isConnected) t = svg; if (type === 'pointerdown') tg[id] = t;
          t.dispatchEvent(new w.PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 })); if (type === 'pointerup') delete tg[id]; };
        const tap = (x, y) => { ev('pointerdown', x, y); ev('pointerup', x, y); };
        const mid = id => { const b = w.bbox(id), r = svg.getBoundingClientRect(), z = V('zoom'); return { x: r.left + (b.x + b.w / 2) * z, y: r.top + (b.y + b.h / 2) * z }; };
        const center = id => { const p = mid(id), s = st.getBoundingClientRect(); st.scrollLeft += p.x - (s.left + s.width / 2); st.scrollTop += p.y - (s.top + s.height / 2); return mid(id); };
        const empty = () => { const s = st.getBoundingClientRect(); for (let y = s.top + 20; y < s.bottom - 20; y += 13) for (let x = s.left + 20; x < s.right - 20; x += 13) { const e = d.elementFromPoint(x, y); if (e && (e.id === 'bg' || e === svg)) return { x, y }; } ok(false, 'no empty canvas in view' + at); };
        const deselect = () => { V('sel').clear(); w.render(); w.buildPanel(); }, closeMenus = () => d.querySelectorAll('.pop.open').forEach(m => m.classList.remove('open'));
        w.fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], objects: [{ id: 't1', type: 'text', x: 200, y: 150, s: 1, r: 0, text: 'Touch me', size: 24, anchor: 'start' },
          { id: 'r1', type: 'shape', kind: 'rect', x: 800, y: 500, s: 1, r: 0, w: 300, h: 200, fill: '#cfe3f5', stroke: '#6f86c8', sw: 2 }] });
        await until(() => w.fit.z != null, 10000); V('snap=false;guides=false'); w.setZoom(1); await sleep(100); const R = () => V('get')('r1');
        // one finger on an element that is not selected scrolls the view and moves nothing; a tap selects it
        let p = center('r1'); const x0 = R().x, y0 = R().y, s0 = [st.scrollLeft, st.scrollTop];
        ev('pointerdown', p.x, p.y); for (let i = 1; i <= 6; i++) ev('pointermove', p.x - i * 10, p.y - i * 7); ev('pointerup', p.x - 60, p.y - 42); if (V('phTouch').fl) V('phTouch').fl();   // (no flick going on after it)
        eq([R().x, R().y], [x0, y0], 'a drag on an element not selected moved it' + at); ok(st.scrollLeft - s0[0] > 30 && st.scrollTop - s0[1] > 20, 'the drag did not scroll the view' + at + ': ' + [st.scrollLeft - s0[0], st.scrollTop - s0[1]]); eq(V('sel').size, 0, 'the drag selected something' + at);
        await sleep(450); p = mid('r1'); tap(p.x, p.y); ok(V('sel').size === 1 && V('sel').has('r1'), 'a tap did not select the element' + at);
        // the selection drags only past 10 px, then follows the finger exactly
        await sleep(450); p = mid('r1'); ev('pointerdown', p.x, p.y); ev('pointermove', p.x + 5, p.y + 4); ev('pointermove', p.x + 7, p.y - 6);
        eq([R().x, R().y], [x0, y0], 'the element moved within 10 px' + at); ev('pointermove', p.x + 25, p.y); ev('pointermove', p.x + 40, p.y); ev('pointerup', p.x + 40, p.y);
        near(R().x - x0, 40 / V('zoom'), 1, 'the dragged element' + at); eq(R().y, y0, 'the dragged element moved sideways only' + at); w.undo();
        // two fingers: the page is only scaled while they move, then one zoom and one render
        deselect(); await sleep(450); const R0 = w.render; let n = 0; w.render = function () { n++; return R0.apply(this, arguments); };
        try { const e0 = empty(), z0 = V('zoom'), c = { x: Math.min(Math.max(e0.x, st.getBoundingClientRect().left + 110), st.getBoundingClientRect().right - 110), y: e0.y };
          ev('pointerdown', c.x - 40, c.y, 1); ev('pointerdown', c.x + 40, c.y, 2);
          for (let i = 1; i <= 6; i++) { ev('pointermove', c.x - 40 - i * 10, c.y, 1); ev('pointermove', c.x + 40 + i * 10, c.y, 2); }
          eq(n, 0, 'renders during the pinch' + at); eq(V('zoom'), z0, 'the zoom changed before the fingers lifted' + at); ok(/scale/.test($$('#wrap').style.transform), 'the page was not scaled during the pinch' + at);
          ev('pointerup', c.x + 100, c.y, 2); ev('pointerup', c.x - 100, c.y, 1); await sleep(50);
          near(V('zoom'), z0 * 200 / 80, 1e-6, 'zoom after the pinch' + at); eq(n, 1, 'renders after the pinch' + at); ok(!$$('#wrap').style.transform && !$$('#phSpace'), 'the pinch left its scale or spacer behind' + at);
        } finally { w.render = R0; }
        deselect(); await sleep(450); { const e3 = empty(), s3 = st.getBoundingClientRect(), c3 = { x: Math.min(Math.max(e3.x, s3.left + 110), s3.right - 110), y: e3.y }; ev('pointerdown', c3.x - 40, c3.y, 1); ev('pointerdown', c3.x + 40, c3.y, 2); ev('pointerdown', c3.x, c3.y + 30, 3); ok(V('pinch'), 'no pinch with two fingers' + at); ev('pointerup', c3.x - 40, c3.y, 1); eq(V('pinch'), null, 'the pinch went on after one of its own fingers lifted' + at); ev('pointerup', c3.x + 40, c3.y, 2); ev('pointerup', c3.x, c3.y + 30, 3); eq(V('touches').size, 0, 'fingers left after three lifted' + at); ok(!$$('#wrap').style.transform, 'the pinch left its scale behind' + at); }
        w.setZoom(1); await sleep(50);
        // press and hold: the element's menu (as an action sheet), the canvas menu on empty canvas
        p = center('r1'); ev('pointerdown', p.x, p.y); ev('pointermove', p.x + 3, p.y + 2); ok(await until(() => cm.classList.contains('open'), 2000), 'press and hold on an element opened no menu' + at);
        ok(cm.classList.contains('sheet'), 'the element menu is no action sheet' + at); ok(V('sel').has('r1'), 'press and hold did not select the element under the finger (selected: ' + [...V('sel')].join() + ')' + at); ev('pointerup', p.x + 3, p.y + 2); eq([R().x, R().y], [x0, y0], 'press and hold moved the element' + at); closeMenus(); await sleep(350);
        deselect(); const e1 = empty(); ev('pointerdown', e1.x, e1.y); ok(await until(() => cm.classList.contains('open'), 2000), 'press and hold on empty canvas opened no menu' + at);
        ok(/Text here/.test(cm.textContent) && /Paste/.test(cm.textContent), 'the canvas menu lacks its items' + at + ': ' + cm.textContent); ev('pointerup', e1.x, e1.y); closeMenus(); await sleep(350);
        // press and hold on a handle: the menu, and what the press changed is undone (a text's width handle gives it a box width at once)
        center('t1'); V('sel=new Set(["t1"])'); w.render(); w.buildPanel(); const T = () => V('get')('t1'), bw0 = T().boxW, hd = [...d.querySelectorAll('#overlay rect[data-h="twr"]')].find(h => !h.classList.contains('phx'));
        ok(hd, 'no width handle on the selected text' + at); const hb = hd.getBoundingClientRect(), hx = hb.left + hb.width / 2, hy = hb.top + hb.height / 2;
        ev('pointerdown', hx, hy); ok(T().boxW > 0, 'the width handle press set no box width' + at); ok(await until(() => cm.classList.contains('open'), 2000), 'press and hold on a handle opened no menu' + at);
        eq(T().boxW, bw0, 'press and hold on a handle left the element changed' + at); eq(V('drag'), null, 'the handle drag is still going' + at); ev('pointerup', hx, hy); closeMenus(); await sleep(350);
        // a double tap on empty canvas zooms in 2×; on a text it edits it in place at 16 px or more, with Done (the view comes back)
        deselect(); w.fit(true); await sleep(50); const zf = V('zoom'), e2 = empty(); await doubleTap(w, e2.x, e2.y, e2.x + 2, e2.y + 1);
        ok(await until(() => Math.abs(V('zoom') - zf * 2) < 1e-6, 2000), 'a double tap on empty canvas did not zoom 2× (' + zf + ' → ' + V('zoom') + ')' + at); eq(V('scene').objects.length, 2, 'the double tap added something' + at);
        w.fit(true); await sleep(450); const zt = V('zoom'); p = mid('t1'); await doubleTap(w, p.x, p.y);
        const ta = $$('textarea.inline-edit'); ok(ta && V('editor'), 'a double tap on a text did not edit it' + at); ok(parseFloat(ta.style.fontSize) >= 16, 'the in-place field is under 16 px: ' + ta.style.fontSize + at);
        ok(V('zoom') * 24 >= 16 - 1e-6, 'the text was not zoomed to 16 px' + at); const dn = $$('.fmtbar.float .fdone'); ok(dn, 'no Done on the formatting bar' + at);
        ta.value = 'Touched'; ta.dispatchEvent(new w.Event('input')); dn.click(); await sleep(50);
        ok(!V('editor') && T().text === 'Touched', 'Done did not end the edit' + at); near(V('zoom'), zt, 1e-6, 'Done did not bring the zoom back' + at); w.undo(); deselect(); await sleep(450);
      };
      try {
        fr = D.createElement('iframe'); fr.title = 'phone touch test'; fr.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;border:0;z-index:2147483000;background:#fff';
        fr.src = location.pathname + '?file=' + encodeURIComponent(name) + '&phone=1'; D.body.appendChild(fr);
        ok(await until(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 60000), 'the editor did not start in the phone frame');
        const w = watch(fr.contentWindow); w.alert = () => {}; w.confirm = () => true; w.prompt = () => null; w.download = () => {}; w.HTMLAnchorElement.prototype.click = function () {}; w.onbeforeunload = null;
        try { w.navigator.vibrate = () => true; } catch (e) {}
        if (w.applyUIClasses) w.applyUIClasses(); w.dispatchEvent(new w.Event('resize')); await sleep(250);   // a hidden tab may start the frame at 300 × 150 and send no media-query change
        await checks(w, '390 × 844');
        fr.style.width = '844px'; fr.style.height = '390px'; if (w.document.hidden && !await until(() => w.document.documentElement.classList.contains('ph-land'), 1500)) { if (w.applyUIClasses) w.applyUIClasses(); w.dispatchEvent(new w.Event('resize')); }
        ok(await until(() => w.document.documentElement.classList.contains('ph-land'), 20000), 'the frame did not turn sideways'); await sleep(350);
        await checks(w, '844 × 390');
      } finally {
        if (fr) { try { await fr.contentWindow.flushSave(); } catch (e) {} fr.remove(); fr = null; }
        await sleep(200);   // the scratch figure: to the trash, then out of it (its history goes with it); this page's fetch, so the web version's storage too
        try { await fetch('api/move?file=' + encodeURIComponent(name) + '&from=&to=trash', { method: 'POST' }); await fetch('api/delete?file=' + encodeURIComponent(name), { method: 'POST' }); } catch (e) {}
        try { localStorage.removeItem('figEditor.scene.v1:' + name); } catch (e) {}
      }
    }, 300000);
    // a finger, not a mouse: what a phone's first minute with an example needs (panels behind everything, gaps in icons, thin lines), plus Back, a cancelled touch, iOS gesture events, a stylus
    test('phone touch 2: panels behind other elements, finger tolerance, cancelled touches, gesture events, Back for every mode, Select several, big charts and structures, press-and-hold click, stylus, keys', async () => {
      if (typeof phPick !== 'function') throw new Skip('this editor has no phone touch code');
      const name = String(FILE).replace(/\.json$/i, '') + '-phone.json'; let fr = null;   // the phone layout test's name too (see above)
      const until = async (f, ms = 3000) => { const t0 = Date.now(); for (;;) { let v = false; try { v = f(); } catch (e) {} if (v) return true; if (Date.now() - t0 > ms) return false; await sleep(40); } };
      try {
        fr = D.createElement('iframe'); fr.title = 'phone touch test 2'; fr.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;border:0;z-index:2147483000;background:#fff';
        fr.src = location.pathname + '?file=' + encodeURIComponent(name) + '&phone=1'; D.body.appendChild(fr);
        ok(await until(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 60000), 'the editor did not start in the phone frame');
        const w = watch(fr.contentWindow), d = w.document, V = s => w.eval(s), $$ = s => d.querySelector(s), svg = $$('#svg'), st = $$('#stage'), cm = $$('#ctxMenu'), tg = {};
        w.alert = () => {}; w.confirm = () => true; w.prompt = () => null; w.download = () => {}; w.HTMLAnchorElement.prototype.click = function () {}; w.onbeforeunload = null; try { w.navigator.vibrate = () => true; } catch (e) {}
        if (w.applyUIClasses) w.applyUIClasses(); w.dispatchEvent(new w.Event('resize')); await sleep(250);
        const ev = (type, x, y, id = 1, kind = 'touch') => { let t = type === 'pointerdown' ? d.elementFromPoint(x, y) : tg[id]; ok(t, 'nothing under ' + Math.round(x) + ', ' + Math.round(y)); if (!t.isConnected) t = svg; if (type === 'pointerdown') tg[id] = t;
          t.dispatchEvent(new w.PointerEvent(type, { pointerId: id, pointerType: kind, isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 })); if (type === 'pointerup' || type === 'pointercancel') delete tg[id]; };
        const tap = (x, y, kind) => { ev('pointerdown', x, y, 1, kind); ev('pointerup', x, y, 1, kind); };
        const swipe = (x, y, dx, dy, id = 1, kind = 'touch') => { const mk = (type, X, Y) => new w.PointerEvent(type, { pointerId: id, pointerType: kind, isPrimary: id === 1, clientX: X, clientY: Y, bubbles: true, cancelable: true, composed: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 }), E = [mk('pointerdown', x, y)]; for (let i = 1; i <= 5; i++) E.push(mk('pointermove', x + dx * i / 5, y + dy * i / 5)); E.push(mk('pointerup', x + dx, y + dy)); const t = d.elementFromPoint(x, y); ok(t, 'nothing under ' + Math.round(x) + ', ' + Math.round(y)); E.forEach(e => (t.isConnected ? t : svg).dispatchEvent(e)); if (V('phTouch').fl) V('phTouch').fl(); };   // (no flick going on after it: a slow machine's quick moves can look like one)
        const mid = id => { const r = V('linkNode')(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
        const center = id => { const p = mid(id), s = st.getBoundingClientRect(); st.scrollLeft += p.x - (s.left + s.width / 2); st.scrollTop += p.y - (s.top + s.height / 2); return mid(id); };
        const pause = () => sleep(450);   // past the double-tap window
        const desel = () => { V('sel').clear(); w.render(); w.buildPanel(); }, pickOf = (x, y) => { const g = w.phPick(x, y); return g ? g.dataset.id : ''; }, O = id => V('get')(id);
        const scene1 = { version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], objects: [{ id: 'p1', type: 'box', x: 800, y: 480, s: 1, r: 0, w: 1500, h: 780, fill: '#f5f6f8', stroke: '#d1d5db', sw: 2, text: '' },
          { id: 'i1', type: 'icon', kind: 'microscope', x: 400, y: 300, s: 1, r: 0, size: 110 }, { id: 'a1', type: 'arrow', x: 0, y: 0, s: 1, r: 0, x1: 700, y1: 300, x2: 1200, y2: 300, color: '#333333', width: 3, head: 'arrow' }, { id: 't1', type: 'text', x: 300, y: 650, s: 1, r: 0, text: 'A label', size: 28, anchor: 'start' }] };
        w.fig.set(scene1); V('snap=false;guides=false'); w.fit(true); await sleep(150);
        const zf = V('zoom'), sv = () => svg.getBoundingClientRect(), page = (x, y) => ({ x: sv().left + x * V('zoom'), y: sv().top + y * V('zoom') });
        // a free spot on the panel (top right), and a panel that counts as one: no text of its own, elements on it
        ok(w.phBack(O('p1')), 'a box with no text and elements on it is no panel behind them'); const fp = page(1450, 130); eq(pickOf(fp.x, fp.y), 'p1', 'the free spot');
        // a double tap on it zooms in as on empty canvas, opens no text field and leaves nothing selected
        await doubleTap(w, fp.x, fp.y, fp.x + 1, fp.y + 1, () => ok(V('sel').has('p1'), 'a tap selects the panel'));
        ok(await until(() => Math.abs(V('zoom') - zf * 2) < 1e-6, 2000), 'a double tap on the panel did not zoom 2×: ' + V('zoom')); ok(!V('editor') && !$$('textarea.inline-edit'), 'a double tap on the panel opened a text field'); eq(V('sel').size, 0, 'the first tap\'s selection stayed');
        w.fit(true); await pause();
        // press and hold on it: the canvas menu; once selected, its own menu
        let p = page(1450, 130); ev('pointerdown', p.x, p.y); ok(await until(() => cm.classList.contains('open'), 2000), 'press and hold on the panel opened no menu'); ok(/Text here/.test(cm.textContent), 'press and hold on the panel is not the canvas menu: ' + cm.textContent); ev('pointerup', p.x, p.y); cm.classList.remove('open'); await sleep(350);
        // a tap selects it, and then a quick swipe moves nothing while a press and a drag does
        desel(); await pause(); p = page(1450, 130); tap(p.x, p.y); await pause(); const py = O('p1').y; swipe(p.x, p.y, 0, -70); await sleep(30); eq(O('p1').y, py, 'a quick swipe moved the selected panel'); eq(V('drag'), null, 'a drag is left');
        await pause(); ev('pointerdown', p.x, p.y); w.clearTimeout(V('phTouch').lp); ok(await until(() => false, 230) === false); ev('pointermove', p.x, p.y - 30); ev('pointermove', p.x, p.y - 40); ev('pointerup', p.x, p.y - 40); ok(O('p1').y < py - 40, 'press, then drag did not move the panel'); w.undo(); desel(); await pause();
        // a section box with no elements on it is edited by a double tap as before
        w.fig.update('p1', { text: 'Now with text' }); ok(!w.phBack(O('p1')), 'a box with text counts as a panel behind'); w.fig.update('p1', { text: '' }); desel(); await pause();
        // gaps in an icon go to the icon, not to the panel; beside a thin arrow the arrow; on the label the label
        { const r = V('linkNode')('i1').getBoundingClientRect(); let hit = 0; for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (pickOf(r.left + (i + .5) * r.width / 10, r.top + (j + .5) * r.height / 10) === 'i1') hit++; ok(hit >= 95, 'a tap inside an icon\'s box picks it: ' + hit + ' of 100'); }
        p = page(950, 300); eq(pickOf(p.x, p.y + 6), 'a1', 'a finger 6 px beside a thin arrow'); eq(pickOf(p.x, p.y + 25), 'p1', 'a finger 25 px beside a thin arrow');
        p = mid('i1'); tap(p.x, p.y); ok(V('sel').has('i1') && V('sel').size === 1, 'a tap on the icon did not select it'); await pause();
        // a cancelled touch: the drag is undone and over
        p = mid('i1'); const ix = O('i1').x, hn = V('hist').length; ev('pointerdown', p.x, p.y); ev('pointermove', p.x + 20, p.y); ev('pointermove', p.x + 40, p.y); ok(O('i1').x !== ix, 'the selected icon did not move'); ev('pointercancel', p.x + 40, p.y); await sleep(30);
        eq(O('i1').x, ix, 'a cancelled touch left the element moved'); eq(V('drag'), null, 'a cancelled touch left the drag running'); eq(V('hist').length, hn, 'a cancelled touch made an undo step'); desel(); await pause();
        // iOS sends gesture events for a finger pinch too: they add nothing; a trackpad's (no fingers down) still zooms
        { w.setZoom(.5); await sleep(50); const R0 = w.render; let n = 0; w.render = function () { n++; return R0.apply(this, arguments); }; const G = (t, s) => { const e = new w.Event(t, { bubbles: true, cancelable: true }); e.scale = s; e.clientX = 195; e.clientY = 400; st.dispatchEvent(e); };
          try { const c = { x: 195, y: 400 }, z0 = V('zoom'); ev('pointerdown', c.x - 50, c.y, 1); ev('pointerdown', c.x + 50, c.y, 2); G('gesturestart', 1); for (let i = 1; i <= 5; i++) { ev('pointermove', c.x - 50 - i * 10, c.y, 1); ev('pointermove', c.x + 50 + i * 10, c.y, 2); G('gesturechange', 1 + i * .2); }
            eq(n, 0, 'renders during a pinch with gesture events'); eq(V('zoom'), z0, 'the gesture events zoomed during the pinch'); ev('pointerup', c.x + 100, c.y, 2); ev('pointerup', c.x - 100, c.y, 1); G('gestureend', 2); await sleep(30); near(V('zoom'), z0 * 2, 1e-6, 'the zoom after a pinch with gesture events'); eq(n, 1, 'renders after the pinch');
            w.setZoom(.5); G('gesturestart', 1); G('gesturechange', 1.5); G('gestureend', 1.5); near(V('zoom'), .75, 1e-6, 'a trackpad pinch'); } finally { w.render = R0; } w.fit(true); await pause(); }
        // Back: Sketch and placing a comment end with it; a menu item that opens a sheet at once leaves no entry behind
        w.setSketch(true); await sleep(30); ok(w.history.state && w.history.state.ph, 'Sketch has no Back entry'); w.history.back(); ok(await until(() => !V('sk').on), 'Back did not leave Sketch mode'); await sleep(120);
        w.setSketch(true); await sleep(30); $$('#skDone').click(); ok(await until(() => !(w.history.state && w.history.state.ph) && !V('PH').backing, 10000), 'Done left Sketch\'s Back entry');
        w.setPlacing(true); await sleep(30); ok(w.history.state && w.history.state.ph, 'placing a comment has no Back entry'); w.history.back(); ok(await until(() => !V('placing')), 'Back did not end placing the comment'); await sleep(120);
        p = page(1450, 130); desel(); ev('pointerdown', p.x, p.y); ok(await until(() => cm.classList.contains('open'), 2000), 'no canvas menu for Back'); ev('pointerup', p.x, p.y); await sleep(500); ok(w.history.state && w.history.state.ph, 'the menu has no Back entry');
        [...cm.querySelectorAll('button')].find(b => /Comment here/.test(b.textContent)).click(); await sleep(100); eq($$('#props').dataset.ph, 'full', 'Comment here opened no sheet'); eq(V('PH').stack.length, 1, 'layers after a menu item that opens a sheet'); $$('#props .sgx').click(); ok(await until(() => !(w.history.state && w.history.state.ph) && !V('PH').backing, 10000), 'a Back entry is left after closing the sheet: the next Back would do nothing'); w.undo(); desel(); await pause();
        // press and hold: the menu is under the lifting finger: the click that may come with the lift does not run a row, a later tap does
        w.fit(true); await sleep(50); p = mid('t1'); ev('pointerdown', p.x, p.y); ok(await until(() => cm.classList.contains('open'), 2000), 'no element menu'); const rw = [...cm.querySelectorAll('button')].find(b => /Duplicate/.test(b.textContent)), n1 = V('scene').objects.length; ev('pointerup', p.x, p.y); rw.click(); eq(V('scene').objects.length, n1, 'the click of the lifting finger ran a menu row'); ok(cm.classList.contains('open'), 'the click of the lifting finger closed the menu');
        await sleep(480); rw.click(); eq(V('scene').objects.length, n1 + 1, 'a tap on the row later did nothing'); w.undo(); desel(); await pause();
        // Select several: a double tap keeps the element selected and opens its properties; a single tap on it takes it out; the toolbar has only what applies
        V('PH').multi = true; w.mbarSync(); p = mid('i1'); await doubleTap(w, p.x, p.y); await sleep(50); ok(V('sel').has('i1'), 'a double tap in Select several deselected it'); eq($$('#props').dataset.ph, 'full', 'a double tap in Select several opened no properties'); eq($$('#props .sgt').textContent, 'Icon', 'the properties are not the icon\'s'); w.phSheet('#props', 'closed'); await pause();
        p = mid('i1'); tap(p.x, p.y); await sleep(30); ok(!V('sel').has('i1'), 'a tap in Select several did not take it out'); V('PH').multi = false; w.mbarSync(); desel(); await pause();
        // the selection toolbar fits a 390 px phone with Deselect in sight; Arrange lists what applies
        V('sel').add('i1'); w.render(); w.buildPanel(); { const m = $$('#mbSel'); ok(m.scrollWidth <= m.clientWidth + 1, 'the selection toolbar overflows: ' + m.scrollWidth + ' > ' + m.clientWidth); ok([...m.querySelectorAll('button')].filter(b => !b.hidden).every(b => b.getBoundingClientRect().width >= 40), 'a toolbar button is under 40 px wide'); }
        w.phArrange(); await sleep(30); ok(cm.querySelectorAll('button').length === 4 && !cm.querySelector('button[disabled]'), 'Arrange for one element lists rows that do not apply: ' + cm.textContent); cm.classList.remove('open'); await sleep(50); desel();
        // a finger's words: the Page sheet, the comments list, a toast
        $$('#mbar [data-m=page]').click(); await sleep(60); { const t = [...$$('#props').querySelectorAll('p')].map(x => x.textContent).join(' '); ok(/Tap an element/.test(t) && /Add a comment/.test(t) && !/Click|right-click|\+ Comment/.test(t), 'the Page sheet has desktop wording: ' + t); } w.phSheet('#props', 'closed'); await sleep(60);
        w.toast('File ▾ → Download a copy: click “x”, double-click y, right-click z on your computer, click.json'); eq($$('#toast').textContent, '⋯ → File ▸ → Download a copy: tap “x”, double-tap y, press and hold z on this device, click.json', 'a toast\'s wording');
        // keys in the phone layout: / opens Add and its search, Esc closes a sheet
        st.focus(); st.dispatchEvent(new w.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })); await sleep(50); eq($$('#left').dataset.ph, 'full', '/ did not open the Add sheet'); eq(d.activeElement, $$('#palSearch'), '/ did not focus the search'); st.focus(); st.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await sleep(50); ok(!$$('#left').dataset.ph, 'Esc did not close the Add sheet');
        // a flick goes on after the finger lifts, a new press stops it, and a pause before lifting gives none (frames by timer: a hidden tab paints none)
        { const raf = w.requestAnimationFrame, caf = w.cancelAnimationFrame; w.requestAnimationFrame = f => w.setTimeout(() => f(w.performance.now()), 16); w.cancelAnimationFrame = i => w.clearTimeout(i);
          try { w.setZoom(1); await sleep(50); st.scrollLeft = 300; st.scrollTop = 100; const s = st.getBoundingClientRect(), x = s.left + 300, y = s.top + 40; ok(!pickOf(x, y) || pickOf(x, y) === 'p1', 'the flick starts on something'); desel(); await pause();
            const H = d.documentElement, still = H.classList.contains('ui-still'); H.classList.remove('ui-still'); /* a system set to reduce motion (GitHub's Windows and Mac machines) has no flick: checked below */ let sl = 0, went = false; for (let a = 0; a < 4 && !went; a++) { st.scrollLeft = 300; ev('pointerdown', x, y); for (let i = 1; i <= 5; i++) { await sleep(16); ev('pointermove', x - i * 60, y); } sl = st.scrollLeft; ev('pointerup', x - 300, y); for (let i = 0; i < 30 && !went; i++) { await sleep(50); went = st.scrollLeft > sl + 20; } } ok(went, 'a flick stopped dead: ' + sl + ' → ' + st.scrollLeft); /* tries again: on a slow machine late timers can make the moves too slow to count as a flick, and frames come late */ ev('pointerdown', x, y); const s2 = st.scrollLeft; await sleep(80); eq(st.scrollLeft, s2, 'a new press did not stop the flick'); ev('pointerup', x, y); await pause(); H.classList.add('ui-still'); st.scrollLeft = 300; ev('pointerdown', x, y); for (let i = 1; i <= 5; i++) { await sleep(16); ev('pointermove', x - i * 24, y); } const sNoFlick = st.scrollLeft; ev('pointerup', x - 120, y); await sleep(200); eq(st.scrollLeft, sNoFlick, 'a flick with reduced motion'); await pause(); H.classList.remove('ui-still');
            ev('pointerdown', x, y); for (let i = 1; i <= 5; i++) { await sleep(16); ev('pointermove', x - i * 10, y); } await sleep(150); const s3 = st.scrollLeft; ev('pointerup', x - 50, y); await sleep(80); eq(st.scrollLeft, s3, 'a pause before lifting still flicked'); H.classList.toggle('ui-still', still); } finally { w.requestAnimationFrame = raf; w.cancelAnimationFrame = caf; } }
        // a stylus works as a finger does: it scrolls, a tap selects, the selection moves after 10 px, press and hold has the menu; a resting hand is ignored; in Sketch it draws
        w.fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], objects: [{ id: 'r1', type: 'shape', kind: 'rect', x: 800, y: 500, s: 1, r: 0, w: 300, h: 200, fill: '#cfe3f5', stroke: '#6f86c8', sw: 2 }] }); w.setZoom(1); await sleep(100);
        { p = center('r1'); const x0 = O('r1').x, s0 = [st.scrollLeft, st.scrollTop]; swipe(p.x, p.y, -60, -40, 7, 'pen'); eq(O('r1').x, x0, 'a pen\'s drag moved an element that is not selected'); ok(st.scrollLeft - s0[0] > 30 && st.scrollTop - s0[1] > 20, 'a pen\'s drag did not scroll'); await pause();
          p = mid('r1'); ev('pointerdown', p.x, p.y, 7, 'pen'); ev('pointerup', p.x, p.y, 7, 'pen'); ok(V('sel').has('r1'), 'a pen\'s tap did not select'); await pause();
          p = mid('r1'); ev('pointerdown', p.x, p.y, 7, 'pen'); ev('pointermove', p.x + 5, p.y, 7, 'pen'); eq(O('r1').x, x0, 'the selection moved within 10 px of a pen'); ev('pointerdown', p.x + 90, p.y + 90, 8); eq(V('touches').size, 0, 'a resting hand counts as a finger'); ev('pointerup', p.x + 90, p.y + 90, 8); ev('pointermove', p.x + 30, p.y, 7, 'pen'); ev('pointermove', p.x + 40, p.y, 7, 'pen'); ev('pointerup', p.x + 40, p.y, 7, 'pen'); near(O('r1').x - x0, 40, 1, 'a pen\'s drag of the selection'); w.undo(); desel(); await pause();
          p = mid('r1'); ev('pointerdown', p.x, p.y, 7, 'pen'); ok(await until(() => cm.classList.contains('open'), 2000), 'a pen\'s press and hold opened no menu'); ev('pointerup', p.x, p.y, 7, 'pen'); cm.classList.remove('open'); await sleep(350); desel();
          w.setSketch(true); await sleep(30); p = mid('r1'); ev('pointerdown', p.x, p.y, 7, 'pen'); eq((V('drag') || {}).mode, 'sketch', 'in Sketch a pen does not draw'); ev('pointermove', p.x + 20, p.y, 7, 'pen'); ev('pointerup', p.x + 20, p.y, 7, 'pen'); w.setSketch(false); await pause(); }
        // a big Gantt chart: a quick swipe from a bar scrolls, a press and a drag moves the bar; a tiny structure drags as a whole, a zoomed-in one has handles, a row for what a keyboard types, and a bond that moves it all
        w.fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], objects: [{ id: 'g1', type: 'gantt', x: 100, y: 100, s: 1, r: 0, cols: 'A|B|C|D|E|F', colW: 200, rowH: 60, barH: 36, labelW: 200, tasks: 'One|1|3|a\nTwo|2|4|a\nThree|1|5|a', phases: 'a|#6f86c8|Phase' }] }); w.setZoom(3); await sleep(150);
        { V('sel').add('g1'); w.render(); w.buildPanel(); const o = O('g1'), G = w.ganttGeom(o), at = () => { const q = w.toGlobal(o, [G.X(2.5), G.rowY(1)]); return page(q.x, q.y); }; let q = at(); const s = st.getBoundingClientRect(); st.scrollLeft += q.x - (s.left + s.width / 2); st.scrollTop += q.y - (s.top + s.height / 2); await sleep(50); ok(w.phBig(), 'the chart does not count as big at this zoom'); q = at(); const t0 = o.tasks, s0 = st.scrollLeft;
          swipe(q.x, q.y, -120, 0); await sleep(30); eq(O('g1').tasks, t0, 'a quick swipe from a bar moved the bar'); ok(st.scrollLeft > s0 + 60, 'a quick swipe from a bar did not scroll'); await pause(); q = at(); ev('pointerdown', q.x, q.y); w.clearTimeout(V('phTouch').lp); await sleep(230); eq((V('drag') || {}).mode, 'gbar', 'press on a bar'); ev('pointermove', q.x - 30, q.y); ev('pointermove', q.x - 700, q.y); ev('pointerup', q.x - 700, q.y); ok(O('g1').tasks !== t0, 'press, then drag did not move the bar'); desel(); await pause(); }
        w.fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], objects: [{ id: 'c1', type: 'chem', x: 800, y: 450, s: 1, r: 0, smiles: 'CCCC(=O)O' }] }); await sleep(100); w.fit(true); await sleep(100);
        { p = mid('c1'); tap(p.x, p.y); await sleep(50); ok(V('sel').has('c1'), 'a tap did not select the structure'); eq(d.querySelectorAll('#overlay [data-h=catom]').length, 0, 'finger handles on a structure too small for them'); await pause(); p = mid('c1'); const x0 = O('c1').x; ev('pointerdown', p.x, p.y); w.clearTimeout(V('phTouch').lp); await sleep(230); ev('pointermove', p.x + 30, p.y); ev('pointermove', p.x + 50, p.y); ev('pointerup', p.x + 50, p.y); ok(O('c1').x > x0 + 50, 'a tiny structure did not drag as a whole'); w.undo(); await sleep(50);
          V('sel').clear(); V('sel').add('c1'); w.setZoom(1.5); await sleep(80); center('c1'); await sleep(50); const hd = s => [...d.querySelectorAll('#overlay circle[data-h=' + s + ']')].find(c => !c.classList.contains('phx')), mc = c => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }; ok(hd('catom') && hd('cbond'), 'no handles on a zoomed-in structure');
          const ia = +hd('catom').dataset.i; p = mc(hd('catom')); tap(p.x, p.y); await sleep(80); eq((V('chemActive') || {}).atom, ia, 'a tap on an atom did not pick it'); ok($$('#props').dataset.ph, 'picking an atom did not open the sheet with its row'); const kb = t => [...d.querySelectorAll('#props .phqk button')].find(b => b.textContent === t); ok(kb('N') && kb('+') && kb('Remove'), 'the atom row lacks its buttons: ' + $$('#props .phq').textContent);
          kb('N').click(); eq(O('c1').atoms[ia].el, 'N', 'the N button'); kb('+').click(); eq(O('c1').atoms[ia].q, 1, 'the + button'); const na = O('c1').atoms.length; kb('Remove').click(); eq(O('c1').atoms.length, na - 1, 'the Remove button'); w.undo(); w.undo(); w.undo(); w.phSheet('#props', 'closed'); await sleep(50); V('sel').clear(); V('sel').add('c1'); w.render(); w.buildPanel(); await pause();
          const xb = O('c1').x; p = mc(hd('cbond')); ev('pointerdown', p.x, p.y); w.clearTimeout(V('phTouch').lp); await sleep(230); ev('pointermove', p.x + 30, p.y); ev('pointermove', p.x + 60, p.y); ev('pointerup', p.x + 60, p.y); near(O('c1').x - xb, 40, 1, 'a drag on a bond moves the whole structure'); w.undo(); desel(); await pause(); }
        // a keyboard that shrinks the whole page (Android in-app browsers, Firefox): while typing the layout stays, so the field keeps the focus; a rotation (another width) still changes it
        { V('sel').clear(); w.fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], objects: [{ id: 'r1', type: 'shape', kind: 'rect', x: 800, y: 500, s: 1, r: 0, w: 300, h: 200, fill: '#cfe3f5', stroke: '#6f86c8', sw: 2 }] }); V('sel').add('r1'); w.render(); w.buildPanel(); $$('#mbar [data-m=style]').click(); await sleep(350); const f = [...$$('#props').querySelectorAll('input[type=text],textarea')].find(i => i.getClientRects().length); ok(f, 'no text field in the properties'); for (let i = 0; i < 40 && d.activeElement !== f; i++) { f.focus(); await sleep(50); } ok(d.activeElement === f, 'the field did not take the focus');
          fr.style.height = '330px'; await until(() => w.innerHeight === 330, 1500); w.applyUIClasses(); w.dispatchEvent(new w.Event('resize')); await sleep(150); ok(w.matchMedia('(orientation:landscape)').matches, 'the frame did not turn "sideways"'); ok(!d.documentElement.classList.contains('ph-land'), 'a keyboard shrinking the page turned the layout sideways'); ok(d.activeElement === f, 'a keyboard shrinking the page took the focus from the field'); ok(d.documentElement.classList.contains('ph-kb'), 'no ph-kb with a keyboard shrinking the page');
          fr.style.height = '844px'; await until(() => w.innerHeight === 844, 1500); w.applyUIClasses(); w.dispatchEvent(new w.Event('resize')); await sleep(150); fr.style.width = '844px'; fr.style.height = '390px'; await until(() => w.innerWidth === 844, 1500); w.applyUIClasses(); await sleep(150); ok(d.documentElement.classList.contains('ph-land'), 'a rotation while typing did not turn the layout'); ok(d.activeElement === f, 'a rotation while typing rebuilt the panel under the field'); f.blur(); w.phSheet('#props', 'closed'); fr.style.width = '390px'; fr.style.height = '844px'; await until(() => w.innerWidth === 390, 1500); w.applyUIClasses(); w.dispatchEvent(new w.Event('resize')); await sleep(200); desel(); }
        // Find and replace with the keyboard up: its title and field stay on the screen
        { w.findReplaceDialog(); await sleep(250); const de = d.documentElement; de.style.setProperty('--kb', '477px'); de.style.setProperty('--vvh', '367px'); await sleep(50); const b = $$('#modalBox'), bb = b.getBoundingClientRect(), tt = b.querySelector('h2').getBoundingClientRect(); ok(tt.top >= -1 && bb.bottom <= 368 && b.querySelector('input').getBoundingClientRect().bottom < 368, 'Find and replace leaves the screen above the keyboard: box ' + Math.round(bb.top) + '–' + Math.round(bb.bottom)); de.style.setProperty('--kb', '0px'); de.style.setProperty('--vvh', w.innerHeight + 'px'); w.closeModal(); await sleep(60); }
        // Off keeps the phone layout where the desktop one leaves no canvas (a frame without ?phone=1), and gives way from 560 px wide
        fr.remove(); fr = D.createElement('iframe'); fr.title = 'phone off test'; fr.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;border:0;z-index:2147483000;background:#fff'; fr.src = location.pathname + '?file=' + encodeURIComponent(name); D.body.appendChild(fr);
        ok(await until(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 60000), 'the editor did not start without phone=1'); { const f = fr.contentWindow, H = f.document.documentElement, u = f.UI.phone; try { f.UI.phone = 'off'; f.applyUIClasses(); await sleep(60); ok(H.classList.contains('phone'), 'Phone layout: Off at 390 px left no canvas'); ok(f.document.querySelector('#stage').clientWidth > 300, 'canvas with Off at 390 px'); fr.style.width = '640px'; await until(() => f.innerWidth === 640, 1500); f.applyUIClasses(); await sleep(60); ok(!H.classList.contains('phone'), 'Phone layout: Off at 640 px is still on'); } finally { f.UI.phone = u; } }
      } finally {
        if (fr) { try { await fr.contentWindow.flushSave(); } catch (e) {} fr.remove(); fr = null; }
        await sleep(200);
        try { await fetch('api/move?file=' + encodeURIComponent(name) + '&from=&to=trash', { method: 'POST' }); await fetch('api/delete?file=' + encodeURIComponent(name), { method: 'POST' }); } catch (e) {}
        try { localStorage.removeItem('figEditor.scene.v1:' + name); } catch (e) {}
      }
    }, 300000);
    // a phone's opening zoom makes everything small: small elements move (their handles stay off them), arrows, tapping on a big figure, fingers whose lift got lost, Select several, the first-run hint, exports
    test('phone touch 3: small elements move, handles beside them, no redraw for a tap, lost fingers, Select several, focus, page-top rotate, comment close, Sketch, zoom after editing, Add Text, wording, Export, app browsers, Export several, Start over', async () => {
      if (typeof phRedraw !== 'function') throw new Skip('this editor has no phone touch code');
      const name = String(FILE).replace(/\.json$/i, '') + '-phone.json'; let fr = null, hello0 = null, recent0 = null; try { hello0 = localStorage.getItem('fig.phHello'); recent0 = localStorage.getItem('fig.palRecent'); } catch (e) {}   // the phone layout test's name too (see above); the hint's record and recently used go back afterwards
      const until = async (f, ms = 3000) => { const t0 = Date.now(); for (;;) { let v = false; try { v = f(); } catch (e) {} if (v) return true; if (Date.now() - t0 > ms) return false; await sleep(40); } };
      const open = async q => { if (fr) fr.remove(); fr = D.createElement('iframe'); fr.title = 'phone touch test 3'; fr.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;border:0;z-index:2147483000;background:#fff'; fr.src = location.pathname + '?file=' + encodeURIComponent(name) + '&phone=1' + (q || ''); D.body.appendChild(fr);
        ok(await until(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 60000), 'the editor did not start in the phone frame'); const w = watch(fr.contentWindow); w.alert = () => {}; w.confirm = () => true; w.prompt = () => null; w.download = () => {}; w.HTMLAnchorElement.prototype.click = function () {}; w.onbeforeunload = null; try { w.navigator.vibrate = () => true; } catch (e) {} if (w.applyUIClasses) w.applyUIClasses(); w.dispatchEvent(new w.Event('resize')); await sleep(250); return w; };
      try {
        const w = await open(), d = w.document, V = s => w.eval(s), $$ = s => d.querySelector(s), svg = $$('#svg'), st = $$('#stage'), cm = $$('#ctxMenu'), tg = {}, O = id => V('get')(id);
        const ev = (type, x, y, id = 1) => { let t = type === 'pointerdown' ? d.elementFromPoint(x, y) : tg[id]; ok(t, 'nothing under ' + Math.round(x) + ', ' + Math.round(y)); if (!t.isConnected) t = svg; if (type === 'pointerdown') tg[id] = t;
          t.dispatchEvent(new w.PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 })); if (type === 'pointerup' || type === 'pointercancel') delete tg[id]; };
        const tap = (x, y) => { ev('pointerdown', x, y); ev('pointerup', x, y); }, pause = () => sleep(450), mid = id => { const r = V('linkNode')(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, desel = () => { V('sel').clear(); w.render(); w.buildPanel(); }, hd = s => d.querySelector('#overlay [data-h="' + s + '"]:not(.phx)'), mc = h => { const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, ids = () => [...V('sel')].sort().join();
        const SC = { version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], objects: [{ id: 't1', type: 'text', x: 200, y: 150, s: 1, r: 0, text: 'Label', size: 16, anchor: 'start' }, { id: 'i1', type: 'icon', kind: 'microscope', x: 500, y: 150, s: 1, r: 0, size: 50 }, { id: 'b1', type: 'box', x: 800, y: 150, s: 1, r: 0, w: 100, h: 60, fill: '#eeeeee', stroke: '#999999', sw: 1, text: '' },
          { id: 'a1', type: 'arrow', x: 0, y: 0, s: 1, r: 0, x1: 1000, y1: 150, x2: 1100, y2: 150, color: '#333333', width: 3, head: 'arrow' }, { id: 'a2', type: 'arrow', x: 0, y: 0, s: 1, r: 0, x1: 200, y1: 450, x2: 1400, y2: 450, color: '#333333', width: 3, head: 'arrow' },
          { id: 'g1', type: 'gantt', x: 100, y: 550, s: 1, r: 0, cols: 'A|B|C', colW: 100, rowH: 30, barH: 20, labelW: 100, tasks: 'One|0|2|a\nTwo|1|3|a', phases: 'a|#6f86c8|Phase' }, { id: 'ge', type: 'geom', kind: 'polygon', x: 900, y: 700, s: 1, r: 0, pts: [[-50, 40], [50, 40], [0, -50]], fill: '#cfe3f5', stroke: '#6f86c8', sw: 2 }, { id: 'top', type: 'shape', kind: 'rect', x: 1500, y: 15, s: 1, r: 0, w: 30, h: 30, fill: '#cfe3f5', stroke: '#6f86c8', sw: 2 }] };
        w.fig.set(SC); V('snap=false;guides=false'); w.fit(true); await sleep(150); const zf = V('zoom'); ok(zf < .3, 'the figure did not open small: ' + zf);
        // a press on the middle of something small moves it; nothing else about it changes
        for (const id of ['t1', 'i1', 'b1', 'a1', 'g1', 'ge']) { let p = mid(id); tap(p.x, p.y); ok(V('sel').size === 1 && V('sel').has(id), 'a tap did not select ' + id); await pause(); p = mid(id); const o0 = JSON.parse(JSON.stringify(O(id))), xy = o => id === 'a1' ? o.x1 : o.x; ev('pointerdown', p.x, p.y); eq((V('drag') || {}).mode, 'move', 'a press on the middle of ' + id); ev('pointermove', p.x + 20, p.y); ev('pointermove', p.x + 40, p.y); ev('pointerup', p.x + 40, p.y);
          const o1 = O(id); near(xy(o1) - xy(o0), 40 / zf, 3, 'the drag on ' + id); ['boxW', 'bend', 's', 'tasks', 'pts', 'w'].forEach(k => eq(o1[k], o0[k], k + ' of ' + id + ' changed')); w.undo(); desel(); await pause(); }
        // a short word: the width bars sit beside it, and a bar's edge keeps its distance to the finger
        { const p = mid('t1'); tap(p.x, p.y); const tr = V('linkNode')('t1').getBoundingClientRect(), L = hd('twl').getBoundingClientRect(), R = hd('twr').getBoundingClientRect(); ok(L.right <= tr.left + 1 && R.left >= tr.right - 1, 'the width bars cover a short word'); await pause(); const q = mc(hd('twr')); ev('pointerdown', q.x, q.y); eq((V('drag') || {}).mode, 'twr', 'a press on the bar'); const R0 = w.textFrame(O('t1')).R; ev('pointermove', q.x + 20, q.y); ev('pointermove', q.x + 40, q.y); near((w.textFrame(O('t1')).R - R0) * zf, 40, 6, 'the text box edge'); ev('pointerup', q.x + 40, q.y); w.undo(); await pause();
          const q2 = mc(hd('twr')); tap(q2.x, q2.y); ok(!O('t1').boxW, 'a tap on a width bar left a box width'); desel(); await pause(); }
        // a long arrow: its middle moves it, the dot beside the line curves it, near the line it is straight again; a short one has no handles
        { let p = mid('a2'); tap(p.x, p.y); const dot = hd('bend'); ok(dot, 'no bend dot'); ok(Math.abs(mc(dot).y - p.y) >= 20, 'the bend dot sits on the line'); await pause(); p = mid('a2'); const y0 = O('a2').y1; ev('pointerdown', p.x, p.y); eq((V('drag') || {}).mode, 'move', 'a press on the arrow\'s middle'); ev('pointermove', p.x, p.y + 20); ev('pointermove', p.x, p.y + 40); ev('pointerup', p.x, p.y + 40); near(O('a2').y1 - y0, 40 / zf, 3, 'the arrow moved'); eq(+O('a2').bend || 0, 0, 'the arrow curved'); w.undo(); await pause();
          const q = mc(hd('bend')); ev('pointerdown', q.x, q.y); eq((V('drag') || {}).mode, 'bend', 'a press on the bend dot'); ev('pointermove', q.x, q.y - 20); ev('pointermove', q.x, q.y - 30); ok(Math.abs(O('a2').bend) * zf > 40, 'the dot did not curve the arrow: ' + O('a2').bend); ev('pointermove', q.x, q.y - 4); eq(O('a2').bend, 0, 'near the line it is straight'); ev('pointerup', q.x, q.y - 4); desel(); await pause();
          p = mid('a1'); tap(p.x, p.y); eq(d.querySelectorAll('#overlay [data-h]').length, 0, 'handles on an arrow too short for them'); desel(); await pause(); eq(d.querySelectorAll('#overlay [data-h=gstart]').length, 0, 'Gantt handles at this zoom'); }
        // a tap on the selection redraws nothing; a handle drag redraws only at the end
        { let p = mid('i1'); tap(p.x, p.y); await pause(); const R0 = w.render, B0 = w.buildPanel; let nR = 0, nB = 0; w.render = function () { nR++; return R0.apply(this, arguments); }; w.buildPanel = function () { nB++; return B0.apply(this, arguments); };
          try { p = mid('i1'); tap(p.x, p.y); eq([nR, nB], [0, 0], 'renders and panel builds for a tap on the selection'); ok(d.querySelector('#overlay .phx'), 'the handles\' twins did not come back'); await pause(); const q = mc(hd('scale')), s0 = O('i1').s; ev('pointerdown', q.x, q.y); eq((V('drag') || {}).mode, 'scale', 'a press on the corner handle'); for (let i = 1; i <= 5; i++) ev('pointermove', q.x + i * 8, q.y + i * 8); eq(nR, 0, 'renders during a handle drag'); ok(O('i1').s > s0, 'the handle did not scale'); ok(V('linkNode')('i1').getAttribute('transform').includes('scale(' + O('i1').s), 'the element was not redrawn: ' + V('linkNode')('i1').getAttribute('transform')); ev('pointerup', q.x + 40, q.y + 40); eq(nR, 1, 'renders at the end of a handle drag'); w.undo(); } finally { w.render = R0; w.buildPanel = B0; } desel(); await pause(); }
        // a double tap by the events' own times: a slow render between the two taps does not lose it
        { const p = mid('t1'), mk = type => new w.PointerEvent(type, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, composed: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }), E = ['pointerdown', 'pointerup', 'pointerdown', 'pointerup'].map(mk), R1 = w.render; w.render = function () { const t = w.performance.now(); while (w.performance.now() - t < 300); return R1.apply(this, arguments); };
          let t3 = 0; try { let t = d.elementFromPoint(p.x, p.y); t.dispatchEvent(E[0]); (t.isConnected ? t : svg).dispatchEvent(E[1]); ok(V('sel').has('t1'), 'the first tap did not select'); t = d.elementFromPoint(p.x, p.y); t.dispatchEvent(E[2]); t3 = Date.now(); (t.isConnected ? t : svg).dispatchEvent(E[3]); } finally { w.render = R1; } ok(V('editor'), 'a double tap behind a slow render did not edit'); ok(V('PH').ghost >= t3 + 450 + 200, 'the guard against the lifting finger\'s click ran out while building'); $$('.fmtbar .fdone').click(); await sleep(50); near(V('zoom'), zf, 1e-6, 'Done brings the zoom back'); desel(); await pause(); }
        // the edit ends by a press on the bars: the zoom comes back too; a tap on the canvas stays where it is; the editing surfaces take no page pinch
        { const p = mid('t1'); await doubleTap(w, p.x, p.y); ok(V('editor'), 'a double tap did not edit'); ok(V('zoom') > zf * 1.5, 'the edit did not zoom in'); eq(w.getComputedStyle($$('textarea.inline-edit')).touchAction, 'pan-x pan-y', 'touch-action of the in-place field'); eq(w.getComputedStyle($$('.fmtbar')).touchAction, 'pan-x pan-y', 'touch-action of its bar'); $$('#bExport').dispatchEvent(new w.PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false, bubbles: true })); ok(!V('editor'), 'a press on the bar did not end the edit'); near(V('zoom'), zf, 1e-6, 'a press on the top bar left the page zoomed in'); desel(); await pause();
          const p2 = mid('t1'); await doubleTap(w, p2.x, p2.y); ok(V('editor'), 'a double tap did not edit'); const z2 = V('zoom'); svg.dispatchEvent(new w.PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 60, bubbles: true, cancelable: true, button: 0, buttons: 1 })); svg.dispatchEvent(new w.PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 60, bubbles: true, cancelable: true, button: 0, buttons: 0 })); ok(!V('editor'), 'a tap on the canvas did not end the edit'); near(V('zoom'), z2, 1e-6, 'a tap on the canvas took the zoom back'); w.fit(true); desel(); await pause(); }
        // a finger whose lift never reached the canvas: it ends where it lifts, and a new first finger clears what is left
        { const s = st.getBoundingClientRect(), x = s.left + 20, y = s.top + 20; ev('pointerdown', x, y); $$('body>header').dispatchEvent(new w.PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 20, bubbles: true })); delete tg[1]; eq(V('touches').size, 0, 'a lift outside the canvas stayed on the list'); await pause();
          ev('pointerdown', x, y); delete tg[1]; eq(V('touches').size, 1, 'the first finger'); const z0 = V('zoom'), f = () => d.elementFromPoint(x, y), pe = (type, xx) => new w.PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: xx, clientY: y, bubbles: true, cancelable: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 }), t = f(); t.dispatchEvent(pe('pointerdown', x)); eq(V('touches').size, 1, 'a new first finger after a lost lift'); ok(!V('pinch'), 'a single finger counted as a pinch'); t.dispatchEvent(pe('pointermove', x + 60)); t.dispatchEvent(pe('pointerup', x + 60)); eq(V('touches').size, 0, 'the list after it'); near(V('zoom'), z0, 1e-6, 'a single finger zoomed'); if (V('phTouch').fl) V('phTouch').fl(); await pause(); }
        // Select several: press and hold and a double tap on a text keep what was gathered; a second finger takes a box back
        { V('PH').multi = true; w.mbarSync(); let p = mid('t1'); tap(p.x, p.y); await pause(); p = mid('i1'); tap(p.x, p.y); await pause(); eq(ids(), 'i1,t1', 'gathered'); p = mid('b1'); ev('pointerdown', p.x, p.y); ok(await until(() => cm.classList.contains('open'), 2000), 'no menu for press and hold'); eq(ids(), 'b1,i1,t1', 'press and hold in Select several'); ev('pointerup', p.x, p.y); cm.classList.remove('open'); await sleep(350);
          V('sel').delete('t1'); w.render(); w.buildPanel(); await pause(); p = mid('t1'); await doubleTap(w, p.x, p.y); ok(V('editor'), 'a double tap on a text in Select several did not edit it'); eq(ids(), 'b1,i1,t1', 'a double tap on a text in Select several'); $$('.fmtbar .fdone').click(); await sleep(50); eq(ids(), 'b1,i1,t1', 'after that edit'); await pause();
          V('sel').clear(); V('sel').add('t1'); w.render(); w.buildPanel(); const r = svg.getBoundingClientRect(), x0 = r.left + 4, y0 = r.top + 4; ev('pointerdown', x0, y0); eq((V('drag') || {}).mode, 'marquee', 'a box from empty canvas'); ev('pointermove', x0 + 30, y0 + 30); ev('pointermove', r.right - 4, r.bottom - 4); ok(V('sel').size > 2, 'the box took nothing'); ev('pointerdown', r.left + 100, r.top + 100, 2); eq(ids(), 't1', 'a second finger during a box'); eq(V('drag'), null, 'the box is still going'); ev('pointerup', r.left + 100, r.top + 100, 2); ev('pointerup', r.right - 4, r.bottom - 4); V('PH').multi = false; w.mbarSync(); desel(); w.fit(true); await pause(); }
        // a press on the canvas takes the focus off a field
        { V('sel').add('i1'); w.render(); w.buildPanel(); w.phSheet('#props', 'peek'); await sleep(60); const f = [...$$('#props').querySelectorAll('input[type=text],textarea')].find(i => i.getClientRects().length); ok(f, 'no text field in the properties'); for (let i = 0; i < 40 && d.activeElement !== f; i++) { f.focus(); if (d.activeElement !== f) await sleep(50); } ok(d.activeElement === f, 'the field did not take the focus'); /* a sheet still sliding in is not visible yet, so it cannot take the focus */ svg.dispatchEvent(new w.PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 60, bubbles: true, cancelable: true, button: 0, buttons: 1 })); ok(d.activeElement !== f, 'a press on the canvas left the focus on the field'); svg.dispatchEvent(new w.PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 60, bubbles: true, cancelable: true, button: 0, buttons: 0 })); w.phSheet('#props', 'closed'); desel(); await pause(); }
        // an element flush with the top of the page: its rotate handle is below it when the view cannot scroll that high, and turns it
        { w.setZoom(1); await sleep(80); st.scrollTop = 0; const m0 = mid('top'), s = st.getBoundingClientRect(); st.scrollLeft += m0.x - (s.left + s.width / 2); await sleep(50); const p = mid('top'); tap(p.x, p.y); const q = mc(hd('rot')); ok(q.y > p.y && q.y < s.bottom - 10, 'the rotate handle at the page top is out of reach: ' + q.y); ok(q.y > s.top + 10, 'the rotate handle is under the top bar'); await pause(); ev('pointerdown', q.x, q.y); eq((V('drag') || {}).mode, 'rot', 'a press on the rotate handle'); ev('pointermove', q.x + 30, q.y); ev('pointermove', q.x + 50, q.y); ev('pointerup', q.x + 50, q.y); ok(O('top').r, 'the handle did not turn it'); w.undo(); desel(); w.fit(true); await pause(); }
        // a comment's ✕ has a finger's target; closing leaves the comment
        { const c = w.fig.add('comment', { x: 400, y: 400, text: 'Look', collapsed: false }); V('sel').add(c); w.render(); w.buildPanel(); await sleep(40); const x = [...d.querySelectorAll('#content [data-id="' + c + '"] [data-act="close"] circle')].pop().getBoundingClientRect(), cx = x.left + x.width / 2, cy = x.top + x.height / 2; ok(d.elementFromPoint(cx - 15, cy + 10).closest('[data-act="close"]'), 'no target beside the ✕'); await pause(); tap(cx - 15, cy + 10); ok(O(c) && O(c).collapsed, 'a tap beside the ✕ did not close the bubble'); w.fig.remove(c); desel(); await pause(); }
        // Sketch with nothing drawn leaves nothing; an undo down to no strokes after Done neither
        { const n = V('scene').objects.length; w.setSketch(true); await sleep(30); eq(V('scene').objects.length, n + 1, 'Sketch made no layer to draw on'); w.setSketch(false); await sleep(30); eq(V('scene').objects.length, n, 'an empty sketch stayed'); ok(!V('scene').objects.some(o => o.type === 'sketch'), 'an empty sketch stayed'); w.setSketch(true); await sleep(30); const r = svg.getBoundingClientRect(); ev('pointerdown', r.left + 40, r.top + 40); ev('pointermove', r.left + 60, r.top + 60); ev('pointermove', r.left + 80, r.top + 60); ev('pointerup', r.left + 80, r.top + 60); w.setSketch(false); await sleep(30); eq(V('scene').objects.length, n + 1, 'a drawn sketch is kept'); w.undo(); await sleep(30); eq(V('scene').objects.length, n, 'an undo left an empty sketch'); }
        // Add → Text opens for typing, zoomed in; typed it is one undo step and Done brings the view back; left as it is, nothing is added
        { const n = V('scene').objects.length, h0 = V('hist').length, zb = V('zoom'), item = () => [...d.querySelectorAll('#palList .pitem')].find(b => (b.querySelector('span') || {}).textContent === 'Text'); $$('#mbar [data-m=add]').click(); await sleep(60); item().click(); await sleep(60); ok(V('editor'), 'Add → Text did not open for typing'); ok(!$$('#left').dataset.ph, 'the Add sheet stayed open'); ok(parseFloat($$('textarea.inline-edit').style.fontSize) >= 16, 'the new text is under 16 px'); const ta = $$('textarea.inline-edit'); ta.value = 'Typed'; ta.dispatchEvent(new w.Event('input')); $$('.fmtbar .fdone').click(); await sleep(50); eq(V('scene').objects.length, n + 1, 'the new text'); eq(V('hist').length, h0 + 1, 'undo steps for the new text'); near(V('zoom'), zb, 1e-6, 'Done after Add → Text'); w.undo(); await sleep(30); eq(V('scene').objects.length, n, 'Undo of the new text');
          desel(); $$('#mbar [data-m=add]').click(); await sleep(60); item().click(); await sleep(60); $$('.fmtbar .fdone').click(); await sleep(50); eq(V('scene').objects.length, n, 'Add → Text left untouched stayed'); await pause(); }
        // wording: no keyboard in a finger's sentences; the quick row has a way back from a color
        { const say = V('phSay'); eq(say('Replaced 3 (Ctrl+Z undoes it)'), 'Replaced 3 (↶ undoes it)', 'Ctrl+Z'); eq(say('Undo (or Ctrl+Z outside the two fields) undoes a replacement.'), 'Undo undoes a replacement.', 'the Find and replace hint'); eq(say('Attached: the end now follows it (Alt while dragging keeps it free)'), 'Attached: the end now follows it', 'Alt'); V('sel').add('t1'); w.render(); w.buildPanel(); w.phSheet('#props', 'peek'); await sleep(40); const cs = [...d.querySelectorAll('#props .phq button.phsw')].map(b => b.dataset.c); ok(cs.includes('#1f2328') && cs.includes('#ffffff'), 'the quick row has no near-black and white: ' + cs); w.phSheet('#props', 'closed'); desel(); }
        // Export: the sheet button is gone without a sheet; a size past what a phone draws is said and comes out smaller; too large is a message, not a raw error
        { w.exportDialog(); await sleep(50); const b = $$('#modalBox'); eq(w.getComputedStyle(b.querySelector('#exSheet')).display, 'none', 'Give the page the sheet\'s shape without a sheet'); const m = b.querySelector('#exMm'); m.value = '841'; m.dispatchEvent(new w.Event('input', { bubbles: true })); ok(/phones/.test(b.querySelector('#exInfo').textContent), 'no word on a size past what a phone draws: ' + b.querySelector('#exInfo').textContent); w.closeModal();
          const mp = w.makePng, sc = V('scene'); w.makePng = async (W0) => { const H = Math.round(sc.h * W0 / sc.w); if (W0 * H > 16.7e6) throw Object.assign(new Error('too large'), { big: true }); return { bytes: new Uint8Array(1), W: W0, H }; }; try { const r = await w.pngFit(8000, 600, {}); ok(r.less && r.W * r.H <= 16.7e6 && r.W > 4000 && r.dpi < 600, 'pngFit: ' + J([r.W, r.H, r.dpi, r.less])); ok(/this phone/.test(V('pngLess')(r)), 'the message for a smaller PNG'); const r2 = await w.pngFit(800, 300, {}); ok(!r2.less && r2.W === 800 && r2.dpi === 300, 'pngFit at a size that fits'); } finally { w.makePng = mp; }
          const cd = w.canvasDraws; w.canvasDraws = () => false; try { let e = null; try { await w.makePng(200, 72, {}); } catch (x) { e = x; } ok(e && e.big && /too large/.test(e.message), 'a canvas that draws nothing: ' + (e && e.message)); } finally { w.canvasDraws = cd; } ok(w.canvasDraws(w.document.createElement('canvas').getContext('2d'), 800, 600), 'a small canvas draws'); }
        // an app's built-in browser: recognized by its name; a download is not called done; a picture can be pressed and held; a backup does not count
        { [['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29', 1], ['Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0 Mobile Safari/537.36 [LinkedInApp]', 1], ['Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS]', 1], ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 0], ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/118.0 Mobile/15E148 Safari/604.1', 0], ['Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36', 0]].forEach(([ua, v]) => eq(!!V('phInApp')(ua, false), !!v, 'in-app browser? ' + ua)); ok(!V('phInApp')('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', true), 'a Home Screen app is no in-app browser');
          const sOk = V('serverOk'), PH0 = V('PH'); let got = null; const dl = w.download; w.download = (n, b) => { got = [n, b]; }; V('serverOk=false'); PH0.inapp = true; w.navigator.canShare = () => false; try {   // (no file sharing: as in most of these browsers) const m = await w.saveExport('zz-test.png', (await w.makePng(200, 72, {})).bytes, 'image/png', 1); ok(/built-in browser/.test(m) && /<img /.test(m), 'the message in an app\'s browser: ' + short(m)); ok(got && got[0] === 'zz-test.png', 'the download was not tried'); const m2 = await w.saveExport('zz-test.svg', new w.Blob(['<svg/>'], { type: 'image/svg+xml' }), 'image/svg+xml', 1); ok(/built-in browser/.test(m2) && !/<img /.test(m2), 'the message for a file that is no picture');
            if (V('WEB')) { await w.flushSave(true); const b0 = J(V('backupSt')()); await w.webBackup(); await sleep(50); eq(J(V('backupSt')()), b0, 'a backup in an app\'s browser counted as made'); ok(/built-in browser/.test($$('#toast').textContent), 'the backup\'s message in an app\'s browser: ' + $$('#toast').textContent); }
            w.phHello.S = {}; const T = $$('#toast'); T.classList.remove('show'); if (V('WEB')) { w.phHello(); ok(/built-in browser/.test(T.textContent) && T.classList.contains('show'), 'no notice in an app\'s browser: ' + T.textContent); T.classList.remove('show'); } } finally { V('serverOk=' + sOk); PH0.inapp = false; w.download = dl; delete w.navigator.canShare; } }
        // the first-run hint: once, and a press ends it
        { const T = $$('#toast'); w.phHello.S = {}; T.classList.remove('show'); w.phHello(); ok(/Pinch to zoom/.test(T.textContent) && T.classList.contains('show'), 'no first-run hint: ' + T.textContent); eq(w.phHello.S.tip, 1, 'the hint is not remembered'); const s = st.getBoundingClientRect(); ev('pointerdown', s.left + 6, s.top + 6); ok(!T.classList.contains('show'), 'a press did not end the hint'); ev('pointerup', s.left + 6, s.top + 6); if (V('phTouch').fl) V('phTouch').fl(); T.classList.remove('show'); w.phHello(); ok(!T.classList.contains('show'), 'the hint came twice'); await pause(); }
        // Export several figures: a finger's controls; on the website one .zip instead of a chain of downloads (only this frame's figure is listed)
        { await w.flushSave(true); const lf = w.listFiles, dl = w.download; let got = null; w.listFiles = async sc => sc ? lf(sc) : [{ name }]; w.download = (n, b) => { got = [n, b]; }; try { await w.batchExportDialog(); await sleep(120); const row = $$('#bxList .bxrow'); ok(row, 'no figure row'); const cb = row.querySelector('input[type=checkbox]').getBoundingClientRect(), bt = row.querySelector('.ib').getBoundingClientRect(); ok(cb.width >= 23.9 && cb.height >= 23.9, 'the row\'s checkbox: ' + [cb.width, cb.height]); ok(bt.width >= 39.9 && bt.height >= 39.9, 'the row\'s order button: ' + [bt.width, bt.height]); const box = $$('#modalBox'); ok(box.scrollWidth <= box.clientWidth + 1, 'the dialog scrolls sideways');
            if (V('WEB')) { ok(/\.zip/.test($$('#bxNote').textContent), 'the note does not say .zip: ' + $$('#bxNote').textContent); row.querySelector('input[type=checkbox]').checked = true; const F = $$('#bxFmt'); F.value = 'svg'; F.dispatchEvent(new w.Event('input', { bubbles: true })); w.navigator.canShare = () => true; w.navigator.share = async () => {}; $$('#bxGo').click(); ok(await until(() => /\.zip/.test($$('#bxMsg').textContent) && !$$('#bxGo').disabled, 8000), 'no .zip message: ' + $$('#bxMsg').textContent); const bs = [...$$('#bxMsg').querySelectorAll('button')]; ok(bs.some(b => /Share/.test(b.textContent)), 'no Share… for the .zip: ' + $$('#bxMsg').textContent); const dn = bs.find(b => b.textContent === 'Download'); ok(dn, 'no Download for the .zip'); ok(!got, 'it was downloaded before a tap'); dn.click(); ok(got && got[0] === 'figures-svg.zip' && got[1].size > 100, 'the .zip was not offered: ' + J(got && got[0])); const files = await w.unzip(await got[1].arrayBuffer()); eq(files.length, 1, 'files in the .zip'); ok(/\.svg$/.test(files[0].name), 'the file in the .zip: ' + files[0].name); delete w.navigator.canShare; delete w.navigator.share; }
            w.closeModal(); } finally { w.listFiles = lf; w.download = dl; } }
        // an example whose text said what only a desktop has
        { const t = await (await fetch('examples/workflow.json', { cache: 'no-store' })).text(); ok(!/File ▾|drag items/.test(t), 'the workflow example gives desktop instructions'); }
        // the website's example links: Start the example over is there, and a copy that differs from the example says where the way back is
        { const f = await open('&from=examples/workflow.json'); eq(f.eval('EX_ID'), 'workflow', 'the example behind the link'); ok(await until(() => !f.document.querySelector('#fileMenu [data-act=restartex]').hidden, 20000), 'no Start the example over…'); if (f.eval('WEB')) ok(await until(() => /your copy of the example/.test(f.document.querySelector('#toast').textContent), 4000), 'a copy with changes opened without a word: ' + f.document.querySelector('#toast').textContent); }
      } finally {
        if (fr) { try { await fr.contentWindow.flushSave(); } catch (e) {} fr.remove(); fr = null; }
        await sleep(200);
        try { await fetch('api/move?file=' + encodeURIComponent(name) + '&from=&to=trash', { method: 'POST' }); await fetch('api/delete?file=' + encodeURIComponent(name), { method: 'POST' }); } catch (e) {}
        try { localStorage.removeItem('figEditor.scene.v1:' + name); [['fig.phHello', hello0], ['fig.palRecent', recent0]].forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }); } catch (e) {}
      }
    }, 300000);
    // phone layout tests (M3)
    // the editor in frames of a phone's size, on a figure of its own (removed afterwards): ?phone=1 forces the phone layout without saving a setting
    test('phone layout: bars, Add and Style sheets, dialogs, menus and Back at 390 × 844 and 844 × 390; 1400 × 900 and 768 × 1024 keep the desktop layout', async () => {
      if (typeof phModal !== 'function') throw new Skip('this editor has no phone layout');
      const name = String(FILE).replace(/\.json$/i, '') + '-phone.json', keys = ['fig.palRecent', 'fig.palFav', 'fig.palClosed'], ls0 = {};
      keys.forEach(k => { try { ls0[k] = localStorage.getItem(k); } catch (e) {} });   // a tap in the Add sheet records a recently used item (this browser's list is put back)
      let fr = null;
      const until = async (f, ms = 3000) => { const t0 = Date.now(); for (;;) { let v = false; try { v = f(); } catch (e) {} if (v) return true; if (Date.now() - t0 > ms) return false; await sleep(40); } };
      const open = async (q, w, h) => {
        if (fr) fr.remove(); fr = D.createElement('iframe'); fr.title = 'phone layout test'; fr.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;z-index:2147483000;background:#fff`;
        fr.src = location.pathname + '?file=' + encodeURIComponent(name) + q; D.body.appendChild(fr);
        ok(await until(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 60000), 'the editor did not start in a ' + w + ' × ' + h + ' frame');
        const fw = watch(fr.contentWindow); fw.alert = () => {}; fw.confirm = () => true; fw.prompt = () => null; fw.download = () => {}; fw.HTMLAnchorElement.prototype.click = function () {}; fw.onbeforeunload = null;
        try { Object.defineProperty(fw.navigator, 'share', { value: async () => {}, configurable: true }); } catch (e) {}   // never the system's share sheet
        if (fw.applyUIClasses) fw.applyUIClasses(); fw.dispatchEvent(new fw.Event('resize'));   // a hidden tab may start the frame at the default 300 × 150 and, painting no frames, never send the size's media-query change
        await sleep(250); return fw; };
      const resize = async (w, h, f) => { fr.style.width = w + 'px'; fr.style.height = h + 'px';
        if (fr.contentWindow.document.hidden && !await until(f, 1500)) { const fw = fr.contentWindow; if (fw.applyUIClasses) fw.applyUIClasses(); fw.dispatchEvent(new fw.Event('resize')); }   // a tab that paints no frames (hidden) dispatches no media-query change or resize events: the same updates by hand
        ok(await until(f, 20000), 'the layout did not follow a ' + w + ' × ' + h + ' frame'); await sleep(350); };
      const rect = (d, s) => d.querySelector(s).getBoundingClientRect(), shown = (w, el) => !!el && w.getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
      // what every phone size must give: a usable canvas, no sideways page scroll, one top row, the toolbar, Add and Style sheets, dialogs that fit, menus as sheets, Back
      const phoneChecks = async (w, land) => {
        const d = w.document, $$ = s => d.querySelector(s), W = w.innerWidth, H = w.innerHeight, at = ' (' + W + ' × ' + H + ')', V = s => w.eval(s);   // V: the frame's let / const globals (scene, sel, get) are no window properties
        ok(d.documentElement.classList.contains('phone') && d.documentElement.classList.contains('ph-land') === land, 'html.phone' + (land ? ' and ph-land' : '') + ' expected' + at + ': ' + d.documentElement.className);
        const st = rect(d, '#stage'); ok(st.width > 300, 'canvas only ' + Math.round(st.width) + ' px wide' + at); if (land) ok(st.height > 280, 'canvas only ' + Math.round(st.height) + ' px high' + at);
        ok(d.documentElement.scrollWidth <= W && d.body.scrollWidth <= W, 'the page scrolls sideways' + at + ': ' + d.documentElement.scrollWidth);
        ok(rect(d, 'body>header').height <= 56, 'the top bar is ' + Math.round(rect(d, 'body>header').height) + ' px high' + at);
        const mb = rect(d, '#mbar'); ok(shown(w, $$('#mbar')) && mb.width >= 44 && mb.height >= 44 && mb.right <= W + 1 && mb.bottom <= H + 1, 'the toolbar is not visible' + at);
        // Add: a tap on an item adds it in the middle of the view, selects it and closes the sheet
        $$('#mbar [data-m=add]').click(); ok(await until(() => $$('#left').dataset.ph === 'full'), 'Add did not open its sheet' + at);
        ok(parseFloat(w.getComputedStyle($$('#palSearch')).fontSize) >= 16, 'the Add search field is under 16 px (iOS zooms the page)' + at);
        const it = [...d.querySelectorAll('#palList .pitem')].find(b => /\|Rectangle\|shape/.test(b.dataset.key)); ok(it, 'no Rectangle in the Add sheet'); ok(!it.draggable, 'Add items stay draggable on a phone');
        const n0 = V('scene').objects.length; it.click(); await sleep(350);
        const objs = V('scene').objects; eq(objs.length, n0 + 1, 'a tap added nothing' + at); const o = objs[objs.length - 1];
        ok(V('sel').size === 1 && V('sel').has(o.id), 'the new element is not selected' + at); ok(!$$('#left').dataset.ph, 'the Add sheet stayed open' + at);
        const er = d.querySelector(`#content [data-id="${o.id}"]`).getBoundingClientRect(), cx = er.left + er.width / 2, cy = er.top + er.height / 2, s2 = rect(d, '#stage');
        ok(cx > s2.left && cx < s2.right && cy > s2.top && cy < s2.bottom, 'the new element is outside the visible canvas' + at);
        // Style: the properties sheet peeks (upright: the canvas gives it a row, --ph-sheet; sideways: a column, --ph-side), with the quick row; ✕ closes it and the canvas gets its room back
        const v = land ? '--ph-side' : '--ph-sheet', sz0 = land ? s2.width : s2.height;
        $$('#mbar [data-m=style]').click(); ok(await until(() => $$('#props').dataset.ph === 'peek'), 'Style did not open the properties' + at); await sleep(350);
        ok(d.documentElement.style.getPropertyValue(v), v + ' not set by the open properties' + at); const s3 = rect(d, '#stage');
        ok((land ? s3.width : s3.height) < sz0 - 100, 'the canvas did not make room for the properties' + at);
        ok([...$$('#props').querySelectorAll('input,select,textarea')].filter(i => !/^(checkbox|radio|range|color|file)$/.test(i.type) && i.getClientRects().length).every(i => parseFloat(w.getComputedStyle(i).fontSize) >= 16), 'a properties field is under 16 px' + at);
        const sw = [...$$('#props').querySelectorAll('.phq button.phsw')].find(b => b.dataset.c !== String(o.fill).toLowerCase()); ok(sw, 'no color dots on top of the properties' + at);
        const f0 = o.fill; sw.click(); eq(String(o.fill).toLowerCase(), sw.dataset.c, 'a color dot did not color the element' + at); w.undo(); eq(V('get')(o.id).fill, f0, 'undo after a color dot' + at);
        $$('#props .sgx').click(); ok(await until(() => !$$('#props').dataset.ph && !d.documentElement.style.getPropertyValue(v)), 'closing the properties left ' + v + at);
        // dialogs fill the screen at most, with a ✕ that closes them; their fields are 16 px
        w.exportDialog(); await sleep(250); let b = rect(d, '#modalBox'); ok(b.width <= W + 1 && b.height <= H + 1 && b.left >= -1 && b.top >= -1, 'the Export dialog is larger than the screen' + at + ': ' + Math.round(b.width) + ' × ' + Math.round(b.height));
        ok([...d.querySelectorAll('#modalBox input,#modalBox select')].filter(i => !/^(checkbox|radio|range|color|file)$/.test(i.type) && i.getClientRects().length).every(i => parseFloat(w.getComputedStyle(i).fontSize) >= 16), 'an Export field is under 16 px' + at);
        ok($$('#modalBox .phfoot #exGo'), 'the Export button is not kept at the bottom' + at); ok(shown(w, $$('#modalBox h2 .mx')), 'the Export dialog has no ✕' + at);
        $$('#modalBox h2 .mx').click(); ok($$('#modal').hidden, '✕ did not close the Export dialog' + at); ok(await until(() => !(w.history.state && w.history.state.ph) && !w.eval('PH').backing, 10000), 'the Export dialog left its Back entry' + at);
        w.helpDialog(); await sleep(250); b = rect(d, '#modalBox'); ok(b.height <= H + 1 && b.width <= W + 1, 'Help is larger than the screen' + at); ok(/Tap/.test($$('#modalBox table').textContent) && $$('#modalBox details'), 'Help does not start with the touch table' + at);
        $$('#modalBox h2 .mx').click(); ok($$('#modal').hidden, '✕ did not close Help' + at); ok(await until(() => !(w.history.state && w.history.state.ph) && !w.eval('PH').backing, 10000), 'Help left its Back entry' + at);   // (its Back entry is taken off)
        // Back closes the top layer only: a menu (an action sheet) over the Add sheet, then the sheet
        $$('#mbar [data-m=add]').click(); ok(await until(() => $$('#left').dataset.ph === 'full'), 'Add did not open its sheet again' + at);
        w.showMenu([{ t: 'One', f: () => {} }, { t: 'Two', f: () => {} }], 0, 0); await sleep(60); const cm = $$('#ctxMenu');
        ok(cm.classList.contains('open') && cm.classList.contains('sheet'), 'a menu is not an action sheet' + at);
        ok(w.history.state && w.history.state.ph, 'the menu has no Back entry' + at); w.history.back();
        ok(await until(() => !cm.classList.contains('open')), 'Back did not close the menu' + at); await sleep(150); eq($$('#left').dataset.ph, 'full', 'Back closed the sheet under the menu too' + at);
        ok(w.history.state && w.history.state.ph, 'the sheet has no Back entry' + at); w.history.back(); ok(await until(() => !$$('#left').dataset.ph), 'Back did not close the Add sheet' + at);
        V('sel').clear(); w.render(); w.buildPanel(); await sleep(150); };
      try {
        let w = await open('&phone=1', 390, 844); await phoneChecks(w, false);
        await resize(844, 390, () => w.document.documentElement.classList.contains('ph-land')); await phoneChecks(w, true);   // turned sideways: the toolbar becomes a rail on the right
        // a desktop and a tablet: the phone layout stays off (automatic), the side panels are grid columns, the header is the desktop one
        let ui = {}; try { ui = JSON.parse(localStorage.getItem('fig.ui') || '{}') || {}; } catch (e) {}
        w = await open(ui.phone === 'on' || ui.phone === 'off' ? '&phone=0' : '', 1400, 900);
        const deskChecks = (w, what) => { const d = w.document, cs = w.getComputedStyle(d.body), cols = cs.gridTemplateColumns.split(' ').map(parseFloat), lw = parseFloat(cs.getPropertyValue('--lw')), rw = parseFloat(cs.getPropertyValue('--rw'));
          ok(!d.documentElement.classList.contains('phone'), what + ': the phone layout is on'); ok(['#mbar', '#bMore', '#zoomChip'].every(s => !shown(w, d.querySelector(s))), what + ': phone controls are shown');
          eq(cols.length, 3, what + ': grid columns ' + cs.gridTemplateColumns); near(cols.reduce((a, x) => a + x, 0), w.innerWidth, 2, what + ': the columns fill the window');
          ok(cols.some(x => Math.abs(x - lw) < 1) && cols.some(x => Math.abs(x - rw) < 1), what + ': side columns ' + cs.gridTemplateColumns + ' are not --lw ' + lw + ' / --rw ' + rw);
          ['#left', '#props'].forEach(s => { const e = d.querySelector(s); ok(w.getComputedStyle(e).position !== 'fixed' && shown(w, e) && e.getBoundingClientRect().height > 300, what + ': ' + s + ' is not a side panel'); });
          const hh = rect(d, 'body>header').height; near(parseFloat(cs.gridTemplateRows), hh, 1, what + ': header row'); ok(hh < 130, what + ': header ' + Math.round(hh) + ' px high');
          if (!d.documentElement.classList.contains('hwrap')) near(hh, parseFloat(cs.getPropertyValue('--hh')), 1, what + ': header height'); };   // one row: the desktop height (a wrapped header is as high as its rows)
        deskChecks(w, '1400 × 900');
        await resize(768, 1024, () => w.innerWidth === 768); deskChecks(w, '768 × 1024');
      } finally {
        if (fr) { try { await fr.contentWindow.flushSave(); } catch (e) {} fr.remove(); fr = null; }
        await sleep(200);   // the scratch figure: to the trash, then out of it (its history goes with it); this page's fetch, so the web version's storage too
        try { await fetch('api/move?file=' + encodeURIComponent(name) + '&from=&to=trash', { method: 'POST' }); await fetch('api/delete?file=' + encodeURIComponent(name), { method: 'POST' }); } catch (e) {}
        try { localStorage.removeItem('figEditor.scene.v1:' + name); } catch (e) {}
        keys.forEach(k => { try { if (ls0[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, ls0[k]); } catch (e) {} });
      }
    }, 300000);
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
