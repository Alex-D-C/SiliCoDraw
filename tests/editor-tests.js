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
//           base: 'http://localhost:8770/tests/' (the folder of this file, for the test icon pack in icon-pack-test/; found by itself in /tests/ or /release/tests/),
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
    test('icons: environmental microbiology (its group, both colors used, inside the box, found by a microbial ecologist\'s words)', () => {
      const own = ('dinoflagellate coccolithophore microalga actinomycete magnetotactic methanogen spores microbialmat floc consortium syntrophy rootnodule lichen algalbloom marinesnow virallysis cablebacteria ' +
        'soilprofile rhizosphere sediment watercolumn lake estuary openocean hotspring ricepaddy peatbog compost landfill aquifer cave saltpond acidmine plastisphere oilspill ' +
        'nitrogencycle sulfurcycle phosphoruscycle ironcycle nitrification denitrification anammox nitrogenfixation methanogenesis methaneoxidation sulfatereduction photoresp decomposition bioremediation biodegradation eutrophication ghgflux redoxtower ' +
        'wwtp activatedsludge digester tricklingfilter chemostat constructedwetland pipebiofilm ' +
        'sedimentcorer ctdrosette planktonnet samplebottle filtrationunit membranefilter winogradsky anaerobicjar spreadplate mpntubes microcosm mesocosm sip amplicon16s metagenome magbinning fishmicroscopy samplingsite fieldstation fluxchamber microsensor').split(' ');
      const gi = ICON_GROUPS.findIndex(g => g[0] === 'Environmental microbiology'); ok(gi > 0, 'no group "Environmental microbiology"'); eq(ICON_GROUPS[gi - 1][0], 'Ecology & agriculture', 'the group comes after');
      const inGroup = new Set(ICON_GROUPS[gi][1]), gone = own.filter(k => !ICONS[k] || !inGroup.has(k)); ok(!gone.length, 'not defined or not in the group: ' + gone.join(', ')); eq(inGroup.size, ICON_GROUPS[gi][1].length, 'an icon is listed twice in the group');
      const host = D.createElementNS('http://www.w3.org/2000/svg', 'svg'); host.setAttribute('style', 'position:absolute;left:-9999px;top:0;width:200px;height:200px'); D.body.appendChild(host);
      const bad = [];
      try { for (const k of own) { const ic = ICONS[k], d = (a, b) => ic.d(a, b, '#444444');
        if (d('#ff0000', '#6f86c8') === d('#00ff00', '#6f86c8')) bad.push(k + ' (the main color changes nothing)'); if (d('#e8eef9', '#ff0000') === d('#e8eef9', '#00ff00')) bad.push(k + ' (the accent color changes nothing)');
        if (!/\S/.test(ic.t || '') || ic.c.length !== 2) bad.push(k + ' (no search words or not two colors)');
        const g = D.createElementNS('http://www.w3.org/2000/svg', 'g'); g.innerHTML = iconBody(ic, ic.c[0], ic.c[1]); host.appendChild(g); const b = g.getBBox(); g.remove();
        if (b.x < -58 || b.y < -58 || b.x + b.width > 58 || b.y + b.height > 58 || Math.max(b.width, b.height) < 70) bad.push(k + ' (drawn bounds ' + [b.x, b.y, b.width, b.height].map(Math.round).join(' ') + ')'); } } finally { host.remove(); }
      ok(!bad.length, bad.length + ' icons: ' + bad.slice(0, 8).join('; '));
      const first = { dinoflagellate: 'dinoflagellate', anammox: 'anammox', winogradsky: 'winogradsky', methanotroph: 'methaneoxidation', paddy: 'ricepaddy', peat: 'peatbog', sewage: 'wwtp', mpn: 'mpntubes', oxycline: 'watercolumn', saltern: 'saltpond', sulphur: 'sulfurcycle', streptomyces: 'actinomycete', aquifer: 'aquifer', metagenome: 'metagenome' };
      for (const w in first) eq((fig.findIcon(w, 1)[0] || {}).kind, first[w], 'the first icon found for "' + w + '"');
      const among = { ciliate: 'paramecium', niskin: 'ctdrosette', microbe: 'bacterium', nmds: 'pca', biofilm: 'pipebiofilm', nodule: 'rootnodule', thermophile: 'hotspring', '16s': 'amplicon16s', coliform: 'membranefilter' };   // words added to icons that were there, and new icons beside old ones
      for (const w in among) ok(fig.findIcon(w, 6).some(x => x.kind === among[w]), '"' + w + '" does not find ' + among[w] + ': ' + fig.findIcon(w, 6).map(x => x.kind).join(', '));
      eq(fig.findIcon('methanogen', 1)[0].group, 'Environmental microbiology', 'the group of a new icon');
      // words whose first icon the new ones must not take ("fate" is inside Sulfate, "aerobic" inside Anaerobic, "treatment" a search word of the wastewater plant), and a typed word that is a whole word of a name
      const still = { microscopy: 'microscope', treatment: 'syringe', fate: 'differentiation', copy: 'line1', aerobic: 'vo2max', film: 'biofilm', glia: 'microglia', fluorescence: 'immunofluorescence', myocyte: 'cardiomyocyte', plastic: 'microplastics', mouse: 'mouse', brain: 'brain', bra: 'brain', rna: 'rna', well: 'wellplate',
        mat: 'microbialmat', mag: 'magbinning', station: 'fieldstation', 'enrichment culture': 'winogradsky', 'water well': 'aquifer' };
      for (const w in still) eq((fig.findIcon(w, 1)[0] || {}).kind, still[w], 'the first icon found for "' + w + '"');
      ok(fig.findIcon('well', 3).some(x => x.kind === 'aquifer'), '"well" does not list the aquifer and well among the first three');
      // a compound's name drawn in an icon sits on a light pill, so it reads on a dark page too (bare dark text was under 3:1 there)
      const bare = 'landfill peatbog methanogen activatedsludge sip amplicon16s winogradsky decomposition syntrophy rootnodule biodegradation microbialmat'.split(' ').filter(k => { const s = iconBody(ICONS[k], ICONS[k].c[0], ICONS[k].c[1]), n = (s.match(/<text/g) || []).length; return !n || (s.match(/<rect[^>]*>\s*<text/g) || []).length !== n; });
      ok(!bare.length, 'a label without its pill: ' + bare.join(', '));
    });
    test('icons: a user\'s own icon named like a built-in one (a "Lake" saved before the library had a lake) keeps its drawing under a free key', async () => {
      const built = k => ICONS[k].d('#111111', '#222222', '#444444'), lake0 = built('lake'), cave0 = built('cave');
      const def = c => ({ n: 'My own', t: 'own', svg: '<rect x="-40" y="-40" width="80" height="80" fill="' + c + '"/>', k: [c, '#000000'], c: [c, '#000000'] });
      const figure = () => ({ version: 4, w: 400, h: 300, bg: '#ffffff', palette: [], icons: { lake: def('#123456') }, objects: [{ id: 'u1', type: 'icon', kind: 'lake', x: 200, y: 150, s: 1, r: 0, size: 80 }, { id: 'u2', type: 'icon', kind: 'cell', x: 80, y: 150, s: 1, r: 0, size: 60 }] });
      const mine = [];
      try {
        fig.set(figure()); await settle();
        const nk = fig.get().objects[0].kind; mine.push(nk);
        ok(/^lake\d+$/.test(nk), 'the element kept the kind "' + nk + '"'); ok(!ICONS.lake.user, 'the built-in lake was replaced'); eq(built('lake'), lake0, 'the built-in lake draws something else');
        ok(ICONS[nk] && ICONS[nk].user, 'the user icon is not registered as ' + nk); ok(USER[nk] && !USER.lake, 'My icons: ' + Object.keys(USER).join(', '));
        ok((await svgString({})).includes('#123456'), 'the figure does not draw the user\'s own icon');
        const ic = fig.get().icons || {}; ok(ic[nk] && !ic.lake, 'the figure embeds ' + Object.keys(ic).join(', ')); eq(fig.get().objects[1].kind, 'cell', 'another icon');
        fig.set(figure()); await settle(); eq(fig.get().objects[0].kind, nk, 'opened again: the same key');
        USER.cave = def('#654321'); await loadUserIcons();   // the library file (assets/my-icons.json) of an earlier version
        const ck = Object.keys(USER).find(k => /^cave\d+$/.test(k)); if (ck) mine.push(ck);
        ok(ck && !USER.cave, 'the library kept the key cave: ' + Object.keys(USER).join(', ')); ok(!ICONS.cave.user, 'the built-in cave was replaced'); eq(built('cave'), cave0, 'the built-in cave draws something else');
        ok(ck && ICONS[ck].user && ICONS[ck].def.svg.includes('#654321'), 'the library icon is not registered under its new key');
        await loadUserIcons(); ok(!ICONS.lake.user && !ICONS.cave.user && !USER.lake && !USER.cave, 'loaded again: a built-in icon was replaced');
        registerIcon('lake', def('#ff0000')); ok(!ICONS.lake.user, 'registerIcon replaced a built-in icon');
      } finally {
        fig.set({ version: 4, w: 400, h: 300, bg: '#ffffff', palette: [], objects: [] }); await settle();
        for (const k of mine) if (USER[k]) removeUserIcon(k);
        await sleep(300);
      }
      ok(ICONS.lake && ICONS.cave && !mine.some(k => ICONS[k]), 'after removing them from My icons');
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
        // the animation sidebar is a sheet: as wide as the screen upright, a column beside the toolbar sideways; closed again, nothing of it is left (open or closed is put back as this browser had it)
        if (typeof w.fig.animPane === 'function') { let p0 = null; try { p0 = w.localStorage.getItem('fig.animPane'); } catch (e) {}
          try { w.fig.animPane(true); await sleep(80); const r = rect(d, '#animbar'); ok(shown(w, $$('#animbar')) && r.height > 150 && r.bottom <= H + 1 && r.right <= W + 1 && (land ? r.width >= 240 && r.left > 0 : Math.abs(r.left) < 1 && Math.abs(r.width - W) < 2), 'the animation sheet' + at + ': ' + [r.left, r.top, r.width, r.height].map(Math.round)); ok(shown(w, $$('#abPlay')) && shown(w, $$('.abgal .abfx')), 'with its playback and gallery' + at);
            { const st = rect(d, '#stage'); ok(land ? st.right <= r.left + 2 && st.width > 150 : st.bottom <= r.top + 2 && st.height > 120, 'the canvas keeps the room the sheet leaves, so the slide is in sight' + at + ': ' + [st.left, st.top, st.width, st.height].map(Math.round)); } }
          finally { w.fig.animPane(false); try { if (p0) w.localStorage.setItem('fig.animPane', p0); else w.localStorage.removeItem('fig.animPane'); } catch (e) {} } ok(!shown(w, $$('#animbar')), 'the animation sheet closes' + at); }
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
    // ---------- slides (a figure file with several slides) ----------
    // every slides test leaves a plain figure behind (the other tests start from blank(), which replaces the slide shown)
    const unslide = () => { try { sel = new Set(); if (typeof animStop === 'function') animStop(); for (let g = 0; g < 99 && isDeck(scene) && scene.slides.length > 1; g++) { const n = scene.slides.length; fig.removeSlide(n); if (scene.slides.length === n) break; } if (isDeck(scene)) { const o = scene.objects; delete scene.objects; delete scene.slides; scene.objects = o; slideFix(); commit(); } } catch (e) {} };
    const three = async () => { unslide(); blank(); fig.add('text', { id: 'tA', x: 200, y: 200, text: 'One' });
      const b = fig.addSlide({ name: 'Two', notes: 'Notes for two' }); fig.add('text', { id: 'tA', x: 300, y: 300, text: 'Two' });   // the same element id on another slide
      const c = fig.addSlide({ name: 'Three', objects: [{ id: 'x1', type: 'box', x: 400, y: 400 }, { id: 'x2', type: 'formula', x: 800, y: 300, tex: 'E = mc^2' }] }); await settle(); return [scene.slides[0].id, b, c]; };
    const hasSlides = typeof isDeck === 'function' && typeof fig.addSlide === 'function';
    test('slides: add, switch, the strip, PageUp and PageDown, reorder, duplicate, rename, remove', async () => {
      if (!hasSlides) throw new Skip('this editor has no slides');
      try {
        blank(); fig.add('text', { id: 'tA', x: 200, y: 200, text: 'One' }); await settle(); const keys0 = Object.keys(scene);
        ok(!isDeck(scene), 'a plain figure to start with'); eq(fig.slides().length, 1, 'a plain figure is its one slide'); ok(D.querySelector('#slides').hidden, 'no strip for a plain figure');
        const [a, b, c] = await three();
        ok(isDeck(scene), 'the figure has slides'); eq(scene.slides.length, 3, 'slides'); eq(CUR, 2, 'the new slide is shown'); eq(scene.objects.length, 2, 'the slide shown has its own elements');
        const P = JSON.parse(J(scene)); ok(!('objects' in P) && Array.isArray(P.slides), 'the text has slides and no top-level objects'); eq([P.w, P.h, P.bg], [1600, 900, '#ffffff'], 'one page for the file');
        eq(fig.slides().map(s => [s.n, s.name, s.current]), [[1, '', false], [2, 'Two', false], [3, 'Three', true]], 'fig.slides');
        eq(fig.slide(1).n, 1, 'fig.slide(n)'); eq(get('tA').text, 'One', 'slide 1 shows its own element'); eq(fig.slide(b).name, 'Two', 'fig.slide(id)'); eq(get('tA').text, 'Two', 'slide 2 its own, under the same id');
        eq(fig.get().objects.length, 1, 'fig.get is the slide shown'); ok(!('slides' in fig.get()), 'as a plain figure'); eq(fig.get({ slides: true }).slides.length, 3, 'fig.get({slides: true}) is the file');
        eq(fig.list().length, 1, 'fig.list is the slide shown'); ok(fig.slides()[1].notes === 'Notes for two', 'notes');
        // the file text: one element per line, each slide starting a line
        const lines = figLines(lastSaved); eq(lines.replace(/\n/g, ''), lastSaved, 'the file text is the state plus line breaks');
        ok(lines.split('\n').some(l => l.startsWith('{"id":' + J(b))), 'each slide starts a line'); ok(lines.split('\n').filter(l => /^\{"id":"(tA|x1|x2)"/.test(l)).length === 4, 'one element per line');
        // the strip
        await sleep(400); ok(!D.querySelector('#slides').hidden && D.documentElement.classList.contains('has-slides'), 'the strip shows');
        const its = () => [...D.querySelectorAll('#slList .sl')]; eq(its().length, 3, 'a thumbnail per slide'); eq(D.querySelector('#slList .sl.on').dataset.id, b, 'the slide shown is marked');
        ok(its().every(i => i.querySelector('.slt').shadowRoot.querySelector('svg')), 'the thumbnails are drawn'); eq(its()[1].querySelector('.slnm').textContent, 'Two', 'its name');
        // the Slides dialog (what phones have in place of the strip) and the phone toolbar's button
        slidesDialog(); eq(D.querySelectorAll('#modalBox .sdrow').length, 3, 'the Slides dialog lists them'); ok(D.querySelector('.sdrow.on .sdt').shadowRoot.querySelector('svg'), 'with thumbnails');
        D.querySelectorAll('#modalBox .sdrow')[0].click(); eq(CUR, 0, 'a tap shows that slide'); ok(!D.querySelector('#modal').hidden && D.querySelector('.sdrow.on').dataset.i === '0', 'the dialog follows');
        D.querySelector('#sdDown').click(); eq([CUR, scene.slides[1].id], [1, a], 'Move down'); D.querySelector('#sdUp').click(); eq([CUR, scene.slides[0].id], [0, a], 'Move up'); D.querySelector('#sdClose').click(); ok(D.querySelector('#modal').hidden, 'closed');
        ok(!D.querySelector('#mbar [data-m=slides]').hidden, 'the phone toolbar has Slides');
        its()[2].click(); eq(CUR, 2, 'a click on a thumbnail shows that slide'); eq(sel.size, 0, 'nothing selected on the new slide');
        const key = k => D.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        key('PageUp'); eq(CUR, 1, 'PageUp'); key('PageDown'); eq(CUR, 2, 'PageDown'); key('PageDown'); eq(CUR, 2, 'PageDown on the last slide');
        // the selection and a text being typed never travel to another slide
        fig.slide(1); fig.select(['tA']); eq(sel.size, 1, 'selected'); fig.slide(2); eq(sel.size, 0, 'the selection stays behind');
        if (typeof editText === 'function') { fig.slide(1); editText(get('tA')); ok(editor && editor.ta, 'typing in place'); editor.ta.value = 'typed'; editor.ta.dispatchEvent(new Event('input', { bubbles: true })); fig.slide(2); ok(!editor, 'the typing ends'); eq([scene.slides[0].objects.find(o => o.id === 'tA').text, get('tA').text], ['typed', 'Two'], 'and stays on its slide'); fig.slide(1); fig.update('tA', { text: 'One' }); fig.slide(2); }
        // reorder, duplicate, rename, remove
        const before = lastSaved; fig.moveSlide(c, 1); eq(fig.slides().map(s => s.name), ['Three', '', 'Two'], 'moved first'); eq(fig.slide().name, 'Two', 'the slide shown stays shown'); undo(); eq(lastSaved, before, 'undo of the move');
        fig.slide(1); const d = fig.duplicateSlide(); eq(scene.slides.length, 4, 'duplicate'); eq([CUR, scene.slides[1].id], [1, d], 'the copy follows and is shown'); eq(J(scene.slides[1].objects), J(scene.slides[0].objects), 'the same elements');
        eq(fig.updateSlide(d, { name: 'Copy', notes: 'said' }).name, 'Copy', 'rename'); eq(Object.keys(scene.slides[1]).pop(), 'objects', 'the elements stay the slide\'s last key');
        fig.removeSlide(d); eq(scene.slides.length, 3, 'removed'); eq(CUR, 1, 'the next slide is shown');
        const th = f => { try { f(); return false; } catch (e) { return true; } }; ok(th(() => fig.slide(9)), 'fig.slide of a missing slide'); ok(th(() => fig.removeSlide('nope')), 'fig.removeSlide of a missing slide'); ok(th(() => fig.moveSlide(1, 7)), 'fig.moveSlide out of range');
        // the comments and the checks: per slide, and all at once
        fig.slide(3); fig.add('comment', { x: 420, y: 380, text: 'fix this', on: 'x1' }); eq(fig.comments().length, 1, 'comments of the slide shown'); fig.slide(1); eq(fig.comments().length, 0, 'none on slide 1');
        eq(fig.comments({ slides: true }).map(x => [x.slide, x.text, x.on]), [[3, 'fix this', 'x1']], 'fig.comments({slides: true})');
        fig.add('text', { id: 'far', x: -900, y: -900, text: 'off' }); const ck = fig.check({ slides: true }); ok(ck.some(m => m.slide === 1 && m.id === 'far' && /outside the page/.test(m.msg)), 'fig.check({slides: true}) names the slide'); eq(CUR, 0, 'and comes back to the slide shown');
        // down to one slide: a plain figure again
        fig.removeSlide(3); fig.removeSlide(2); ok(!isDeck(scene) && Array.isArray(JSON.parse(lastSaved).objects) && !('slides' in JSON.parse(lastSaved)), 'one slide left: a plain figure'); eq(get('tA').text, 'One', 'its elements');
        ok(th(() => fig.removeSlide(1)), 'the last slide stays'); await sleep(60); ok(D.querySelector('#slides').hidden, 'the strip is gone'); eq(Object.keys(scene).filter(k => !keys0.includes(k)), [], 'no new keys in a plain figure');
        undo(); ok(isDeck(scene) && scene.slides.length === 2, 'undo brings the slide back');
      } finally { unslide(); }
    });
    test('slides: undo and redo across slides, packed steps', async () => {
      if (!hasSlides) throw new Skip('this editor has no slides');
      try {
        const [a, b, c] = await three(); fig.slide(1); fig.update('tA', { text: 'One!' }); fig.slide(3); const s = J(scene);
        undo(); await settle(); eq([CUR, get('tA').text], [0, 'One'], 'undo shows the slide that changed'); redo(); await settle(); eq(CUR, 0, 'redo too'); eq(J(scene), s, 'and gives the same file');
        fig.slide(2); const n = scene.slides.length, t0 = lastSaved; const e = fig.addSlide({ name: 'Extra' }); eq(CUR, 2, 'added after the slide shown'); undo(); eq([scene.slides.length, CUR, lastSaved === t0], [n, 1, true], 'undo of a new slide: back on the one before');
        redo(); eq([scene.slides.length, fig.slide().id], [n + 1, e], 'redo shows it again'); undo();
        fig.slide(1); fig.removeSlide(3); eq(scene.slides.length, n - 1, 'removed'); undo(); eq([scene.slides.length, CUR], [n, 2], 'undo of a removal shows the slide that is back');
        // each step exactly, switching slides in between (a switch is no step)
        fig.slide(1); await settle(); const st = [J(scene)]; fig.add('box', { x: 300, y: 300 }); await settle(); st.push(J(scene)); fig.slide(2); fig.update('tA', { size: 30 }); await settle(); st.push(J(scene));
        fig.slide(3); fig.remove('x1'); await settle(); st.push(J(scene)); fig.moveSlide(3, 1); await settle(); st.push(J(scene));
        const h = hist.length; fig.slide(2); fig.slide(3); await settle(); eq(hist.length, h, 'switching slides is no undo step');
        for (let i = st.length - 2; i >= 0; i--) { undo(); await settle(); eq(J(scene), st[i], 'undo to step ' + i); } for (let i = 1; i < st.length; i++) { redo(); await settle(); eq(J(scene), st[i], 'redo to step ' + i); }
        // a big file: the steps stay packed, per slide
        const objs = p => { const o = []; for (let i = 0; i < 400; i++) o.push({ id: 'k' + i, type: i % 3 ? 'text' : 'box', x: 40 + (i % 30) * 50, y: 40 + Math.floor(i / 30) * 40, text: p + ' ' + i }); return o; };
        fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], slides: [{ id: 'a', name: 'A', objects: objs('A') }, { id: 'b', objects: objs('B') }] }); await settle();
        eq([isDeck(scene), scene.slides.length], [true, 2], 'fig.set of a file with slides'); fig.slide(1); await settle();
        // a slide drawn for the first time gets its elements' defaults filled in: no undo step, nothing to save
        const hs = hist.length, ls = lastSaved; fig.slide(2); await settle(); fig.slide(1); fig.slide(2); fig.slide(1); await settle(); eq([hist.length, lastSaved === ls, isClean()], [hs, true, true], 'looking at a slide is no change');
        fig.update('k0', { x: 41 }); await settle(); const big = [J(scene)]; ok(big[0].length > 5e4, 'big enough to be packed');
        fig.update('k1', { text: 'changed "quoted" \\ text' }); big.push(J(scene)); fig.slide(2); fig.remove('k5'); big.push(J(scene)); fig.update('k1', { x: 999 }); big.push(J(scene)); await settle();
        ok((hist.raw || []).slice(-3).every(v => v && typeof v === 'object' && v.d), 'the steps are kept packed, slide by slide');
        for (let i = big.length - 2; i >= 0; i--) { undo(); await settle(); eq(J(scene), big[i], 'big: undo to step ' + i); } for (let i = 1; i < big.length; i++) { redo(); await settle(); eq(J(scene), big[i], 'big: redo to step ' + i); }
        // fig.set of a plain figure on a file with slides replaces the slide shown; fig.batch over slides is one step
        fig.slide(2); const g = fig.get(); g.objects = g.objects.slice(0, 3); fig.set(g); eq([scene.slides.length, scene.objects.length, scene.slides[0].objects.length], [2, 3, 400], 'fig.set(plain) replaces the slide shown only');
        commit(); const pre = lastSaved, h0 = hist.length; fig.batch(() => { fig.addSlide({ name: 'In batch' }); fig.add('chip', { x: 100, y: 100 }); fig.slide(1); fig.add('chip', { x: 200, y: 100 }); });
        ok(h0 >= 300 || hist.length - h0 === 1, 'fig.batch over two slides is one step'); undo(); eq(lastSaved, pre, 'and one undo');
      } finally { unslide(); }
    });
    test('slides: saved one element per line; a file edited outside while a slide is open; merged with an unsaved change', async () => {
      if (!hasSlides) throw new Skip('this editor has no slides');
      if (typeof pollOnce !== 'function' || !FILE_SYNC) throw new Skip('no figure file here');
      try {
        const [a, b, c] = await three(); fig.slide(2); commit(); await settle(); await flushSave(); await sleep(100); await flushSave();
        const rd = async () => { const r = await fetch(FILE, { cache: 'no-store' }); ok(r.ok, 'reading the file: HTTP ' + r.status); return r.text(); }, wr = async F => { const r = await fetch(FILE, { method: 'POST', body: typeof F === 'string' ? F : J(F) }); ok(r.ok, 'writing the file: HTTP ' + r.status); };
        const settled = async () => { ok(await waitFor(() => !pushBusy && fileSame() && D.querySelector('#status').textContent === 'Saved', 8000), 'not saved again'); };
        let t = await rd(); eq(t.replace(/\n/g, ''), lastSaved, 'the file is the saved state'); ok(t.split('\n').length >= 3 + 4, 'one element per line, slide by slide'); eq(J(healScene(JSON.parse(t))), J(scene), 'the file, loaded again, is the same');
        // 1. nothing unsaved here: taken as it is; the tab stays on its slide
        let F = JSON.parse(t); F.slides[0].objects.find(o => o.id === 'tA').text = 'One, edited outside'; F.slides[1].objects.push({ id: 'new1', type: 'text', x: 500, y: 600, text: 'Added outside' });
        F.slides.push({ id: 'zz', name: 'From the file', notes: 'n', objects: [{ id: 'tA', type: 'text', x: 100, y: 100, text: 'Four' }] }); await wr(F); await pollOnce();
        ok(await waitFor(() => !!get('new1'), 6000), 'the edit of the slide shown did not arrive'); eq([CUR, fig.slide().id], [1, b], 'the tab stays on its slide'); eq(scene.slides.length, 4, 'the new slide'); eq(scene.slides[0].objects.find(o => o.id === 'tA').text, 'One, edited outside', 'another slide\'s edit');
        if (chgSay.last) { eq(chgSay.last.added, ['new1'], 'what changed on this slide'); eq(chgSay.last.slides, [a, 'zz'], 'the other slides that changed'); }
        await sleep(350); eq(D.querySelectorAll('#slList .sl').length, 4, 'the strip follows'); await settled();
        // 2. an unsaved change here, and the file reordered, edited and one slide removed meanwhile: merged slide by slide
        F = JSON.parse(await rd()); F.slides[1].objects.find(o => o.id === 'new1').text = 'Outside again'; F.slides = [F.slides[3], F.slides[1], F.slides[0]];   // slide "Three" (c) is gone, the order is new
        clearTimeout(pushTimer); get('tA').size = 77; commit(); clearTimeout(pushTimer);   // this tab's change to slide 2, not yet written
        await wr(F); pushFile(); ok(await waitFor(() => get('new1') && get('new1').text === 'Outside again', 8000), 'the outside change was not merged in'); await settled();
        eq(get('tA').size, 77, 'this tab\'s change is kept'); eq(scene.slides.map(s => s.id), ['zz', b, a], 'the file\'s order and removal'); eq([CUR, fig.slide().id], [1, b], 'still on its slide');
        t = await rd(); eq(t.replace(/\n/g, ''), lastSaved, 'the merge is saved'); eq(JSON.parse(t).slides[1].objects.find(o => o.id === 'tA').size, 77, 'with this tab\'s change');
        // 3. the slide shown is removed outside: the tab shows the slide now at its place; undo brings everything back
        F = JSON.parse(t); F.slides.splice(1, 1); await wr(F); await pollOnce(); ok(await waitFor(() => scene.slides.length === 2, 6000), 'the removal did not arrive'); eq(fig.slide().id, a, 'the slide now at its place'); eq(sel.size, 0, 'nothing selected');
        undo(); eq(scene.slides.length, 3, 'undo of the outside change'); await settled();
        // 4. a plain figure that got slides outside while it was edited here: its elements are the matching slide's
        unslide(); blank(); fig.add('text', { id: 'p1', x: 100, y: 100, text: 'plain' }); fig.add('box', { id: 'p2', x: 400, y: 400 }); commit(); await settle(); await flushSave(); await settled();
        F = JSON.parse(await rd()); const objs = F.objects; delete F.objects; F.slides = [{ id: 'n1', name: 'New first', objects: [] }, { id: 'old', objects: objs }];
        clearTimeout(pushTimer); get('p1').text = 'plain, changed here'; commit(); clearTimeout(pushTimer); await wr(F); pushFile();
        ok(await waitFor(() => isDeck(scene) && scene.slides.length === 2, 8000), 'the slides did not arrive'); await settled(); eq(scene.slides[1].objects.find(o => o.id === 'p1').text, 'plain, changed here', 'the change went to the slide that holds the figure');
        eq(scene.slides[0].objects.length, 0, 'the other slide is as the file has it'); eq(fig.slide().id, 'old', 'the tab shows the slide that holds what it showed');
      } finally { unslide(); await flushSave().catch(() => {}); }
    });
    test('slides: PDF with a page per slide, PowerPoint with a slide and notes per slide, pictures of each slide', async () => {
      if (!hasSlides) throw new Skip('this editor has no slides');
      try {
        const [a, b, c] = await three(); fig.slide(2);
        const dec = async blob => new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
        const r = await makePdf({ mm: 120, dpi: 150 }); eq(r.pages, 3, 'PDF pages'); eq(((await dec(r.blob)).match(/\/Type\s*\/Page\b(?!s)/g) || []).length, 3, 'page objects'); eq([CUR, fig.slide().id], [1, b], 'the tab is back on its slide');
        eq((await makePdf({ mm: 120, dpi: 150, current: true })).pages, 1, 'only the slide shown');
        // each slide drawn in turn: its own SVG (the formula of slide 3 typeset on the way)
        const svgs = []; await slideEach([0, 1, 2], async i => { svgs.push(await svgString({})); }); eq(svgs.length, 3, 'three pictures'); svgs.forEach((s, i) => checkSvg(s, 'slide ' + (i + 1)));
        ok(svgs[0].includes('>One<') && !svgs[0].includes('>Two<') && svgs[1].includes('>Two<'), 'each picture holds its own slide'); ok(/<path/.test(svgs[2]) && scene.slides[2].objects.find(o => o.id === 'x2').paths, 'the formula on slide 3 was typeset for its picture');
        eq(CUR, 1, 'back again'); await checkPng(400, 'slide shown');
        // the Export dialog offers this slide or all of them (opened and closed: nothing is exported)
        exportDialog(); const q = s => D.querySelector(s), F0 = q('#exFmt'), pick = v => { F0.value = v; F0.dispatchEvent(new Event('input', { bubbles: true })); };
        ok(!q('#exSlRow').hidden, 'the Slides choice'); pick('pptx'); eq(q('#exSl').value, 'all', 'PowerPoint starts on all slides'); ok(!q('#exNumRow').hidden, 'slide numbers'); pick('png'); eq(q('#exSl').value, 'one', 'PNG on this slide');
        q('#exSl').value = 'all'; q('#exSl').dispatchEvent(new Event('input', { bubbles: true })); pick('pdf'); eq(q('#exSl').value, 'all', 'a choice made stays'); ok(/3 pages/.test(q('#exInfo').textContent), 'says how many pages'); closeModal();
        // PowerPoint: a slide for each, with its speaker notes and a slide number
        let p; try { p = await exportPptx(null, { numbers: true }); } catch (e) { if (!opts.strict && OFFLINE.test(e.message)) throw new Skip('PowerPoint library not reachable (offline): ' + e.message); throw e; }
        eq(p.slides, 3, 'PowerPoint slides'); const z = await dec(p.blob); for (const n of [1, 2, 3]) ok(z.includes('ppt/slides/slide' + n + '.xml'), 'slide ' + n + ' is in the file'); ok(!z.includes('ppt/slides/slide4.xml'), 'no fourth slide');
        // (the entries are compressed: unzipped with the library the export itself uses)
        const Z = await JSZip.loadAsync(p.blob), zt = n => Z.file(n).async('string'); ok((await zt('ppt/notesSlides/notesSlide2.xml')).includes('Notes for two'), 'slide 2 carries its speaker notes'); ok(!(await zt('ppt/notesSlides/notesSlide1.xml')).includes('Notes for two'), 'slide 1 does not');
        ok((await zt('ppt/slides/slide1.xml')).includes('One') && (await zt('ppt/slides/slide2.xml')).includes('Two'), 'each slide holds its own text'); for (const n of [1, 2, 3]) ok(/type="sldNum"/.test(await zt('ppt/slides/slide' + n + '.xml')), 'slide ' + n + ' has its number');
        const one = await exportPptx(null, { current: true }); eq(one.slides, 1, 'only the slide shown'); { const z1 = await JSZip.loadAsync(one.blob), x = await z1.file('ppt/slides/slide1.xml').async('string'); ok(x.includes('Two') && !x.includes('One'), 'and it is the slide shown'); ok(!/type="sldNum"/.test(x), 'no number unless asked for'); } eq(CUR, 1, 'and back');
        // a slide never looked at: drawn (and its formula typeset) for its page, and that is no change
        fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], slides: [{ id: 'a', objects: [{ id: 't', type: 'text', x: 100, y: 100, text: 'first' }] }, { id: 'b', objects: [{ id: 'fx', type: 'formula', x: 800, y: 300, tex: 'a^2 + b^2' }] }] }); await settle(); fig.slide(1); await settle();
        const hh = hist.length, sv = []; await slideEach([0, 1], async i => { sv.push(await svgString({})); }); ok(/<path/.test(sv[1]) && !/<path/.test(sv[0]), 'the unseen slide\'s formula is in its picture'); eq([CUR, hist.length], [0, hh], 'back on the slide shown, no undo step');
      } finally { unslide(); }
    });
    test('slides: slides from other figures, healing a file with slides, a plain figure\'s file is untouched', async () => {
      if (!hasSlides) throw new Skip('this editor has no slides');
      try {
        // repairs: slides without ids or elements, a duplicate id, top-level elements beside slides
        const H = healScene({ w: 800, h: 600, objects: [{ id: 'top', type: 'text', x: 1, y: 1, text: 't' }], slides: [{ id: 's1', objects: [{ type: 'box', x: 1, y: 1 }, 'junk'] }, { id: 's1', name: 7 }, null, { notes: 'kept' }] });
        eq(H.slides.length, 4, 'slides kept (top-level elements become the first)'); eq(H.slides[0].objects[0].id, 'top', 'the top-level elements'); ok(!Object.prototype.hasOwnProperty.call(H, 'objects'), 'no top-level objects left');
        eq(new Set(H.slides.map(s => s.id)).size, 4, 'every slide has its own id'); ok(H.slides.every(s => Array.isArray(s.objects)), 'every slide has elements'); ok(!('name' in H.slides[2]) && H.slides[3].notes === 'kept', 'names and notes');
        eq(J(healScene(JSON.parse(J(H)))), J(H), 'healing again changes nothing'); eq(figErr('{"slides":[]}'), '', 'a slides list is a figure'); ok(figErr('{"w":1}') !== '', 'neither objects nor slides is none');
        ok(blankScene({ slides: [{ id: 's1', objects: [] }] }) && !blankScene({ slides: [{ id: 's1', objects: [] }, { id: 's2', objects: [] }] }), 'blank: one empty slide, not two');
        // three-way merge, slide by slide
        const S = (id, o, x) => ({ id, ...(x || {}), objects: o }), T = (id, text) => ({ id, type: 'text', x: 1, y: 1, text }), deck = sl => ({ version: 4, w: 1600, h: 900, bg: '#ffffff', slides: sl });
        let m = mgMerge(deck([S('a', [T('1', 'x')]), S('b', [T('1', 'y')])]), deck([S('a', [T('1', 'x'), T('2', 'mine')]), S('b', [T('1', 'y')])]), deck([S('b', [T('1', 'theirs')]), S('a', [T('1', 'x')]), S('c', [T('9', 'new')], { name: 'New' })]));
        eq(m.scene.slides.map(s => s.id), ['b', 'a', 'c'], 'their order and their new slide'); eq(m.scene.slides[1].objects.map(o => o.text), ['x', 'mine'], 'my element'); eq(m.scene.slides[0].objects[0].text, 'theirs', 'their edit'); eq(m.conflicts.length, 0, 'no conflict');
        m = mgMerge(deck([S('a', [T('1', 'x')]), S('b', [T('1', 'y')])]), deck([S('a', [T('1', 'x')]), S('b', [T('1', 'mine')], { notes: 'my notes' })]), deck([S('a', [T('1', 'x')])]));
        eq(m.scene.slides.map(s => s.id), ['a', 'b'], 'a slide removed there but changed here is kept'); eq(m.conflicts.length, 1, 'and listed');
        m = mgMerge(deck([S('a', [T('1', 'x')]), S('b', [T('1', 'y')])]), deck([S('a', [T('1', 'x')]), S('b', [T('1', 'y')])]), deck([S('a', [T('1', 'x')])])); eq(m.scene.slides.map(s => s.id), ['a'], 'removed there, untouched here: gone');
        // slides from other figures: another page size is scaled to fit and centered; a file with slides brings all of them
        unslide(); blank(); fig.add('text', { id: 'home', x: 100, y: 100, text: 'home' }); const h0 = hist.length;
        const n = slidesImport([['alpha.json', { version: 4, w: 800, h: 450, bg: '#fff', objects: [{ id: 'q', type: 'box', x: 400, y: 225, s: 1, w: 100, h: 50 }, { id: 'ar', type: 'arrow', x1: 0, y1: 0, x2: 800, y2: 450 }] }],
          ['beta.json', { version: 4, w: 1600, h: 900, bg: '#fff', slides: [{ id: 's1', name: 'Intro', notes: 'hello', objects: [{ id: 'q', type: 'text', x: 5, y: 5, text: 'b1' }] }, { id: 's2', objects: [] }] }]]);
        eq(n, 3, 'three slides came in'); eq(fig.slides().map(s => s.name), ['', 'alpha', 'Intro', 'beta 2'], 'named after their files (or their own names)'); eq(CUR, 1, 'the first new slide is shown'); ok(h0 >= 300 || hist.length - h0 === 1, 'one undo step');
        const q = get('q'), ar = get('ar'); eq([q.x, q.y, q.s], [800, 450, 2], 'scaled to this page'); eq([ar.x2, ar.y2], [1600, 900], 'arrows too'); eq(fig.slides()[2].notes, 'hello', 'notes come along');
        undo(); ok(!isDeck(scene) && get('home'), 'undo takes them all away');
        // a plain figure still saves as ever: no new keys
        blank(); fig.add('box', { x: 300, y: 300 }); commit(); const P = JSON.parse(lastSaved); eq(Object.keys(P).sort(), ['bg', 'h', 'objects', 'palette', 'version', 'w'], 'a plain figure\'s keys');
      } finally { unslide(); }
    });

    // ---------- animations (files with slides) ----------
    const th = f => { try { f(); return false; } catch (e) { return true; } };
    const paneKeep = () => { let p = null, a = null; try { p = localStorage.getItem('fig.animPane'); a = localStorage.getItem('fig.animAuto'); } catch (e) {} return () => { try { if (typeof animStop === 'function') animStop(); if (typeof fig.animPane === 'function') fig.animPane(false); const au = D.querySelector('#abAuto'); if (au) au.checked = a !== 'off'; if (p) localStorage.setItem('fig.animPane', p); else localStorage.removeItem('fig.animPane'); if (a) localStorage.setItem('fig.animAuto', a); else localStorage.removeItem('fig.animAuto'); } catch (e) {} }; };
    const layer = id => { const c = D.querySelector('#animStage [data-id="' + id + '"]'); return c ? c.closest('svg') : null; };   // the layer that plays an element (a copy of its drawing over the page)
    test('animations: add, order, motion path, play, undo, pruning, healing; PowerPoint timing', async () => {
      if (!hasSlides || typeof fig.animate !== 'function') throw new Skip('this editor has no animations');
      const back = paneKeep();
      try {
        if (typeof fig.animPane === 'function') fig.animPane(false);
        unslide(); blank(); fig.add('text', { id: 'tA', x: 200, y: 200, text: 'One' }); eq(fig.anims(), [], 'a plain figure has no animations'); ok(th(() => fig.animate('nope', { fx: 'fade' })) && th(() => fig.animate('tA', { fx: 'nope' })) && !isDeck(scene), 'a call that fails leaves it a plain figure');
        { const a = fig.animate('tA', { fx: 'fade' }); ok(isDeck(scene) && scene.slides.length === 1 && fig.anims().length === 1, 'fig.animate makes a plain figure a file with one slide'); fig.batch(() => { fig.removeAnim(a); fig.animate('tA', { fx: 'fly' }); }); eq([isDeck(scene), fig.anims().map(x => x.fx)], [true, ['fly']], 'the only animation replaced in one batch');
          fig.removeAnim(fig.anims()[0].id); ok(!isDeck(scene), 'the last one removed: a plain figure again'); }
        fig.select(['tA']); ok(!D.querySelector('#props #animGo'), 'and no Animation section in its panel');
        await three(); fig.slide(1); fig.add('box', { id: 'bx', x: 600, y: 400 }); fig.add('icon', { id: 'g1', kind: 'cell', x: 900, y: 300, group: 'G' }); fig.add('icon', { id: 'g2', kind: 'cell', x: 1060, y: 300, group: 'G' }); await settle();
        const i1 = fig.animate('tA', { fx: 'fly', dir: 'l' }), i2 = fig.animate('bx', { fx: 'wheel', dir: '2', start: 'after', dur: 1 }), i3 = fig.animate('g1', { kind: 'out', fx: 'fade', start: 'with' }), i4 = fig.animate('bx', { kind: 'path', path: [[160, 0], [160, 90]] });
        eq([i1, i2, i3, i4].map(x => x.length), [1, 1, 1, 1], 'one animation each'); eq(fig.anims()[2].on, 'g:G', 'an element of a group stands for its group');
        eq(fig.anims().map(x => [x.n, x.kind, x.fx, x.start, x.step, x.name]), [[1, 'in', 'fly', 'click', 1, 'Fly In'], [2, 'in', 'wheel', 'after', 1, 'Wheel'], [3, 'out', 'fade', 'with', 1, 'Fade'], [4, 'path', 'custom', 'click', 2, 'Custom path']], 'the list, in order, with click steps');
        ok(th(() => fig.animate('nope', {})), 'a missing element'); ok(th(() => fig.animate('tA', { fx: 'zoom' })), 'an unknown effect'); ok(th(() => fig.animate('tA', { fx: 'fly', dir: 'x' })), 'an unknown direction'); ok(th(() => fig.removeAnim('nope')), 'a missing animation');
        const P = JSON.parse(lastSaved); eq(P.slides[0].anims.length, 4, 'kept in the slide'); eq(Object.keys(P.slides[0]).pop(), 'objects', 'before its elements'); ok(!('anims' in P.slides[1]), 'not on the other slides'); ok(!('anims' in P), 'not on the file');
        eq(figLines(lastSaved).replace(/\n/g, ''), lastSaved, 'the file text');
        // the panels point to the sidebar (one place for animations), the path has its handles
        fig.select(['bx']); await frame(); ok(D.querySelector('#props #animGo') && /2 on this element/.test(D.querySelector('#props #animGo').textContent), 'the selection\'s pointer says how many'); eq(D.querySelectorAll('#overlay [data-h=apt]').length, 2, 'a handle per path point');
        ok(!D.querySelector('#props .animrow') && !D.querySelector('#props #animAdd'), 'no animation fields in the properties any more');
        fig.select([]); await frame(); ok(D.querySelector('#props #animGoPage') && !D.querySelector('#props .animli'), 'the Page panel points there too');
        // dragging a path point
        fig.select(['bx']); await frame(); { const h = D.querySelectorAll('#overlay [data-h=apt]')[1], r = h.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, ev = (t, dx) => new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x + dx, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: t === 'pointerup' ? 0 : 1, isPrimary: true });
          const S = D.querySelector('#svg'), c0 = D.querySelector('#content').firstElementChild; h.dispatchEvent(ev('pointerdown', 0)); S.dispatchEvent(ev('pointermove', 30)); S.dispatchEvent(ev('pointermove', 60)); ok(D.querySelector('#content').firstElementChild === c0, 'only the overlay is drawn again while a point is dragged'); S.dispatchEvent(ev('pointerup', 60)); await frame();
          const p = fig.anims()[3].path; ok(p[1][0] > 170 && Math.abs(p[1][1] - 90) < 12, 'the point moved with the pointer: ' + J(p)); eq(p[0], [160, 0], 'the other stayed'); undo(); eq(fig.anims()[3].path, [[160, 0], [160, 90]], 'undo of the drag'); }
        // reorder, change, undo
        const s0 = lastSaved; fig.moveAnim(i4[0], 1); eq(fig.anims()[0].id, i4[0], 'moved first'); undo(); eq(lastSaved, s0, 'undo of the move');
        eq([fig.updateAnim(i1[0], { dur: 2, delay: .5 }).dur, fig.anims()[0].delay], [2, .5], 'fig.updateAnim'); eq(fig.updateAnim(i1[0], { dur: 'abc', fx: 'nope' }).fx, 'fade', 'values that are none get their defaults');
        // a path is travelled at an even speed, a custom one as a smooth curve through its points (smooth: false = straight)
        if (typeof animPathAt === 'function') { eq(animPathAt({ fx: 'line', path: [[100, 0]] }, .25), [25, 0], 'a quarter of a line');
          const cp = { fx: 'custom', path: [[20, 0], [20, 300], [400, 300]] }, st = []; let q = [0, 0]; for (let u = 1; u <= 400; u++) { const p = animPathAt(cp, u / 400); st.push(Math.hypot(p[0] - q[0], p[1] - q[1])); q = p; }   // (fine steps: a chord across the tight turn at the first point is shorter than the way around it)
          const mean = st.reduce((a, b) => a + b, 0) / st.length; ok(st.every(v => Math.abs(v - mean) < mean * .12), 'even steps along a path of uneven points: ' + J(st.filter(v => Math.abs(v - mean) >= mean * .12).map(v => +v.toFixed(2))) + ' of ' + mean.toFixed(2)); eq(q.map(Math.round), [400, 300], 'it ends on its last point');
          const L = animPathLine(cp); ok(cp.path.every(p => L.pts.some(v => Math.hypot(v[0] - p[0], v[1] - p[1]) < .01)), 'the curve goes through the saved points'); ok(L.pts.length > 20 && animPathLine({ ...cp, smooth: false }).pts.length === 4, 'smooth, unless smooth is false');
          eq(fig.updateAnim(i4[0], { smooth: false }).smooth, false, 'smooth: false is kept'); ok(pptxTiming([{ a: slideAnims()[3], spids: ['7'] }], 1600, 900).includes('path="M 0 0 L 0.1 0 L 0.1 0.1 E"'), 'and written as straight lines'); ok(!('smooth' in fig.updateAnim(i4[0], { smooth: true })), 'smooth again: the field goes'); }
        // playing changes nothing: the animated elements play on layers over the page, their originals wait unseen; an entrance is unseen until it begins
        const C = D.querySelector('#content'), html0 = C.innerHTML, s1 = lastSaved, h1 = hist.length, pr = fig.playAnims(); ok(animRun && animRun.an.length >= 4, 'running'); const g = [...C.children].find(x => x.dataset.id === 'bx');
        if (g.animate) { ok(D.querySelector('#animStage') && layer('bx') && layer('tA'), 'a layer per animated element'); eq(getComputedStyle(layer('bx')).opacity, '0', 'not yet in'); eq(getComputedStyle(g).visibility, 'hidden', 'the original waits unseen'); ok(layer('g1') === layer('g2'), 'a group plays as one layer');
          await frame(); await frame(); await frame(); await frame(); eq(new Set(animRun.an.map(x => x.startTime)).size, 1, 'every effect on one clock'); ok(animRun.an.every(x => x.playState === 'running'), 'and running'); }
        animStop(); eq(await pr, 4, 'played'); ok(!D.querySelector('#animStage'), 'the layers are gone at once'); eq(getComputedStyle(g).visibility, 'visible', 'as it was'); eq(C.innerHTML, html0, 'the drawing itself was never touched'); ok(!animRun, 'stopped'); eq([lastSaved === s1, hist.length], [true, h1], 'nothing changed');
        // it stops by itself, at any change of the drawing and at Escape
        if (g.animate) { const f = fig.animate('tA', { fx: 'fade', dur: .05 }), p1 = fig.playAnims(f); ok(animRun, 'a short one'); eq(await p1, 1, 'ended by itself'); ok(!animRun && !D.querySelector('#animStage'), 'and the page is as drawn'); ok(animStats && animStats.frames >= 0 && animStats.layers === 1, 'with its frame times: ' + J(animStats));
          fig.playAnims(); fig.update('bx', { x: 610 }); ok(!animRun && !D.querySelector('#animStage'), 'a change of the figure stops it'); fig.update('bx', { x: 600 });
          fig.playAnims(); D.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); ok(!animRun, 'Escape stops it'); fig.removeAnim(f); }
        // PowerPoint's timing: a tree PowerPoint reads (ids in order, its presets, click steps)
        const xml = pptxTiming(slideAnims().map(x => ({ a: x, spids: x.on === 'bx' ? ['7'] : x.on === 'tA' ? ['5'] : ['8', '9'] })), 1600, 900), doc = new DOMParser().parseFromString('<r xmlns:p="urn:p">' + xml + '</r>', 'application/xml');
        ok(!doc.querySelector('parsererror'), 'the timing is XML'); const ct = [...doc.getElementsByTagName('p:cTn')]; eq(ct.map(n => +n.getAttribute('id')), ct.map((n, i) => i + 1), 'ids 1, 2, 3… in the order of the file');
        eq(ct.filter(n => n.hasAttribute('presetID')).map(n => [n.getAttribute('presetID'), n.getAttribute('presetClass'), n.getAttribute('presetSubtype'), n.getAttribute('nodeType')].join(' ')), ['10 entr 0 clickEffect', '21 entr 2 afterEffect', '10 exit 0 withEffect', '10 exit 0 withEffect', '0 path 0 clickEffect'], 'presets and how they start');
        ok(xml.includes('path="M 0 0 C 0.01667 0 0.08333 -0.01667 0.1 0 C 0.11667 0.01667 0.1 0.08333 0.1 0.1 E"'), 'the smooth path as curves, in fractions of the slide: ' + (xml.match(/path="[^"]*"/) || [''])[0]); ok(xml.includes('filter="wheel(2)"') && xml.includes('<p:strVal val="hidden"/>'), 'the wheel and the exit\'s hiding'); eq((xml.match(/delay="indefinite"/g) || []).length, 2, 'two click steps');
        // an animation whose element has no shape in the export is left out, and its click goes to the next one
        { const x2 = pptxTiming([{ a: { kind: 'in', fx: 'fade', start: 'click', dur: .5 }, spids: [] }, { a: { kind: 'in', fx: 'fade', start: 'with', dur: .5 }, spids: ['5'] }], 1600, 900); ok(x2.includes('nodeType="clickEffect"') && !x2.includes('onBegin'), 'the step stays a click step'); eq(pptxTiming([{ a: { kind: 'in', fx: 'fade', start: 'click', dur: .5 }, spids: [] }], 1600, 900), '', 'nothing to write, no timing'); }
        // a change that would leave no animation is refused, not saved as its removal
        ok(th(() => fig.updateAnim(i1[0], { on: 'nope' })), 'an unknown element'); eq(fig.anims().length, 4, 'still there');
        // an exit and then an entrance of the same element: seen at the start, gone in between, back at the end (played, then stopped)
        if (g.animate) { const e1 = fig.animate('tA', { kind: 'out', fx: 'fade', dur: .05 }), e2 = fig.animate('tA', { fx: 'wipe', dur: .05 }), pq = fig.playAnims([e1[0], e2[0]]), lt = layer('tA');
          eq(getComputedStyle(lt).opacity, '1', 'an exit first: seen until it goes'); await sleep(460); eq(getComputedStyle(lt).opacity, '0', 'gone after the exit'); await sleep(520); eq(getComputedStyle(lt).opacity, '1', 'back with its entrance'); animStop(); await pq; fig.removeAnim([e1[0], e2[0]]); }
        // into the exported file: each animation on its element's shape, a group's on the group
        let p = null; try { p = await exportPptx(null, { current: true, numbers: true }); } catch (e) { if (opts.strict || !OFFLINE.test(e.message)) throw e; }
        if (p) { const z = await JSZip.loadAsync(p.blob), x = await z.file('ppt/slides/slide1.xml').async('string'), d = new DOMParser().parseFromString(x, 'application/xml'), PN = 'http://schemas.openxmlformats.org/presentationml/2006/main';
          ok(!d.querySelector('parsererror') && d.getElementsByTagNameNS(PN, 'timing').length === 1, 'one timing in the slide'); eq([...d.documentElement.children].map(n => n.localName).slice(0, 3), ['cSld', 'clrMapOvr', 'timing'], 'at its place');
          const sp = [...new Set([...d.getElementsByTagNameNS(PN, 'spTgt')].map(n => n.getAttribute('spid')))], tree = d.getElementsByTagNameNS(PN, 'spTree')[0], tops = [...tree.children].filter(n => n.getElementsByTagNameNS(PN, 'cNvPr')[0]).map(n => [n.getElementsByTagNameNS(PN, 'cNvPr')[0].getAttribute('id'), n.localName]);
          eq(sp.length, 3, 'three shapes are animated'); ok(sp.every(s => tops.some(t => t[0] === s)), 'each lies directly on the slide: ' + J(sp) + ' of ' + J(tops)); ok(sp.some(s => tops.some(t => t[0] === s && t[1] === 'grpSp')), 'the group as a group'); ok(tops.some(t => t[1] === 'grpSp'), 'the slide number did not stop the grouping'); }
        // an animation goes with its element, and with its group; undo brings it back
        fig.remove('bx'); eq(fig.anims().map(x => x.on), ['tA', 'g:G'], 'deleted with the element'); undo(); eq(fig.anims().length, 4, 'and back');
        delete get('g1').group; delete get('g2').group; commit(); eq(fig.anims().some(x => x.on === 'g:G'), false, 'no group, no animation of it'); undo();
        // other slides, a copied slide; one slide with animations stays a slide, without them it is a plain figure again
        fig.slide(2); eq(fig.anims().length, 0, 'slide 2 has none'); const dup = fig.duplicateSlide(1); eq(fig.anims().length, 4, 'a copied slide brings its animations'); fig.removeSlide(dup);
        while (scene.slides.length > 1) fig.removeSlide(scene.slides.length); ok(isDeck(scene) && scene.slides.length === 1 && fig.anims().length === 4, 'one slide with animations stays a file with slides');
        fig.removeAnim(fig.anims().map(x => x.id)); ok(!isDeck(scene) && scene.objects.length === 4, 'the last animation gone: a plain figure again'); undo(); ok(isDeck(scene) && fig.anims().length === 4, 'undo brings the slide and its animations back'); redo();
        // fig.set of a plain figure over one slide whose animated element is gone: recorded as the plain figure it is, so redo keeps its steps
        fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', slides: [{ id: 's1', anims: [{ id: 'a1', on: 'k1', kind: 'in', fx: 'fade', start: 'click', dur: 0.5, delay: 0 }], objects: [{ id: 'k1', type: 'shape', x: 300, y: 300 }] }] }); fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', objects: [] }); ok(!isDeck(scene), 'fig.set without the animated element: a plain figure at once');
        { const z = fig.add('shape', { x: 300, y: 300 }); fig.animate(z, { fx: 'fade' }); undo(); undo(); eq(scene.objects.length, 0, 'two steps back'); redo(); redo(); eq([isDeck(scene), scene.objects.length, fig.anims().length], [true, 1, 1], 'and both again with redo'); }
        // a slide with a name stays a slide when its last animation goes
        fig.updateSlide(1, { name: 'Intro' }); fig.removeAnim(fig.anims()[0].id); ok(isDeck(scene) && scene.slides[0].name === 'Intro' && !fig.anims().length, 'a named slide stays a slide without animations');
        // repairs
        const H = healScene({ w: 800, h: 600, slides: [{ id: 's1', anims: [{ on: 'x', fx: 'nope', dir: 'zz', dur: 'abc' }, { on: 'gone' }, { on: 'x', kind: 'path', path: [[1, 2], 'bad'] }, 'junk', { id: 'a1', on: 'x', fx: 'fly', start: 'with', delay: 999 }], objects: [{ id: 'x', type: 'box', x: 1, y: 1 }] }] });
        eq(H.slides[0].anims.map(q => [q.id, q.kind, q.fx, q.dir, q.start, q.dur, q.delay]), [['a2', 'in', 'fade', undefined, 'click', .5, 0], ['a3', 'path', 'line', undefined, 'click', 2, 0], ['a1', 'in', 'fly', 'b', 'with', .5, 60]], 'defaults for what is wrong, nothing for what is gone'); eq(J(healScene(JSON.parse(J(H)))), J(H), 'healing again changes nothing');
        const H2 = healScene({ w: 800, h: 600, slides: [{ id: 's1', anims: [{ on: 'x', kind: 'path', path: [[1, 2], [3, 4]], smooth: false }, { on: 'x', kind: 'path', path: [[1, 2]], smooth: false }, { on: 'x', kind: 'path', path: [[1, 2], [3, 4]], smooth: 'no' }], objects: [{ id: 'x', type: 'box', x: 1, y: 1 }] }] });
        eq(H2.slides[0].anims.map(q => [q.fx, q.smooth, Object.keys(q).pop()]), [['custom', false, 'path'], ['line', undefined, 'path'], ['custom', undefined, 'path']], 'smooth: only false, only on a path of several points, before the points');
      } finally { animStop(); back(); unslide(); }
    });
    test('animation sidebar: toggle, gallery, options, pane order and selection, playback, a plain figure', async () => {
      if (!hasSlides || typeof fig.animPane !== 'function') throw new Skip('this editor has no animation sidebar');
      const back = paneKeep(), B = D.querySelector('#animbar'), btn = D.querySelector('#bAnim'), q = s => B.querySelector(s), qa = s => [...B.querySelectorAll(s)], rows = () => qa('.aprow').map(r => r.dataset.anim), chosen = () => qa('.aprow.sel').map(r => r.dataset.anim),
        pressOn = id => { const b = bbox(id), r = D.querySelector('#svg').getBoundingClientRect(), z = r.width / scene.w, x = r.left + (b.x + b.w / 2) * z, y = r.top + (b.y + b.h / 2) * z, t = D.elementFromPoint(x, y), o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
          if (!t || !t.closest('#stage')) return false; t.dispatchEvent(new PointerEvent('pointerdown', o)); (D.elementFromPoint(x, y) || t).dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); return true; }, key = (el, k, o) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...(o || {}) }));
      try {
        // the button, Shift+A and fig.animPane; open or closed is the browser's, not the figure's
        fig.animPane(false); unslide(); blank(); fig.add('box', { id: 'bx', x: 400, y: 300, w: 260, h: 160, text: 'A box' }); fig.add('text', { id: 'tA', x: 800, y: 300, text: 'Hello', size: 40 }); fig.add('icon', { id: 'ic', x: 1100, y: 500, kind: 'cell', size: 160 }); await settle();
        const s0 = lastSaved; eq([fig.animPane(), B.hidden, btn.getAttribute('aria-pressed')], [false, true, 'false'], 'closed'); ok(btn.title && btn.getAttribute('aria-label'), 'the button says what it is');
        btn.click(); eq([fig.animPane(), B.hidden, btn.getAttribute('aria-pressed'), btn.classList.contains('on')], [true, false, 'true', true], 'the button opens it'); eq(localStorage.getItem('fig.animPane'), '1', 'remembered in this browser'); eq(lastSaved, s0, 'the figure is not changed by it');
        key(D.querySelector('#stage'), 'A', { shiftKey: true }); eq(fig.animPane(), false, 'Shift+A closes it'); eq(localStorage.getItem('fig.animPane'), null, 'and that is remembered'); eq(fig.animPane(true), true, 'fig.animPane(true)'); eq(fig.animPane(), true, 'fig.animPane()');
        if (typeof setFocusMode === 'function') { setFocusMode(true); eq(fig.animPane(), false, 'focus mode hides it: there it counts as closed'); key(D.querySelector('#stage'), 'A', { shiftKey: true }); eq([fig.animPane(), inFocus(), B.hidden], [true, false, false], 'Shift+A there leaves focus mode and shows it'); }
        { const au = q('#abAuto'); au.checked = false; au.dispatchEvent(new Event('change')); eq(localStorage.getItem('fig.animAuto'), 'off', 'the preview switched off (for the checks below)'); }
        // nothing yet: the how-to; no selection: the gallery asks for one
        ok(q('.abempty') && /Select an element/.test(q('.abempty').textContent), 'the empty pane says how'); eq(qa('.abfx').length, 8, 'eight entrance effects'); ok(qa('.abfx').every(b => b.title && b.querySelector('svg') && b.textContent.trim()), 'each with a picture, a name and a tooltip');
        eq(qa('.abtabs button').map(b => b.textContent.trim()), ['Entrance', 'Exit', 'Motion path'], 'the three kinds'); fig.select([]); await frame(); q('.abfx[data-fx="in:fade"]').click(); ok(!isDeck(scene) && !fig.anims().length, 'nothing is added without a selection');
        ok(q('#abPlay').disabled && q('#abFrom').disabled && q('#abStop').disabled, 'nothing to play');
        // a plain figure: the first animation makes it a file with one slide
        fig.select(['bx']); await frame(); ok(/box/i.test(q('.abfor').textContent), 'the gallery names the selection'); q('.abfx[data-fx="in:fly"]').click();
        ok(isDeck(scene) && scene.slides.length === 1, 'a file with one slide'); eq(fig.anims().map(a => [a.on, a.kind, a.fx, a.start]), [['bx', 'in', 'fly', 'click']], 'the gallery adds it to the selection'); eq(chosen(), rows(), 'its row is chosen'); ok(!D.documentElement.classList.contains('has-slides'), 'no slide strip for one slide');
        ok(!D.querySelector('#props #animGo'), 'no pointer in the properties while the sidebar is open');
        // the options of the chosen animation: direction as pictures, start, duration and delay
        eq(qa('.abdirs button').length, 4, 'four directions'); ok(qa('.abdirs button').every(b => b.title && b.getAttribute('aria-label') && b.querySelector('svg')), 'as pictures with names'); q('.abdirs [data-dir="l"]').click(); eq(fig.anims()[0].dir, 'l', 'a direction'); ok(q('.abdirs [data-dir="l"]').classList.contains('on') && q('.abdirs [data-dir="l"]').getAttribute('aria-checked') === 'true', 'shown as chosen');
        { const du = q('.abopt [data-f=dur]'); du.focus(); du.value = '1.5'; du.dispatchEvent(new Event('change', { bubbles: true })); eq(fig.anims()[0].dur, 1.5, 'the duration'); const de = q('.abopt [data-f=delay]'); de.focus(); de.value = ''; de.dispatchEvent(new Event('change', { bubbles: true })); eq([fig.anims()[0].delay, de.value], [0, '0'], 'an emptied field keeps its value'); }
        // Tab out of a changed field: the change comes while the focus moves on, and the focus is kept where it went
        { const du = q('.abopt [data-f=dur]'); du.focus(); du.value = '2'; q('.abopt [data-f=delay]').focus(); du.dispatchEvent(new Event('change', { bubbles: true })); await sleep(40); eq([fig.anims()[0].dur, D.activeElement && D.activeElement.dataset.k], [2, 'f-delay'], 'Tab from duration lands on delay'); const d2 = q('.abopt [data-f=dur]'); d2.focus(); d2.value = '1.5'; d2.dispatchEvent(new Event('change', { bubbles: true })); }
        q('.abstart [data-start="after"]').click(); eq(fig.anims()[0].start, 'after', 'the start'); { const fx = q('.abopt [data-f=fx]'); fx.value = 'wheel'; fx.dispatchEvent(new Event('change', { bubbles: true })); eq([fig.anims()[0].fx, fig.anims()[0].dir], ['wheel', '1'], 'another effect takes its first variant'); eq(qa('.abdirs button').map(b => b.textContent.trim()), ['1', '2', '3', '4', '8'], 'the spokes'); }
        // exit and motion path from the other tabs
        fig.select(['tA']); await frame(); q('[data-tab=out]').click(); eq(qa('.abfx').map(b => b.textContent.trim()).slice(0, 3), ['Disappear', 'Fade', 'Fly Out'], 'the exits'); q('.abfx[data-fx="out:wipe"]').click();
        fig.select(['ic']); await frame(); q('[data-tab=path]').click(); eq(qa('.abfx').map(b => b.dataset.fx), ['path:line', 'path:custom', 'path:draw', 'path:back'], 'the paths'); q('.abfx[data-fx="path:custom"]').click();
        eq(fig.anims().map(a => a.on + ':' + a.kind + ':' + a.fx), ['bx:in:wheel', 'tA:out:wipe', 'ic:path:custom'], 'three animations'); ok(fig.anims()[2].path.length > 2, 'a curve of several points');
        ok(q('.abpath') && q('.abopt [data-f=smooth]').checked, 'a path has its buttons and Smooth curve'); q('.abopt [data-a=line]').click(); eq([fig.anims()[2].fx, fig.anims()[2].path.length], ['line', 1], 'Straight line'); q('.abopt [data-a=addpt]').click(); eq([fig.anims()[2].fx, fig.anims()[2].path.length], ['custom', 2], 'Add point');
        { const sm = q('.abopt [data-f=smooth]'); sm.checked = false; sm.dispatchEvent(new Event('change', { bubbles: true })); eq(fig.anims()[2].smooth, false, 'Smooth curve off'); }
        // the pane: grouped by click, a timing bar per row, rows and canvas share the selection
        eq(rows(), fig.anims().map(a => a.id), 'the rows in play order'); eq(qa('.apstep .apst').map(n => n.textContent), ['With the slide', 'Click 1', 'Click 2'], 'grouped by click step'); ok(qa('.aprow').every(r => r.querySelector('.apbar .b') && r.querySelector('.apt b').textContent && r.title), 'each with its name and timing bar');
        eq(qa('.aprow .apt small').map(n => n.textContent.split(' · ')[0]), ['Entrance', 'Exit', 'Custom path'], 'the kind in words, not only as a color'); ok(qa('.aprow').every(r => /Entrance|Exit|Motion path/.test(r.getAttribute('aria-label')) && /on click|previous/.test(r.getAttribute('aria-label'))), 'and each row named in full for a screen reader');
        eq(getComputedStyle(q('.aplist')).overflowY, 'visible', 'the list is not a scrolling area of its own inside the sidebar'); q('.abtog').click(); ok(!q('.abgal') && q('.abtog').getAttribute('aria-expanded') === 'false', 'the effects fold away'); q('.abtog').click(); ok(q('.abgal'), 'and come back');
        qa('.aprow')[0].click(); eq([[...sel], chosen()], [['bx'], [rows()[0]]], 'a row selects what it animates'); fig.select(['tA']); await frame(); eq(chosen(), [rows()[1]], 'a selected element chooses its row');
        qa('.aprow')[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); eq([chosen().length, [...sel].sort()], [2, ['ic', 'tA']], 'Ctrl adds a row'); qa('.aprow')[0].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); eq(chosen().length, 3, 'Shift takes the rows between');
        q('.abstart [data-start="with"]').click(); eq(fig.anims().map(a => a.start), ['with', 'with', 'with'], 'the start of every chosen row, one step'); undo(); eq(fig.anims().map(a => a.start), ['after', 'click', 'click'], 'undone at once');
        // hover outlines the element; reorder with Alt+Up / Down, by dragging and from the row's menu
        qa('.aprow')[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); ok(animHover === 'tA' && D.querySelector('#overlay rect[stroke-dasharray]'), 'the row under the pointer outlines its element'); q('.aplist').dispatchEvent(new MouseEvent('mouseleave')); eq(animHover, null, 'and lets go');
        const o0 = rows(); qa('.aprow')[0].click(); key(qa('.aprow')[0], 'ArrowDown', { altKey: true }); eq(rows(), [o0[1], o0[0], o0[2]], 'Alt+Down moves the row'); eq(D.activeElement && D.activeElement.dataset.anim, o0[0], 'the focus stays on it'); key(D.activeElement, 'ArrowUp', { altKey: true }); eq(rows(), o0, 'Alt+Up moves it back');
        key(qa('.aprow')[0], 'ArrowDown'); eq([chosen(), [...sel]], [[o0[1]], ['tA']], 'Down chooses the next row');
        { const R = qa('.aprow'), r2 = R[2].getBoundingClientRect(), dv = (t, el, y) => { const e = new Event(t, { bubbles: true, cancelable: true }); e.clientY = y; e.dataTransfer = null; el.dispatchEvent(e); };
          dv('dragstart', R[0], 0); dv('dragover', R[2], r2.bottom - 2); ok(R[2].classList.contains('dropa'), 'a line shows where it goes'); dv('drop', R[2], r2.bottom - 2); eq(rows(), [o0[1], o0[2], o0[0]], 'dragged to the end'); undo(); eq(rows(), o0, 'undo'); }
        qa('.aprow')[2].querySelector('.apmenu').click(); { const m = D.querySelector('#ctxMenu'), it = [...m.querySelectorAll('button')].map(b => b.textContent); ok(m.classList.contains('open') && it.some(t => /Start with previous/.test(t)) && it.some(t => /^Remove/.test(t)) && it.some(t => /Play from here/.test(t)), 'the row menu: ' + J(it)); [...m.querySelectorAll('button')].find(b => /Start with previous/.test(b.textContent)).click(); eq(fig.anims()[2].start, 'with', 'Start with previous'); undo(); }
        // playback: Play slide, From selected, Stop; the bars run with it
        ok(!q('#abPlay').disabled && q('#abStop').disabled, 'ready to play'); const html0 = D.querySelector('#content').innerHTML; q('#abPlay').click();
        if (animRun) { ok(!q('#abStop').disabled && B.classList.contains('playing'), 'Stop is there while it plays'); ok(D.querySelector('#animStage'), 'on layers over the page'); ok(animRun.an.length > fig.anims().length, 'the progress bar and the rows\' bars run on the same clock');
          q('#abStop').click(); ok(!animRun && !D.querySelector('#animStage') && q('#abStop').disabled, 'Stop restores the page at once'); eq(D.querySelector('#content').innerHTML, html0, 'exactly as it was drawn');
          qa('.aprow')[2].click(); q('#abFrom').click(); ok(animRun && animRun.t > 0, 'From selected starts at that animation: ' + (animRun && animRun.t)); eq(getComputedStyle(layer('tA')).opacity, '0', 'what went out before it is gone'); animStop();
          // "Play when I change something": one preview at a time
          const au = q('#abAuto'); au.checked = true; au.dispatchEvent(new Event('change')); qa('.aprow')[0].click(); q('.abdirs [data-dir="2"]').click(); q('.abdirs [data-dir="3"]').click(); ok(await waitFor(() => !!animRun, 2000), 'a change plays its animation'); eq([animRun.ids, D.querySelectorAll('#animStage').length], [[rows()[0]], 1], 'that one, once');
          q('.abdirs [data-dir="4"]').click(); ok(!animRun, 'the next change ends the preview that is playing'); ok(await waitFor(() => !!animRun, 2000), 'and plays the new one'); eq(D.querySelectorAll('#animStage').length, 1, 'never two at once');
          // a preview is not in the way: a press on the canvas ends it and selects with that one press, also on the element being previewed; it ends right after its animation
          ok(animRun.end - animRun.total <= 200, 'a preview ends right after its animation'); ok(pressOn('ic'), 'the icon is in sight'); eq([!!animRun, [...sel]], [false, ['ic']], 'a press on the canvas ends a preview and selects at once');
          qa('.aprow')[0].click(); q('.abdirs [data-dir="2"]').click(); ok(await waitFor(() => !!animRun, 2000), 'another preview'); ok(pressOn('bx'), 'the box is in sight'); eq([!!animRun, [...sel]], [false, ['bx']], 'also a press on the element being previewed');
          animStop(); au.checked = false; au.dispatchEvent(new Event('change')); clearTimeout(animBar.tm); }
        // keys in the sidebar never reach the canvas: Delete on an effect button removes the chosen animation, not the element; the arrows go through the tabs and the effects
        fig.select(['bx']); await frame(); q('[data-tab=in]').click(); { const g = q('.abfx[data-fx="in:fade"]'); g.focus(); g.click(); } eq([fig.anims().length, chosen().length], [4, 1], 'one more from the gallery, chosen'); ok(/Already has an entrance/.test((q('.abhas') || {}).textContent || ''), 'the gallery says the element already has an entrance');
        { const r = q('.aprow.act').getBoundingClientRect(), b = q('#abBody').getBoundingClientRect(); ok(r.top >= b.top - 1 && r.bottom <= b.bottom + 1, 'the new row is in sight'); }
        key(D.activeElement, 'Delete'); eq([fig.anims().length, !!get('bx')], [3, true], 'Delete on an effect button removes the chosen animation, not the element'); ok(B.contains(D.activeElement), 'the focus stays in the sidebar');
        { const x0 = get('bx').x, t = q('[data-tab=in]'); t.focus(); key(t, 'ArrowRight'); eq([animBar.tab, D.activeElement && D.activeElement.dataset.tab, get('bx').x], ['out', 'out', x0], 'the arrows go through the tabs and do not move the element'); const f = qa('.abfx')[0]; f.focus(); key(f, 'ArrowRight'); eq(D.activeElement, qa('.abfx')[1], 'and through the effects'); eq(get('bx').x, x0, 'still in its place'); q('[data-tab=in]').click(); }
        // Remove in the options keeps the focus in the sidebar; undo brings the row back, chosen again
        fig.select(['tA']); await frame(); { const rm = q('.abopt [data-a=rm]'); rm.focus(); rm.click(); } eq(fig.anims().length, 2, 'Remove in the options'); ok(B.contains(D.activeElement), 'the focus stays in the sidebar after Remove'); undo(); await frame(); eq([fig.anims().length, chosen().length, q('#abFrom').disabled], [3, 1, false], 'undo brings it back, chosen again');
        // removing: the row's Delete key; the last one gone, the figure is a plain figure again
        qa('.aprow')[0].click(); key(qa('.aprow')[0], 'a', { ctrlKey: true }); eq(chosen().length, 3, 'Ctrl+A chooses every row'); key(qa('.aprow')[0], 'Delete'); eq([fig.anims().length, isDeck(scene), scene.objects.length], [0, false, 3], 'Delete removes the rows, not the elements; a plain figure again'); ok(q('.abempty'), 'the empty pane again');
        undo(); eq([fig.anims().length, isDeck(scene)], [3, true], 'undo brings them back');
        // closed: the properties and the Page panel point to it
        eq(getComputedStyle(q('#abOver')).display !== 'none', D.documentElement.classList.contains('anim-over'), 'a line says the properties are hidden exactly when the sidebar covers them'); q('#abProps').click(); eq(fig.animPane(), false, 'Show properties closes the sidebar'); fig.animPane(true);
        fig.animPane(false); fig.select(['bx']); await frame(); ok(D.querySelector('#props #animGo'), 'the properties point to the sidebar'); D.querySelector('#props #animGo button').click(); eq(fig.animPane(), true, 'and open it');
        // a narrow window: it takes the place of the properties panel instead of squeezing the canvas
        if (typeof animBarFit === 'function' && !D.documentElement.classList.contains('phone')) { const st = D.querySelector('#stage').getBoundingClientRect().width; ok(st >= 300 || D.documentElement.classList.contains('anim-over'), 'the canvas keeps its room: ' + Math.round(st) + ' px'); }
      } finally { animStop(); back(); try { fig.select([]); } catch (e) {} unslide(); }
    });
    // ---------- presenting: a slide's own background, transitions, the slideshow and its presenter view ----------
    const hasShow = hasSlides && typeof fig.present === 'function' && typeof pageBg === 'function';
    const showOff = () => { try { if (typeof showEnd === 'function') showEnd(); } catch (e) {} };
    const room = () => { if (hist.length > 200) hist.length = 0; };   // these tests count undo steps: the history holds 300 at most and then stops growing
    test('animations: Back to original position follows the earlier paths (canvas, show, PowerPoint); copies keep their animations (duplicate, paste, another slide, groups, a plain figure)', async () => {
      if (!hasSlides || typeof fig.animate !== 'function') throw new Skip('this editor has no animations');
      if (typeof animLive !== 'function') throw new Skip('this editor has no "Back to original position"');
      const back = paneKeep(), tip0 = copySel.tip, toastT = () => D.querySelector('#toast').textContent;
      try {
        if (typeof fig.animPane === 'function') fig.animPane(false);
        await three(); fig.slide(1); fig.add('box', { id: 'bx', x: 600, y: 400 }); await settle();
        // --- the path back: no points of its own, worked out from the path before it ---
        const [p] = fig.animate('bx', { kind: 'path', path: [[300, -100]], dur: .05 }), [b] = fig.animate('bx', { kind: 'path', fx: 'back', dur: .05, path: [[9, 9]] });
        eq(scene.slides[0].anims[1], { id: b, on: 'bx', kind: 'path', fx: 'back', start: 'click', dur: .05, delay: 0 }, 'the file keeps no points for it');
        eq(fig.anims().map(x => [x.fx, x.name, x.from || null, x.path]), [['line', 'Line', null, [[300, -100]]], ['back', 'Back to original position', [300, -100], [[0, 0]]]], 'fig.anims gives where it starts');
        eq(fig.check().filter(r => /animation/.test(r.msg)), [], 'nothing to say about a back that moves');
        fig.updateAnim(p, { path: [[10, 20], [50, 60]] }); eq(fig.anims()[1].from, [50, 60], 'it follows a change of the earlier path');
        { const L = animLive(slideAnims()), P = animPathLine(L[1]); eq([P.pts, Math.round(P.tot)], [[[50, 60], [0, 0]], 78], 'travelled from the end of that path to the element'); ok(animPathD(L[1], 100, 100).startsWith('M150,160L100,100'), 'drawn from there: ' + animPathD(L[1], 100, 100)); ok(animPathD(L[0], 100, 100).startsWith('M100,100'), 'other paths start at the element'); }
        fig.moveAnim(b, 1); eq(fig.anims()[0].from, [0, 0], 'moved before the path: nothing to undo'); { const c = fig.check().filter(r => /animation/.test(r.msg)); eq(c.map(r => [r.id, r.level]), [['bx', 'info']], 'fig.check says so'); ok(/does nothing/.test(c[0].msg) && c[0].msg.includes(b), 'in words: ' + c[0].msg); eq(fig.check(['tA']).filter(r => /animation/.test(r.msg)), [], 'not for another element'); }
        fig.moveAnim(b, 2); eq(fig.anims()[1].from, [50, 60], 'and after it again');
        const [b2] = fig.animate('bx', { kind: 'path', fx: 'back', dur: .05 }); eq(fig.anims()[2].from, [0, 0], 'a second back starts where the first one ended: at the element');
        fig.update('bx', { x: 700 }); eq(fig.anims()[1].from, [50, 60], 'an element moved keeps its offsets');
        // on the canvas: the path is drawn for the selection, without points to drag; the sidebar explains it
        fig.select(['bx']); render(); { const ov = D.querySelector('#svg').innerHTML; eq(D.querySelectorAll('[data-h=apt]').length, 2, 'only the custom path has points to drag'); const bb = bbox('bx'), cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2; ok(ov.includes(animPathD(animLive(slideAnims())[1], cx, cy)), 'the way back is not drawn'); }
        if (typeof fig.animPane === 'function') { fig.animPane(true); await frame(); const B = D.querySelector('#abBody'); B.querySelector('[data-tab=path]').click(); await frame();
          const g = B.querySelector('.abfx[data-fx="path:back"]'); ok(g && /Back to original position/.test(g.textContent) && g.title && g.querySelector('svg'), 'the gallery has no Back to original position'); eq(B.querySelectorAll('.abgal .abfx').length, 4, 'four motion paths');
          B.querySelector(`.aprow[data-anim="${b}"]`).click(); await frame(); ok(B.querySelector('.abopt .abback') && !B.querySelector('.abopt .abpath') && B.querySelector('.abopt [data-f=dur]') && B.querySelector('.abopt [data-start]'), 'its options: an explanation, start and timing, no point tools');
          ok(/does nothing/.test(B.querySelector(`.aprow[data-anim="${b2}"] small`).textContent) && !/does nothing/.test(B.querySelector(`.aprow[data-anim="${b}"] small`).textContent), 'the row of an idle back says so');
          { const r2 = B.querySelector(`.aprow[data-anim="${b2}"]`), s2 = r2.querySelector('small'); ok(r2.classList.contains('idle') && !B.querySelector(`.aprow[data-anim="${b}"]`).classList.contains('idle'), 'the idle row is not marked'); ok(s2.clientWidth === 0 || s2.scrollWidth <= s2.clientWidth + 1, 'its note is cut off: "' + s2.textContent + '" ' + s2.scrollWidth + ' > ' + s2.clientWidth); ok(/no earlier path/.test(r2.title) && /no earlier path/.test(r2.getAttribute('aria-label')), 'the tooltip and the name say why'); }
          B.querySelector(`.aprow[data-anim="${b2}"]`).click(); await frame(); ok(/Does nothing yet/.test(B.querySelector('.abopt .abback').textContent), 'and its options too');
          fig.select(['tA']); await frame(); const n0 = fig.anims().length; B.querySelector('.abfx[data-fx="path:back"]').click(); await frame(); eq([fig.anims().length, fig.anims().pop().fx, fig.anims().pop().on], [n0 + 1, 'back', 'tA'], 'the gallery adds one'); fig.removeAnim(fig.anims().pop().id); animStop(); fig.animPane(false); }
        // played, presented and exported with the offset of that moment
        eq(await fig.playAnims(), 3, 'all three play'); eq(await fig.playAnims([b]), 1, 'the back alone plays');
        if (typeof showSnap === 'function') { const S = await showSnap(0); eq(S.L.map(x => x.from || null), [null, [50, 60], [0, 0]], 'the slideshow has the same offsets'); }
        { const L = animLive(slideAnims()), x = pptxTiming(L.map(a => ({ a, spids: ['7'] })), 1600, 900), m = [...x.matchAll(/<p:animMotion[^>]* path="([^"]*)"[^>]* ptsTypes="(\w+)"/g)].map(q => [q[1], q[2]]);
          eq(m[1], ['M 0.03125 0.06667 L 0 0 E', 'AA'], 'PowerPoint: a straight path from the offset to the shape\'s place'); ok(m[0][0].startsWith('M 0 0 C '), 'the path before it as before: ' + m[0][0]); ok(!new DOMParser().parseFromString(x.replace('<p:timing>', '<p:timing xmlns:p="p">'), 'application/xml').querySelector('parsererror'), 'the timing is well-formed'); }
        { const L = animLive(slideAnims()), x = pptxTiming(L.map(a => ({ a, spids: ['7'] })), 1600, 900), m = [...x.matchAll(/<p:animMotion[^>]* path="([^"]*)"/g)].map(q => q[1]); eq([m.length, m[2]], [3, 'M 0 0 L 0 0 E'], 'PowerPoint: an idle back is a path that stays in place, so its click counts there as in the show'); eq((x.match(/nodeType="clickEffect"/g) || []).length, animSteps(L).pop(), 'as many clicks as the show has'); }
        { const H = healScene({ w: 800, h: 600, slides: [{ id: 's1', anims: [{ on: 'x', kind: 'path', fx: 'back', path: [[1, 2], [3, 4]], smooth: false, dur: 'x' }, { on: 'x', kind: 'in', fx: 'back' }], objects: [{ id: 'x', type: 'box', x: 1, y: 1 }] }] }); eq(H.slides[0].anims, [{ id: 'a1', on: 'x', kind: 'path', fx: 'back', start: 'click', dur: 2, delay: 0 }, { id: 'a2', on: 'x', kind: 'in', fx: 'fade', start: 'click', dur: .5, delay: 0 }], 'a file: back keeps no points; it is a path effect only'); }
        fig.updateAnim(b2, { fx: 'line' }); ok(fig.anims()[2].fx === 'line' && fig.anims()[2].path.length === 1, 'changed into a line it gets a point'); fig.removeAnim(b2);
        // --- copies keep their animations ---
        copySel.tip = 1; fig.animate('tA', { fx: 'fade', start: 'with' });   // bx: path (click 1), back (click 2); tA: fade with the back
        const sig = () => fig.anims().map(x => [x.on, x.fx, x.start]), base = sig(), h0 = hist.length;
        fig.select(['bx']); duplicate(); const d1 = [...sel][0]; ok(d1 && d1 !== 'bx', 'no copy'); eq(sig(), base.concat([[d1, 'custom', 'click'], [d1, 'back', 'click']]), 'Duplicate: the copy has copies of the animations, after the others');
        eq(new Set(fig.anims().map(x => x.id)).size, fig.anims().length, 'with ids of their own'); eq(fig.anims()[4].from, [50, 60], 'the copied back follows the copied path'); eq(hist.length, h0 + 1, 'one undo step'); ok(/Duplicated with 2 animations/.test(toastT()), 'said: ' + toastT());
        undo(); eq([sig(), !!get(d1)], [base, false], 'undo takes the copy and its animations'); redo(); eq(fig.anims().length, 5, 'redo'); undo();
        fig.select(['bx', 'tA']); copySel(); ok(clip.some(o => Array.isArray(o.animRefs)) && !/animRefs/.test(J(scene)), 'the copy carries them, the figure does not'); pasteClip(clip); const ids = [...sel], nb = ids.find(i => get(i).type === 'box'), nt = ids.find(i => get(i).type === 'text');
        eq(sig().slice(3), [[nb, 'custom', 'click'], [nb, 'back', 'click'], [nt, 'fade', 'with']], 'Paste: in their order, a "with" stays with the copied row of its click step'); ok(/Pasted with 3 animations/.test(toastT()), 'said: ' + toastT()); undo(); eq(sig(), base, 'one step back');
        fig.select(['tA']); copySel(); pasteClip(clip); eq(sig().slice(3), [[[...sel][0], 'fade', 'click']], 'a "with" whose partner was not copied starts on click'); undo();
        fig.select(['tA']); const keepClip = J(clip); fig.slide(2); const n2 = scene.objects.length; ok(pasteText(CLIP_TAG + keepClip), 'the system clipboard\'s copy is taken'); eq([scene.objects.length, sig()], [n2 + 1, [[[...sel][0], 'fade', 'click']]], 'pasted on another slide with its animation'); undo(); fig.slide(1);
        // a group: its animation follows the copy's group
        fig.add('icon', { id: 'g1', kind: 'cell', x: 900, y: 300, group: 'G' }); fig.add('icon', { id: 'g2', kind: 'cell', x: 1060, y: 300, group: 'G' }); await settle(); fig.animate('g1', { kind: 'path', fx: 'custom', path: [[40, 40], [80, 0]], smooth: false, start: 'after', delay: 1 });
        fig.select(['g1', 'g2']); duplicate(); { const G2 = get([...sel][0]).group, a = fig.anims().pop(); ok(G2 && G2 !== 'G' && [...sel].every(i => get(i).group === G2), 'the copies are a group of their own'); eq([a.on, a.fx, a.smooth, a.path, a.start, a.delay], ['g:' + G2, 'custom', false, [[40, 40], [80, 0]], 'click', 1], 'the group\'s path came along: points, straight stretches, delay'); } undo();
        { fig.select(['bx']); D.querySelector('#toast').textContent = ''; eq(pasteObjs(scene.objects.filter(o => sel.has(o.id)), 0, false, 'Copied'), 2, 'an Alt-drag copy keeps them too'); ok(!/Copied with/.test(toastT()) && fig.anims().length === base.length + 3, 'the copy is not announced before the drag has made it: ' + toastT()); undo(); }
        // Alt+click without a drag takes the copy away again and says nothing; an Alt-drag says what came along, and is one step
        { fig.select(['bx']); render(); await frame(); const S = D.querySelector('#svg'), bb = bbox('bx'), m = S.getScreenCTM(), x = m.a * (bb.x + bb.w * .3) + m.e, y = m.d * (bb.y + bb.h * .3) + m.f, t = D.elementFromPoint(x, y), W = D.defaultView, T = D.querySelector('#toast');
          const pe = (ty, dx = 0) => new W.PointerEvent(ty, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: ty === 'pointerup' ? 0 : 1, clientX: x + dx, clientY: y, altKey: true, bubbles: true, cancelable: true });
          if (t && S.contains(t) && t.closest('[data-id]')) { room(); const n0 = scene.objects.length, a0 = fig.anims().length, h1 = hist.length; T.textContent = ''; T.classList.remove('show');
            t.dispatchEvent(pe('pointerdown')); if (drag && drag.altSel) { S.dispatchEvent(pe('pointerup')); eq([scene.objects.length, fig.anims().length, hist.length], [n0, a0, h1], 'Alt+click: the copy is not taken away again'); ok(!/Copied with/.test(toastT()), 'Alt+click said a copy was made: ' + toastT());
              fig.select(['bx']); render(); await frame(); D.elementFromPoint(x, y).dispatchEvent(pe('pointerdown')); for (let i = 1; i <= 6; i++) S.dispatchEvent(pe('pointermove', i * 12)); S.dispatchEvent(pe('pointerup', 72)); eq([scene.objects.length, fig.anims().length, hist.length], [n0 + 1, a0 + 2, h1 + 1], 'Alt-drag: a copy with its two animations, one step'); ok(/Copied with 2 animations/.test(toastT()), 'said when the drag ends: ' + toastT()); undo(); eq([scene.objects.length, fig.anims().length], [n0, a0], 'one undo takes the copy and its animations'); }
            else if (drag) S.dispatchEvent(pe('pointerup')); } }
        // a figure that got its one slide from its first animation: a cut takes the last animations (a plain figure again); the paste brings the element back with them, as one slide again
        { unslide(); blank(); fig.add('box', { id: 'cx', x: 500, y: 400 }); await settle(); fig.animate('cx', { fx: 'fade' }); fig.animate('cx', { kind: 'path', path: [[100, 0]] }); ok(isDeck(scene) && scene.slides.length === 1 && fig.anims().length === 2, 'the first animation makes no file with one slide'); room(); const hc = hist.length;
          fig.select(['cx']); copySel('Cut'); del(); ok(!isDeck(scene) && !scene.objects.length, 'the cut leaves no plain figure'); ok(clip[0].animFrom && !/animFrom/.test(J(scene)), 'the copy does not say where it was made'); const cc = JSON.parse(J(clip)); D.querySelector('#toast').textContent = ''; pasteClip(clip);
          ok(isDeck(scene) && scene.slides.length === 1 && scene.objects.length === 1, 'cut + paste: not one slide again'); eq(fig.anims().map(x => [x.on === [...sel][0], x.kind, x.fx, x.start]), [[true, 'in', 'fade', 'click'], [true, 'path', 'line', 'click']], 'cut + paste in a one-slide figure keeps the animations'); ok(/Pasted with 2 animations/.test(toastT()), 'said: ' + toastT()); ok(!/animFrom|animRefs/.test(J(scene)), 'nothing of the clipboard in the figure'); eq(hist.length, hc + 2, 'the cut and the paste: two steps');
          undo(); ok(!isDeck(scene) && !scene.objects.length, 'undo: the figure after the cut'); undo(); ok(isDeck(scene) && fig.anims().length === 2 && !!get('cx'), 'undo again: as before the cut'); redo();
          cc.forEach(o => delete o.animFrom); pasteClip(cc); ok(!isDeck(scene) && scene.objects.length === 1 && !/anim/.test(J(scene)), 'the same copy from another figure leaves it plain'); }
        await three(); fig.slide(1); fig.add('box', { id: 'bx', x: 600, y: 400 }); await settle(); fig.animate('bx', { kind: 'path', path: [[10, 20], [50, 60]] }); fig.animate('tA', { fx: 'fade', start: 'with' });
        // a plain figure takes the elements without the animations, and stays plain
        fig.select(['bx', 'tA']); copySel(); const c2 = JSON.parse(J(clip)); c2.forEach(o => delete o.animFrom);   /* (as copied in another figure) */ D.querySelector('#toast').textContent = ''; unslide(); blank(); pasteClip(c2); ok(!isDeck(scene) && scene.objects.length === 2 && !/anim/.test(J(scene)), 'a paste made a plain figure a file with slides: ' + J(scene).slice(0, 200)); ok(!/animation/.test(toastT()), 'nothing is said about what was left out');
        // pasted JSON from anywhere: healed, never trusted
        await three(); fig.slide(1); fig.select(['tA']); copySel(); { const c3 = JSON.parse(J(clip)); c3[0].animRefs = [{ k: 0, st: 1, a: { id: 'zz"<', on: 'elsewhere', kind: 'in', fx: 'nope', start: 'with', dur: 'x' } }, 'junk', { a: null }, { k: 1, st: 1, a: { kind: 'path', fx: 'back', start: 'after' } }]; pasteClip(c3); }
        eq(fig.anims().map(x => [x.on === [...sel][0], x.kind, x.fx, x.start, x.dur]), [[true, 'in', 'fade', 'click', .5], [true, 'path', 'back', 'after', 2]], 'animations pasted from elsewhere are repaired');
      } finally { copySel.tip = tip0; animStop(); back(); unslide(); }
    }, 180000);

    test('slide background: a color of its own on the canvas and in every export, light labels on a dark slide, fig.get / fig.set, the panel, merge, undo', async () => {
      if (!hasShow) throw new Skip('this editor has no slide backgrounds');
      try {
        const [a, b, c] = await three(); room(); fig.slide(2); fig.add('plot', { id: 'pl', x: 800, y: 600, kind: 'bar', data: 'A: 1\nB: 2' }); fig.add('text', { id: 'dk', x: 300, y: 800, text: 'dark words', color: '#111827', size: 30 }); await settle();
        ok(!inkDark(get('pl')), 'dark labels on the white page'); eq(fig.slides().map(s => s.bg), [null, null, null], 'no slide has a background of its own');
        const h0 = hist.length; eq(fig.updateSlide(2, { bg: '#0f172a' }).bg, '#0f172a', 'fig.updateSlide returns the row'); eq(hist.length, h0 + 1, 'one undo step'); await settle();
        eq([pageBg(), scene.bg, D.querySelector('#bg').getAttribute('fill')], ['#0f172a', '#ffffff', '#0f172a'], 'the canvas shows the slide\'s color, the file keeps its own'); ok(inkDark(get('pl')), 'the chart\'s labels are light on the dark slide');
        eq([fig.get().bg, fig.get({ slides: true }).bg, fig.get({ slides: true }).slides[1].bg], ['#0f172a', '#ffffff', '#0f172a'], 'fig.get: the slide as a figure carries its background');
        { const k = Object.keys(scene.slides[1]); eq(k[k.length - 1], 'objects', 'the elements stay the slide\'s last key'); }
        fig.slide(1); eq([pageBg(), D.querySelector('#bg').getAttribute('fill')], ['#ffffff', '#ffffff'], 'another slide keeps the file\'s'); fig.slide(2); await settle();
        // the color check judges text against the slide's background
        ok(colorCheck().text.some(x => x.id === 'dk' && x.bg === '#0f172a'), 'dark text on the dark slide is reported'); fig.remove('dk');
        // every export of the slide
        const BG = '<rect width="1600" height="900" fill="#0f172a"/>'; ok((await svgString({})).includes(BG), 'SVG'); ok(!(await svgString({ transparent: true })).includes(BG), 'a transparent SVG has no background');
        { const sv = []; await slideEach([0, 1, 2], async i => { sv.push(await svgString({})); }); eq(sv.map(s => s.includes(BG)), [false, true, false], 'each slide\'s picture has its own background'); eq(CUR, 1, 'back on the slide shown'); }
        { const png = await makePng(160, 72), im = new Image(); im.src = URL.createObjectURL(new Blob([png.bytes], { type: 'image/png' })); await im.decode(); const cv = D.createElement('canvas'); cv.width = 160; cv.height = 90; const x = cv.getContext('2d'); x.drawImage(im, 0, 0); URL.revokeObjectURL(im.src);
          eq([...x.getImageData(2, 2, 1, 1).data], [15, 23, 42, 255], 'PNG'); }
        if (typeof makeTiff === 'function' && typeof tiffDecode === 'function') { const t = await makeTiff(80, 72, { lzw: false }), d = tiffDecode(new Uint8Array(await t.blob.arrayBuffer())); if (d && d.data) eq([...d.data.slice(0, 3)], [15, 23, 42], 'TIFF'); }
        { const seen = [], o = W.pdfCol; W.pdfCol = v => { seen.push(String(v)); return o(v); }; try { const r = await makePdf({ mm: 100, dpi: 72 }); eq(r.pages, 3, 'PDF pages'); } finally { W.pdfCol = o; } eq(seen.filter(v => /0f172a|15, ?23, ?42/i.test(v)).length, 1, 'one PDF page is painted in the slide\'s color'); }
        { let p; try { p = await exportPptx(); } catch (e) { if (!opts.strict && OFFLINE.test(e.message)) p = null; else throw e; }
          if (p) { const Z = await JSZip.loadAsync(p.blob), zt = n => Z.file(n).async('string'); ok(/<p:bg>.*0F172A/.test(await zt('ppt/slides/slide2.xml')), 'the PowerPoint slide has the background'); ok(!/0F172A/.test(await zt('ppt/slides/slide1.xml')), 'the others do not'); } }
        ok(slideThumbSvg(1, 96).includes('fill="#0f172a"') && !slideThumbSvg(0, 96).includes('#0f172a'), 'thumbnails'); ok(sceneSvg({ w: 100, h: 100, bg: '#ffffff', slides: [{ id: 'x', bg: '#123456', objects: [] }] }, 50, 50).includes('#123456'), 'a file\'s preview (Home) shows its first slide\'s background');
        // fig.set of a slide: a background other than the file's is the slide's own
        { const g = fig.get(); fig.set(g); eq([scene.bg, scene.slides[1].bg, scene.slides[0].bg], ['#ffffff', '#0f172a', undefined], 'fig.set(fig.get()) changes nothing'); g.bg = '#ffffff'; fig.set(g); eq(scene.slides[1].bg, undefined, 'the file\'s color: none of its own'); g.bg = '#0f172a'; fig.set(g); eq([scene.bg, scene.slides[1].bg], ['#ffffff', '#0f172a'], 'and back'); await settle(); }
        // a color like any other; undo; a copy keeps it
        eq(recolorFig({ '#0f172a': '#111111' }) >= 1, true, 'recolorFig counts it'); commit(); eq(scene.slides[1].bg, '#111111', 'recolored'); undo(); eq(scene.slides[1].bg, '#0f172a', 'undo'); redo(); undo();
        fig.duplicateSlide(2); eq(fig.slides().map(s => s.bg), [null, '#0f172a', '#0f172a', null], 'a duplicate keeps the background'); fig.removeSlide(3); fig.slide(2); await settle();
        // the Page panel: the tick box, the color field, Use for all slides
        sel = new Set(); buildPanel(); let cb = D.querySelector('#props #slBgOwn'); ok(cb && cb.checked && /Different background color for this slide/.test(cb.closest('label').textContent), 'the tick box is on'); ok(D.querySelector('#slBgRow input[type=color]'), 'with a color field');
        cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); eq([fig.slides()[1].bg, pageBg()], [null, '#ffffff'], 'off: the slide follows the file again'); ok(!D.querySelector('#slBgRow'), 'and the color field goes');
        cb = D.querySelector('#props #slBgOwn'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); eq(fig.slides()[1].bg, '#ffffff', 'on: its own color, starting as the file\'s'); eq(pageBg(), '#ffffff');
        { const ci = D.querySelector('#slBgRow input[type=color]'); ci.value = '#223344'; ci.dispatchEvent(new Event('input', { bubbles: true })); ci.dispatchEvent(new Event('change', { bubbles: true })); eq([fig.slides()[1].bg, D.querySelector('#bg').getAttribute('fill'), scene.bg], ['#223344', '#223344', '#ffffff'], 'the color field sets the slide\'s color'); }
        { const hh = hist.length; D.querySelector('#slBgAll button').click(); eq([scene.bg, fig.slides().map(s => s.bg)], ['#223344', [null, null, null]], 'Use for all slides'); eq(hist.length, hh + 1, 'in one step'); undo(); eq([scene.bg, fig.slides()[1].bg], ['#ffffff', '#223344'], 'undone'); }
        // null removes; errors; a file's broken value is dropped
        eq(fig.updateSlide(2, { bg: null }).bg, null, 'null removes it'); ok(th(() => fig.updateSlide(2, { bg: '"><x' })) && th(() => fig.updateSlide(2, { bg: 5 })), 'not a color: refused');
        { const h = healScene({ w: 800, h: 600, bg: '#ffffff', slides: [{ id: 'x', bg: '"><script>', objects: [] }, { id: 'y', bg: 5, objects: [] }, { id: 'z', bg: ' #abcdef ', objects: [] }] }); eq(h.slides.map(s => s.bg), [undefined, undefined, '#abcdef'], 'healing'); }
        // merged like a slide's name: the other side's color arrives, this side's change stays
        { const B = JSON.parse(lastSaved), M = JSON.parse(lastSaved), T = JSON.parse(lastSaved); T.slides[1].bg = '#00ff00'; M.slides[0].name = 'mine'; const m = mgMerge(B, M, T).scene; eq([m.slides[1].bg, m.slides[0].name], ['#00ff00', 'mine'], 'merge'); const k = Object.keys(m.slides[1]); eq(k[k.length - 1], 'objects', 'elements last after a merge'); }
        // a figure brought in as a slide keeps its background
        { const n = slidesImport([['zz-dark.json', { version: 4, w: 1600, h: 900, bg: '#101010', objects: [{ id: 'q', type: 'text', x: 100, y: 100, text: 'in' }] }], ['zz-same.json', { version: 4, w: 1600, h: 900, bg: '#FFFFFF', objects: [] }]]); eq(n, 2, 'two slides brought in'); const S = fig.slides(); eq([S[2].bg, S[3].bg], ['#101010', null], 'the dark one keeps its color, the white one follows the file'); }
        // a single slide with its own color becomes a plain figure of that color
        unslide(); blank(); ok(th(() => fig.updateSlide(1, { bg: '#000000' })), 'a plain figure: refused, with a hint'); fig.addSlide({}); fig.updateSlide(1, { bg: '#333333' }); fig.removeSlide(2); eq([isDeck(scene), scene.bg], [false, '#333333'], 'one slide left: its color is the figure\'s');
      } finally { unslide(); blank(); }
    });
    test('transitions: the model and its checks, the thumbnail mark, the Page panel, Preview, Apply to all, PowerPoint', async () => {
      if (!hasShow) throw new Skip('this editor has no transitions');
      try {
        const [a, b, c] = await three(); room(); eq(fig.slides().map(s => s.trans), [null, null, null], 'none to begin with');
        const h0 = hist.length; eq(fig.updateSlide(2, { trans: { fx: 'push' } }).trans, { fx: 'push', dir: 'u', dur: 1 }, 'Push: from the bottom, 1 s (PowerPoint\'s defaults)'); eq(hist.length, h0 + 1, 'one undo step');
        eq(fig.updateSlide(3, { trans: { fx: 'fade' } }).trans, { fx: 'fade', dur: 0.7 }, 'Fade: 0.7 s'); eq(fig.updateSlide(3, { trans: { fx: 'fade', dur: 99, advance: '4' } }).trans, { fx: 'fade', dur: 20, advance: 4 }, 'numbers in their range');
        ok(th(() => fig.updateSlide(2, { trans: { fx: 'zoom' } })) && th(() => fig.updateSlide(2, { trans: { fx: 'push', dir: 'x' } })) && th(() => fig.updateSlide(2, { trans: 'fade' })), 'an unknown effect or direction is refused');
        eq(fig.updateSlide(3, { trans: null }).trans, null, 'null removes it'); eq(fig.updateSlide(3, { trans: { fx: 'none' } }).trans, null, '"none" is none'); eq(fig.updateSlide(3, { trans: { fx: 'none', advance: 2 } }).trans, { fx: 'none', advance: 2 }, 'only an advance time'); fig.updateSlide(3, { trans: null });
        { const k = Object.keys(scene.slides[1]); eq(k[k.length - 1], 'objects', 'the elements stay the slide\'s last key'); }
        // a file's own spelling is kept and reported; it plays as none
        { const h = healScene({ w: 800, h: 600, slides: [{ id: 'x', trans: { fx: 'zoom', dur: 'x' }, objects: [] }, { id: 'y', trans: { fx: 'push', dir: 'sideways', dur: '2' }, objects: [] }, { id: 'z', trans: 'fade', objects: [] }, { id: 'q', trans: { fx: 'fade<', advance: -3 }, objects: [] }] });
          eq(h.slides.map(s => s.trans && s.trans.fx), ['zoom', 'push', undefined, 'fade'], 'healing keeps what the file says'); eq(h.slides[1].trans, { fx: 'push', dir: 'sideways', dur: 2 }); eq(h.slides[3].trans.advance, 0); eq([transOf(h.slides[0]), transOf(h.slides[1]).dir], [null, 'u'], 'what plays'); }
        scene.slides[0].trans = { fx: 'zoom' }; ok(fig.check({ slides: true }).some(r => r.slide === 1 && r.level === 'error' && /unknown effect "zoom"/.test(r.msg)), 'fig.check names an unknown effect'); fig.slide(1); ok(fig.check().some(r => /unknown effect/.test(r.msg)), 'also for the slide shown');
        scene.slides[0].trans = { fx: 'push', dir: 'x' }; ok(fig.check().some(r => /unknown direction "x"/.test(r.msg)), 'and an unknown direction'); delete scene.slides[0].trans; ok(!fig.check().some(r => /slide transition/.test(r.msg)), 'nothing to say about a good one'); commit();
        // the mark on the thumbnail
        slideStrip1(); { const L = [...D.querySelectorAll('#slList .sl')]; eq(L.map(x => !!x.querySelector('.sltr')), [false, true, false], 'the slide with a transition is marked'); ok(/transition Push from bottom/.test(L[1].getAttribute('aria-label')), 'and named for screen readers'); }
        // the Page panel
        fig.slide(2); sel = new Set(); buildPanel(); const P = D.querySelector('#props'), fxb = k => P.querySelector('.trfx[data-fx=' + k + ']'), set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
        eq([...P.querySelectorAll('.trfx')].map(x => [x.dataset.fx, x.getAttribute('aria-checked'), x.tabIndex]), [['none', 'false', -1], ['fade', 'false', -1], ['push', 'true', 0]], 'the gallery shows Push chosen'); ok([...P.querySelectorAll('.trfx')].every(x => x.title && x.querySelector('svg')), 'picture buttons with a title');
        ok(P.querySelector('select[data-k=dir]') && P.querySelector('input[data-k=dur]'), 'direction and duration'); fxb('fade').click(); eq(fig.slides()[1].trans, { fx: 'fade', dur: 0.7 }, 'Fade from the gallery'); ok(!P.querySelector('select[data-k=dir]'), 'no direction for a fade'); if (transPreview.stop) transPreview.stop();
        fxb('none').click(); eq(fig.slides()[1].trans, null, 'None'); ok(!P.querySelector('input[data-k=dur]') && P.querySelector('#trBtns button').disabled, 'no duration, no Preview'); fxb('push').click(); eq(fig.slides()[1].trans, { fx: 'push', dir: 'u', dur: 1 }, 'Push again'); if (transPreview.stop) transPreview.stop();
        { const hh = hist.length; set(P.querySelector('select[data-k=dir]'), 'r'); eq(fig.slides()[1].trans.dir, 'r', 'From Left'); eq(P.querySelector('select[data-k=dir]').selectedOptions[0].textContent, 'From Left'); eq(hist.length, hh + 1, 'one step'); set(P.querySelector('input[data-k=dur]'), '0'); eq([fig.slides()[1].trans.dur, P.querySelector('input[data-k=dur]').value], [0.05, '0.05'], 'a duration out of range: the field shows what was stored'); set(P.querySelector('input[data-k=dur]'), '1.5'); eq(fig.slides()[1].trans.dur, 1.5, 'duration'); P.querySelector('#trAdv').focus(); set(P.querySelector('#trAdv'), '4'); ok(D.activeElement && D.activeElement.id === 'trAdv', 'the advance field keeps the focus'); eq(fig.slides()[1].trans, { fx: 'push', dir: 'r', dur: 1.5, advance: 4 }, 'advance after 4 s'); set(P.querySelector('#trAdv'), ''); eq(fig.slides()[1].trans.advance, undefined, 'empty: on click'); }
        { const g = P.querySelector('.trgal'); fxb('push').focus(); fxb('push').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); eq(fig.slides()[1].trans.fx, 'fade', 'the arrow keys pick the next one'); if (transPreview.stop) transPreview.stop(); fig.updateSlide(2, { trans: { fx: 'push', dir: 'r', dur: 1.5 } }); }
        // Preview: two layers over the page, gone afterwards, nothing changed
        { const hh = hist.length; ok(transPreview(1), 'Preview plays'); const pv = D.querySelector('#transPrev'); ok(pv && pv.children.length === 2, 'two layers over the page'); ok(pv.children[1].getAnimations().length === 1 && pv.children[0].getAnimations().length === 1, 'both move'); transPreview.stop(); ok(!D.querySelector('#transPrev'), 'gone'); eq(hist.length, hh, 'no step'); ok(!transPreview(0), 'no transition: nothing to play'); }
        // Apply to all slides: one step
        { const hh = hist.length; P.querySelectorAll('#trBtns button')[1].click(); eq(fig.slides().map(s => s.trans && s.trans.fx + s.trans.dir), ['pushr', 'pushr', 'pushr'], 'every slide'); eq(hist.length, hh + 1, 'in one step'); undo(); eq(fig.slides().map(s => !!s.trans), [false, true, false], 'undone'); }
        // merged as a field of the slide
        { const B = JSON.parse(lastSaved), M = JSON.parse(lastSaved), T = JSON.parse(lastSaved); T.slides[2].trans = { fx: 'fade', dur: 0.7 }; eq(mgMerge(B, M, T).scene.slides[2].trans, { fx: 'fade', dur: 0.7 }, 'merge'); }
        // PowerPoint: its own transitions, before the timing
        eq(pptxTrans({ fx: 'push', dir: 'l', dur: 1 }).includes('<p:push/>'), true, 'the format\'s default direction is left out'); eq(pptxTrans({ fx: 'zoom' }), '', 'an unknown one is not written'); eq(pptxTrans(null), '');
        fig.updateSlide(1, { trans: { fx: 'fade', dur: 0.7, advance: 3 } }); fig.slide(2); fig.add('shape', { id: 'sq', x: 900, y: 500, w: 120, h: 120, kind: 'rect' }); fig.animate('sq', { fx: 'fade' }); await settle();
        let p; try { p = await exportPptx(); } catch (e) { if (!opts.strict && OFFLINE.test(e.message)) throw new Skip('PowerPoint library not reachable (offline): ' + e.message); throw e; }
        const Z = await JSZip.loadAsync(p.blob), zt = n => Z.file(n).async('string'), x1 = await zt('ppt/slides/slide1.xml'), x2 = await zt('ppt/slides/slide2.xml'), x3 = await zt('ppt/slides/slide3.xml');
        ok(/<mc:Choice[^>]*Requires="p14"><p:transition spd="med" p14:dur="700" advTm="3000"><p:fade\/><\/p:transition><\/mc:Choice><mc:Fallback><p:transition spd="med" advTm="3000"><p:fade\/><\/p:transition><\/mc:Fallback>/.test(x1), 'slide 1: Fade, 0.7 s, advancing after 3 s');
        ok(/<p:transition spd="slow" p14:dur="1500"><p:push dir="r"\/><\/p:transition>/.test(x2), 'slide 2: Push from the left, 1.5 s'); ok(x2.indexOf('AlternateContent') > x2.indexOf('</p:clrMapOvr>') && x2.indexOf('<p:timing') > x2.indexOf('</mc:AlternateContent>'), 'after the color map, before the animations');
        ok(!/p:transition/.test(x3), 'slide 3: none'); for (const x of [x1, x2, x3]) ok(!new DOMParser().parseFromString(x, 'application/xml').querySelector('parsererror'), 'well-formed');
        // the last slide with a transition stays a file with slides
        fig.removeAnim(fig.anims()[0].id); fig.removeSlide(3); fig.removeSlide(1); eq([isDeck(scene), scene.slides && scene.slides.length], [true, 1], 'one slide with a transition is still a slide'); fig.updateSlide(1, { name: '', trans: null }); ok(!isDeck(scene), 'without it: a plain figure');
      } finally { if (typeof transPreview === 'function' && transPreview.stop) transPreview.stop(); unslide(); blank(); }
    });
    test('presenting: start, click steps, back, jump, black and white, the end; keys, clicks and the bar; transitions on two layers; the presenter view; nothing is changed', async () => {
      if (!hasShow) throw new Skip('this editor cannot present');
      const key = (k, o, t) => (t || W).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...(o || {}) })), P = () => fig.presenting(), q = s => D.querySelector(s), wo = W.open; let fr = null;
      const op = on => getComputedStyle(SHOW.cur.of.get(on)[0].svg).opacity, still = () => waitFor(() => SHOW && !SHOW.tr && !SHOW.run, 6000);
      try {
        const [a, b, c] = await three(); room(); fig.slide(2); fig.add('shape', { id: 's1', x: 500, y: 500, w: 200, h: 200, kind: 'rect' }); fig.add('shape', { id: 's2', x: 900, y: 500, w: 200, h: 200, kind: 'ellipse' }); fig.add('comment', { id: 'cm', x: 300, y: 300, text: 'a note' });
        fig.animate('s1', { fx: 'fade', dur: 0.1 }); fig.animate('s2', { fx: 'fly', dir: 'l', dur: 0.1 }); fig.updateSlide(2, { trans: { fx: 'push', dir: 'u', dur: 0.3 } }); fig.updateSlide(3, { trans: { fx: 'fade', dur: 0.3 }, bg: '#0f172a' }); fig.slide(1); await settle();
        eq(P(), null, 'not presenting'); const h0 = hist.length, was = J(fig.get({ slides: true }));
        const p = await fig.present({ fullscreen: false }); eq([p.slide, p.step, p.slides, p.steps, p.end], [1, 0, 3, 0, false], 'from the beginning'); ok(q('#show') && D.documentElement.classList.contains('showing'), 'the show covers the editor'); ok(syncBusy(), 'the file is not read meanwhile');
        eq(SHOW.fit.children.length, 1, 'one layer'); { const r = SHOW.fit.getBoundingClientRect(), e = q('#show').getBoundingClientRect(); near(r.width / r.height, 1600 / 900, 0.01, 'the slide keeps its shape'); ok(Math.abs(r.width - e.width) < 2 || Math.abs(r.height - e.height) < 2, 'and fills the window one way'); }
        ok(SHOW.cur.host.shadowRoot.querySelector('svg.al text'), 'drawn as a vector picture'); ok(!SHOW.slides[1].svg.includes('a note') && !/class="[^"]*\b(note|hit)\b/.test(SHOW.slides[1].svg), 'no comments or handles in the show');
        // → : the next slide arrives with its transition (Push: both layers move), then stands at step 0 with nothing of its animations showing
        key('ArrowRight'); ok(SHOW.tr && SHOW.fit.children.length === 2, 'the transition runs on two layers'); eq([...SHOW.fit.children].map(h => h.getAnimations().length), [1, 1], 'Push moves the old and the new slide'); ok(await still(), 'it ends'); eq(SHOW.fit.children.length, 1, 'one layer again');
        eq([P().slide, P().step, P().steps], [2, 0, 2], 'slide 2, before its first click'); eq([op('s1'), op('s2')], ['0', '0'], 'what comes in by a click is not there yet');
        key(' '); eq(P().step, 1, 'Space: the first step'); ok(await still()); eq([op('s1'), op('s2')], ['1', '0'], 'the first element is in');
        key('Backspace'); eq([P().step, !!SHOW.run, op('s1')], [0, false, '0'], 'back: the state before, at once'); key('n'); key('N'); eq(P().step, 2, 'N twice: a press while a step plays finishes it and goes on'); ok(await still()); eq([op('s1'), op('s2')], ['1', '1'], 'both are in');
        // the next slide fades in (one layer animates); its own background
        key('PageDown'); ok(SHOW.tr, 'Fade'); eq([...SHOW.fit.children].map(h => h.getAnimations().length), [0, 1], 'the new slide fades in over the old one'); ok(await still()); eq([P().slide, SHOW.cur.host.style.background.replace(/\s/g, '')], [3, 'rgb(15,23,42)'], 'slide 3 on its own background');
        key('ArrowLeft'); eq([P().slide, P().step, !!SHOW.tr], [2, 2, false], 'back: the slide before as it was left, without a transition'); eq([op('s1'), op('s2')], ['1', '1']);
        key('p'); key('ArrowUp'); key('PageUp'); eq([P().slide, P().step], [1, 0], 'P, ↑, PageUp go back');
        // a number and Enter; Home and End; B and W
        key('3'); ok(!q('#shNum').hidden && /3/.test(q('#shNum').textContent), 'the number typed shows'); key('Enter'); eq([P().slide, q('#shNum').hidden], [3, true], 'number + Enter jumps'); key('Home'); eq(P().slide, 1, 'Home'); key('End'); eq(P().slide, 3, 'End'); key('2'); key('Enter'); eq([P().slide, P().step], [2, 0], 'a jump starts the slide');
        key('b'); eq([P().blank, q('#shBlank').hidden], ['black', false], 'B: a black screen'); key('ArrowRight'); eq([P().blank, P().slide, P().step], [null, 2, 0], 'the next key only brings the slide back'); key(','); eq(P().blank, 'white', ', is white'); key('w'); eq(P().blank, null, 'W again: the slide'); key('.'); eq(P().blank, 'black'); key('.');
        // keys of the browser stay its own; nothing reaches the editor
        { const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }); W.dispatchEvent(e); ok(!e.defaultPrevented, 'Ctrl+Z is left alone'); eq(hist.length, h0, 'and undoes nothing'); const d = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }); D.dispatchEvent(d); eq(J(fig.get({ slides: true })), was, 'Delete deletes nothing'); }
        // the end
        key('End'); key('Enter'); eq([P().end, q('#shEnd').hidden, /End of slideshow/.test(q('#shEnd').textContent)], [true, false, true], 'after the last slide: the end screen'); key('ArrowLeft'); eq([P().end, P().slide], [false, 3], 'back from it');
        key('ArrowRight'); key('ArrowRight'); eq([P(), !!q('#show'), D.documentElement.classList.contains('showing')], [null, false, false], 'one more: the show is over'); eq([CUR, fig.slide().id], [2, c], 'the editor is on the slide last shown');
        eq([hist.length, J(fig.get({ slides: true })), isClean()], [h0, was, true], 'nothing changed, no undo step, nothing to save');
        // clicks, the bar, Tab, Escape
        fig.slide(1); await fig.present({ from: 2, fullscreen: false }); eq([P().slide, P().step], [2, 0], 'from a slide'); const el = q('#show'); el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })); eq(P().step, 1, 'a click is "next"'); await still();
        ok([...el.querySelectorAll('#shBar button')].every(x => x.title && x.getAttribute('aria-label')), 'the bar\'s buttons are named'); q('#shPrev').click(); eq(P().step, 0, 'the bar: back'); q('#shNext').click(); eq(P().step, 1, 'the bar: next'); await still(); eq(/^2 \/ 3$/.test(q('#shPos').textContent), true, 'slide n / N');
        key('Tab'); ok(D.activeElement && D.activeElement.closest('#shBar'), 'Tab goes to the bar, not into the editor'); { const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); D.activeElement.dispatchEvent(e); ok(!e.defaultPrevented, 'Enter on a button presses that button'); eq(P().step, 1); }
        // a finger: tap the left half = back, the right half = next, a swipe to the left = next
        { const r = el.getBoundingClientRect(), tp = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, button: 0 })), tap = (x, y) => { tp('pointerdown', x, y); tp('pointerup', x, y); };
          tap(r.left + r.width * .2, r.top + r.height / 2); eq(P().step, 0, 'tap left: back'); tap(r.left + r.width * .8, r.top + r.height / 2); eq(P().step, 1, 'tap right: next'); await still(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })); eq(P().step, 1, 'the click a tap also sends does not count twice');
          tp('pointerdown', r.left + r.width * .7, r.top + 200); tp('pointerup', r.left + r.width * .3, r.top + 210); eq(P().step, 2, 'swipe left: next'); await still(); tp('pointerdown', r.left + r.width * .3, r.top + 200); tp('pointerup', r.left + r.width * .7, r.top + 190); eq(P().step, 1, 'swipe right: back'); }
        key('Escape'); eq([P(), CUR], [null, 1], 'Escape ends it, on the slide it showed');
        // F5 and Shift+F5 in the editor; not while a dialog is open
        { const e = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }); D.dispatchEvent(e); ok(e.defaultPrevented, 'F5 is taken'); ok(await waitFor(() => P() && P().slide === 1, 8000), 'F5: from the beginning'); const e2 = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }); W.dispatchEvent(e2); ok(e2.defaultPrevented && P(), 'F5 in the show does not reload the page'); fig.present(false); eq(P(), null, 'fig.present(false)');
          fig.slide(3); key('F5', { shiftKey: true }, D); ok(await waitFor(() => P() && P().slide === 3, 8000), 'Shift+F5: from this slide'); key('Escape'); }
        ok(th(() => { throw 0; }) && await fig.present({ from: 99 }).then(() => false, () => true), 'an unknown slide is an error'); eq(P(), null);
        // a slide that moves on by itself
        fig.updateSlide(1, { trans: { fx: 'none', advance: 0.05 } }); await fig.present({ fullscreen: false }); ok(await waitFor(() => P() && P().slide === 2, 4000), 'advance after a time'); showOff(); fig.updateSlide(1, { trans: null }); await settle();
        // the presenter view (a frame stands in for the second window)
        fr = D.createElement('iframe'); fr.style.cssText = 'position:fixed;left:0;top:0;width:1100px;height:700px;border:0;opacity:0;pointer-events:none'; D.body.appendChild(fr); W.open = () => fr.contentWindow;
        const pp = await fig.present({ from: 2, view: true }); ok(pp.view && SHOW.view, 'the view is open'); const pd = fr.contentDocument, g = id => pd.getElementById(id);
        ok(/^Slide 2 of 3/.test(g('pvPos').textContent) && /Two/.test(g('pvPos').textContent), 'slide n of N and its name'); eq(g('pvNotes').textContent, 'Notes for two', 'the speaker notes'); eq(g('pvNextH').textContent, 'Next: click 1 of 2', 'what the next click brings');
        ok(g('pvCur').querySelector('.shL').shadowRoot.querySelector('svg.al') && g('pvNext').querySelector('.shL').shadowRoot.querySelector('svg.al'), 'this slide and the next step are drawn'); ok(/^\d+:\d\d$/.test(g('pvTimer').textContent) && /\d/.test(g('pvClock').textContent), 'a timer and a clock');
        { const vi = pd.querySelector('link[rel="icon"]'); ok(vi && vi.getAttribute('href') === D.querySelector('link[rel="icon"]').getAttribute('href'), 'the view\'s window has the app icon'); }
        { const r = g('pvCur').getBoundingClientRect(); near(r.width / r.height, 1600 / 900, 0.02, 'the slide keeps its shape there'); ok(r.width > 300, 'at a size to read'); }
        g('pvNextB').click(); eq(P().step, 1, 'Next in the view moves the show'); await still(); eq(g('pvNextH').textContent, 'Next: click 2 of 2'); eq(getComputedStyle(SHOW.view.cur.of.get('s1')[0].svg).opacity, '1', 'the view shows the slide in its animation state'); eq(getComputedStyle(SHOW.view.cur.of.get('s2')[0].svg).opacity, '0');
        key('ArrowRight', null, fr.contentWindow); eq(P().step, 2, 'a key in the view moves the show'); await still(); ok(/^Next: slide 3/.test(g('pvNextH').textContent), 'then the next slide'); key('ArrowRight'); await still(); eq(P().slide, 3); ok(/^Slide 3 of 3/.test(g('pvPos').textContent), 'the view follows the show'); ok(/No notes/.test(g('pvNotes').textContent) && g('pvNotes').classList.contains('none'), 'a slide without notes says so'); ok(g('pvNext').querySelector('.cover'), 'nothing after the last slide');
        g('pvPrev').click(); eq(P().slide, 2, 'Back in the view'); { const f0 = parseFloat(g('pvNotes').style.fontSize); g('pvLg').click(); eq(parseFloat(g('pvNotes').style.fontSize), f0 + 2, 'larger notes'); g('pvSm').click(); eq(parseFloat(g('pvNotes').style.fontSize), f0, 'smaller notes'); }
        g('pvPause').click(); eq([g('pvPause').textContent, g('pvTimer').classList.contains('paused')], ['Resume', true], 'the timer pauses'); g('pvPause').click(); g('pvReset').click(); eq(g('pvTimer').textContent, '0:00', 'and starts again');
        key('b'); ok(g('pvCur').querySelector('.cover'), 'a black screen is said in the view'); key('b'); ok(!g('pvCur').querySelector('.cover'));
        key('v'); eq([!!SHOW.view, P().view, !!P()], [false, false, true], 'V closes the view; the show goes on'); W.open = () => null; ok(!showView(true), 'a blocked pop-up: no view'); ok(!q('#shMsg').hidden && /pop-ups/.test(q('#shMsg').textContent), 'and the show says what to do');
        W.open = () => fr.contentWindow; key('v'); ok(SHOW.view, 'V opens it again'); fr.contentDocument.getElementById('pvEnd').click(); eq([P(), !!q('#show')], [null, false], 'End show in the view ends both');
        // a paste in a show changes nothing; a typed number + Enter jumps also from a focused button; a mouse press never leaves the focus on a button of the bar
        { await settle(); const hq = hist.length, wq = J(fig.get({ slides: true })); await fig.present({ from: 3, fullscreen: false }); const el2 = q('#show'), kd = (k, t) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); t.dispatchEvent(e); return e; };
          const pe = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(pe, 'clipboardData', { value: { files: [], items: [], types: ['text/plain'], getData: t => t === 'text/plain' ? 'PASTED IN A SHOW' : '' } }); el2.dispatchEvent(pe); await settle();
          ok(pe.defaultPrevented, 'a paste in the show is refused'); eq([hist.length, J(fig.get({ slides: true }))], [hq, wq], 'and adds nothing, no undo step');
          q('#shPrev').focus(); kd('1', q('#shPrev')); const en = kd('Enter', q('#shPrev')); ok(en.defaultPrevented, 'Enter after a number is the jump, not the focused button'); eq([P().slide, q('#shNum').hidden], [1, true], 'number + Enter jumps from a focused button');
          const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true }); q('#shNext').dispatchEvent(md); ok(md.defaultPrevented, 'a mouse press does not move the focus onto a button of the bar');
          // a finger: the bar is hidden; a tap on the bottom edge only shows it, the next tap there goes on
          const r = el2.getBoundingClientRect(), tp = (t, x, y) => el2.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerType: 'touch', pointerId: 9, clientX: x, clientY: y, button: 0 })), tap = (x, y) => { tp('pointerdown', x, y); tp('pointerup', x, y); };
          el2.focus(); el2.classList.add('idle'); eq(getComputedStyle(q('#shBar')).pointerEvents, 'none', 'the hidden bar takes no taps'); tap(r.left + r.width * .8, r.bottom - 12); eq([el2.classList.contains('idle'), P().slide, P().step], [false, 1, 0], 'a tap on the bottom edge shows the bar and changes nothing'); ok(getComputedStyle(q('#shBar')).pointerEvents !== 'none', 'its buttons can be tapped');
          tap(r.left + r.width * .8, r.bottom - 12); await still(); eq(P().slide, 2, 'with the bar showing, a tap there goes on'); el2.classList.add('idle'); tap(r.left + r.width * .8, r.top + r.height / 2); ok(!el2.classList.contains('idle'), 'every touch shows the bar'); await still();
          key('Escape'); eq(P(), null); }
        // a show started from the Present menu gives the focus back to the Present button
        { const bp = q('#bPresent'); if (bp && bp.offsetParent !== null) { bp.focus(); bp.click(); const mi = q('#ctxMenu button[data-i="1"]'); ok(mi, 'the Present menu'); mi.focus(); mi.click(); ok(await waitFor(() => P() && P().ready, 8000), 'started from the menu'); key('Escape'); eq([P(), D.activeElement && D.activeElement.id], [null, 'bPresent'], 'the focus is back on the Present button'); } }
        // a slide that moves on by itself still does after a black screen and after the window changed its size
        fig.updateSlide(1, { trans: { fx: 'none', advance: 0.4 } }); await fig.present({ fullscreen: false }); key('b'); key('b'); ok(await waitFor(() => P() && P().slide === 2, 4000), 'advance after a black screen'); showOff();
        await fig.present({ fullscreen: false }); W.dispatchEvent(new Event('resize')); ok(await waitFor(() => P() && P().slide === 2, 4000), 'advance after a resize'); showOff(); fig.updateSlide(1, { trans: null }); await settle();
        // pop-ups blocked at the start: the show goes on alone and keeps saying so
        W.open = () => null; { const pb = await fig.present({ view: true, fullscreen: false }); ok(pb && !pb.view, 'no view'); await new Promise(r => setTimeout(r, 300)); ok(!q('#shMsg').hidden && /blocked/.test(q('#shMsg').textContent), 'the message stays when the slides are ready'); showOff(); }
        // the presenter view opened from a full-screen show: the browser leaves full screen for the new window, the show goes on; Esc in full screen still ends it
        { let fsEl = null; Object.defineProperty(D, 'fullscreenElement', { configurable: true, get: () => fsEl }); const fsc = () => D.dispatchEvent(new Event('fullscreenchange'));
          try { await fig.present({ from: 2, fullscreen: false }); fsEl = q('#show'); fsc(); W.open = () => { fsEl = null; fsc(); return fr.contentWindow; }; key('v'); await new Promise(r => setTimeout(r, 250)); ok(P() && P().view, 'the show goes on, with its view');
            const pd2 = fr.contentDocument, g2 = id => pd2.getElementById(id); eq(g2('pvPos').title, g2('pvPos').textContent, 'a long slide name is whole in the tooltip'); const m2 = new MouseEvent('mousedown', { bubbles: true, cancelable: true }); g2('pvPause').dispatchEvent(m2); ok(m2.defaultPrevented, 'a mouse press leaves the keyboard with the show there too');
            key('End'); key('ArrowRight'); ok(P().end && g2('pvNextB').disabled && g2('pvNextB').textContent !== g2('pvEnd').textContent, 'at the end: one End show button'); key('ArrowLeft'); ok(!g2('pvNextB').disabled);
            fsEl = q('#show'); fsc(); fsEl = null; fsc(); eq(P(), null, 'leaving full screen otherwise (Esc) ends the show'); } finally { fsEl = null; delete D.fullscreenElement; showOff(); } }
        W.open = () => fr.contentWindow;
        // a plain figure presents as one slide
        unslide(); blank(); fig.add('text', { id: 'only', x: 300, y: 300, text: 'Only' }); await settle(); const hp = hist.length, p1 = await fig.present({ fullscreen: false }); eq([p1.slide, p1.slides, p1.steps], [1, 1, 0], 'one slide'); key('ArrowRight'); ok(P().end, 'then the end'); key('ArrowRight'); eq([P(), hist.length, isDeck(scene)], [null, hp, false], 'over; still a plain figure, no step');
        // F5 while typing in place on the canvas presents too (the page is not loaded again) and keeps the text
        { editText(scene.objects.find(o => o.id === 'only')); const ta = q('.inline-edit'); ok(ta, 'typing in place'); const e = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }); ta.dispatchEvent(e); ok(e.defaultPrevented, 'F5 from the text is taken'); ok(await waitFor(() => P() && P().ready, 8000), 'and presents'); ok(!q('.inline-edit'), 'the typing is finished'); showOff(); }
        // the last transition of a one-slide file taken away: a plain figure again in that same step
        { fig.addSlide({}); fig.updateSlide(1, { trans: { fx: 'fade' } }); fig.removeSlide(2); await settle(); ok(isDeck(scene) && fig.slides()[0].trans, 'one slide with a transition stays a file with slides'); const hh = hist.length; fig.updateSlide(1, { trans: null }); eq([isDeck(scene), hist.length], [false, hh + 1], 'plain again, one step'); await settle(); ok(isClean(), 'and saved as that'); undo(); ok(isDeck(scene) && fig.slides()[0].trans && fig.slides()[0].trans.fx === 'fade', 'one undo brings the transition back'); }
      } finally { W.open = wo; showOff(); if (fr) fr.remove(); unslide(); blank(); }
    }, 180000);
    // ---------- Home (the page of all figures) ----------
    // the figures these tests make are named <scratch figure>-ws-home-…, so wsClean and the runners' own clean-up remove them; every action on several figures runs with the
    // search box holding that name, and only after the cards shown are checked to be the tests' own (the folder may hold the user's figures)
    const hmPre = () => wsPre() + '-home', hmMain = () => D.querySelector('#hmMain'), hmCard = n => hmMain().querySelector('.hmc[data-n="' + n + '"]');
    const hmShown = () => [...hmMain().querySelectorAll('.hmc[data-n]')].map(c => c.dataset.n);
    const hmIn = async sc => ((await listFiles(sc)) || []).map(f => f.name).filter(n => n.startsWith(hmPre())).sort();
    const hmClick = (el, o = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...o }));
    const hmKey = (k, o = {}, t = D) => t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
    const hmWait = async (f, ms = 10000) => { const t0 = Date.now(); for (;;) { let v = false; try { v = await f(); } catch (e) {} if (v) return true; if (Date.now() - t0 > ms) return false; await sleep(50); } };
    const hmSearch = async q => { ok(await waitFor(() => hmMain().querySelector('.hmq')), 'no search box'); const i = hmMain().querySelector('.hmq'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); await frame(); };
    // a section with only the tests' figures in sight, ready for the next action
    const hmOpen = async (sec, want) => { fig.home(sec); await HOME.ctx.reload(); await hmSearch(hmPre()); if (want) ok(await waitFor(() => J(hmShown().slice().sort()) === J(want.slice().sort())), sec + ' shows ' + J(hmShown()) + ', expected ' + J(want)); ok(hmShown().every(n => n.startsWith(hmPre())), 'a figure that is not the tests\' own is in sight: ' + J(hmShown())); ok(await waitFor(() => !hmMain().querySelector('.hmbulk button:disabled')), 'an action is still running'); };
    const hmDlg = s => waitFor(() => !D.querySelector('#modal').hidden && D.querySelector('#modalBox ' + s));   // a dialog that shows now (a closed one keeps its content)
    const hmBulk = a => hmMain().querySelector('.hmbulk [data-act="' + a + '"]'), hmN = () => hmMain().querySelector('.hmbulk .hmn').textContent, hmMake = async (names, body) => { for (const n of names) ok((await fetch(encodeURIComponent(n), { method: 'POST', body: body || wsFig(n) })).ok, 'could not make ' + n); };
    test('home: opens and closes (button, logo, File menu, fig.home, Esc), keeps the keys from the canvas, and saves nothing in the figure', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      blank(); const id = fig.add('text', { x: 300, y: 300, text: 'stays' }); await settle(); commit(); const before = J(scene), H = D.querySelector('#home'), head = D.querySelector('body > header');
      try {
        eq(fig.home(), false, 'Home at the start of a page opened with ?file='); ok(H.hidden, '#home shows');
        eq(fig.home(true), true, 'fig.home(true)'); ok(!H.hidden && D.documentElement.classList.contains('home-on'), 'Home is not shown'); ok(head.inert === true || !('inert' in head), 'the editor behind Home is in reach of Tab');
        eq(+getComputedStyle(H).zIndex < +getComputedStyle(D.querySelector('#modal')).zIndex && +getComputedStyle(H).zIndex < +getComputedStyle(D.querySelector('#ctxMenu')).zIndex, true, 'Home lies over dialogs or menus');
        ok(/Back to /.test(D.querySelector('#hmBack').textContent) && D.querySelector('#hmBack').textContent.includes(BASE), 'the Back button does not name the figure');
        eq([...D.querySelectorAll('#hmNav button')].map(b => b.dataset.sec).slice(0, 4), ['figures', 'archive', 'trash', 'templates'], 'the sections'); eq(D.querySelector('#hmNav [aria-current=page]').dataset.sec, HOME.sec, 'the section shown is marked');
        // the canvas gets no key: Delete, Ctrl+A and the arrows act on Home only
        fig.home('templates');   // a section without a selection: Ctrl+A selects nothing there, so the one Esc below closes Home whether the figure lists are read yet or not
        fig.select(id); const x0 = get(id).x; hmKey('Delete'); hmKey('ArrowRight'); hmKey('a', { ctrlKey: true }); hmKey('z', { ctrlKey: true }); ok(get(id) && get(id).x === x0 && scene.objects.length === 1, 'a key reached the canvas behind Home');
        hmKey('Escape'); eq(fig.home(), false, 'Esc closes Home'); ok(H.hidden && !D.documentElement.classList.contains('home-on') && !head.inert, 'Home left something behind');
        D.querySelector('#bHome').click(); eq(fig.home(), true, 'the Home button'); D.querySelector('#hmBack').click(); eq(fig.home(), false, 'Back to the figure');
        D.querySelector('header .brand').click(); eq(fig.home(), true, 'the logo'); fig.home(false); menuActs.home(); eq(fig.home(), true, 'File ▾ → Home'); ok(D.querySelector('#fileMenu [data-act=home]'), 'no Home item in the File menu'); fig.home(false);
        hmKey('o', { ctrlKey: true }); eq(fig.home(), true, 'Ctrl+O'); fig.home(false);
        eq(fig.home('archive'), true, 'fig.home(section)'); eq(D.querySelector('#hmNav [aria-current=page]').dataset.sec, 'archive', 'the Archive section'); eq(fig.home('zz-no-such-section'), true, 'an unknown section changes nothing'); eq(HOME.sec, 'archive', 'the section after an unknown one');
        hmClick(D.querySelector('#hmNav [data-sec=templates]')); ok(await waitFor(() => hmMain().querySelectorAll('.hmc.hmtpl').length >= NEW_TPLS.length), 'the template cards'); eq(hmMain().querySelector('.hmc.hmtpl').dataset.v, NEW_TPLS[0][0], 'the first template');
        // a template card opens the New figure dialog with that choice made (the name is asked there)
        hmClick(hmMain().querySelector('.hmc.hmtpl[data-v=workflow]')); ok(await hmDlg('#nfTpl'), 'no New figure dialog'); eq(D.querySelector('#nfTpl').value, 'workflow', 'the template chosen on the card'); ok(D.querySelector('#nfName').value, 'no name suggested'); closeModal(); eq(fig.home(), true, 'Home after the dialog');
        // the template cards are grouped as the New figure dialog groups them, each with a name and a second line
        eq([...hmMain().querySelectorAll('h3.hmh')].slice(0, 3).map(h => h.firstChild.textContent), ['Basics', 'Posters', 'Graphical abstracts'], 'the groups of the templates'); eq(D.querySelector('#hmNav [data-sec=templates] .hml').textContent, 'Templates', 'the name in the navigation');
        eq(hmTplName('Blank canvas (1600 × 900)'), ['Blank canvas', '1600 × 900'], 'a template name in two lines'); eq(hmTplName('Workflow: 3 steps with arrows'), ['Workflow', '3 steps with arrows'], 'a template name with a colon');
        ok(hmMain().querySelector('.hmc.hmtpl[data-v=sketch] .hmth').shadowRoot.querySelector('svg path'), 'the Sketch card has no picture of its own');
        // the Figures bar has a New figure button (the same dialog as the + card)
        fig.home('figures'); ok(await waitFor(() => hmMain().querySelector('.hmbar .hmnewb')), 'no New figure button in the bar'); hmClick(hmMain().querySelector('.hmbar .hmnewb')); ok(await hmDlg('#nfTpl'), 'the New figure button opens no dialog'); closeModal(); ok(hmMain().querySelector('.hmnewb').title && hmMain().querySelector('.hmnewb').getAttribute('aria-label') === 'New figure', 'the button has no name');
        fig.home('figures'); fig.home(false); eq(J(scene), before, 'Home changed the figure'); ok(!/"home"|hmc|HOME/.test(J(fig.get({ slides: true }))), 'something of Home is in the figure');
        // the dates as a person says them; the thumbnail of a portrait page shows its top, of a very wide one its left part
        { const now = new Date(), p2 = n => String(n).padStart(2, '0'), st = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()), at = (days, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, h, m);
          eq(hmDate(st(at(0, 9, 5))), 'Today 09:05', 'today'); eq(hmDate(st(at(1, 17, 31))), 'Yesterday 17:31', 'yesterday'); eq(hmDate('2021-11-03 10:00'), 'Nov 3, 2021', 'another year'); ok(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/.test(hmDate(st(at(40, 8, 0)))), 'a date of this year: ' + hmDate(st(at(40, 8, 0)))); eq(hmDate('no date'), 'no date', 'what is no date stays as it is');
          const vb = (w, h) => /viewBox="([^"]*)"/.exec(hmFit(sceneSvg({ version: 4, w, h, objects: [] }, 320, 180), { w, h }))[1]; eq(vb(1600, 900), '0 0 1600 900', 'a 16 : 9 page whole'); eq(vb(1200, 1200), '0 0 1200 1200', 'a square page whole'); eq(vb(2400, 3400), '0 0 2400 1800', 'a portrait page: its top'); eq(vb(4000, 500), '0 0 1500 500', 'a very wide page: its left part'); }
        // the setting: at start where the user left off (the default), Home or the last figure; "Home page" saved by the build before is the default of now
        eq(UI_OPTIONS.start, ['last', 'home', 'figure'], 'the start setting'); eq(uiOld({ start: 'home' }).start, 'last', 'the old default'); eq(uiOld({ start: 'home', v: 2 }).start, 'home', 'Home page, chosen'); eq(uiOld({ start: 'figure' }).start, 'figure', 'The last figure, chosen before');
        const s0 = UI.start; try { eq(fig.prefs({ start: 'figure' }).start, 'figure', 'fig.prefs({start})'); eq(JSON.parse(localStorage.getItem('fig.ui')).v, 2, 'the saved settings carry no version'); appearanceDialog(); ok(D.querySelector('#modalBox [data-k=start][data-v=figure].on') && D.querySelector('#modalBox [data-k=start][data-v=home]') && /Where I left off/.test(D.querySelector('#modalBox [data-k=start][data-v=last]').textContent), 'Appearance has no "At start" row'); closeModal(); eq(fig.prefs({ start: 'home' }).start, 'home', 'Home page'); } finally { fig.prefs({ start: s0 }); if (!D.querySelector('#modal').hidden) closeModal(); }
      } finally { fig.home(false); sel = new Set(); render(); }
    });
    test('home: lists the figures with thumbnails, search filters, sort and view are remembered, the arrow keys move, a broken file is no error', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      const p = hmPre(), names = [p + '-a.json', p + '-b.json'], deck = p + '-deck.json', bad = p + '-bad.json', pref0 = { ...homePref }; let ls0 = null; try { ls0 = localStorage.getItem('fig.home'); } catch (e) {}
      try {
        await wsClean(); await hmMake(names); await hmMake([deck], J({ version: 4, w: 400, h: 300, slides: [{ id: 's1', objects: [{ id: 't1', type: 'text', x: 20, y: 40, s: 1, r: 0, text: 'one' }] }, { id: 's2', objects: [] }] })); await hmMake([bad], '{"this is": "no figure"}');
        fig.home('figures'); await HOME.ctx.reload(); ok(await waitFor(() => hmCard(names[0])), 'the figures are not listed'); const all = (await listFiles()).length;
        ok(hmMain().querySelector('.hmc.hmnew'), 'no New figure card'); eq(hmShown().length, all, 'one card for each figure'); eq(D.querySelector('#hmNav [data-sec=figures] .hmcnt').textContent, String(all), 'the number in the navigation');
        if ((await listFiles()).some(f => f.name === FILE)) ok(hmCard(FILE).classList.contains('cur') && /Open/.test(hmCard(FILE).textContent), 'the open figure is not marked');
        ok(hmCard(names[0]).querySelector('.hmnm').textContent === names[0].replace(/\.json$/, '') && /^Today \d\d:\d\d$/.test(hmCard(names[0]).querySelector('.hmd').textContent) && /\d{4}-\d\d-\d\d \d\d:\d\d/.test(hmCard(names[0]).querySelector('.hmd').title), 'the name without .json and the date: ' + hmCard(names[0]).querySelector('.hmdt').textContent);
        // search: as typed, by name; the New figure card goes while searching; nothing found says so
        await hmSearch(p); eq(hmShown().slice().sort(), [...names, bad, deck].sort(), 'the search result'); ok(!hmMain().querySelector('.hmc.hmnew'), 'the New figure card while searching');
        await hmSearch(p + '-A'); eq(hmShown(), [names[0]], 'the search ignores case'); await hmSearch('zz-no-such-figure-anywhere'); eq(hmShown(), [], 'nothing found'); ok(!hmMain().querySelector('.hmempty').hidden && /zz-no-such-figure-anywhere/.test(hmMain().querySelector('.hmempty').textContent), 'no word about an empty result');
        hmClick(hmMain().querySelector('.hmempty [data-do=clear]')); eq(hmMain().querySelector('.hmq').value, '', 'Clear search'); ok(hmMain().querySelector('.hmempty').hidden && hmShown().length === all && D.activeElement === hmMain().querySelector('.hmq'), 'the list after Clear search');
        // an empty list says what it is for; Figures without a figure offers a new one and the templates (the lists replaced by empty ones for a moment: nothing is moved)
        { const L0 = HOME.lists; try { HOME.lists = { active: [], archive: [], trash: [] }; homeDraw(); const E = () => hmMain().querySelector('.hmempty'); ok(!E().hidden && /No figures yet/.test(E().textContent) && E().querySelector('[data-do=new]') && E().querySelector('[data-do=templates]') && !hmMain().querySelector('.hmc.hmnew'), 'Figures without a figure: ' + E().textContent);
            fig.home('archive'); ok(/Nothing archived yet/.test(E().textContent) && !E().querySelector('button'), 'the empty archive: ' + E().textContent); fig.home('trash'); ok(/The trash is empty/.test(E().textContent) && !hmMain().querySelector('[data-act=empty]'), 'the empty trash: ' + E().textContent);
            fig.home('figures'); hmClick(E().querySelector('[data-do=templates]')); eq(HOME.sec, 'templates', 'Browse templates'); } finally { HOME.lists = L0; fig.home('figures'); homeDraw(); } }
        hmKey('Escape', {}, hmMain().querySelector('.hmq')); eq(hmMain().querySelector('.hmq').value, '', 'Esc in the search box clears it'); eq(fig.home(), true, 'that Esc closed Home'); await hmSearch(p);
        // thumbnails: drawn from the file for the cards in sight (a tab in the background draws nothing: not checked there)
        if (!D.hidden && window.IntersectionObserver) { ok(await waitFor(() => [...names, deck, bad].every(n => hmCard(n) && hmCard(n).querySelector('.hmth').dataset.done), 20000), 'the thumbnails did not come');
          ok(hmCard(names[0]).querySelector('.hmth').shadowRoot.querySelector('svg text, svg g'), 'no picture of the figure'); eq(hmCard(names[0]).querySelector('.hmth').dataset.done, '1', 'a figure\'s thumbnail');
          eq(hmCard(bad).querySelector('.hmth').dataset.done, '0', 'a file that is no figure gets the placeholder'); ok(/2 slides/.test(hmCard(deck).textContent), 'no "2 slides" on a file with slides'); ok(hmThumb.run <= 4, 'more than four files read at a time'); }
        ok(D.querySelector('#modal').hidden, 'a dialog opened for a broken file');
        // sort and view, kept in this browser
        const so = hmMain().querySelector('.hmsort'); so.value = 'name'; so.dispatchEvent(new Event('change', { bubbles: true })); eq(hmShown(), [names[0], names[1], bad, deck], 'sorted by name'); eq(JSON.parse(localStorage.getItem('fig.home')).sort, 'name', 'the sort order is remembered');
        hmClick(hmMain().querySelector('.hmview [data-v=list]')); ok(hmMain().querySelector('.hmgrid').classList.contains('list') && hmMain().querySelector('.hmview [data-v=list]').getAttribute('aria-pressed') === 'true', 'the list view'); eq(JSON.parse(localStorage.getItem('fig.home')).view, 'list', 'the view is remembered');
        { const r = hmCard(names[0]).getBoundingClientRect(), r2 = hmCard(names[1]).getBoundingClientRect(); ok(r.height < 70 && r2.top >= r.bottom - 1 && Math.abs(r.left - r2.left) < 1, 'the list view has no compact rows'); }
        hmClick(hmMain().querySelector('.hmview [data-v=grid]')); ok(!hmMain().querySelector('.hmgrid').classList.contains('list'), 'back to the grid');
        // the keyboard: one card takes Tab, the arrows move on, Space selects, Esc clears the selection first
        eq(hmMain().querySelectorAll('.hmc[tabindex="0"]').length, 1, 'cards in the Tab order'); const c0 = hmCard(names[0]); c0.focus(); hmKey('ArrowRight', {}, c0); eq(D.activeElement, hmCard(names[1]), 'the right arrow'); hmKey('Home', {}, D.activeElement); eq(D.activeElement, c0, 'Home'); hmKey('End', {}, c0); eq(D.activeElement, hmCard(deck), 'End');
        hmKey(' ', {}, D.activeElement); eq(hmN(), '1 selected', 'Space selects'); ok(hmCard(deck).classList.contains('sel') && hmCard(deck).getAttribute('aria-selected') === 'true' && hmCard(deck).querySelector('.hmck input').checked, 'the card does not show it'); ok(!hmMain().querySelector('.hmbulk').hidden, 'no bar for the selection');
        hmKey('Escape'); eq(hmMain().querySelector('.hmbulk').hidden, true, 'Esc clears the selection'); eq(fig.home(), true, 'the first Esc closed Home'); hmKey('Escape'); eq(fig.home(), false, 'the second Esc closes Home');
        eq(D.querySelectorAll('#hmMain .hmc').length, 0, 'the cards stay while Home is hidden'); eq(hmThumb.q.length, 0, 'thumbnails wait while Home is hidden');
      } finally { fig.home(false); Object.assign(homePref, pref0); try { if (ls0 === null) localStorage.removeItem('fig.home'); else localStorage.setItem('fig.home', ls0); } catch (e) {} await wsClean(); }
    });
    test('home: several figures selected are archived, made active, moved to the trash, restored and deleted; other tabs are told; rename, duplicate, export', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      const p = hmPre(), A = p + '-a.json', B = p + '-b.json', C = p + '-c.json', names = [A, B, C], said = []; const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('silicodraw-files') : null; if (bc) bc.onmessage = e => said.push(e.data);
      const lf = listFiles, sort0 = homePref.sort; homePref.sort = 'name';   // (by name: the three are made within the same minute, or not)
      try {
        await wsClean(); await hmMake(names); await hmOpen('figures', names);
        // Ctrl+click adds, Shift+click takes the range, a box toggles, Ctrl+A takes all shown
        hmClick(hmCard(A), { ctrlKey: true }); eq(hmN(), '1 selected', 'Ctrl+click'); hmClick(hmCard(C), { shiftKey: true }); eq(hmN(), '3 selected', 'Shift+click takes the range'); hmClick(hmCard(B).querySelector('.hmck input')); eq(hmN(), '2 selected', 'the box'); ok(!hmCard(B).classList.contains('sel'), 'the box did not deselect');
        hmKey('Escape'); eq(hmMain().querySelector('.hmbulk').hidden, true, 'Esc'); hmKey('a', { ctrlKey: true }); eq(hmN(), '3 selected', 'Ctrl+A selects all shown'); eq(fig.home(), true, 'Home after the keys');
        hmClick(hmCard(C)); eq(hmN(), '2 selected', 'with a selection a click selects (nothing opens)'); eq(hmMain().querySelector('.hmgrid').classList.contains('picking'), true, 'the boxes show while something is selected');
        eq([...hmMain().querySelectorAll('.hmbulk [data-act]')].map(b => b.dataset.act), ['archive', 'trash', 'dup', 'export', 'clear'], 'the actions for figures');
        // Export… hands the selection to Export several figures
        listFiles = async sc => sc ? lf(sc) : names.map(n => ({ name: n, size: 1, modified: '2026-01-01 00:00' }));
        try { hmClick(hmBulk('export')); ok(await hmDlg('#bxList'), 'no Export several figures dialog'); eq([...D.querySelectorAll('#bxList input[data-f]')].filter(c => c.checked).map(c => c.dataset.f).sort(), [A, B], 'the figures ticked there'); } finally { closeModal(); listFiles = lf; }
        // Archive: both go, the third stays; the other tabs hear it before and after each move
        said.length = 0; hmClick(hmBulk('archive')); ok(await hmWait(async () => J(await hmIn('archive')) === J([A, B])), 'not archived: ' + J(await hmIn('archive'))); eq(await hmIn(''), [C], 'the figure not selected stays'); ok(/2 figures archived/.test(D.querySelector('#toast').textContent), 'the message: ' + D.querySelector('#toast').textContent);
        if (bc) { ok(await waitFor(() => said.filter(m => m && m.gone).length >= 2), 'the other tabs were not told'); eq(said.filter(m => m && (m.moving || m.gone)).map(m => m.moving ? 'moving ' + m.moving : 'gone ' + m.gone + ' ' + m.to), ['moving ' + A, 'moving ' + B, 'moving ' + A, 'gone ' + A + ' archive', 'moving ' + B, 'gone ' + B + ' archive'], 'what the other tabs heard (all of them first, so a tab can save a change; then around each move)'); }
        ok(await waitFor(() => fig.home() && !hmCard(A) && hmMain().querySelector('.hmbulk').hidden), 'the list was not drawn again'); eq(D.querySelector('#hmNav [data-sec=archive] .hmcnt').textContent, String((await listFiles('archive')).length), 'the Archive number');
        // Archive → Make active (Ctrl+click: a plain click there opens the figure)
        await hmOpen('archive', [A, B]); eq([...hmMain().querySelectorAll('.hmbulk [data-act]')].map(b => b.dataset.act), ['active', 'trash', 'clear'], 'the actions in the archive'); ok(!hmMain().querySelector('.hmc.hmnew'), 'a New figure card in the archive');
        hmClick(hmCard(A), { ctrlKey: true }); hmClick(hmCard(B)); eq(hmN(), '2 selected', 'two in the archive'); hmClick(hmBulk('active')); ok(await hmWait(async () => J(await hmIn('')) === J(names)), 'not active again: ' + J(await hmIn(''))); eq(await hmIn('archive'), [], 'the archive after it');
        // Move to trash: no question, a message with the number
        await hmOpen('figures', names); hmKey('a', { ctrlKey: true }); eq(hmN(), '3 selected', 'all three'); hmClick(hmBulk('trash')); ok(await hmWait(async () => J(await hmIn('trash')) === J(names)), 'not in the trash: ' + J(await hmIn('trash'))); ok(D.querySelector('#modal').hidden, 'moving to the trash asked'); ok(/3 figures moved to trash/.test(D.querySelector('#toast').textContent), 'the message: ' + D.querySelector('#toast').textContent);
        // Trash: a click only selects; Restore; Delete permanently asks once
        await hmOpen('trash', names); eq([...hmMain().querySelectorAll('.hmbulk [data-act]')].map(b => b.dataset.act), ['active', 'delete', 'clear'], 'the actions in the trash'); ok(hmMain().querySelector('.hmbar [data-act=empty]'), 'no Empty trash…');
        hmClick(hmCard(A)); eq(hmN(), '1 selected', 'a click in the trash selects'); eq(fig.home(), true, 'a click in the trash opened something'); hmClick(hmBulk('active')); ok(await hmWait(async () => J(await hmIn('')) === J([A])), 'not restored'); ok(/restored/.test(D.querySelector('#toast').textContent), 'the message: ' + D.querySelector('#toast').textContent);
        await hmOpen('trash', [B, C]); hmKey('a', { ctrlKey: true }); hmClick(hmBulk('delete')); ok(await hmDlg('#akOk'), 'deleting for good did not ask'); ok(/Delete 2 figures for good/.test(D.querySelector('#modalBox').textContent) && D.querySelector('#akOk').classList.contains('dangerbtn'), 'the question: ' + D.querySelector('#modalBox').textContent.slice(0, 120));
        D.querySelector('#akNo').click(); await sleep(150); eq(await hmIn('trash'), [B, C], 'Cancel deleted something'); await hmOpen('trash', [B, C]); hmKey('a', { ctrlKey: true }); hmClick(hmBulk('delete')); ok(await hmDlg('#akOk'), 'no question the second time'); D.querySelector('#akOk').click(); ok(await hmWait(async () => !(await hmIn('trash')).length), 'not deleted'); ok(await waitFor(() => D.querySelector('#modal').hidden), 'the question stays');
        // the ⋯ menu of a card (also on a right-click): rename, duplicate, archive, trash
        await hmOpen('figures', [A]); hmCard(A).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 })); ok(D.querySelector('#ctxMenu').classList.contains('open'), 'no menu on a right-click');
        eq([...D.querySelectorAll('#ctxMenu button')].map(b => b.textContent), ['Open', 'Open in a new tab', 'Rename…', 'Duplicate…', 'Export…', 'Archive', 'Move to trash'], 'the menu of a figure'); hmKey('Escape'); ok(!D.querySelector('#ctxMenu').classList.contains('open') && fig.home(), 'Esc closes the menu only');
        const pick = async t => { hmClick(hmCard(A).querySelector('.hmmore')); ok(D.querySelector('#ctxMenu').classList.contains('open'), 'no menu from the ⋯ button'); hmClick([...D.querySelectorAll('#ctxMenu button')].find(b => b.textContent === t)); };
        await pick('Duplicate…'); ok(await hmDlg('#akIn'), 'Duplicate did not ask for a name'); eq(D.querySelector('#akIn').value, A.replace(/\.json$/, '') + '-copy', 'the name suggested'); D.querySelector('#akIn').value = p + '-d'; D.querySelector('#akOk').click(); ok(await hmWait(async () => (await hmIn('')).includes(p + '-d.json')), 'no copy'); eq(J(JSON.parse(await (await fetch(encodeURIComponent(p + '-d.json'), { cache: 'no-store' })).text()).objects), J(JSON.parse(wsFig(A)).objects), 'the copy holds the figure');
        await hmOpen('figures', [A, p + '-d.json']); said.length = 0; await pick('Rename…'); ok(await hmDlg('#akIn'), 'Rename did not ask for a name'); D.querySelector('#akIn').value = p + '-r'; D.querySelector('#akOk').click(); ok(await hmWait(async () => J(await hmIn('')) === J([p + '-d.json', p + '-r.json'])), 'not renamed: ' + J(await hmIn('')));
        if (bc) ok(await waitFor(() => said.some(m => m && m.gone === A && m.to === 'rename:' + p + '-r.json')), 'the other tabs were not told of the new name');
        // Duplicate for the selection: name-copy, no question
        await hmOpen('figures', [p + '-d.json', p + '-r.json']); hmKey('a', { ctrlKey: true }); hmClick(hmBulk('dup')); ok(await hmWait(async () => (await hmIn('')).length === 4), 'no copies: ' + J(await hmIn(''))); eq(await hmIn(''), [p + '-d-copy.json', p + '-d.json', p + '-r-copy.json', p + '-r.json'].sort(), 'the copies\' names'); ok(D.querySelector('#modal').hidden, 'copies of several asked for names');
        // what cannot be moved is named: a figure of that name is already active
        await hmMake([p + '-x.json']); ok((await fetch('api/move?file=' + encodeURIComponent(p + '-x.json') + '&from=&to=archive', { method: 'POST' })).ok, 'archived by hand'); await hmMake([p + '-x.json']); await hmOpen('archive', [p + '-x.json']); hmClick(hmCard(p + '-x.json'), { ctrlKey: true }); hmClick(hmBulk('active'));
        ok(await waitFor(() => /could not be made active: .*-x/.test(D.querySelector('#toast').textContent)), 'a failed move is not named: ' + D.querySelector('#toast').textContent); eq(await hmIn('archive'), [p + '-x.json'], 'the figure that could not move stays');
      } finally { listFiles = lf; homePref.sort = sort0; if (!D.querySelector('#modal').hidden) closeModal(); D.querySelector('#ctxMenu').classList.remove('open'); fig.home(false); if (bc) bc.close(); await wsClean(); }
    });
    test('home: a new section in the registry is listed, drawn, gets the keys and is tidied up', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      let drawn = 0, cleaned = 0, keyed = 0, ctxSeen = null; const sec = { id: 'zz-news', label: 'What is new', icon: '<circle cx="12" cy="12" r="8"/>', count: () => 3, render(main, ctx) { drawn++; ctxSeen = ctx; main.innerHTML = '<p id="zzNews">Nothing about files here</p>'; return () => { cleaned++; }; }, key(e) { if (e.key === 'x') { keyed++; return true; } return false; } };
      const n0 = HOME_SECTIONS.length, sec0 = HOME.sec;
      try {
        HOME_SECTIONS.push(sec); eq(fig.home('zz-news'), true, 'fig.home(new section)'); const b = D.querySelector('#hmNav [data-sec=zz-news]'); ok(b && /What is new/.test(b.textContent) && b.querySelector('.hmcnt').textContent === '3' && b.getAttribute('aria-current') === 'page' && b.querySelector('svg circle'), 'the navigation does not list it');
        ok(D.querySelector('#hmMain #zzNews') && drawn >= 1, 'the section was not drawn'); eq(D.querySelector('#hmMain').getAttribute('aria-label'), 'What is new', 'the main area is not named after it'); ok(!D.querySelector('#hmMain .hmgrid, #hmMain .hmq'), 'the frame added file controls');
        ok(ctxSeen && ['reload', 'go', 'close', 'say'].every(k => typeof ctxSeen[k] === 'function') && 'active' in ctxSeen.lists, 'what a section is given');
        hmKey('x'); eq(keyed, 1, 'the section\'s key'); eq(fig.home(), true, 'a key the section used closed Home');
        ctxSeen.go('trash'); eq(HOME.sec, 'trash', 'ctx.go'); eq(cleaned, 1, 'leaving the section tidies it up'); ok(!D.querySelector('#zzNews'), 'the section stays drawn'); hmClick(D.querySelector('#hmNav [data-sec=zz-news]')); ok(D.querySelector('#zzNews'), 'back by the navigation');
        hmKey('Escape'); eq(fig.home(), false, 'Esc closes Home from a section without a selection'); eq(cleaned, 2, 'closing Home tidies the section up');
        // a section that fails does not take Home down
        sec.render = () => { throw new Error('zz broken section'); }; const warn = console.warn; console.warn = () => {}; try { fig.home('zz-news'); } finally { console.warn = warn; } ok(fig.home() && /could not be shown/.test(D.querySelector('#hmMain').textContent), 'a broken section'); hmClick(D.querySelector('#hmNav [data-sec=figures]')); ok(await waitFor(() => D.querySelector('#hmMain .hmgrid, #hmMain .hmempty')), 'Figures after a broken section');
      } finally { fig.home(false); HOME_SECTIONS.length = n0; HOME.sec = HOME_SECTIONS.some(s => s.id === sec0) ? sec0 : 'figures'; }
    });
    test('home: selected figures a search hides are counted and named, closing Home forgets the selection, the search box keeps the focus when the lists are read again, Delete asks for the open figure, a name that is not allowed cannot be opened', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      const p = hmPre(), A = p + '-a.json', B = p + '-b.json', C = p + '-c.json', N = p + '-n.json', X = p + ' bad name.json', lf = listFiles, sort0 = homePref.sort, base = n => n.replace(/\.json$/, ''); homePref.sort = 'name';
      try {
        await wsClean(); await hmMake([A, B, C]); await hmOpen('figures', [A, B, C]);
        // the selection outlasts a search; the bar says how many of the selected are out of sight
        hmClick(hmCard(A), { ctrlKey: true }); hmClick(hmCard(B), { ctrlKey: true }); await hmSearch(p + '-b'); eq(hmShown(), [B], 'the search'); eq(hmN(), '2 selected (1 not shown)', 'the bar does not say that a selected figure is hidden'); await hmSearch(p); eq(hmN(), '2 selected', 'the bar with all of them in sight');
        // closing Home forgets the search and the selection (they acted on figures selected long before)
        fig.home(false); fig.home('figures'); ok(await waitFor(() => hmMain().querySelector('.hmq')), 'Figures again'); eq(hmMain().querySelector('.hmq').value, '', 'the search outlasts closing Home'); eq(hmMain().querySelector('.hmbulk').hidden, true, 'the selection outlasts closing Home');
        // the bar is part of the toolbar that sticks (it lay over the view buttons when the toolbar took two rows)
        ok(hmMain().querySelector('.hmbar .hmbulk'), 'the bar of the selection is not inside the toolbar');
        // deleting for good names the figures, those out of sight first
        await hmOpen('figures', [A, B, C]); hmKey('a', { ctrlKey: true }); hmClick(hmBulk('trash')); ok(await hmWait(async () => J(await hmIn('trash')) === J([A, B, C])), 'not in the trash'); ok(D.querySelector('#modal').hidden, 'figures that are not open asked');
        await hmOpen('trash', [A, B, C]); ok(/Enter or Space selects/.test(hmMain().querySelector('.hmgrid').getAttribute('aria-label')), 'the Trash list is said to open on Enter');
        hmClick(hmCard(A)); hmClick(hmCard(C)); await hmSearch(p + '-c'); eq(hmN(), '2 selected (1 not shown)', 'the bar in the trash'); hmClick(hmBulk('delete')); ok(await hmDlg('#akOk'), 'deleting for good did not ask');
        { const t = D.querySelector('#modalBox').textContent; ok(t.includes(base(A)) && t.includes(base(C)) && t.indexOf(base(A)) < t.indexOf(base(C)) && /1 of them is not shown/.test(t) && /cannot be undone/.test(t), 'the question does not name the figures: ' + t.slice(0, 300)); }
        D.querySelector('#akNo').click(); await sleep(150); eq(await hmIn('trash'), [A, B, C], 'Cancel deleted something');
        await hmOpen('trash', [A, B, C]); hmKey('a', { ctrlKey: true }); eq(hmN(), '3 selected', 'all three in the trash'); hmClick(hmBulk('active')); ok(await hmWait(async () => J(await hmIn('')) === J([A, B, C])), 'not restored');
        // the lists are read again (back in the window) while the search box has the focus: it keeps it, with its selection (the focus went to a card, and the next key acted on that figure)
        await hmOpen('figures', [A, B, C]); { const q = hmMain().querySelector('.hmq'); q.focus(); q.setSelectionRange(1, 2); await hmMake([N]); HOME.loadAt = 0; W.dispatchEvent(new Event('focus')); ok(await waitFor(() => hmCard(N)), 'the lists were not read again');
          const q2 = hmMain().querySelector('.hmq'); eq(D.activeElement, q2, 'the search box lost the focus'); eq(q2.value, p, 'the search text'); eq([q2.selectionStart, q2.selectionEnd], [1, 2], 'the selection in the search box'); }
        // Backspace on a card does nothing; Delete moves it to the trash and the focus lands on the card that takes its place
        { const c = hmCard(B); hmClick(c, { ctrlKey: true }); hmClick(c, { ctrlKey: true }); c.focus(); hmKey('Backspace', {}, c); await sleep(300); ok(D.querySelector('#modal').hidden && (await hmIn('')).includes(B), 'Backspace moved a figure to the trash');
          hmKey('Delete', {}, c); ok(await hmWait(async () => (await hmIn('trash')).includes(B)), 'Delete did not move it to the trash'); ok(await waitFor(() => !hmCard(B) && D.activeElement === hmCard(C)), 'the focus is not on the next card: ' + (D.activeElement && D.activeElement.dataset && D.activeElement.dataset.n)); }
        // the figure open in this tab: Delete asks first, as Move to trash in the toolbar does
        await hmSearch(''); if (hmCard(FILE) && hmMain().querySelector('.hmbulk').hidden) { const c = hmCard(FILE); c.focus(); hmKey('Delete', {}, c); ok(await hmDlg('#akOk'), 'the open figure went to the trash without a question'); ok(D.querySelector('#modalBox').textContent.includes(BASE), 'the question does not name it'); D.querySelector('#akNo').click(); await sleep(200); ok((await listFiles()).some(f => f.name === FILE) && fig.home() && !fileGone, 'Cancel moved the open figure'); }
        // a file whose name the editor cannot open (made outside it): shown, not to be opened or selected
        listFiles = async sc => sc ? lf(sc) : [...((await lf()) || []), { name: X, size: 1, modified: '2026-01-01 00:00' }];
        try { await HOME.ctx.reload(); await hmSearch(p + ' bad'); const c = hmCard(X); ok(c && c.classList.contains('bad') && c.getAttribute('aria-disabled') === 'true' && !c.querySelector('.hmck') && !c.querySelector('.hmmore') && /rename this file/.test(c.textContent), 'a name that is not allowed looks like any figure');
          const u = location.href; hmClick(c); await sleep(100); eq(location.href, u, 'it was opened'); eq(fig.home(), true, 'Home closed'); ok(/cannot be opened/.test(D.querySelector('#toast').textContent), 'no word why: ' + D.querySelector('#toast').textContent);
          hmKey('a', { ctrlKey: true }); eq(hmMain().querySelector('.hmbulk').hidden, true, 'it can be selected'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 })); ok(!D.querySelector('#ctxMenu').classList.contains('open'), 'it has a menu');
        } finally { listFiles = lf; await HOME.ctx.reload(); }
      } finally { listFiles = lf; homePref.sort = sort0; if (!D.querySelector('#modal').hidden) closeModal(); D.querySelector('#ctxMenu').classList.remove('open'); fig.home(false); await wsClean(); }
    });
    test('home: a section that lists no files keeps what was typed in it when the file lists change; the navigation keeps the focus and says the section', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      let drawn = 0; const sec = { id: 'zz-form', label: 'A form', render(main) { drawn++; main.innerHTML = '<input id="zzIn">'; } }, n0 = HOME_SECTIONS.length, sec0 = HOME.sec, p = hmPre();
      try {
        await wsClean(); HOME_SECTIONS.push(sec); fig.home('zz-form'); await HOME.ctx.reload(); const d0 = drawn, i = D.querySelector('#zzIn'), cnt = () => +D.querySelector('#hmNav [data-sec=figures] .hmcnt').textContent, c0 = cnt(); i.value = 'typed'; i.focus();
        await hmMake([p + '-f.json']); HOME.loadAt = 0; W.dispatchEvent(new Event('focus')); ok(await waitFor(() => cnt() === c0 + 1), 'the number in the navigation did not follow: ' + cnt() + ', was ' + c0);
        eq(drawn, d0, 'a section without lists was drawn again when the lists changed'); ok(D.querySelector('#zzIn') === i && i.value === 'typed', 'what was typed is gone'); eq(D.activeElement, i, 'the field lost the focus');
        await HOME.ctx.reload(); eq(drawn, d0 + 1, 'ctx.reload() draws the section again');
        ok(HOME_SECTIONS.filter(s => s.lists).map(s => s.id).join() === 'figures,archive,trash', 'the sections that show the lists: ' + HOME_SECTIONS.filter(s => s.lists).map(s => s.id));
        // a section chosen from the keyboard: the focus stays in the navigation (the buttons are made anew), the arrow keys go on, a screen reader hears the section
        const b = D.querySelector('#hmNav [data-sec=archive]'); b.focus(); hmClick(b); eq(D.activeElement && D.activeElement.dataset.sec, 'archive', 'the focus fell out of the navigation'); ok(await waitFor(() => D.querySelector('#srLive').textContent === 'Archive'), 'the section is not said: ' + D.querySelector('#srLive').textContent);
        hmKey('ArrowDown', {}, D.activeElement); eq(D.activeElement && D.activeElement.dataset.sec, 'trash', 'the arrow keys in the navigation');
        // Home comes back on the section it had when the page is loaded anew
        fig.home('archive'); homeCarry(true); try { ok(/^1:archive$/.test(sessionStorage.getItem('fig.home')), 'the section is not carried: ' + sessionStorage.getItem('fig.home')); } finally { homeCarry(false); }
      } finally { fig.home(false); HOME_SECTIONS.length = n0; HOME.sec = HOME_SECTIONS.some(s => s.id === sec0) ? sec0 : 'figures'; await wsClean(); }
    });
    test('home: a thumbnail never carries script from the file (page color, legend colors); a kept picture waits until its card is in sight', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      const evil = () => ({ version: 4, w: 400, h: 300, bg: '#fff"/><image href="x.png" onerror="window.__zzPwn=1"/><rect fill="#fff', objects: [{ id: 't1', type: 'text', x: 10, y: 20, s: 1, r: 0, text: 'x' },
        { id: 'l1', type: 'legend', x: 100, y: 100, s: 1, r: 0, items: 'circle|x"/><image href="y.png" onerror="window.__zzPwn=2"/><rect fill="#fff|lab\nline|#f00" onload="window.__zzPwn=3|l2', dir: 'v', size: 14, gap: 10 }] });
      const host = D.createElement('span'), el = D.createElement('span'), key = 'zz/test@1'; D.body.appendChild(host);
      try {
        for (const sc of [evil(), healScene(evil())]) { const t = D.createElement('template'); t.innerHTML = sceneSvg(sc, 320, 200); const all = [...t.content.querySelectorAll('*')]; ok(all.length > 3, 'nothing was drawn');
          eq(all.filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).map(e => e.outerHTML.slice(0, 80)), [], 'an event handler from the file'); eq(t.content.querySelectorAll('image,script,foreignObject').length, 0, 'an element from the file'); }
        eq(healScene(evil()).bg, '#ffffff', 'a page color that is no color'); hmThumbPaint(host, { svg: sceneSvg(evil(), 320, 200), slides: 0 }); await sleep(150); ok(host.shadowRoot.querySelector('svg'), 'no thumbnail'); ok(!W.__zzPwn, 'script from the file ran: ' + W.__zzPwn);
        hmThumb.cache.set(key, { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', slides: 0 }); hmThumbWant(el, key, async () => null); ok(!el.shadowRoot, 'a kept picture is put in at once, in sight or not'); hmThumbWant(el, key, async () => null, true); ok(el.shadowRoot && el.shadowRoot.querySelector('svg'), 'a kept picture for a first card');
      } finally { host.remove(); hmThumb.cache.delete(key); if (hmThumb.io) hmThumb.io.unobserve(el); delete W.__zzPwn; }
    });
    test('home: a tab that has a figure open saves before the figure is moved; deleting a trashed figure for good keeps the history and the browser copy of an active figure of that name', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      const p = hmPre(), A = p + '-m.json', mf = moveFile, LK = 'figEditor.scene.v1:' + A, bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('silicodraw-files') : null; let heard = 0, flushedAt = 0, movedAt = 0;
      const mv = (from, to) => fetch('api/move?file=' + encodeURIComponent(A) + '&from=' + from + '&to=' + to, { method: 'POST' }), hist = async () => { const r = await fetch('api/history?file=' + encodeURIComponent(A), { cache: 'no-store' }).catch(() => null); try { return r && r.ok ? (await r.json()).length : -1; } catch (e) { return -1; } };
      try {
        await wsClean(); await hmMake([A]);
        if (bc) {   // this test plays the other tab: it has a change to save, and says so
          bc.onmessage = e => { const d = e.data || {}; if (d.moving === A && !heard) { heard = 1; bc.postMessage({ held: A, pending: true }); setTimeout(() => { flushedAt = Date.now(); bc.postMessage({ flushed: A }); }, 400); } };
          moveFile = async (...a) => { if (a[0] === A && !movedAt) movedAt = Date.now(); return mf(...a); }; moveFile.old = mf.old;
          const r = await hmMove([A], 'active', 'archive'); moveFile = mf; eq(r.ok, [A], 'the move'); ok(heard, 'the other tab was not told'); ok(flushedAt && movedAt >= flushedAt, 'the figure was moved before the other tab had saved (' + (movedAt - flushedAt) + ' ms)'); ok((await mv('archive', 'active')).ok, 'active again');
        }
        ok((await mv('active', 'trash')).ok, 'to the trash'); await hmMake([A], wsFig('the new one')); await hmMake([A], wsFig('the new one, changed')); const h0 = await hist(); try { localStorage.setItem(LK, 'kept'); } catch (e) {}
        const r2 = await hmDelete([A]); eq(r2.ok, [A], 'deleted from the trash'); eq(await hmIn('trash'), [], 'the trash'); ok((await hmIn('')).includes(A), 'the active figure of that name');
        eq(await hist(), h0, 'the history of the active figure went with the trashed one'); let kept = 'kept'; try { kept = localStorage.getItem(LK); } catch (e) {} eq(kept, 'kept', 'this browser\'s copy of the active figure went');
      } finally { moveFile = mf; if (bc) bc.close(); try { localStorage.removeItem(LK); } catch (e) {} await wsClean(); await wsClean(); }
    });
    test('home: ?home in the address opens it, ?file= alone opens the figure; on a phone tabs, two cards per row, boxes in sight, the selection bar at the bottom, Back closes', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      const p = hmPre(), names = [p + '-s.json', p + '-t.json', p + '-u.json']; let fr = null;
      const open = async q => { if (fr) fr.remove(); fr = D.createElement('iframe'); fr.title = 'home test'; fr.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;border:0;z-index:2147483000;background:#fff'; fr.src = location.pathname + '?file=' + encodeURIComponent(names[0]) + q; D.body.appendChild(fr);
        ok(await waitFor(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 60000), 'the editor did not start in the frame'); const w = watch(fr.contentWindow); w.alert = () => {}; w.confirm = () => true; w.onbeforeunload = null; return w; };
      try {
        await wsClean(); await hmMake(names);
        let w = await open('&phone=1'); await sleep(400); eq(w.fig.home(), false, '?file= alone started on Home');
        w = await open('&phone=1&home'); ok(await waitFor(() => w.fig.home()), '?home did not open Home'); ok(!/[?&]home\b/.test(w.location.search) && /[?&]file=/.test(w.location.search), 'the address keeps ?home: ' + w.location.search);
        const d = w.document, $$ = s => d.querySelector(s), cs = el => w.getComputedStyle(el); ok(w.eval('PHONE()'), 'no phone layout in the frame'); ok(await waitFor(() => $$('#hmMain .hmc[data-n="' + names[0] + '"]')), 'the figures are not listed on the phone');
        const q = $$('#hmMain .hmq'); q.value = p; q.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(60); const cards = [...d.querySelectorAll('#hmMain .hmc[data-n]')]; eq(cards.length, 3, 'the cards');
        eq(cs($$('#hmNav')).flexDirection, 'row', 'the sections are no row of tabs'); { const n = $$('#hmNav').getBoundingClientRect(), m = $$('#hmMain').getBoundingClientRect(); ok(n.bottom <= m.top + 1 && n.width > 300, 'the tabs are not above the list'); ok([...d.querySelectorAll('#hmNav button')].every(b => b.getBoundingClientRect().height >= 40), 'tabs too small for a finger'); }
        { const a = cards[0].getBoundingClientRect(), b = cards[1].getBoundingClientRect(), c = cards[2].getBoundingClientRect(); ok(Math.abs(a.top - b.top) < 1 && b.left > a.right && c.top >= a.bottom && a.width > 150 && b.right <= 390, 'not two cards per row: ' + J([a.left, a.top, a.width, b.left, b.top, c.top])); }
        eq(cs(cards[0].querySelector('.hmck')).opacity, '1', 'the boxes hide on a phone'); eq(cs(cards[0].querySelector('.hmmore')).opacity, '1', 'the ⋯ button hides on a phone'); ok(cards[0].querySelector('.hmck').getBoundingClientRect().width >= 30, 'the box is too small for a finger');
        cards[0].querySelector('.hmck input').click(); const bar = $$('#hmMain .hmbulk'); ok(!bar.hidden && /1 selected/.test(bar.textContent), 'no bar for the selection'); { const r = bar.getBoundingClientRect(); eq(cs(bar).position, 'fixed', 'the bar scrolls away'); ok(r.bottom <= 844 && r.bottom > 844 - 40 && r.left >= 0 && r.right <= 390, 'the bar is not at the bottom: ' + J([r.left, r.top, r.right, r.bottom])); ok([...bar.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 40), 'bar buttons too small'); ok(parseFloat(cs($$('#hmMain .hmgrid')).marginBottom) >= 60, 'no room under the last cards for the bar of the selection'); }
        // the ⋯ menu is a sheet over Home, and its scrim covers Home
        cards[1].querySelector('.hmmore').click(); ok(await waitFor(() => $$('#ctxMenu.open.sheet')), 'no sheet for the card menu'); ok(await waitFor(() => $$('#phScrim.on') && +cs($$('#phScrim')).zIndex > +cs($$('#home')).zIndex), 'the scrim is under Home');
        // Back: the menu, then Home (the selection stays what it was)
        w.history.back(); ok(await waitFor(() => !$$('#ctxMenu.open')), 'Back did not close the menu'); eq(w.fig.home(), true, 'Back closed Home with the menu'); await sleep(350); w.history.back(); ok(await waitFor(() => !w.fig.home()), 'Back did not close Home'); ok(/[?&]file=/.test(w.location.search), 'Back left the figure');
        // the top bar's ⋯ menu has Home
        $$('#bMore').click(); ok(await waitFor(() => $$('#ctxMenu.open')), 'no More menu'); eq(d.querySelector('#ctxMenu button').textContent, 'Home', 'Home in the More menu'); d.querySelector('#ctxMenu button').click(); ok(await waitFor(() => w.fig.home()), 'More → Home'); w.fig.home(false);
      } finally { if (fr) fr.remove(); await wsClean(); }
    }, 240000);
    test('home: the plain address starts on Home (not with "At start: The last figure" or ?home=0) and leaves no cover; the open figure archived from Home: the tab moves on to another figure, with Home', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      const p = hmPre(), names = [p + '-s.json', p + '-t.json', p + '-u.json'], s0 = UI.start; let fr = null;
      const live = () => { try { const w = fr.contentWindow; return !!(w.fig && w.eval('typeof fileReady!=="undefined"&&fileReady')); } catch (e) { return false; } };
      // (the plain address may forward to the figure last used: the frame's window is then another one, so it is asked for anew each time)
      const open = async u => { if (fr) fr.remove(); try { sessionStorage.removeItem('fig.home'); } catch (e) {} fr = D.createElement('iframe'); fr.title = 'home test'; fr.style.cssText = 'position:fixed;left:0;top:0;width:1100px;height:700px;border:0;z-index:2147483000;background:#fff'; fr.src = u; D.body.appendChild(fr);
        ok(await waitFor(live, 60000), 'the editor did not start at ' + u); await sleep(500); ok(await waitFor(live, 60000), 'the editor did not stay at ' + u); const w = fr.contentWindow; w.alert = () => {}; w.confirm = () => true; w.onbeforeunload = null; return w; };
      const booted = w => !w.document.documentElement.classList.contains('home-boot');
      try {
        await wsClean(); await hmMake(names); if (UI.start !== 'home') fig.prefs({ start: 'home' });
        let w = await open(location.pathname); ok(await waitFor(() => fr.contentWindow.fig.home() === true, 15000), 'the plain address did not start on Home'); w = fr.contentWindow; ok(booted(w), 'the cover of the start stays'); ok(!w.document.querySelector('#home').hidden && w.document.querySelector('#hmNav [aria-current=page]').dataset.sec === 'figures', 'Home does not show Figures');
        fig.prefs({ start: 'figure' }); w = await open(location.pathname); await sleep(600); eq(fr.contentWindow.fig.home(), false, '"At start: The last figure" started on Home'); ok(booted(fr.contentWindow), 'the cover stays without Home');
        fig.prefs({ start: 'home' }); w = await open(location.pathname + '?home=0'); await sleep(600); eq(fr.contentWindow.fig.home(), false, '?home=0 started on Home'); ok(booted(fr.contentWindow) && !/[?&]home(=|&|$)/.test(fr.contentWindow.location.search), 'the address keeps home=0: ' + fr.contentWindow.location.search);
        // the figure open in the tab, archived from Home: saved, moved, and the tab ends on another active figure with Home showing
        w = await open(location.pathname + '?file=' + encodeURIComponent(names[0]) + '&home'); ok(await waitFor(() => w.fig.home()), '?home did not open Home'); const d = w.document; ok(await waitFor(() => d.querySelector('#hmMain .hmc[data-n="' + names[0] + '"]')), 'the open figure is not listed');
        const q = d.querySelector('#hmMain .hmq'); q.value = names[0].replace(/\.json$/, ''); q.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(60); eq([...d.querySelectorAll('#hmMain .hmc[data-n]')].map(c => c.dataset.n), [names[0]], 'the card of the open figure'); ok(d.querySelector('#hmMain .hmc.cur'), 'it is not marked as open');
        d.querySelector('#hmMain .hmc.cur .hmck input').click(); d.querySelector('#hmMain .hmbulk [data-act=archive]').click(); ok(await hmWait(async () => (await hmIn('archive')).includes(names[0]), 20000), 'the open figure was not archived');
        ok(await waitFor(() => { const x = fr.contentWindow; return live() && x.fig.home() === true && !x.location.search.includes(encodeURIComponent(names[0])); }, 30000), 'the tab did not move on to another figure with Home: ' + fr.contentWindow.location.search);
        ok(!(await hmIn('')).includes(names[0]), 'the archived figure is active again');
      } finally { if (fr) fr.remove(); fig.prefs({ start: s0 }); try { sessionStorage.removeItem('fig.home'); } catch (e) {} await wsClean(); }
    }, 240000);

    test('home: the plain address opens where this browser left off: Home if it was showing, else the figure last worked on, Home when that figure is gone or nothing is remembered; each "At start" setting; ?file= is direct; a tab loaded again shows what it showed', async () => {
      if (typeof homeShow !== 'function' || typeof noteFront !== 'function') throw new Skip('this editor does not remember where it left off');
      const p = hmPre(), names = [p + '-v.json', p + '-w.json', p + '-x.json'], gone = p + '-gone.json', s0 = UI.start, hereKey = 'fig.here:' + DIR, enc = encodeURIComponent; let fr = null;
      const put = (st, k, v) => { try { if (v == null) st.removeItem(k); else st.setItem(k, v); } catch (e) {} }, got = (st, k) => { try { return st.getItem(k); } catch (e) { return null; } };
      const keep = [[localStorage, viewKey()], [localStorage, lastKey()], [sessionStorage, hereKey]].map(([st, k]) => [st, k, got(st, k)]);
      // the page has settled: the editor runs, the start has decided (no cover, nothing pending) and the address stays (the plain address may go on to a figure: the frame's window is then another one)
      const calm = () => { try { const w = fr.contentWindow; return !!(w.fig && w.eval('typeof fileReady!=="undefined"&&fileReady&&!HOME.pend&&!HOME.plan') && !w.document.documentElement.classList.contains('home-boot')) && w.location.href; } catch (e) { return false; } };
      const rest = async what => { let was = null, n = 0; ok(await waitFor(() => { const h = calm(); n = h && h === was ? n + 1 : 0; was = h; return n >= 12; }, 60000), 'the editor did not settle: ' + what); const w = fr.contentWindow; w.alert = () => {}; w.confirm = () => true; w.onbeforeunload = null; return w; };
      // start(view, last, here, address): what the browser remembers (Home or a figure in front, which figure, what this tab showed), then the page opened anew
      const start = async (view, last, here, u) => { if (fr) fr.remove(); put(sessionStorage, 'fig.home', null); put(sessionStorage, 'fig.homeRe', null); put(localStorage, viewKey(), view); put(localStorage, lastKey(), last); put(sessionStorage, hereKey, here);
        fr = D.createElement('iframe'); fr.title = 'home test'; fr.style.cssText = 'position:fixed;left:0;top:0;width:1100px;height:700px;border:0;z-index:2147483000;background:#fff'; fr.src = u || location.pathname; D.body.appendChild(fr);
        return rest('at ' + (u || location.pathname) + ' (' + J([view, last, here]) + ')'); };
      // the frame's page goes elsewhere by itself (loaded again, a figure opened, Back, Forward): go starts it, then the new page settles
      const move = async (go, what) => { fr.contentWindow.__was = 1; go(fr.contentWindow); ok(await waitFor(() => !fr.contentWindow.__was, 30000), 'the page did not change: ' + what); return rest(what); };
      const plain = () => !/[?&]file=/.test(fr.contentWindow.location.search);
      const at = n => fr.contentWindow.location.search.includes('file=' + enc(n)), say = () => J([fr.contentWindow.location.search, fr.contentWindow.fig.home()]);
      try {
        await wsClean(); fig.prefs({ start: 'last' });
        // nothing remembered (the first start in this browser): Home only when there are two or more figures to choose from, else the figure
        const n0 = ((await listFiles('')) || []).length; let w = await start(null, null); eq(w.fig.home(), WEB || n0 >= 2, 'nothing remembered, ' + n0 + ' figure(s) in the folder' + (WEB ? ' (the website: always Home)' : '') + ': ' + say());
        await hmMake(names);
        // Home was showing: Home again, over the figure last worked on
        w = await start('home', names[0]); ok(at(names[0]) && w.fig.home() === true, 'Home was showing, over ' + names[0] + ': ' + say()); ok(w.document.querySelector('#hmBack').textContent.includes(names[0].replace(/\.json$/, '')), 'Back does not lead to the figure last worked on');
        ok(!w.document.querySelector('#home').hidden && w.document.querySelector('#hmNav [aria-current=page]').dataset.sec === 'figures', 'Home does not show Figures');
        // what is in front is remembered as it changes: Home closed = the figure, Home shown = Home; the figure of the page is the last one
        w.fig.home(false); eq(got(localStorage, viewKey()), 'figure', 'Home closed'); eq(got(localStorage, lastKey()), names[0], 'the figure last worked on'); await sleep(400); /* (closing Home steps back in the history: let that arrive before Home shows again) */ w.fig.home(true); await sleep(200); eq(got(localStorage, viewKey()), 'home', 'Home shown');
        // that page loaded again (F5, the browser restoring its tabs) shows Home again, and Home stays remembered
        w = await move(x => x.location.reload(), 'loaded again on Home'); ok(at(names[0]) && w.fig.home() === true, 'loaded again while Home showed: ' + say()); eq(got(localStorage, viewKey()), 'home', 'Home is no longer remembered after the page was loaded again');
        // "Today" and "Yesterday" on the cards: left open over midnight, the list is drawn again when the figures are read next
        { ok(await waitFor(() => w.document.querySelector('#hmMain .hmc[data-n]')), 'no cards'); const c = w.document.querySelector('#hmMain .hmc[data-n]'); w.eval('HOME.day="another day"'); await w.homeLoad(); ok(!c.isConnected, 'the cards were not drawn again on another day'); ok(!/"1 items"/.test(w.document.querySelector('#hmNav').innerHTML), 'the navigation says "1 items"'); }
        // a figure was in front: that figure, directly
        w = await start('figure', names[1]); ok(at(names[1]) && w.fig.home() === false, 'a figure was in front: ' + say()); ok(w.document.querySelector('#home').hidden && !w.document.documentElement.classList.contains('home-on'), 'Home shows over the figure'); eq(got(localStorage, viewKey()), 'figure', 'the figure stays remembered');
        w = await move(x => x.location.reload(), 'loaded again on a figure'); ok(at(names[1]) && w.fig.home() === false, 'loaded again while a figure showed: ' + say());
        // that figure is gone (archived, trashed, renamed elsewhere): Home
        w = await start('figure', gone); ok(w.fig.home() === true && !at(gone), 'the figure last worked on is gone: ' + say()); ok(!(await hmIn('')).includes(gone), 'the figure that was gone was made');
        // nothing remembered (the first start in this browser), and there are figures to choose from: Home
        w = await start(null, null); eq(w.fig.home(), true, 'nothing remembered: ' + say());
        // a tab on the plain address loaded again shows what it showed, whatever another tab did since
        w = await start('home', names[0], 'figure'); eq(w.fig.home(), false, 'this tab showed a figure: ' + say()); w = await start('figure', names[1], 'home'); eq(w.fig.home(), true, 'this tab showed Home: ' + say());
        // ?file= opens that figure directly, ?home=0 never Home, ?home always
        w = await start('home', names[0], null, location.pathname + '?file=' + enc(names[1])); ok(at(names[1]) && w.fig.home() === false, '?file= with Home remembered: ' + say());
        w = await start('home', names[0], null, location.pathname + '?home=0'); eq(w.fig.home(), false, '?home=0 with Home remembered: ' + say());
        w = await start('figure', names[1], null, location.pathname + '?file=' + enc(names[2]) + '&home'); ok(at(names[2]) && w.fig.home() === true, '?home with a figure remembered: ' + say());
        // ?phone=1 on the plain address goes along to the figure it leads to
        w = await start('figure', names[1], null, location.pathname + '?phone=1'); ok(at(names[1]) && /[?&]phone=1(&|$)/.test(w.location.search) && w.document.documentElement.classList.contains('phone'), '?phone=1 was lost on the way to the last figure: ' + say());
        // At start: Home page = Home whatever was in front, over the figure last worked on (which stays remembered); The last figure = that figure, never Home (also when it is gone)
        fig.prefs({ start: 'home' }); w = await start('figure', names[1]); eq(w.fig.home(), true, '"Home page" with a figure remembered: ' + say());
        ok(at(names[1]) && w.document.querySelector('#hmBack').textContent.includes(names[1].replace(/\.json$/, '')), '"Home page": Home is not over the figure last worked on: ' + say()); eq(got(localStorage, lastKey()), names[1], '"Home page": the figure last worked on was forgotten');
        fig.prefs({ start: 'figure' }); w = await start('home', names[2]); ok(at(names[2]) && w.fig.home() === false, '"The last figure" with Home remembered: ' + say());
        w = await start('figure', gone); eq(w.fig.home(), false, '"The last figure", and it is gone: ' + say()); w = await start(null, null); eq(w.fig.home(), false, '"The last figure", nothing remembered: ' + say());
        // "Home page" as the build before saved it (its default, no version): where I left off
        { const ui0 = got(localStorage, 'fig.ui'); try { put(localStorage, 'fig.ui', J({ start: 'home' })); w = await start('figure', names[1]); eq(w.UI.start, 'last', 'the old saved default'); ok(at(names[1]) && w.fig.home() === false, 'the old saved default started on Home: ' + say()); } finally { put(localStorage, 'fig.ui', ui0); } }
        // Back and Forward: the plain address shows what it showed (figure.json, or Home), never the figure opened after it. (Needs a figure.json: made here when the folder has none, and deleted again)
        fig.prefs({ start: 'last' });
        { const had = ((await listFiles('')) || []).some(f => f.name === 'figure.json'); if (!had) await hmMake(['figure.json']);
          try {
            w = await start('figure', 'figure.json'); ok(plain() && w.fig.home() === false, 'figure.json at the plain address: ' + say());
            w = await move(x => x.eval('openFile')(names[2]), 'a figure picked'); ok(at(names[2]) && w.fig.home() === false, 'a figure picked from the list: ' + say()); eq(got(localStorage, lastKey()), names[2], 'the figure picked is the last one');
            w = await move(x => x.history.back(), 'Back'); ok(plain() && w.eval('FILE') === 'figure.json' && w.fig.home() === false, 'Back to the plain address went on to the figure opened after it: ' + say());
            w = await move(x => x.history.forward(), 'Forward'); ok(at(names[2]), 'Forward: ' + say());
            w = await start('home', 'figure.json'); ok(plain() && w.fig.home() === true, 'Home at the plain address: ' + say());
            w = await move(x => x.eval('openFile')(names[2]), 'a figure opened from Home'); ok(at(names[2]) && w.fig.home() === false, 'a figure opened from Home: ' + say());
            w = await move(x => x.history.back(), 'Back to Home'); ok(plain() && w.fig.home() === true, 'Back to the plain address that showed Home: ' + say());
          } finally { if (fr) { fr.remove(); fr = null; } if (!had) { await sleep(300); if ((await fetch('api/move?file=figure.json&from=&to=trash', { method: 'POST' })).ok) await fetch('api/delete?file=figure.json', { method: 'POST' }); } }
        }
      } finally { if (fr) fr.remove(); fig.prefs({ start: s0 }); keep.forEach(([st, k, v]) => put(st, k, v)); put(sessionStorage, 'fig.home', null); put(sessionStorage, 'fig.homeRe', null); await wsClean(); }
    }, 300000);

    // --- citations: references in the formats the reference managers export (samples written for these tests), the styles, the dialog ---
    const hasCite = typeof citeDialog === 'function' && typeof fig.cite === 'function';
    const CS = {
      zoteroRis: ['TY  - JOUR', 'TI  - Rapamycin extends lifespan through p_53 and H_2O balance: a *critical* test', 'AU  - Carlsson, Alexander B.', 'AU  - van der Berg, Karel', 'AU  - Müller, Jörg', "AU  - O'Neill, Siobhán", 'T2  - Nature Medicine', 'J2  - Nat Med', 'VL  - 5', 'IS  - 3', 'SP  - 123', 'EP  - 130', 'PY  - 2025', 'DA  - 2025/03/01/', 'DO  - 10.1234/natmed.2025.001', 'UR  - https://doi.org/10.1234/natmed.2025.001', 'KW  - aging', 'ER  - ', '',
        'TY  - CHAP', 'TI  - Dietary restriction in worms', 'AU  - Smith, John A., Jr.', 'AU  - de la Cruz, María', 'T2  - Handbook of the Biology of Aging', 'A2  - Kaeberlein, Matt', 'PB  - Academic Press', 'CY  - London', 'PY  - 2021', 'SP  - 45', 'EP  - 67', 'ER  - ', '',
        'TY  - ELEC', 'TI  - Ageing and health', 'AU  - World Health Organization', 'T2  - WHO fact sheets', 'PY  - 2024', 'UR  - https://www.who.int/news-room/fact-sheets/detail/ageing-and-health', 'Y2  - 2025/01/15/', 'ER  - ', '',
        'TY  - GEN', 'TI  - A preprint without a year', 'AU  - Li, Wei', 'AU  - Nguyen, Thi Hoa', 'PB  - bioRxiv', 'DO  - 10.1101/2024.05.06.123456', 'M3  - preprint', 'ER  - '].join('\r\n'),
      endnoteRis: ['TY  - JOUR', 'AU  - Kenyon, C.', 'AU  - Chang, J.', 'AU  - Gensch, E.', 'AU  - Rudner, A.', 'AU  - Tabtiang, R.', 'PY  - 1993', 'DA  - Dec 2', 'TI  - A C. elegans mutant that lives twice as long as wild type', 'JO  - Nature', 'JF  - Nature', 'J2  - Nature', 'VL  - 366', 'IS  - 6454', 'SP  - 461-4', 'DO  - 10.1038/366461a0', 'AN  - 8247153', 'DB  - PubMed', 'ER  - '].join('\n'),
      zoteroBib: ['@article{carlsson_rapamycin_2025,', '\ttitle = {Rapamycin extends lifespan in {C}. elegans: {mTOR} \\& beyond},', '\tvolume = {5},', '\tissn = {1234-5678},', '\tdoi = {10.1234/natmed.2025.001},', '\tnumber = {3},', '\tjournal = {Nature Medicine},', '\tshortjournal = {Nat Med},',
        '\tauthor = {Carlsson, Alexander B. and van der Berg, Karel and M{\\"u}ller, J{\\"o}rg and {Aging Atlas Consortium} and Smith, Jr., John},', '\tmonth = mar,', '\tyear = {2025},', '\tpages = {123--130},', '}', '',
        '@incollection{smith_dietary_2021,', '\taddress = {London},', '\ttitle = {Dietary restriction in worms},', '\tbooktitle = {Handbook of the {Biology} of {Aging}},', '\tpublisher = {Academic Press},', '\tauthor = {Smith, John A.},', '\teditor = {Kaeberlein, Matt},', '\tyear = {2021},', '\tpages = {45--67},', '}', '',
        '@misc{vaswani_attention_2017,', '\ttitle = {Attention {Is} {All} {You} {Need}},', '\turl = {http://arxiv.org/abs/1706.03762},', '\tdoi = {10.48550/arXiv.1706.03762},', '\tpublisher = {arXiv},', '\tauthor = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},', '\tyear = {2017},', '\tnote = {arXiv:1706.03762 [cs]},', '}'].join('\n'),
      mendeleyBib: ['@string{pnas = "Proceedings of the National Academy of Sciences"}', '@article{Garcia-Lopez2013,', 'abstract = {Aging is characterized by a progressive loss {\\ldots}},', "author = {Garc{\\'{i}}a-L{\\'{o}}pez, Mar{\\'{i}}a and {\\O}stergaard, S{\\o}ren and {\\v{S}}imi{\\'{c}}, Goran and others},", 'doi = {10.1073/pnas.1234567110},', 'journal = pnas,', 'month = {jun},', 'number = {24},', 'pages = {9794--9799},', 'pmid = {23716681},', 'title = {{The hallmarks of aging in \\textit{Drosophila} at 25~{\\textdegree}C: $\\beta$-oxidation}},', 'volume = {110},', 'year = {2013}', '}', '',
        '@book{Alberts2014, author = "Alberts, Bruce and Johnson, Alexander and Lewis, Julian", title = "Molecular Biology of the Cell", edition = "6", publisher = "Garland Science", year = 2014}'].join('\n'),
      csl: JSON.stringify([{ id: 'http://zotero.org/users/1/items/AAAA', type: 'article-journal', title: 'The <i>C. elegans</i> lifespan machine', 'container-title': 'Nature Methods', 'container-title-short': 'Nat Methods', volume: '10', issue: '7', page: '665-670', DOI: '10.1038/nmeth.2475', URL: 'https://doi.org/10.1038/nmeth.2475', author: [{ family: 'Stroustrup', given: 'Nicholas' }, { family: 'Ulmschneider', given: 'Bryne E.' }, { family: 'Beethoven', given: 'Ludwig', 'non-dropping-particle': 'van' }], issued: { 'date-parts': [[2013, 7]] } },
        { type: 'webpage', title: 'Global health estimates', 'container-title': 'WHO', URL: 'https://www.who.int/data/global-health-estimates', author: [{ literal: 'World Health Organization' }], accessed: { 'date-parts': [[2025, 1, 2]] } },
        { type: 'article', title: 'A deep preprint', publisher: 'bioRxiv', DOI: '10.1101/2023.01.01.522000', author: [{ family: 'Zhang', given: 'Wei' }], issued: { raw: '2023-01-02' } }]),
      cslOne: JSON.stringify({ type: 'book', title: 'Molecular Biology of the Cell', publisher: 'Garland Science', author: [{ family: 'Alberts', given: 'Bruce' }, { family: 'Johnson', given: 'Alexander' }], issued: { 'date-parts': [['2014']] } }),
      enw: ['%0 Journal Article', '%A López-Otín, Carlos', '%A Blasco, Maria A.', '%A Partridge, Linda', '%A Serrano, Manuel', '%A Kroemer, Guido', '%T The hallmarks of aging', '%J Cell', '%V 153', '%N 6', '%P 1194-1217', '%D 2013', '%8 Jun 6', '%@ 0092-8674', '%R 10.1016/j.cell.2013.05.039', '%M 23746838', '%U https://www.ncbi.nlm.nih.gov/pubmed/23746838', '', '',
        '%0 Book Section', '%A Aging Atlas Consortium,', '%E Editor, Ann', '%T An atlas of aging', '%B The Big Book of Aging', '%I Springer', '%C Berlin', '%D 2020', '%P 1-20', '', '%0 Report', '%A Jones, Alice', '%T A report without a year', '%I Institute of Things'].join('\n'),
      enXml: '<?xml version="1.0" encoding="UTF-8"?><xml><records><record><database name="My EndNote Library.enl" path="C:\\x.enl">My EndNote Library.enl</database><source-app name="EndNote" version="20.0">EndNote</source-app><rec-number>12</rec-number><ref-type name="Journal Article">17</ref-type><contributors><authors><author><style face="normal" font="default" size="100%">Harrison, D. E.</style></author><author><style face="normal" font="default" size="100%">Strong, R.</style></author><author><style face="normal" font="default" size="100%">Nelson, Z. D.</style></author></authors></contributors><titles><title><style face="normal" font="default" size="100%">Rapamycin fed late in life extends lifespan in genetically heterogeneous mice</style></title><secondary-title><style face="normal" font="default" size="100%">Nature</style></secondary-title><alt-title><style face="normal" font="default" size="100%">Nature</style></alt-title></titles><periodical><full-title><style face="normal" font="default" size="100%">Nature</style></full-title></periodical><pages><style face="normal" font="default" size="100%">392-5</style></pages><volume><style face="normal" font="default" size="100%">460</style></volume><number><style face="normal" font="default" size="100%">7253</style></number><dates><year><style face="normal" font="default" size="100%">2009</style></year></dates><accession-num><style face="normal" font="default" size="100%">19587680</style></accession-num><urls><related-urls><url><style face="normal" font="default" size="100%">https://www.ncbi.nlm.nih.gov/pubmed/19587680</style></url></related-urls></urls><electronic-resource-num><style face="normal" font="default" size="100%">10.1038/nature08221</style></electronic-resource-num><remote-database-provider>NLM</remote-database-provider></record>' +
        '<record><ref-type name="Journal Article">17</ref-type><contributors><authors><author>Partridge, Linda</author><author>Deelen, Joris</author><author>Slagboom, P. Eline</author></authors></contributors><titles><title>Facing up to the global challenges of ageing</title><secondary-title>Nature</secondary-title></titles><periodical><full-title>Nature Reviews Molecular Cell Biology</full-title><abbr-1>Nat Rev Mol Cell Biol</abbr-1></periodical><pages>45-56</pages><volume>561</volume><dates><year>2018</year></dates></record></records></xml>',
      nbib: ['PMID- 23746838', 'OWN - NLM', 'STAT- MEDLINE', 'DCOM- 20130726', 'IS  - 1097-4172 (Electronic)', 'IS  - 0092-8674 (Linking)', 'VI  - 153', 'IP  - 6', 'DP  - 2013 Jun 6', 'TI  - The hallmarks of aging.', 'PG  - 1194-217', 'LID - 10.1016/j.cell.2013.05.039 [doi]', 'LID - S0092-8674(13)00645-4 [pii]', 'AB  - Aging is characterized by a progressive loss of physiological integrity, leading', '      to impaired function and increased vulnerability to death.', 'FAU - López-Otín, Carlos', 'AU  - López-Otín C', 'AD  - Departamento de Bioquímica, Universidad de Oviedo, Spain.', 'FAU - Blasco, Maria A', 'AU  - Blasco MA', 'FAU - Partridge, Linda', 'AU  - Partridge L', 'FAU - Serrano, Manuel', 'AU  - Serrano M', 'FAU - Kroemer, Guido', 'AU  - Kroemer G', 'CN  - Hallmarks Study Group', 'LA  - eng', 'PT  - Journal Article', 'PT  - Review', 'PL  - United States', 'TA  - Cell', 'JT  - Cell', 'JID - 0413066', 'SO  - Cell. 2013 Jun 6;153(6):1194-217. doi: 10.1016/j.cell.2013.05.039.', '',
        'PMID- 8247153', 'VI  - 366', 'IP  - 6454', 'DP  - 1993 Dec 2', 'TI  - A C. elegans mutant that lives twice as long as wild type.', 'PG  - 461-4', 'AU  - Kenyon C', 'AU  - Chang J', 'AU  - Gensch E', 'TA  - Nature', 'JT  - Nature', 'AID - 10.1038/366461a0 [doi]'].join('\n'),
      apa: 'Carlsson, A. B., van der Berg, K., & Müller, J. (2025). Rapamycin extends lifespan in C. elegans. Nature Medicine, 5(3), 123–130. https://doi.org/10.1234/natmed.2025.001',
      vancouver: 'Carlsson AB, van der Berg K, Müller J, et al. Rapamycin extends lifespan in C. elegans. Nat Med. 2025;5(3):123-130. doi:10.1234/natmed.2025.001',
      nature: 'Kenyon, C., Chang, J., Gensch, E., Rudner, A. & Tabtiang, R. A C. elegans mutant that lives twice as long as wild type. Nature 366, 461–464 (1993).'
    };
    const citePrefsOff = () => { try { localStorage.removeItem('fig.cite'); } catch (e) {} };
    const citeTexts = () => slidesOf(scene).map(sl => sl.objects.filter(o => o.cite || o.refList).map(o => o.text));
    const fam = r => r.authors.map(a => a.literal || a.family).join('|');

    test('home: the website starts on Home with directions to the desktop version and coding agents (welcome strip, Copy, Desktop & AI, links, fold); example links open directly; phones; the desktop editor has none of it', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      if (!WEB) {   // the desktop editor: no strip, no section, no links under the sections
        ok(!HOME_SECTIONS.some(s => s && s.id === 'desktop'), 'the desktop editor lists Desktop & AI');
        const was = fig.home(); fig.home('figures'); try { ok(await waitFor(() => hmMain().querySelector('.hmbar')), 'Figures did not draw'); ok(!D.querySelector('#hmMain .hmweb') && !D.querySelector('#hmNav .hmfoot') && !D.querySelector('#hmNav a'), 'the desktop editor shows the website\'s directions'); } finally { if (!was) fig.home(false); }
        eq(typeof webStrip === 'function' ? webStrip() : '', '', 'webStrip outside the website'); return;
      }
      const put = (st, k, v) => { try { if (v == null) st.removeItem(k); else st.setItem(k, v); } catch (e) {} };
      const keep = [[localStorage, viewKey()], [localStorage, lastKey()], [localStorage, 'fig.webHome'], [sessionStorage, 'fig.here:' + DIR]].map(([st, k]) => [st, k, (() => { try { return st.getItem(k); } catch (e) { return null; } })()]);
      let fr = null;
      const calm = () => { try { const w = fr.contentWindow; return !!(w.fig && w.eval('typeof fileReady!=="undefined"&&fileReady&&!HOME.pend&&!HOME.plan') && !w.document.documentElement.classList.contains('home-boot')) && w.location.href; } catch (e) { return false; } };
      const open = async (u, w0, h0) => { if (fr) fr.remove(); put(sessionStorage, 'fig.home', null); put(sessionStorage, 'fig.homeRe', null); put(sessionStorage, 'fig.here:' + DIR, null);
        fr = D.createElement('iframe'); fr.title = 'website home test'; fr.style.cssText = `position:fixed;left:0;top:0;width:${w0 || 1280}px;height:${h0 || 800}px;border:0;z-index:2147483000;background:#fff`; fr.src = u; D.body.appendChild(fr);
        let was = null, n = 0; ok(await waitFor(() => { const h = calm(); n = h && h === was ? n + 1 : 0; was = h; return n >= 12; }, 60000), 'the editor did not settle at ' + u); const w = fr.contentWindow; w.alert = () => {}; w.confirm = () => true; w.onbeforeunload = null;
        // a clipboard of our own (never the real one): what the page copies is kept here
        w.__copied = []; Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: t => { w.__copied.push(String(t)); return Promise.resolve(); } } }); return w; };
      try {
        // a first visit (nothing remembered): Home on Figures, with the welcome strip
        put(localStorage, viewKey(), null); put(localStorage, lastKey(), null); put(localStorage, 'fig.webHome', null);
        let w = await open(location.pathname), d = w.document; eq(w.fig.home(), true, 'a first visit to the website did not start on Home'); eq(d.querySelector('#hmNav [aria-current=page]').dataset.sec, 'figures', 'Home does not show Figures');
        // Home over a blank figure never saved (a first visit with no figures): its button starts a figure, it names none; closed, nothing is saved
        w = await open(location.pathname + '?home&file=' + encodeURIComponent(wsPre() + '-webhome-blank.json')); d = w.document; ok(await waitFor(() => w.fig.home() === true), '?home did not show Home');
        eq(d.querySelector('#hmBack span').textContent, 'Start a blank figure', 'the top-right button names a figure that never was'); d.querySelector('#hmBack').click(); ok(await waitFor(() => w.fig.home() === false), 'Start a blank figure did not close Home');
        // what that leaves behind (a figure was shown, none was ever saved): the plain address opens Home again, not a blank figure
        put(localStorage, viewKey(), 'figure'); put(localStorage, lastKey(), null); w = await open(location.pathname); d = w.document; eq(w.fig.home(), true, 'after a look at a blank figure, the plain address no longer opens Home');
        // a narrower window (1000 px): the short text, still two rows
        w = await open(location.pathname + '?home', 1000, 760); d = w.document; ok(await waitFor(() => d.querySelector('#hmMain .hmweb')), 'no strip at 1000 px'); ok(d.querySelector('#hmMain .hmweb').getBoundingClientRect().height < 125, 'the strip is too tall at 1000 px: ' + d.querySelector('#hmMain .hmweb').getBoundingClientRect().height);
        w = await open(location.pathname + '?home'); d = w.document; ok(await waitFor(() => d.querySelector('#hmMain .hmweb')), 'no strip');
        const s = d.querySelector('#hmMain .hmweb'); ok(s, 'no welcome strip'); ok(/Drawing with an AI assistant\?/.test(s.textContent) && /Claude Code/.test(s.textContent) && /MIT license/.test(s.textContent) && !/licence/i.test(s.textContent), 'the strip\'s words: ' + s.textContent);
        ok(s.compareDocumentPosition(d.querySelector('#hmMain .hmgrid')) & 4, 'the strip is not above the cards'); ok(s.getBoundingClientRect().height < 130, 'the strip is too tall at 1280 px: ' + s.getBoundingClientRect().height);
        const gh = s.querySelector('a.hmlb.primary'); eq([gh.getAttribute('href'), gh.target, gh.rel, gh.textContent.trim()], ['https://github.com/Alex-D-C/SiliCoDraw', '_blank', 'noopener', 'Desktop version'], 'the Desktop version button');
        eq(s.querySelector('code').textContent, 'https://github.com/Alex-D-C/SiliCoDraw', 'the link shown');
        s.querySelectorAll('button,a').forEach(b => ok(b.title || b.getAttribute('aria-label'), 'a control of the strip without a name: ' + b.outerHTML.slice(0, 80)));
        const cp = s.querySelector('[data-web=agent]'); cp.click(); ok(await waitFor(() => w.__copied.length === 1), 'Copy copied nothing'); const ins = w.__copied[0];
        ok(ins.includes('https://github.com/Alex-D-C/SiliCoDraw') && /AGENTS\.md/.test(ins) && /README/.test(ins) && /start the figure editor/.test(ins), 'the instruction for the agent: ' + ins); eq(cp.textContent.trim(), 'Copied', 'the button does not say Copied'); ok(await waitFor(() => /copied to the clipboard/.test(d.querySelector('#srLive').textContent)), 'the screen reader is not told: ' + d.querySelector('#srLive').textContent);
        // the links under the sections: GitHub, About (the site gives its address), the license
        const L = [...d.querySelectorAll('#hmNav .hmfoot a')].map(a => [a.textContent.trim(), a.getAttribute('href'), a.target, a.rel]);
        eq(L, [['GitHub', 'https://github.com/Alex-D-C/SiliCoDraw', '_blank', 'noopener'], ['About SiliCoDraw', 'https://silicodraw.com/about', '_blank', 'noopener'], ['MIT license', 'https://github.com/Alex-D-C/SiliCoDraw/blob/main/LICENSE', '_blank', 'noopener']], 'the links under the sections');
        // More… opens Desktop & AI: why, install, agents, figures from the website, links; every Copy copies what it shows
        s.querySelector('[data-web=more]').click(); ok(await waitFor(() => w.fig.home() === true && d.querySelector('#hmNav [aria-current=page]').dataset.sec === 'desktop'), 'More… did not open Desktop & AI');
        const m = d.querySelector('#hmMain .hmdk'); ok(m, 'the section did not draw'); const tx = m.textContent;
        ['Why the desktop version', 'Install', 'With an AI coding agent', 'Bring your figures from this website', 'Save all figures to a folder…', 'Open a folder of figures…', 'AGENTS.md', 'CLAUDE.md', 'Start SiliCoDraw.bat', 'sh start.sh'].forEach(t => ok(tx.includes(t), 'the section does not say ' + t));
        ok(!/licence|colour|centre/i.test(tx), 'British spelling in the section');
        const hrefs = [...m.querySelectorAll('a')].map(a => a.getAttribute('href')); ['https://github.com/Alex-D-C/SiliCoDraw', 'https://github.com/Alex-D-C/SiliCoDraw#install-and-start', 'https://github.com/Alex-D-C/SiliCoDraw/blob/main/LICENSE', 'https://github.com/Alex-D-C/SiliCoDraw/issues/new/choose', 'https://silicodraw.com/about'].forEach(h => ok(hrefs.includes(h), 'the section has no link to ' + h));
        m.querySelectorAll('a').forEach(a => ok(a.target === '_blank' && a.rel === 'noopener', 'a link that does not open in a new tab: ' + a.href));
        w.__copied.length = 0; m.querySelector('[data-web=mac]').click(); await sleep(20); m.querySelector('[data-web=link]').click(); await sleep(20); m.querySelector('.hmprompt [data-web=agent]').click(); ok(await waitFor(() => w.__copied.length === 3), 'the section copied ' + w.__copied.length + ' texts');
        eq(w.__copied, ['curl -fsSL https://raw.githubusercontent.com/Alex-D-C/SiliCoDraw/main/install.sh | sh', 'https://github.com/Alex-D-C/SiliCoDraw', ins], 'what the section copies');
        eq(m.querySelector('.hmprompt code').textContent, ins, 'the instruction shown is not the one copied');
        // ✕ folds the strip away in this browser: gone, remembered, and still gone after a reload; the section brings it back
        w.fig.home('figures'); await sleep(100); d.querySelector('#hmMain .hmweb [data-web=fold]').click(); await sleep(60); ok(!d.querySelector('#hmMain .hmweb'), 'the strip did not fold'); eq(localStorage.getItem('fig.webHome'), '{"folded":true}', 'the fold is not remembered'); eq(d.activeElement && d.activeElement.dataset.sec, 'desktop', 'the focus is not on Desktop & AI after the fold');
        ok(d.querySelector('#hmNav [data-sec=desktop]') && d.querySelectorAll('#hmNav .hmfoot a').length === 3, 'folded, the navigation lost its entries');
        w = await open(location.pathname + '?home'); d = w.document; ok(await waitFor(() => w.fig.home() && d.querySelector('#hmMain .hmbar')), 'Home did not show'); ok(!d.querySelector('#hmMain .hmweb'), 'the folded strip came back after a reload');
        w.fig.home('desktop'); await sleep(60); const un = d.querySelector('#hmMain [data-web=unfold]'); ok(un, 'no way back to the strip'); un.click(); w.fig.home('figures'); ok(await waitFor(() => d.querySelector('#hmMain .hmweb')), 'the strip did not come back'); eq(localStorage.getItem('fig.webHome'), '{"folded":false}', 'unfolding is not remembered');
        // an example link (the site's ?example= becomes ?file=…&from=examples/…) opens the figure directly, also at a first visit
        put(localStorage, viewKey(), null); put(localStorage, lastKey(), null); const ex = wsPre() + '-webhome-ex.json';
        w = await open(location.pathname + '?file=' + encodeURIComponent(ex) + '&from=examples/pathway.json'); eq(w.fig.home(), false, 'an example link opened Home'); ok(w.fig.list().length > 3, 'the example did not load');
        // phones: the short strip (heading, one line, Desktop version, More…, ✕), nothing wider than the screen, the links at the end of the row of tabs
        w = await open(location.pathname + '?home&phone=1', 390, 844); d = w.document; ok(await waitFor(() => w.fig.home() && d.querySelector('#hmMain .hmweb')), 'no strip on a phone'); const ps = d.querySelector('#hmMain .hmweb');
        ok(w.getComputedStyle(ps.querySelector('.hmwag')).display === 'none' && w.getComputedStyle(ps.querySelector('.hmwlong')).display === 'none' && w.getComputedStyle(ps.querySelector('.hmwshort')).display !== 'none', 'the phone strip is not the short one');
        ok(ps.getBoundingClientRect().height < 170 && ps.getBoundingClientRect().right <= 390, 'the phone strip: ' + JSON.stringify(ps.getBoundingClientRect()));
        ok(d.querySelector('#hmMain').scrollWidth <= d.querySelector('#hmMain').clientWidth + 1, 'Home scrolls sideways on a phone'); ps.querySelectorAll('.hmwbt>*,.hmwx').forEach(b => ok(b.getBoundingClientRect().height >= 40, 'a button too small for a finger: ' + b.textContent));
        eq(d.querySelectorAll('#hmNav .hmfoot a').length, 3, 'the links are not in the phone\'s row of tabs');
        w.fig.home('desktop'); await sleep(60); ok(d.querySelector('#hmMain').scrollWidth <= d.querySelector('#hmMain').clientWidth + 1, 'Desktop & AI scrolls sideways on a phone');
        { const tb = d.querySelector('#hmNav [data-sec=desktop]').getBoundingClientRect(); ok(tb.left >= 0 && tb.right <= 391, 'the Desktop & AI tab is off the row of tabs: ' + tb.left + '–' + tb.right); ok(w.getComputedStyle(d.querySelector('#hmMain .hmbar h2')).display !== 'none', 'Desktop & AI has no title on a phone'); ok(/⋯ → File ▸ → Save all/.test(d.querySelector('#hmMain .hmdk').textContent), 'the phone is told of a File ▾ menu'); }
      } finally { if (fr) fr.remove(); keep.forEach(([st, k, v]) => put(st, k, v)); await wsClean(); }
    }, 240000);

    test('home: New presentation (bar, card, templates, the file it makes), Import… and figures dropped on Home; the Cite button', async () => {
      if (typeof homeShow !== 'function') throw new Skip('this editor has no Home');
      if (typeof HM_NEWPRES === 'undefined') throw new Skip('this editor has no New presentation on Home');
      blank(); fig.add('text', { x: 300, y: 300, text: 'stays' }); await settle(); commit(); await flushSave(); let before = J(scene); const H = D.querySelector('#home'), toastT = () => D.querySelector('#toast').textContent;
      const A = hmPre() + '-imp-a.json', B = hmPre() + '-imp-b.json', file = (n, t) => new File([wsFig(t)], n, { type: 'application/json' });
      const drop = async (files, type = 'drop') => { let dt = null; try { dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); } catch (e) { dt = null; } let ev = null; try { ev = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }); } catch (e) {} if (!ev || !ev.dataTransfer || ev.dataTransfer.files.length !== files.length) return false; H.dispatchEvent(ev); return ev; };
      try {
        await wsClean();
        // the file a presentation starts from: slides, 16 : 9, a title slide and a content slide
        { const s = newTemplate('slides'); ok(isDeck(s) && s.slides.length === 2 && s.w === 1600 && s.h === 900 && !('objects' in s), 'a file with two slides, 1600 × 900'); eq(s.slides.map(x => x.objects.map(o => o.type)), [['text', 'text'], ['text', 'text']], 'a title and a subtitle, a title and its content'); ok(+s.slides[0].objects[0].size > +s.slides[0].objects[1].size, 'the title is the larger text');
          eq(J(healScene(JSON.parse(J(s)))), J(healScene(JSON.parse(J(healScene(JSON.parse(J(s))))))), 'it loads as it is'); ok(sceneSvg(s, 320, 180).includes('<svg'), 'it has a thumbnail'); const i = NEW_TPLS.findIndex(t => t[0] === 'slides'); ok(i > 0 && NEW_TPLS[i][2] === '' && /Presentation/.test(NEW_TPLS[i][1]), 'offered under Basics in New figure');
          if (hasSlides) { fig.set(s); await settle(); ok(isDeck(scene) && CUR === 0 && D.documentElement.classList.contains('has-slides') && scene.objects.some(o => /title/i.test(o.text)), 'opened: the title slide, with the slide strip'); eq(fig.check({ slides: true }).filter(r => r.level !== 'info'), [], 'nothing wrong on its slides'); unslide(); blank(); fig.add('text', { x: 300, y: 300, text: 'stays' }); await settle(); commit(); before = J(scene); } }
        // Home → Figures: three buttons in the bar, two + cards
        fig.home('figures'); await HOME.ctx.reload(); ok(await waitFor(() => hmMain().querySelectorAll('.hmbar .hmnews .hmnewb').length === 3), 'the bar has no three buttons');
        const bs = [...hmMain().querySelectorAll('.hmbar .hmnewb')]; eq(bs.map(b => b.dataset.do), ['new', 'newp', 'import'], 'New figure, New presentation, Import…'); eq(bs.map(b => b.getAttribute('aria-label')), ['New figure', 'New presentation', 'Import figures'], 'each with a name'); ok(bs.every(b => b.title && b.querySelector('svg') && b.querySelector('span').textContent && b.tabIndex >= 0), 'each with a tooltip, a picture and words');
        eq(new Set(bs.map(b => b.querySelector('svg').innerHTML)).size, 3, 'three different pictures');
        ok(await waitFor(() => hmMain().querySelectorAll('.hmc.hmnew').length === 2), 'no two + cards'); const cs = [...hmMain().querySelectorAll('.hmc.hmnew')], pc = () => hmMain().querySelector('.hmc.hmnew[data-new=slides]'), pb = () => hmMain().querySelector('.hmbar [data-do=newp]'); eq(cs.map(c => [c.dataset.new, c.getAttribute('aria-label')]), [['', 'New figure'], ['slides', 'New presentation']], 'the New figure card, then New presentation'); ok(cs[0].querySelector('svg').innerHTML !== cs[1].querySelector('svg').innerHTML, 'the two cards look the same');
        const pres = async how => { ok(await hmDlg('#nfName'), how + ': no dialog'); const bx = D.querySelector('#modalBox'); eq(bx.querySelector('h2').textContent, 'New presentation', how + ': the dialog'); eq(bx.querySelector('#nfTpl').value, 'slides', how + ': what it starts from'); eq(getComputedStyle(bx.querySelector('#nfTpl').closest('.row')).display, 'none', how + ': only the name is asked'); ok(/^new-presentation/.test(bx.querySelector('#nfName').value) && D.activeElement === bx.querySelector('#nfName'), how + ': a name is suggested, ready to type over'); closeModal(); eq(fig.home(), true, how + ': Home after the dialog'); };
        hmClick(pb()); await pres('the button'); hmClick(pc()); await pres('the card'); pc().focus(); hmKey('Enter', {}, pc()); await pres('Enter on the card');
        hmClick(hmMain().querySelector('.hmbar [data-do=new]')); ok(await hmDlg('#nfName'), 'New figure: no dialog'); eq([D.querySelector('#modalBox h2').textContent, D.querySelector('#nfTpl').value, getComputedStyle(D.querySelector('#nfTpl').closest('.row')).display !== 'none'], ['New figure', 'blank', true], 'New figure still asks what to start from'); ok([...D.querySelector('#nfTpl').options].some(o => o.value === 'slides'), 'and offers the presentation'); closeModal();
        fig.home('templates'); ok(await waitFor(() => hmMain().querySelector('.hmc.hmtpl[data-v=slides]')), 'no Presentation card among the templates'); hmClick(hmMain().querySelector('.hmc.hmtpl[data-v=slides]')); ok(await hmDlg('#nfTpl'), 'the card opens no dialog'); eq([D.querySelector('#modalBox h2').textContent, D.querySelector('#nfTpl').value], ['New figure', 'slides'], 'the template card: New figure with the choice made'); closeModal();
        // Import…: the dialog of Open a folder of figures…
        fig.home('figures'); ok(await waitFor(() => hmMain().querySelector('.hmbar [data-do=import]')), 'no Import button'); hmClick(hmMain().querySelector('.hmbar [data-do=import]')); ok(await hmDlg('#ofFiles'), 'Import… opens no dialog'); eq(D.querySelector('#modalBox h2').textContent, 'Import figures', 'named for what was asked'); ok(!D.querySelector('#ofDir') || /on the Home page/.test(D.querySelector('#modalBox').textContent) && !/canvas/.test(D.querySelector('#modalBox').textContent), 'from Home it speaks of dropping on Home'); closeModal();
        openFolderDialog(); ok(await hmDlg('#ofFiles'), 'no dialog'); eq(D.querySelector('#modalBox h2').textContent, 'Open a folder of figures', 'the File menu\'s name stays'); ok(!/Home page/.test(D.querySelector('#modalBox').textContent), 'the File menu\'s dialog speaks of the canvas'); closeModal();
        { const L0 = HOME.lists; try { HOME.lists = { active: [], archive: [], trash: [] }; homeDraw(); const E = hmMain().querySelector('.hmempty'); eq([...E.querySelectorAll('[data-do]')].map(b => b.dataset.do), ['new', 'newp', 'import', 'templates'], 'no figures yet: the same three, and the templates'); hmClick(E.querySelector('[data-do=newp]')); ok(await hmDlg('#nfName'), 'no dialog from the empty page'); eq(D.querySelector('#modalBox h2').textContent, 'New presentation', 'New presentation from the empty page'); closeModal(); } finally { HOME.lists = L0; homeDraw(); } }
        // figures dropped on Home come in as Import… brings them; the list shows them selected and says what happened
        await HOME.ctx.reload(); let dropped = await drop([file(A, 'imported a'), file(B, 'imported b')], 'dragover');
        if (dropped) { ok(dropped.defaultPrevented && H.classList.contains('dropping'), 'a file over Home is not marked as welcome'); dropped = await drop([file(A, 'imported a'), file(B, 'imported b')]); ok(dropped.defaultPrevented && !H.classList.contains('dropping'), 'the drop is not taken'); }
        else await webRestore([file(A, 'imported a'), file(B, 'imported b')]);   // a browser that makes no drag events with files: the same path from the file chooser
        ok(await waitFor(() => hmCard(A) && hmCard(B) && hmCard(A).classList.contains('sel') && hmCard(B).classList.contains('sel')), 'the imported figures are not shown selected'); eq([...hmMain().querySelectorAll('.hmc.sel')].map(c => c.dataset.n).sort(), [A, B].sort(), 'only they are selected'); ok(/Added 2 figures/.test(toastT()), 'said: ' + toastT()); ok(/^2 selected/.test(hmN()), 'the bar counts them'); eq(HOME.sec, 'figures', 'on Figures'); eq(fig.home(), true, 'Home stays'); ok(D.activeElement && D.activeElement.classList.contains('hmc') && D.activeElement.classList.contains('sel'), 'the keyboard is not on a figure that came in: ' + (D.activeElement && (D.activeElement.id || D.activeElement.tagName)));
        eq(JSON.parse(await (await fetch(encodeURIComponent(A), { cache: 'no-store' })).text()).objects[0].text, 'imported a', 'the file is there');
        if (dropped) { hmMain().querySelector('.hmbar [data-do=import]').focus(); await drop([file(A, 'imported a')]); ok(await waitFor(() => /is already here/.test(toastT())), 'the same figure again is skipped, and said: ' + toastT()); ok(toastT().includes(A.replace(/\.json$/, '')), 'by its name: ' + toastT()); ok(await waitFor(() => hmCard(A) && hmCard(A).classList.contains('sel') && hmMain().querySelectorAll('.hmc.sel').length === 1 && D.activeElement === hmCard(A)), 'the figure that is already here is not pointed at (selected, with the keyboard on it)'); fig.home('archive'); await drop([file(B, 'another b')]); ok(await waitFor(() => HOME.sec === 'figures' && hmCard(B.replace(/\.json$/, '-restored.json')) && hmCard(B.replace(/\.json$/, '-restored.json')).classList.contains('sel')), 'dropped on another section: shown on Figures, beside the figure of that name'); ok(/Added 1 figure/.test(toastT()), 'said: ' + toastT());
          await drop([new File(['x'], 'picture.png', { type: 'image/png' })]); ok(/Drop figure files/.test(toastT()), 'a picture dropped on Home: what to drop is said: ' + toastT()); eq(location.href.includes('picture'), false, 'the page stays'); }
        hmKey('Escape'); hmKey('Escape'); fig.home(false);
        // the Cite button of the top bar opens Add citation…
        { const c = D.querySelector('#bCite'); ok(c && c.title && /Shift\+C/.test(c.title) && c.getAttribute('aria-label') && c.querySelector('svg') && c.dataset.label === 'Cite', 'no Cite button with a tooltip naming Shift+C'); ok([...c.querySelectorAll('svg path')].every(p => p.getAttribute('fill') === 'currentColor'), 'filled quotation marks (outlined ones read as 99)'); if (!PHONE()) { ok(c.offsetWidth >= 24, 'the Cite button is squeezed to ' + c.offsetWidth + ' px'); eq(getComputedStyle(c).flexShrink, '0', 'the icon buttons of the top bar keep their size'); } const order = [...D.querySelectorAll('body > header > button')].map(b => b.id); ok(order.indexOf('bCite') === order.indexOf('bAnim') - 1 && order.indexOf('bCite') < order.indexOf('bPresent'), 'not beside Animations: ' + order.join(' '));
          if (typeof citeDialog === 'function') { c.click(); ok(await hmDlg('h2'), 'the Cite button opens no dialog'); ok(/citation/i.test(D.querySelector('#modalBox h2').textContent), 'Add citation: ' + D.querySelector('#modalBox h2').textContent); closeModal(); } }
        eq(J(scene), before, 'the figure changed');
      } finally { try { closeModal(); } catch (e) {} H.classList.remove('dropping'); fig.home(false); await wsClean(); }
    }, 180000);
    // ---------- the notice board on Home (tips and what's new, in the bar of Figures) ----------
    const nbKeep = async (fn) => { let ls = null; try { ls = localStorage.getItem('fig.notices'); } catch (e) {} const pref = JSON.parse(J(nbPref)), ui = fig.prefs(); try { return await fn(); } finally {
      try { if (ls === null) localStorage.removeItem('fig.notices'); else localStorage.setItem('fig.notices', ls); } catch (e) {} Object.assign(nbPref, pref); if (fig.prefs().motion !== ui.motion) fig.prefs({ motion: ui.motion }); if (!D.querySelector('#modal').hidden) closeModal(); if (fig.home()) fig.home(false); await nbLoad(true); } };
    const nbEl = () => hmMain().querySelector('.hmbar .hmnb');
    const nbPut = p => { Object.assign(nbPref, p); localStorage.setItem('fig.notices', J(nbPref)); };   // (nbSave keeps what another tab wrote: the tests set the browser's copy themselves)
    test('notice board: in the bar of Figures between the search box and the sort list, tips and news from notices/notices.json (same as the built-in copy), rotation with a fade, pauses on hover and focus, none with reduced motion, fold remembered, what\'s new and its seen-state, the API', async () => {
      if (typeof nbMount !== 'function') throw new Skip('this editor has no notice board');
      const mot0 = fig.prefs().motion; await nbKeep(async () => {
        nbPut({ folded: false, seen: [] }); fig.prefs({ motion: 'full' });   // full motion even where the system asks for less (GitHub's Windows and Mac machines do): reduced motion is checked below
        fig.home('figures'); await HOME.ctx.reload(); ok(await waitFor(() => nbEl() && nbEl().querySelector('.nbnext')), 'no board in the bar'); await nbLoad(true); await frame();
        const bar = hmMain().querySelector('.hmbar'), kids = [...bar.children], el = nbEl();
        ok(kids.indexOf(el) > kids.indexOf(bar.querySelector('.hmq')) && kids.indexOf(el) < kids.indexOf(bar.querySelector('.hmsort')), 'the board is not between the search box and the sort list');
        eq([el.tagName, el.getAttribute('aria-label')], ['SECTION', 'Tips and what’s new'], 'a region with a name'); ok(el.querySelector('.nbbody').getAttribute('aria-live') === 'off', 'the rotating words are announced');
        { const r = el.getBoundingClientRect(); ok(r.height >= 64 && r.height <= 140, 'the board is not about two controls tall (72 px at least, taller only for words that need it): ' + r.height); for (const k of kids) { if (k === el || k.hidden || !k.getClientRects().length || k.classList.contains('hmsp')) continue; const q = k.getBoundingClientRect(); ok(q.right <= r.left + 1 || q.left >= r.right - 1 || q.bottom <= r.top + 1 || q.top >= r.bottom - 1, 'the board overlaps ' + k.className); } }
        ['nbprev', 'nbnext', 'nbwn', 'nbfold'].forEach(c => { const b = el.querySelector('.' + c); ok(b && b.tagName === 'BUTTON' && b.getAttribute('aria-label') && b.title && b.tabIndex >= 0, c + ' has no name, tooltip or keyboard access'); });
        // only Figures shows it
        for (const s of ['archive', 'trash', 'templates']) { fig.home(s); await frame(); ok(!hmMain().querySelector('.hmnb'), s + ' shows the board'); } fig.home('figures'); await HOME.ctx.reload(); ok(await waitFor(() => nbEl()), 'the board is not back on Figures');
        // the content: the file, the same as the built-in copy, every action known
        const file = await (await fetch('notices/notices.json', { cache: 'no-store' })).json(), strip = L => J(L.map(x => { const y = { ...x }; delete y.src; return y; }));
        eq(strip(nbClean(file)), strip(nbClean(NB_FALLBACK)), 'the built-in copy differs from notices/notices.json'); eq(nbClean(file).length, file.tips.length + file.news.length, 'notices.json has items the board drops');
        const st = fig.notices(); ok(st.items.filter(x => x.kind === 'tip').length >= 25 && st.items.filter(x => x.kind === 'news').length >= 10, 'too few tips or news: ' + st.items.length); ok(st.items.every(x => !x.action || NB_ACTS[x.action]), 'an unknown action');
        ok(st.items.every(x => x.text.length <= 160), 'a tip that is too long for the board: ' + J(st.items.filter(x => x.text.length > 160).map(x => x.id))); ok(st.items.every(x => !/colour|centre|behaviour|favourite|licence\b|organis/i.test(x.text + ' ' + (x.title || ''))), 'British spelling in a tip');
        { const ix = st.items.map(x => x.kind); ok(ix.slice(0, 6).includes('tip') && ix.slice(0, 6).includes('news'), 'tips and news are not mixed: ' + ix.slice(0, 6)); }
        { const T = ['Shift+C', 'Shift A', 'F5', 'Shift X']; const tx = st.items.map(x => nbPlain(x.text)).join(' '); ok(/Shift C/.test(tx) && /Shift A/.test(tx) && /F5/.test(tx) && /Shift X/.test(tx), 'the tips name ' + T); }
        // marks: escaped words, then bold, italic and keys; {mod} names this keyboard's key
        eq(nbRich('<b>x</b> **bold** *C. elegans* `Shift` {mod}'), '&lt;b&gt;x&lt;/b&gt; <b>bold</b> <i>C. elegans</i> <kbd>Shift</kbd> ' + esc(MODK), 'nbRich'); eq(nbRich('p<0.05 * a *'), 'p&lt;0.05 * a *', 'a lone star is kept');
        // rotation: the clock moves it on after NB_EVERY with a fade; a step by the user is said once
        if (D.hidden) throw new Skip('the test page is hidden: its timers do not run');
        // nothing left from before that pauses it: a dialog, the focus, or the pointer (a headless window's mouse may rest over the board: :hover when it was mounted)
        if (!D.querySelector('#modal').hidden) closeModal(); if (D.activeElement && nbEl().contains(D.activeElement)) D.activeElement.blur(); NB.hover = false; NB.acc = 0;
        { const n = fig.notices(); ok(n.rotating, 'the board does not rotate: ' + J({ paused: n.paused, still: n.still, folded: n.folded, shown: n.shown, hidden: D.hidden, modal: !D.querySelector('#modal').hidden, items: n.items.length, focus: D.activeElement && (D.activeElement.className || D.activeElement.tagName) })); } const i0 = fig.notices().current; nbTick(NB_EVERY - 600); eq(fig.notices().current, i0, 'moved on early'); nbTick(600);
        eq(fig.notices().current, (i0 + 1) % st.items.length, 'the clock did not move it on'); ok(nbEl().classList.contains('nbout'), 'no fade'); { const b = nbEl().querySelector('.nbbody'); b.style.transition = 'none'; eq(getComputedStyle(b).opacity, '0', 'the words do not fade'); b.style.transition = ''; } await sleep(NB_FADE + 120); ok(!nbEl().classList.contains('nbout'), 'the fade did not end');
        { srSay(''); await sleep(60); const i = fig.notices().current; nbEl().querySelector('.nbnext').focus(); nbEl().querySelector('.nbnext').click(); eq(fig.notices().current, (i + 1) % st.items.length, 'Next'); ok(await waitFor(() => /^(Tip|New in this version): /.test(D.querySelector('#srLive').textContent)), 'a step by the user is not said: ' + D.querySelector('#srLive').textContent);
          ok(D.activeElement && D.activeElement.classList.contains('nbnext'), 'Next lost the focus'); nbEl().querySelector('.nbprev').click(); eq(fig.notices().current, i, 'Previous'); hmKey('ArrowRight', {}, D.activeElement); eq(fig.notices().current, (i + 1) % st.items.length, '→ in the board'); D.activeElement.blur(); }
        // pauses: the pointer over it, the focus in it
        { const e = nbEl(), i = fig.notices().current; e.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' })); ok(!nbTick(NB_EVERY) && fig.notices().current === i && fig.notices().paused, 'no pause while the pointer is over it'); e.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
          // only the keyboard's focus pauses it (:focus-visible): a script's focus() counts as that in Chrome and Edge, not always in Firefox, so the rule is checked either way
          e.querySelector('.nbwn').focus(); if (e.querySelector('.nbwn').matches(':focus-visible')) ok(!nbTick(NB_EVERY) && fig.notices().current === i && fig.notices().paused, 'no pause while the focus is in it');
          else ok(!fig.notices().paused && fig.notices().rotating, 'a focus that is not the keyboard\'s pauses it'); D.activeElement.blur(); await frame(); ok(nbTick(NB_EVERY) && fig.notices().current !== i, 'it does not go on after the pause'); await sleep(NB_FADE + 80); }
        // reduced motion: no fade, no turn of the clock; the arrows still step
        { fig.prefs({ motion: 'reduced' }); await frame(); const i = fig.notices().current; ok(!nbTick(NB_EVERY * 3) && fig.notices().current === i && fig.notices().still && !fig.notices().rotating, 'it moves on with reduced motion'); fig.notices('next'); ok(!nbEl().classList.contains('nbout') && fig.notices().current !== i, 'a step fades with reduced motion'); fig.prefs({ motion: 'system' }); await frame(); }
        // folded: a Tips button, remembered in this browser (never in the figure), back with a click
        { const before = J(scene); nbEl().querySelector('.nbfold').click(); ok(nbEl().classList.contains('folded') && nbEl().querySelector('.nbpill'), 'no Tips button'); ok(D.activeElement === nbEl().querySelector('.nbpill'), 'the focus did not go to the Tips button'); eq(JSON.parse(localStorage.getItem('fig.notices')).folded, true, 'folded is not remembered');
          ok(!nbTick(NB_EVERY) , 'a folded board rotates'); homeDraw(); await frame(); ok(nbEl().querySelector('.nbpill'), 'drawn again, the board unfolds'); nbEl().querySelector('.nbpill').click(); ok(nbEl().querySelector('.nbnext') && D.activeElement === nbEl().querySelector('.nbfold'), 'the Tips button did not unfold it'); eq(J(scene), before, 'the figure changed'); ok(!/notices|nbPref/.test(lastSaved), 'the board went into the figure'); }
        eq(fig.notices('fold').folded, true, 'fig.notices(fold)'); eq(fig.notices('unfold').folded, false, 'fig.notices(unfold)'); let thrown = false; try { fig.notices('zz'); } catch (e) { thrown = /unknown command/.test(e.message); } ok(thrown, 'an unknown command does not throw');
        // what's new: every news item with its picture, the ones not seen first with a dot; seen once opened
        { const N = st.items.filter(x => x.kind === 'news'); nbPut({ seen: N.slice(2).map(x => x.id) }); await nbLoad(true); await frame(); ok(nbEl().querySelector('.nbwn .nbdot'), 'no dot on What\'s new'); ok(/2 not seen/.test(nbEl().querySelector('.nbwn').getAttribute('aria-label')), 'What\'s new does not say how many are new');
          nbEl().querySelector('.nbwn').focus(); nbEl().querySelector('.nbwn').click(); ok(await hmDlg('.nbwlist'), 'What\'s new did not open'); const li = [...D.querySelectorAll('#modalBox .nbwlist:not(.nbtips) li')]; eq(D.querySelectorAll('#modalBox .nbtips li').length, st.items.filter(x => x.kind === 'tip').length, 'What\'s new does not list every tip (All tips)'); eq(li.length, N.length, 'the news listed'); eq(li.slice(0, 2).map(x => x.dataset.id), N.slice(0, 2).map(x => x.id), 'the news not seen are not first'); ok(li.slice(0, 2).every(x => x.classList.contains('unseen') && x.querySelector('.nbnew')) && !li[2].querySelector('.nbnew'), 'the New marks');
          ok(li.every(x => x.querySelector('.nbpic img, .nbpic svg')), 'a news item without a picture'); ok(await waitFor(() => [...D.querySelectorAll('#modalBox .nbwlist img')].every(i => i.complete && i.naturalWidth > 0), 8000), 'a picture does not load: ' + J([...D.querySelectorAll('#modalBox .nbwlist img')].filter(i => !i.naturalWidth).map(i => i.getAttribute('src').slice(0, 60))));
          ok(N.every(x => nbPref.seen.includes(x.id)), 'opening What\'s new did not mark them seen'); closeModal(); ok(!nbEl().querySelector('.nbdot'), 'the board keeps its dots'); eq([nbEl().querySelector('.nbwn').getAttribute('aria-label'), nbEl().querySelector('.nbwn').title], ['What’s new', 'What’s new in this version'], 'What\'s new still counts news not seen'); ok(D.activeElement === nbEl().querySelector('.nbwn'), 'the focus did not come back to What\'s new');
          D.activeElement.blur(); fig.notices('fold'); nbPut({ seen: [] }); homeDraw(); await frame(); ok(nbEl().querySelector('.nbpill .nbdot'), 'the Tips button has no dot for news not seen'); fig.notices('whatsnew'); ok(await hmDlg('.nbwlist'), 'What\'s new from the Tips button'); closeModal(); ok(nbEl().querySelector('.nbpill') && !nbEl().querySelector('.nbpill .nbdot'), 'the Tips button keeps its dot after What\'s new'); fig.notices('unfold'); fig.notices('whatsnew'); ok(await hmDlg('.nbwlist'), 'fig.notices(whatsnew)'); eq(D.querySelectorAll('#modalBox .nbwlist li.unseen').length, 0, 'seen news still marked'); closeModal(); }
        // the whole words of the item shown in its tooltip (a cut tip can still be read; every tip is also in What's new, All tips)
        { const x = NB.items[NB.i], b = nbEl().querySelector('.nbbody'); ok(b.title.startsWith(nbPlain((x.title ? x.title + ': ' : '') + x.text)), 'the tooltip does not hold the whole item: ' + b.title); }
        // a redraw of Home during the fade: the board on the screen goes on turning, and its buttons work
        { ok(fig.notices().rotating, 'not rotating before the redraw: ' + J(fig.notices().paused)); nbStep(1, false); await HOME.ctx.reload(); await sleep(NB_FADE + 300); ok(NB.el === nbEl() && NB.el.isConnected && NB.tm && fig.notices().rotating, 'the board froze after a redraw in its fade: ' + J([NB.el === nbEl(), !!NB.tm, fig.notices().rotating]));
          const i = fig.notices().current; nbEl().querySelector('.nbnext').click(); eq(fig.notices().current, (i + 1) % NB.items.length, 'Next after the redraw'); ok(nbEl().querySelector('.nbit.cur .nbtx').textContent.length > 0 && !nbEl().classList.contains('nbout'), 'the board on the screen was not drawn'); if (D.activeElement) D.activeElement.blur(); }
        // another tab: what it saved is kept (folded, news seen) when this one steps; its change is followed here
        { localStorage.setItem('fig.notices', J({ folded: true, at: '', seen: ['zz-other-tab'] })); nbStep(1, true); const s = JSON.parse(localStorage.getItem('fig.notices')); ok(s.folded === true && s.seen.includes('zz-other-tab'), 'a step here wrote over another tab\'s fold or seen news: ' + J(s));
          W.dispatchEvent(new StorageEvent('storage', { key: 'fig.notices', newValue: J({ folded: true, at: '', seen: [] }) })); ok(nbEl().querySelector('.nbpill'), 'another tab folded it: this one did not follow');
          W.dispatchEvent(new StorageEvent('storage', { key: 'fig.notices', newValue: J({ folded: false, at: '', seen: [] }) })); ok(nbEl().querySelector('.nbnext'), 'another tab unfolded it: this one did not follow'); nbPut({ folded: false, seen: [] }); } fig.prefs({ motion: mot0 });
      });
    }, 120000);
    test('notice board: a missing notices.json falls back to the built-in copy, an unsafe one is neutralized, every action works, nothing is asked of another host', async () => {
      if (typeof nbMount !== 'function') throw new Skip('this editor has no notice board');
      const f0 = W.fetch, asked = [];
      await nbKeep(async () => {
        nbPut({ folded: false }); fig.home('figures'); await HOME.ctx.reload(); ok(await waitFor(() => nbEl()), 'no board'); const t0 = performance.now();
        try {
        try {
          // missing: the built-in copy
          W.fetch = (u, o) => { const s = String(u && u.url || u); asked.push(s); return /notices\/notices\.json/.test(s) ? Promise.resolve(new Response('not found', { status: 404 })) : f0(u, o); };
          let L = await nbLoad(true); eq(L.length, nbClean(NB_FALLBACK).length, 'no fallback when the file is missing'); ok(asked.some(s => /notices\/notices\.json/.test(s)), 'the file was not asked for');
          W.fetch = (u, o) => /notices\/notices\.json/.test(String(u && u.url || u)) ? Promise.resolve(new Response('{"tips": [1, 2', { status: 200 })) : f0(u, o); L = await nbLoad(true); eq(L.length, nbClean(NB_FALLBACK).length, 'no fallback when the file is broken');
          // unsafe: escaped words, no action that is not a name of the list, no picture from elsewhere, no script in a drawing
          const bad = { tips: [{ id: 'x1', text: '<img src=x onerror="window.__nbHack=1">**bold**', action: 'javascript:window.__nbHack=1', icon: '"><script>window.__nbHack=1</script>' }, { id: 'x 2', text: 'bad id' }, { id: 'x3', text: 'eval', action: 'constructor' }],
            news: [{ id: 'n1', title: '<script>window.__nbHack=1</script>', text: 'far away', picture: 'https://example.com/x.png' }, { id: 'n2', title: 'up', text: 'parent', picture: '../figure.json' }, { id: 'n3', title: 'svg', text: 'script', picture: '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__nbHack=1"><script>window.__nbHack=1</script></svg>' },
              { id: 'n4', title: 'svg', text: 'link', picture: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>' }, { id: 'n5', title: 'ok', text: 'a plain drawing', picture: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#2563eb"/></svg>', action: 'cite' }, { id: 'n6', title: 'proto', text: 'x', action: '__proto__' }] };
          W.fetch = (u, o) => /notices\/notices\.json/.test(String(u && u.url || u)) ? Promise.resolve(new Response(J(bad), { status: 200 })) : f0(u, o);
          L = await nbLoad(true); const by = id => L.find(x => x.id === id);
          ok(!by('x 2'), 'a bad id is kept'); ok(by('x1') && !by('x1').action && !by('x1').icon, 'a javascript: action or a bad icon is kept: ' + J(by('x1'))); ok(!by('x3').action && !by('n6').action, 'an inherited property passes as an action');
          ok(!by('n1').picture && !by('n2').picture && !by('n3').picture && !by('n4').picture, 'an unsafe picture is kept: ' + J(L.filter(x => x.picture).map(x => x.id))); ok(by('n5').picture && by('n5').action === 'cite', 'a plain drawing is dropped');
          W.__nbHack = 0; for (const id of ['x1', 'n1', 'n3', 'n5']) { NB.i = L.indexOf(by(id)); nbPaint(nbEl()); await frame(); const e = nbEl(); ok(!e.querySelector('script, [onerror], [onload], iframe, object'), id + ': markup from the file in the board'); ok([...e.querySelectorAll('img')].every(i => /^(data:image\/svg\+xml|notices\/|brand\/)/.test(i.getAttribute('src'))), id + ': a picture from elsewhere'); }
          NB.i = L.indexOf(by('x1')); nbPaint(nbEl()); ok(nbEl().querySelector('.nbit.cur').textContent.includes('<img src=x'), 'the words are not shown as written'); ok(nbEl().querySelector('.nbit.cur .nbtx b'), 'bold is lost');
          fig.notices('whatsnew'); ok(await hmDlg('.nbwlist'), 'What\'s new'); ok(!D.querySelector('#modalBox .nbwlist script, #modalBox .nbwlist [onload], #modalBox .nbwlist [onerror]'), 'markup from the file in What\'s new'); closeModal(); await sleep(300); eq(W.__nbHack, 0, 'script from the file ran');
        } finally { W.fetch = (u, o) => { asked.push(String(u && u.url || u)); return f0(u, o); }; }   // (the mocks end; the recorder stays on to the end of the test)
        await nbLoad(true); await frame();
        // every action name does what it says (Home closes first for a feature of the editor)
        const S = s => !D.querySelector('#modal').hidden && D.querySelector('#modalBox h2') && D.querySelector('#modalBox h2').textContent === s;
        const want = { cite: () => S('Add citation') && !fig.home(), anims: () => animPane() && !fig.home(), iconPacks: () => !D.querySelector('#packMenu').hidden && !fig.home(), envmicro: () => palState.cat === 'Environmental microbiology' && !fig.home(),
          newFigure: () => S('New figure'), newPresentation: () => S('New presentation'), import: () => S('Import figures'), templates: () => fig.home() && HOME.sec === 'templates', prefs: () => S('Appearance'), whatsnew: () => S('What’s new'),
          'help:home': () => S('Shortcuts') && /Home: all your figures/.test((D.querySelector('#modalBox tr.nbhl') || {}).textContent), 'help:present': () => /Slideshow/.test((D.querySelector('#modalBox tr.nbhl') || {}).textContent), 'help:anim': () => /Animations: a sidebar/.test((D.querySelector('#modalBox tr.nbhl') || {}).textContent),
          'help:crop': () => /Crop any element/.test((D.querySelector('#modalBox tr.nbhl') || {}).textContent), 'help:cite': () => /Add citation: paste/.test((D.querySelector('#modalBox tr.nbhl') || {}).textContent), 'help:colors': () => /Colors in this icon/.test((D.querySelector('#modalBox tr.nbhl') || {}).textContent) };
        eq(Object.keys(NB_ACTS).sort(), Object.keys(want).sort(), 'the actions'); const cat0 = palState.cat, an0 = animPane();
        try { for (const a of Object.keys(want)) { fig.home('figures'); await frame(); NB_ACTS[a][1](); ok(await waitFor(want[a], 6000), 'the action ' + a + ' did not work'); if (!D.querySelector('#modal').hidden) closeModal(); await frame(); if (!D.querySelector('#modal').hidden) closeModal(); if (animPane() !== an0) animPane(an0); packMenu(false); if (palState.cat !== cat0) { palState.cat = cat0; buildPalette(); } } }
        finally { if (!D.querySelector('#modal').hidden) closeModal(); fig.home(false); }
        // a click on an item runs its action; a news item without one opens What's new at it
        { fig.home('figures'); await HOME.ctx.reload(); ok(await waitFor(() => nbEl() && nbEl().querySelector('.nbnext')), 'no board'); const L2 = NB.items, j = L2.findIndex(x => x.kind === 'news' && !x.action); ok(j >= 0, 'no news item without an action'); NB.i = j; nbPaint(nbEl()); nbEl().querySelector('.nbgo').click(); ok(await hmDlg('.nbwlist li.nbhl'), 'the item did not open What\'s new at it'); eq(D.querySelector('#modalBox .nbwlist li.nbhl').dataset.id, L2[j].id, 'What\'s new at another item'); closeModal(); }
        // no request to another host (the board's file and pictures included)
        ok(asked.every(s => { try { return new URL(s, location.href).host === location.host; } catch (e) { return false; } }), 'a request to another host: ' + J(asked.filter(s => !s.startsWith(location.origin) && /^[a-z]+:/.test(s))));
        ok(asked.some(s => /notices\/notices\.json/.test(s)) && asked.length > 3, 'the recorder saw nothing: ' + asked.length);
        { const far = performance.getEntriesByType('resource').filter(r => r.startTime >= t0 && new URL(r.name).host !== location.host).map(r => r.name); eq(far, [], 'a request to another host'); }
        } finally { W.fetch = f0; }
      });
    }, 120000);
    test('notice board: on its own row in a narrower window, in the bar\'s row in a wide one, a slim strip on a phone; nothing overlaps or leaves the bar from 320 to 2560 px', async () => {
      if (typeof nbMount !== 'function') throw new Skip('this editor has no notice board');
      const name = hmPre() + '-nb.json'; let fr = null, ls = null; try { ls = localStorage.getItem('fig.notices'); localStorage.setItem('fig.notices', J({ folded: false, at: '', seen: [] })); } catch (e) {}
      const open = async (w, h, q) => { if (fr) fr.remove(); fr = D.createElement('iframe'); fr.title = 'notice board test'; fr.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;z-index:2147483000;background:#fff`; fr.src = location.pathname + '?file=' + encodeURIComponent(name) + '&home' + q; D.body.appendChild(fr);
        ok(await waitFor(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 60000), 'the editor did not start in the frame'); const fw = watch(fr.contentWindow); fw.alert = () => {}; fw.onbeforeunload = null; ok(await waitFor(() => fw.document.querySelector('#hmMain .hmbar .hmnb .nbnext'), 20000), 'no board at ' + w + ' px'); await sleep(150); return fw; };
      const geo = fw => { const d = fw.document, bar = d.querySelector('#hmMain .hmbar'), el = bar.querySelector('.hmnb'), R = x => x.getBoundingClientRect(), r = R(el), others = [...bar.children].filter(k => k !== el && !k.hidden && k.getClientRects().length && !k.classList.contains('hmsp') && !k.classList.contains('hmbulk'));
        for (const k of others) { const q = R(k); ok(q.right <= r.left + 1 || q.left >= r.right - 1 || q.bottom <= r.top + 1 || q.top >= r.bottom - 1, 'the board overlaps ' + k.className + ' at ' + fw.innerWidth + ' px'); }
        ok(bar.scrollWidth <= bar.clientWidth + 1 && d.documentElement.scrollWidth <= fw.innerWidth + 1, 'the bar is wider than the window at ' + fw.innerWidth + ' px');
        [...bar.querySelectorAll('button, select, input')].filter(b => b.getClientRects().length).forEach(b => { const q = R(b); ok(q.left >= -1 && q.right <= fw.innerWidth + 1, (b.getAttribute('aria-label') || b.className) + ' is off the screen at ' + fw.innerWidth + ' px'); });
        return { r, q: R(bar.querySelector('.hmq')), news: R(bar.querySelector('.hmnews')), bar: R(bar), pic: fw.getComputedStyle(el.querySelector('.nbpic')).display }; };
      try {
        await wsClean(); await hmMake([name]);
        let fw = await open(2200, 700, '&phone=0'), g = geo(fw); ok(Math.abs((g.r.top + g.r.bottom) / 2 - (g.q.top + g.q.bottom) / 2) < 12, 'the board is not in the row of the search box at 2200 px: ' + J([g.r.top, g.r.bottom, g.r.width, g.q.top, g.q.bottom, fw.innerWidth, fw.innerHeight, fw.document.documentElement.className, fw.location.search]));
        { const b = fw.document.querySelector('#hmMain .hmnb .nbbody').getBoundingClientRect(); ok(b.width >= 520, 'too little room for the words beside the bar\'s controls at 2200 px: ' + b.width); }
        fw = await open(2000, 700, '&phone=0'); g = geo(fw); ok(g.r.top >= g.q.bottom - 1 && g.r.width > g.bar.width - 60, 'not a row of its own at 2000 px (too little room for two or three lines in the bar): ' + J([g.r.top, g.q.bottom, g.r.width, g.bar.width]));
        fw = await open(2560, 600, '&phone=0'); geo(fw); { const d = fw.document, imp = d.querySelector('#hmMain .hmbar [data-do=import]').getBoundingClientRect(), bar = d.querySelector('#hmMain .hmbar').getBoundingClientRect(); ok(bar.right - imp.right < 40, 'the bar\'s buttons stop in the middle of a wide window: ' + J([imp.right, bar.right])); fw.fig.notices('fold'); await sleep(60); ok(Math.abs(d.querySelector('#hmMain .hmbar [data-do=import]').getBoundingClientRect().right - imp.right) < 2, 'the buttons jump when the board is folded'); fw.fig.notices('unfold'); }
        fw = await open(1700, 700, '&phone=0'); g = geo(fw); ok(g.r.top >= g.q.bottom - 1 && g.r.width > g.bar.width - 60, 'not a row of its own at 1700 px (too little room for its words in the bar): ' + J([g.r.top, g.q.bottom, g.r.width, g.bar.width]));
        fw = await open(1440, 600, '&phone=0'); geo(fw);
        fw = await open(1000, 700, '&phone=0'); g = geo(fw); ok(g.r.top >= g.q.bottom - 1 && g.r.width > g.bar.width - 60, 'not a row of its own at 1000 px: ' + J([g.r.top, g.q.bottom, g.r.width, g.bar.width]));
        fw = await open(760, 700, '&phone=0'); geo(fw);
        fw = await open(390, 844, '&phone=1'); g = geo(fw); ok(g.r.top >= g.news.bottom - 1 && g.r.height >= 72 && g.r.height <= 110 && g.pic === 'none', 'not a strip under the three buttons on a phone (its four buttons two by two): ' + J([g.r.top, g.news.bottom, g.r.height, g.pic])); ok([...fw.document.querySelectorAll('#hmMain .hmnb button')].filter(b => b.getClientRects().length).every(b => b.getBoundingClientRect().height >= 36), 'buttons too small for a finger');
        { const all = fw.eval('NB.all'), its = fw.fig.notices().items; ok(all.some(x => x.desk) && its.length && its.every(x => !all.find(y => y.kind === x.kind && y.id === x.id).desk), 'a phone shows tips that name keys or right-click: ' + J(its.filter(x => all.find(y => y.id === x.id && y.desk)).map(x => x.id)));
          const tx = fw.document.querySelector('#hmMain .hmnb .nbit.cur .nbtx'); ok(['none', '', undefined].includes(fw.getComputedStyle(tx).webkitLineClamp), 'a tip on the phone strip is cut off after some lines');
          { const R = s => fw.document.querySelector('#hmMain .hmnb ' + s).getBoundingClientRect(), p = R('.nbprev'), n = R('.nbnext'), w = R('.nbwn'), f = R('.nbfold'); ok(Math.abs(p.top - n.top) < 2 && Math.abs(w.top - f.top) < 2 && w.top >= p.bottom - 1 && Math.abs(p.left - w.left) < 2, 'the phone strip\x27s buttons are not two by two: ' + J([p, n, w, f].map(r => [Math.round(r.left), Math.round(r.top)]))); } }
        fw = await open(320, 640, '&phone=1'); geo(fw);
        fw.fig.notices('fold'); await sleep(60); ok(fw.document.querySelector('#hmMain .hmnb .nbpill'), 'no Tips button on the phone'); { const bar = fw.document.querySelector('#hmMain .hmbar'); ok(bar.scrollWidth <= bar.clientWidth + 1, 'folded, the bar is too wide on a phone'); } fw.fig.notices('unfold');
        fw = await open(844, 390, '&phone=1'); geo(fw);
      } finally { if (fr) fr.remove(); try { if (ls === null) localStorage.removeItem('fig.notices'); else localStorage.setItem('fig.notices', ls); } catch (e) {} await wsClean(); }
    }, 300000);

    test('notice board: every tip and news item shown whole (no ellipsis, nothing clipped, nothing under the buttons) from 320 to 2560 px, on phones upright and sideways, with large text, compact spacing, every style and theme; the board keeps its height while the items turn', async () => {
      if (typeof nbMount !== 'function') throw new Skip('this editor has no notice board');
      const name = hmPre() + '-nbfit.json'; let fr = null, ls = null; try { ls = localStorage.getItem('fig.notices'); localStorage.setItem('fig.notices', J({ folded: false, at: '', seen: [] })); } catch (e) {}
      const open = async (w, h, q) => { if (fr) fr.remove(); fr = D.createElement('iframe'); fr.title = 'notice board test'; fr.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;z-index:2147483000;background:#fff`; fr.src = location.pathname + '?file=' + encodeURIComponent(name) + '&home' + q; D.body.appendChild(fr);
        ok(await waitFor(() => fr.contentWindow.fig && fr.contentWindow.eval('typeof fileReady!=="undefined"&&fileReady'), 60000), 'the editor did not start in the frame'); const fw = watch(fr.contentWindow); fw.alert = () => {}; fw.onbeforeunload = null; ok(await waitFor(() => fw.document.querySelector('#hmMain .hmbar .hmnb .nbit.cur'), 20000), 'no board at ' + w + ' px'); await sleep(250); return fw; };
      const size = async (w, h) => { fr.style.width = w + 'px'; fr.style.height = h + 'px'; await sleep(120); await new Promise(r => fr.contentWindow.requestAnimationFrame(() => r())); };
      // Appearance in the frame only (UI + its classes, never saved: the editor under test and its storage stay as they are)
      const look = async (fw, p) => { Object.assign(fw.UI, { theme: 'light', style: 'classic', text: 'normal', density: 'comfortable' }, p); fw.applyUIClasses(); await sleep(60); };
      const bad = [], seen = new Set();
      const check = (fw, tag, maxLines) => { const d = fw.document, bar = d.querySelector('#hmMain .hmbar'), el = bar.querySelector('.hmnb'), NBf = fw.eval('NB'), L = NBf.items, i0 = NBf.i, hs = [], R = x => x.getBoundingClientRect();
        const say = s => { if (bad.length < 40) bad.push(tag + ': ' + s); };
        if (!L || L.length < 2) { say('no items'); return 0; }
        for (let i = 0; i < L.length; i++) { NBf.i = i; fw.nbPaint(el); el.classList.remove('nbout'); const id = L[i].id; seen.add(L[i].kind + ':' + id);
          const r = R(el); hs.push(r.height); const cur = el.querySelector('.nbit.cur'), body = el.querySelector('.nbbody');
          if (!cur || !cur.textContent.trim()) { say(id + ' not drawn'); continue; }
          if (el.querySelectorAll('.nbit.cur').length !== 1) say(id + ': ' + el.querySelectorAll('.nbit.cur').length + ' items visible');
          for (const t of [el, body, el.querySelector('.nbstack'), cur, ...cur.querySelectorAll('.nbtx, .nbtx > *, .nbk')]) { if (!t || !t.getClientRects().length) continue; const cs = fw.getComputedStyle(t);
            if (cs.textOverflow === 'ellipsis') say(id + ': an ellipsis on ' + t.className);
            if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') say(id + ': lines clamped on ' + t.className);
            if (cs.display !== 'inline' && (t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1)) say(id + ': ' + (t.className || t.tagName) + ' cut off ' + J([t.scrollWidth, t.clientWidth, t.scrollHeight, t.clientHeight]));
            if (parseFloat(cs.fontSize) < 12 && t.matches('.nbtx')) say(id + ': text under 12 px (' + cs.fontSize + ')'); }
          const c = R(cur), b = R(body);
          if (c.top < b.top - 1 || c.bottom > b.bottom + 1 || c.left < b.left - 1 || c.right > b.right + 1) say(id + ': the words leave their box ' + J([c.top, c.bottom, c.left, c.right, b.top, b.bottom, b.left, b.right].map(Math.round)));
          if (c.top < r.top - 1 || c.bottom > r.bottom + 1 || c.right > r.right + 1) say(id + ': the words leave the board');
          for (const k of el.querySelectorAll('button.ib, .nbwn, .nbpic')) { if (!k.getClientRects().length) continue; const q = R(k); if (q.width && !(q.right <= c.left + 1 || q.left >= c.right - 1 || q.bottom <= c.top + 1 || q.top >= c.bottom - 1)) say(id + ': the words run under ' + k.className); if (q.right > r.right + 1 || q.left < r.left - 1) say(k.className + ' leaves the board'); } }
        for (const k of bar.children) { if (k === el || k.hidden || !k.getClientRects().length || k.classList.contains('hmsp') || k.classList.contains('hmbulk')) continue; const q = R(k), r = R(el); if (!(q.right <= r.left + 1 || q.left >= r.right - 1 || q.bottom <= r.top + 1 || q.top >= r.bottom - 1)) say('the board overlaps ' + k.className); }
        if (bar.scrollWidth > bar.clientWidth + 1) say('the bar is wider than its room');
        const hi = Math.max(...hs), lo = Math.min(...hs); if (hi - lo > 1) say('the height changes while the items turn: ' + Math.round(lo) + '–' + Math.round(hi));
        // still loading (the built-in copy laid out hidden): the same height as with the items, so nothing moves when they arrive
        NBf.items = null; fw.nbPaint(el); { const hw = R(el).height, wt = el.querySelector('.nbstack > .nbwait'); if (Math.abs(hw - hi) > 1) say('the board changes its height when the items arrive: ' + Math.round(hw) + ' → ' + Math.round(hi)); if (!wt || !wt.getClientRects().length || el.querySelector('.nbit.cur')) say('"Loading tips…" not shown alone while loading'); } NBf.items = L;
        // the fade (the words and the picture at opacity 0 while .nbout is on) and the buttons' layout (a row of their own, or a 2 × 2 block in the board's grid)
        NBf.i = i0; fw.nbPaint(el); { const fd = [el.querySelector('.nbbody'), el.querySelector('.nbpic')].filter(x => x && x.getClientRects().length); fd.forEach(x => x.style.transition = 'none'); el.classList.add('nbout'); for (const x of fd) if (fw.getComputedStyle(x).opacity !== '0') say('no fade on ' + x.className.split(' ')[0]); el.classList.remove('nbout'); fd.forEach(x => x.style.transition = '');
          const cd = fw.getComputedStyle(el.querySelector('.nbctl')).display, bd = fw.getComputedStyle(el).display; if (cd !== (bd === 'grid' ? 'contents' : 'flex')) say('the arrows are laid out as ' + cd + ' in a ' + bd + ' board');
          if (bd === 'flex') { const p = R(el.querySelector('.nbprev')), n = R(el.querySelector('.nbnext')); if (n.left - p.right < 1.5) say('Previous and Next touch'); } }
        // the line limit is set for the fonts of Windows and macOS (Segoe UI, San Francisco: about 0.45 em a letter); a wider font (DejaVu Sans on Linux, about 0.52 em) may take one line more: the board grows for it
        if (maxLines) { const t0 = el.querySelector('.nbtx'), cs = t0 && fw.getComputedStyle(t0), cx = fw.document.createElement('canvas').getContext('2d'), sample = 'The quick brown fox jumps over the lazy dog, and a figure shows every tip whole.';
          if (cs) { cx.font = cs.fontWeight + ' 100px ' + cs.fontFamily; if (cx.measureText(sample).width / 100 / sample.length > 0.45 * 1.08) maxLines++; } }
        if (maxLines) { for (let i = 0; i < L.length; i++) { NBf.i = i; fw.nbPaint(el); el.classList.remove('nbout'); const t = el.querySelector('.nbit.cur .nbtx'), lh = parseFloat(fw.getComputedStyle(t).lineHeight), n = Math.round(R(t).height / lh); if (n > maxLines) say(L[i].id + ': ' + n + ' lines (at most ' + maxLines + ')'); } }
        NBf.i = i0; fw.nbPaint(el); return hi; };
      try {
        await wsClean(); await hmMake([name]);
        // desktop: one frame, made narrower and wider (the bar slot from 1900 px of main area, its own row below)
        let fw = await open(2560, 700, '&phone=0'); const H = {};
        // the narrowest board (560 px of main area) may take a fourth line with the fonts of macOS too: it grows for it, and the checks keep every item whole
        for (const w of [2560, 2200, 1950, 1820, 1600, 1440, 1280, 1024, 768, 700, 600, 560]) { await size(w, 700); H[w] = check(fw, w + ' px', w <= 700 ? (w < 600 ? 4 : 3) : 0); }
        ok(H[2560] >= 70 && H[2560] <= 110 && H[1440] >= 70 && H[1440] <= 110, 'the board is not about 72 px tall on a wide screen: ' + J(H));
        ok(H[1440] >= 1.5 * 46, 'not taller than before (46 px): ' + H[1440]);
        // large text, compact spacing, every style, light and dark
        for (const [w, p] of [[1440, { text: 'large' }], [2560, { text: 'large' }], [1024, { text: 'large', density: 'compact' }], [2560, { density: 'compact' }], [1440, { theme: 'dark', style: 'soft' }], [2200, { theme: 'dark', style: 'flat' }], [1280, { style: 'contrast' }], [1950, { theme: 'dark', style: 'contrast', text: 'large' }], [560, { text: 'large' }], [600, { theme: 'dark', density: 'compact' }]]) {
          await size(w, 700); await look(fw, p); check(fw, w + ' px ' + J(p), w <= 700 ? (p.text === 'large' ? 4 : 3) : 0); }
        await look(fw, {}); ok(seen.size === fw.eval('NB.all').length, 'not every item was checked on the desktop: ' + seen.size + ' of ' + fw.eval('NB.all').length);
        // phones: upright (320, 360, 390, 430), sideways, large text; only the items a phone shows
        fw = await open(390, 844, '&phone=1'); ok(fw.document.documentElement.classList.contains('phone'), 'no phone layout');
        for (const [w, h] of [[390, 844], [320, 640], [360, 760], [430, 900]]) { await size(w, h); check(fw, 'phone ' + w + ' px'); }
        await look(fw, { text: 'large' }); for (const w of [320, 390]) { await size(w, 800); check(fw, 'phone ' + w + ' px, large text'); } await look(fw, { theme: 'dark', density: 'compact' }); check(fw, 'phone 390 px, dark, compact');
        fw = await open(844, 390, '&phone=1'); ok(await waitFor(() => fw.document.documentElement.classList.contains('ph-land')), 'not sideways'); await sleep(150); { const h = check(fw, 'phone sideways 844 px'); ok(h <= 72, 'the board takes too much height on a phone held sideways: ' + h); }
        fw = await open(667, 375, '&phone=1'); await sleep(150); check(fw, 'phone sideways 667 px'); await look(fw, { text: 'large' }); check(fw, 'phone sideways 667 px, large text');
        ok(!bad.length, 'items cut off or a board that jumps:\n' + bad.join('\n'));
      } finally { if (fr) fr.remove(); try { if (ls === null) localStorage.removeItem('fig.notices'); else localStorage.setItem('fig.notices', ls); } catch (e) {} await wsClean(); }
    }, 300000);

    test('citations: parsers read RIS, BibTeX, EndNote (.enw and XML), CSL JSON, PubMed .nbib, identifiers and formatted references', async () => {
      if (!hasCite) throw new Skip('this editor has no citations');
      const P = k => { const p = refParse(CS[k]); return p; };
      // Zotero RIS: four types, a name particle, a suffix, an institution, a missing year, the abbreviated journal, marks in the title kept as text
      let p = P('zoteroRis'); eq([p.format, p.refs.length], ['ris', 4], 'Zotero RIS'); let r = p.refs[0];
      eq([r.type, fam(r), r.authors[1].given, r.year, r.container, r.short, r.volume, r.issue, r.pages, r.doi, r.url], ['article', "Carlsson|van der Berg|Müller|O'Neill", 'Karel', 2025, 'Nature Medicine', 'Nat Med', '5', '3', '123–130', '10.1234/natmed.2025.001', undefined], 'RIS article');
      eq(r.title, 'Rapamycin extends lifespan through p_53 and H_2O balance: a *critical* test', 'the title is kept as written');
      eq([p.refs[1].type, J(p.refs[1].authors[0]), p.refs[1].authors[1].family, p.refs[1].container, p.refs[1].publisher, p.refs[1].pages], ['chapter', J({ family: 'Smith', given: 'John A.', suffix: 'Jr' }), 'de la Cruz', 'Handbook of the Biology of Aging', 'Academic Press', '45–67'], 'RIS chapter: suffix, particle, book');
      eq([p.refs[2].type, J(p.refs[2].authors), p.refs[2].container, p.refs[2].url], ['web', J([{ literal: 'World Health Organization' }]), 'WHO fact sheets', 'https://www.who.int/news-room/fact-sheets/detail/ageing-and-health'], 'RIS web page with an institution');
      eq([p.refs[3].type, p.refs[3].year, p.refs[3].container, fam(p.refs[3]), 'publisher' in p.refs[3]], ['preprint', undefined, 'bioRxiv', 'Li|Nguyen', false], 'RIS preprint without a year');
      // EndNote RIS: PubMed's shortened pages, the accession number as PMID, a journal named three times
      p = P('endnoteRis'); r = p.refs[0]; eq([p.format, r.authors.length, r.year, r.container, r.short, r.pages, r.pmid, r.doi], ['ris', 5, 1993, 'Nature', undefined, '461–464', '8247153', '10.1038/366461a0'], 'EndNote RIS');
      // Zotero BibTeX: accents, protected capitals, \&, an institution in braces, "Family, Jr., Given", month macro, an arXiv @misc
      p = P('zoteroBib'); eq([p.format, p.refs.length], ['bibtex', 3], 'Zotero BibTeX'); r = p.refs[0];
      eq([r.title, fam(r), r.authors[2].given, J(r.authors[4]), r.short, r.pages, r.issue, r.year], ['Rapamycin extends lifespan in C. elegans: mTOR & beyond', 'Carlsson|van der Berg|Müller|Aging Atlas Consortium|Smith', 'Jörg', J({ family: 'Smith', given: 'John', suffix: 'Jr' }), 'Nat Med', '123–130', '3', 2025], 'BibTeX article');
      eq(J(r.authors[3]), J({ literal: 'Aging Atlas Consortium' }), 'a name in braces is an institution'); eq([p.refs[1].type, p.refs[1].container, p.refs[1].authors.length], ['chapter', 'Handbook of the Biology of Aging', 1], 'BibTeX chapter (the editor is no author)');
      eq([p.refs[2].type, p.refs[2].container, p.refs[2].title, p.refs[2].doi], ['preprint', 'arXiv', 'Attention Is All You Need', '10.48550/arXiv.1706.03762'], 'BibTeX preprint');
      // Mendeley BibTeX: @string, nested accent braces, "and others", a double-braced title with commands and math, quoted values, a bare year
      p = P('mendeleyBib'); eq(p.refs.length, 2, 'Mendeley BibTeX'); r = p.refs[0];
      eq([fam(r), r.authors[0].given, r.authors[1].given, r.container, r.title, r.pmid, r.pages], ['García-López|Østergaard|Šimić', 'María', 'Søren', 'Proceedings of the National Academy of Sciences', 'The hallmarks of aging in Drosophila at 25 °C: β-oxidation', '23716681', '9794–9799'], 'Mendeley article');
      eq([p.refs[1].type, p.refs[1].title, p.refs[1].publisher, p.refs[1].year, p.refs[1].authors.length], ['book', 'Molecular Biology of the Cell', 'Garland Science', 2014, 3], 'BibTeX book');
      // CSL JSON: a list and a single object; HTML in a title, a particle, a literal author, no date, a raw date, a preprint
      p = P('csl'); eq([p.format, p.refs.length], ['csl', 3], 'CSL JSON'); r = p.refs[0];
      eq([r.title, r.authors[2].family, r.short, r.year, r.pages, r.doi, r.url], ['The C. elegans lifespan machine', 'van Beethoven', 'Nat Methods', 2013, '665–670', '10.1038/nmeth.2475', undefined], 'CSL article');
      eq([p.refs[1].type, p.refs[1].year, J(p.refs[1].authors)], ['web', undefined, J([{ literal: 'World Health Organization' }])], 'CSL web page'); eq([p.refs[2].type, p.refs[2].container, p.refs[2].year], ['preprint', 'bioRxiv', 2023], 'CSL preprint');
      p = P('cslOne'); eq([p.format, p.refs.length, p.refs[0].type, p.refs[0].year], ['csl', 1, 'book', 2014], 'one CSL object');
      // EndNote tagged: the trailing comma of an institution, an editor that is no author, a report without a year
      p = P('enw'); eq([p.format, p.refs.length], ['enw', 3], 'EndNote .enw'); r = p.refs[0];
      eq([fam(r), r.container, r.volume, r.issue, r.pages, r.year, r.doi, r.pmid], ['López-Otín|Blasco|Partridge|Serrano|Kroemer', 'Cell', '153', '6', '1194–1217', 2013, '10.1016/j.cell.2013.05.039', '23746838'], '.enw article');
      eq([p.refs[1].type, J(p.refs[1].authors), p.refs[1].container, p.refs[1].publisher], ['chapter', J([{ literal: 'Aging Atlas Consortium' }]), 'The Big Book of Aging', 'Springer'], '.enw chapter of a consortium'); eq([p.refs[2].type, p.refs[2].year, p.refs[2].publisher], ['report', undefined, 'Institute of Things'], '.enw report without a year');
      // EndNote XML: text inside <style>, the periodical's abbreviation
      p = P('enXml'); eq([p.format, p.refs.length], ['xml', 2], 'EndNote XML'); r = p.refs[0];
      eq([fam(r), r.authors[0].given, r.title, r.container, r.pages, r.year, r.doi, r.pmid], ['Harrison|Strong|Nelson', 'D. E.', 'Rapamycin fed late in life extends lifespan in genetically heterogeneous mice', 'Nature', '392–395', 2009, '10.1038/nature08221', '19587680'], 'XML article');
      eq([p.refs[1].container, p.refs[1].short], ['Nature Reviews Molecular Cell Biology', 'Nat Rev Mol Cell Biol'], 'XML: the journal and its abbreviation');
      // PubMed: full author names, a group, continuation lines, the abbreviation, [doi], a record with initials only
      p = P('nbib'); eq([p.format, p.refs.length], ['nbib', 2], 'PubMed nbib'); r = p.refs[0];
      eq([fam(r), r.authors[1].given, r.title, r.container, r.pages, r.year, r.doi, r.pmid], ['López-Otín|Blasco|Partridge|Serrano|Kroemer|Hallmarks Study Group', 'Maria A', 'The hallmarks of aging', 'Cell', '1194–1217', 2013, '10.1016/j.cell.2013.05.039', '23746838'], 'nbib article');
      eq([J(p.refs[1].authors[0]), p.refs[1].pages], [J({ family: 'Kenyon', given: 'C' }), '461–464'], 'nbib: initials');
      // identifiers: nothing is known of them, and nothing is fetched
      const realFetch = W.fetch; let sent = 0; W.fetch = function () { sent++; return realFetch.apply(this, arguments); };
      try {
        eq(J(refParse('10.1016/j.cell.2013.05.039, 10.1038/nature12373; PMID: 23746838 arXiv:1706.03762').ids), J([{ kind: 'doi', id: '10.1016/j.cell.2013.05.039' }, { kind: 'doi', id: '10.1038/nature12373' }, { kind: 'pmid', id: '23746838' }, { kind: 'arxiv', id: '1706.03762' }]), 'identifiers separated by commas, semicolons and spaces');
        eq(refParse('Rapamycin, 10.1038/nature12373').format === 'id', false, 'a sentence with one DOI is no list of identifiers');
        { const s = citeSample(); eq([s.authors[0].family, s.authors[0].given, s.year, s.container], ['Carlsson', 'Alexander David', 2026, 'Nature'], 'the example reference of the style previews'); }
        p = refParse('10.1234/natmed.2025.001'); eq([p.format, J(p.ids), p.refs[0].doi, p.refs[0].authors.length], ['id', J([{ kind: 'doi', id: '10.1234/natmed.2025.001' }]), '10.1234/natmed.2025.001', 0], 'a DOI');
        eq(J(refParse('https://doi.org/10.1016/j.cell.2013.05.039\nPMID: 23746838\narXiv:1706.03762v5\n23746838').ids), J([{ kind: 'doi', id: '10.1016/j.cell.2013.05.039' }, { kind: 'pmid', id: '23746838' }, { kind: 'arxiv', id: '1706.03762v5' }]), 'a DOI link, a PMID (once) and an arXiv id');
        eq(J(refParse('https://pubmed.ncbi.nlm.nih.gov/8247153/').ids), J([{ kind: 'pmid', id: '8247153' }]), 'a PubMed link'); eq(refParse('doi:10.48550/arXiv.1706.03762').ids[0].kind, 'arxiv', 'an arXiv DOI goes to arXiv');
        eq(sent, 0, 'parsing sends nothing');
      } finally { W.fetch = realFetch; }
      // formatted text: APA, Vancouver, Nature (the genus initial ends no title)
      p = P('apa'); r = p.refs[0]; eq([p.format, fam(r), r.authors[0].given, r.year, r.title, r.container, r.volume, r.issue, r.pages, r.doi], ['text', 'Carlsson|van der Berg|Müller', 'AB', 2025, 'Rapamycin extends lifespan in C. elegans', 'Nature Medicine', '5', '3', '123–130', '10.1234/natmed.2025.001'], 'APA text');
      r = P('vancouver').refs[0]; eq([fam(r), r.year, r.title, r.container, r.volume, r.issue, r.pages, r.doi], ['Carlsson|van der Berg|Müller', 2025, 'Rapamycin extends lifespan in C. elegans', 'Nat Med', '5', '3', '123–130', '10.1234/natmed.2025.001'], 'Vancouver text');
      r = P('nature').refs[0]; eq([fam(r), r.year, r.title, r.container, r.volume, r.pages], ['Kenyon|Chang|Gensch|Rudner|Tabtiang', 1993, 'A C. elegans mutant that lives twice as long as wild type', 'Nature', '366', '461–464'], 'Nature text');
      eq(refParse(CS.apa + '\n' + CS.nature).refs.length, 2, 'two formatted references, one per line');
      // nothing a parser can use, a figure file, broken input: no reference, no error
      for (const t of ['', '   ', '??', '{"version":4,"objects":[]}', '@article{', 'TY  - ', '<xml><records><record></record></records></xml>', '[1,2,3]', '%0']) eq(refParse(t).refs.length, 0, 'no reference in ' + J(t));
      eq(J(fig.parseRefs(CS.cslOne)), J(refParse(CS.cslOne).refs), 'fig.parseRefs');
      // names
      eq([J(citeName('Carlsson, Alexander B.')), J(citeName('Alexander B. Carlsson')), J(citeName('Ludwig van Beethoven')), J(citeName('Carlsson AB')), J(citeName('World Health Organization')), J(citeName('Smith, John, Jr')), J(citeName('et al.'))],
        [J({ family: 'Carlsson', given: 'Alexander B.' }), J({ family: 'Carlsson', given: 'Alexander B.' }), J({ family: 'van Beethoven', given: 'Ludwig' }), J({ family: 'Carlsson', given: 'AB' }), J({ literal: 'World Health Organization' }), J({ family: 'Smith', given: 'John', suffix: 'Jr' }), 'null'], 'names');
      eq([citeInit('Alexander B.'), citeInit('Alexander B.', true), citeInit('Jean-Luc'), citeInit('Jean-Luc', true), citeInit('AB'), citeInit('Élodie')], ['AB', 'A. B.', 'JL', 'J.-L.', 'AB', 'É'], 'initials');
    });

    test('citations: styles for one, two and three or more authors and the edge cases; marks in titles are escaped; RIS and BibTeX out and back', async () => {
      if (!hasCite) throw new Skip('this editor has no citations');
      const all = [].concat(...['zoteroRis', 'zoteroBib', 'mendeleyBib', 'csl', 'enw', 'enXml', 'nbib'].map(k => refParse(CS[k]).refs)), by = t => all.find(r => r.title === t), R = new Map(all.map((r, i) => ['r' + (i + 1), r])), N = new Map(all.map((r, i) => ['r' + (i + 1), i + 1])), idOf = r => 'r' + (all.indexOf(r) + 1);
      const T = (r, style, o) => citeText([idOf(r)], style, citeOpts({ citeStyle: style, ...(o || {}) }), R, N);
      const many = all[0], two = by('Dietary restriction in worms'), one = by('A deep preprint'), who = by('Ageing and health'), noYear = by('A preprint without a year'), book = by('Molecular Biology of the Cell'), chap = all.find(r => r.type === 'chapter' && r.authors[0].literal), rep = by('A report without a year'), abbr = by('Facing up to the global challenges of ageing');
      // short for slides
      eq(T(many, 'short'), 'Carlsson et al., *Nat Med* 2025', 'short, four authors: the abbreviated journal, in italics'); eq(T(two, 'short'), 'Smith & de la Cruz, *Handbook of the Biology of Aging* 2021', 'short, two authors'); eq(T(one, 'short'), 'Zhang, *bioRxiv* 2023', 'short, one author');
      eq(T(who, 'short'), 'World Health Organization, *WHO fact sheets* 2024', 'short, an institution'); eq(T(noYear, 'short'), 'Li & Nguyen, *bioRxiv*', 'short, no year'); eq(T(book, 'short'), 'Alberts et al., *Molecular Biology of the Cell* 2014', 'short, a book: its title'); eq(T(rep, 'short'), 'Jones, *A report without a year*', 'short, a report without a year');
      eq(T(by('The hallmarks of aging in Drosophila at 25 °C: β-oxidation'), 'short'), 'García-López et al., *Proceedings of the National Academy of Sciences* 2013', 'short: the full journal name when the reference has no abbreviation');
      eq(T(many, 'short', { citeTitle: true, citeDoi: true }), 'Carlsson et al. Rapamycin extends lifespan through p\\_53 and H\\_2O balance: a \\*critical\\* test. *Nat Med* 2025, doi:10.1234/natmed.2025.001', 'short with title and DOI: the marks of the title are escaped');
      eq(plainText(T(many, 'short', { citeTitle: true })), 'Carlsson et al. Rapamycin extends lifespan through p_53 and H_2O balance: a *critical* test. Nat Med 2025', 'and drawn as the title is written');
      { const runs = richRuns(T(many, 'short', { citeTitle: true })); eq([runs.filter(x => x.i).map(x => x.text).join('|'), runs.some(x => x.sub || x.sup || x.b)], ['Nat Med', false], 'only the journal is italic; no subscript or bold from the title'); }
      eq(T({ ...many }, 'short'), '?', 'a reference the file does not have shows “?”');
      // author–year
      eq([T(many, 'authoryear'), T(two, 'authoryear'), T(one, 'authoryear'), T(noYear, 'authoryear'), T(who, 'authoryear')], ['(Carlsson et al., 2025)', '(Smith & de la Cruz, 2021)', '(Zhang, 2023)', '(Li & Nguyen, n.d.)', '(World Health Organization, 2024)'], 'author–year');
      eq(citeText([idOf(many), idOf(two)], 'authoryear', {}, R, N), '(Carlsson et al., 2025; Smith & de la Cruz, 2021)', 'several in one, joined by “; ”'); eq(citeText([idOf(many), idOf(one)], 'short', {}, R, N), 'Carlsson et al., *Nat Med* 2025; Zhang, *bioRxiv* 2023', 'short, several');
      // numbered
      eq([citeText(['r1'], 'num', {}, R, N), citeText(['r1', 'r3', 'r4', 'r5', 'r9'], 'num', {}, R, N), citeText(['r2', 'r1'], 'sup', {}, R, N), citeText(['r5', 'r3', 'r4', 'zz'], 'sup', {}, R, N), citeRange([4, 1, 2, 2, 7, 8, 9, 10], ', ')], ['[1]', '[1, 3–5, 9]', '^{1,2}', '^{3–5,?}', '1, 2, 4, 7–10'], 'numbered: sorted, runs of three or more as a range');
      eq(J(richRuns('^{1,3–5}').map(x => [x.text, !!x.sup])), J([['1,3–5', true]]), 'the superscript is one raised run');
      // full, Vancouver
      eq(T(many, 'vancouver'), "Carlsson AB, van der Berg K, Müller J, O'Neill S. Rapamycin extends lifespan through p\\_53 and H\\_2O balance: a \\*critical\\* test. *Nat Med*. 2025;5(3):123–130. doi:10.1234/natmed.2025.001", 'Vancouver article');
      eq(T(two, 'vancouver'), 'Smith JA Jr, de la Cruz M. Dietary restriction in worms. In: *Handbook of the Biology of Aging*. Academic Press; 2021. p. 45–67.', 'Vancouver chapter, a suffix'); eq(T(book, 'vancouver'), 'Alberts B, Johnson A, Lewis J. *Molecular Biology of the Cell*. Garland Science; 2014.', 'Vancouver book');
      eq(T(noYear, 'vancouver'), 'Li W, Nguyen TH. A preprint without a year. *bioRxiv* [Preprint]. doi:10.1101/2024.05.06.123456', 'Vancouver preprint without a year'); eq(T(who, 'vancouver'), 'World Health Organization. Ageing and health. *WHO fact sheets*. 2024. https://www.who.int/news-room/fact-sheets/detail/ageing-and-health', 'Vancouver web page');
      eq(T(chap, 'vancouver'), 'Aging Atlas Consortium. An atlas of aging. In: *The Big Book of Aging*. Springer; 2020. p. 1–20.', 'Vancouver, a consortium'); eq(T(abbr, 'vancouver'), 'Partridge L, Deelen J, Slagboom PE. Facing up to the global challenges of ageing. *Nat Rev Mol Cell Biol*. 2018;561:45–56.', 'Vancouver: the abbreviation');
      eq(T(many, 'vancouver', { citeTitle: false, citeDoi: false }), "Carlsson AB, van der Berg K, Müller J, O'Neill S. *Nat Med*. 2025;5(3):123–130.", 'Vancouver without title and DOI');
      { const big = { type: 'article', authors: Array.from({ length: 25 }, (x, i) => ({ family: 'Author' + (i + 1), given: 'Xu Yi' })), year: 2020, title: 'Many', container: 'J' }; R.set('big', big);
        eq(citeText(['big'], 'vancouver', {}, R, N), 'Author1 XY, Author2 XY, Author3 XY, Author4 XY, Author5 XY, Author6 XY, et al. Many. *J*. 2020.', 'Vancouver: six authors, then et al.');
        const a = citeText(['big'], 'apa', {}, R, N); ok(a.includes('Author19, X. Y., … Author25, X. Y. (2020).') && !a.includes('Author20'), 'APA: nineteen authors, an ellipsis, the last one: ' + a.slice(-120)); eq(citeText(['big'], 'short', {}, R, N), 'Author1 et al., *J* 2020', 'short: et al.'); }
      // full, APA
      eq(T(many, 'apa'), "Carlsson, A. B., van der Berg, K., Müller, J., & O'Neill, S. (2025). Rapamycin extends lifespan through p\\_53 and H\\_2O balance: a \\*critical\\* test. *Nature Medicine*, *5*(3), 123–130. https://doi.org/10.1234/natmed.2025.001", 'APA article: the full journal name');
      eq(T(two, 'apa'), 'Smith, J. A., Jr., & de la Cruz, M. (2021). Dietary restriction in worms. In *Handbook of the Biology of Aging* (pp. 45–67). Academic Press.', 'APA chapter'); eq(T(book, 'apa'), 'Alberts, B., Johnson, A., & Lewis, J. (2014). *Molecular Biology of the Cell*. Garland Science.', 'APA book');
      eq(T(noYear, 'apa'), 'Li, W., & Nguyen, T. H. (n.d.). A preprint without a year. *bioRxiv*. https://doi.org/10.1101/2024.05.06.123456', 'APA without a year'); eq(T(who, 'apa'), 'World Health Organization. (2024). *Ageing and health*. WHO fact sheets. https://www.who.int/news-room/fact-sheets/detail/ageing-and-health', 'APA web page');
      eq(citeText([idOf(many), idOf(two)], 'vancouver', { doi: false }, R, N).split('\n').length, 2, 'two full references: two lines');
      // nothing of a reference is markup: a title that is all marks, braces and tags
      { R.set('x', refClean({ authors: ['{B}ad_1 **Name**, ~~X~~'], year: 2020, title: '<img src=x onerror=alert(1)> **bold** __u__ ~~s~~ x^2 H_2O {#f00|red} "q"', container: 'J_1 *x*' }));
        for (const st of ['short', 'authoryear', 'vancouver', 'apa']) { const t = citeText(['x'], st, { title: true, doi: true }, R, N), runs = richRuns(t); ok(!runs.some(x => x.b || x.u || x.s || x.sub || x.sup || x.color), st + ': marks in the fields made formatting: ' + t); ok(!/<img/.test(citeHtml(t)) && /&lt;img/.test(citeHtml(t)) || st === 'authoryear', st + ': the preview escapes HTML'); }
        ok(plainText(citeText(['x'], 'vancouver', {}, R, N)).includes('**bold** __u__ ~~s~~ x^2 H_2O {#f00|red}'), 'the title is drawn as written'); }
      // out and back: RIS and BibTeX hold everything the file keeps
      { const L = all.map((r, i) => ({ id: 'r' + (i + 1), ...r })), strip = r => { const c = { ...r }; delete c.id; return c; }, back = refParse(refsRis(L)).refs;
        eq(back.length, L.length, 'RIS: every reference comes back'); L.forEach((r, i) => eq(J(back[i]), J(strip(r)), 'RIS out and back, reference ' + (i + 1)));
        const bb = refParse(refsBib(L)).refs; eq(bb.length, L.length, 'BibTeX: every reference comes back'); L.forEach((r, i) => eq(J(bb[i]), J(strip(r)), 'BibTeX out and back, reference ' + (i + 1)));
        ok(/^@article\{carlsson2025rapamycin,/.test(refsBib(L)), 'a BibTeX key from author, year and title: ' + refsBib(L).slice(0, 40)); }
    });

    test('citations: fig.addRef, duplicates, healing, a citation follows its reference, where it lands, a hand edit, undo and redo, fig.check', async () => {
      if (!hasCite) throw new Skip('this editor has no citations');
      unslide(); blank(); citePrefsOff(); eq(J(fig.refs()), '[]', 'no references at first'); ok(!('refs' in scene), 'and no list in the file');
      const h0 = hist.length, ids = fig.addRef(CS.zoteroRis); eq([J(ids), fig.refs().length, hist.length - h0], [J(['r1', 'r2', 'r3', 'r4']), 4, 1], 'four references, one undo step');
      // the same reference again: by DOI (BibTeX of the same article), by PMID, by first author + year + title; what the file lacks is filled in
      eq(J(fig.addRef(CS.zoteroBib)), J(['r1', 'r2', 'r5']), 'the same DOI and the same author, year and title are found again'); eq(fig.refs().length, 5, 'only the new one is added');
      const k1 = fig.addRef(CS.nbib); eq(J(fig.addRef(CS.enw).slice(0, 1)), J([k1[0]]), 'the same PMID / DOI from another format'); eq(J(fig.addRef({ title: 'the hallmarks of AGING', authors: ['López-Otín, C.'], year: 2013 })), J([k1[0]]), 'first author, year and title, whatever the case');
      eq(J(fig.addRef({ type: 'article-journal', title: 'A CSL object', author: [{ family: 'Doe', given: 'Jane' }], 'container-title': 'J Obj', issued: { 'date-parts': [[2001]] } }).length), '1', 'a CSL object is taken'); eq(fig.refs().find(r => r.title === 'A CSL object').year, 2001, 'with its year');
      { const n = fig.refs().length, a = fig.addRef({ doi: '10.1234/NATMED.2025.001', pmid: '99999999' }); eq([J(a), fig.refs().length, fig.refs()[0].pmid], [J(['r1']), n, '99999999'], 'a duplicate fills in what was missing (here the PMID)'); }
      let threw = ''; try { fig.addRef('??'); } catch (e) { threw = e.message; } ok(/no reference found/.test(threw), 'fig.addRef says when it finds nothing: ' + threw);
      // healing: only plain values of a sane length, ids unique, citation fields only where they belong
      { const s = healScene({ version: 4, w: 800, h: 600, objects: [{ id: 'a', type: 'text', x: 1, y: 1, text: 'x', cite: 'r1', citeStyle: 'short' }, { id: 'b', type: 'text', x: 1, y: 1, text: 'x', cite: ['r1', 7, 'r1', 'r 2<'], citeStyle: 'nope', citeDoi: 'yes', refCols: 99 }, { id: 'c', type: 'shape', x: 1, y: 1, cite: ['r1'], refList: true }, { id: 'd', type: 'text', x: 1, y: 1, text: 'x', refList: 1 }],
          refs: [null, 5, 'x', {}, { id: 'r1', title: { a: 1 }, authors: 'Doe, J; Roe, R' }, { id: 'r1', title: 'T'.repeat(5000), authors: [{ family: 'A', given: ['x'] }, { literal: {} }, { family: { toString() { return 'X'; } } }, null, 'Kim, Min'], year: { y: 1 }, type: 'weird', url: 'javascript:alert(1)', doi: 'https://doi.org/10.1000/ABC.', pages: '1--9', pmid: 'PMID 123', extra: '<script>' }, { id: '<b>', container: 'Only a journal\u0000\n name' }] });
        eq(s.refs.length, 3, 'three usable references'); eq([s.refs[0].id, J(s.refs[0].authors), 'title' in s.refs[0]], ['r1', J([{ family: 'Doe', given: 'J' }, { family: 'Roe', given: 'R' }]), false], 'authors from a text, a title that is no text dropped');
        const r = s.refs[1]; eq([r.id, r.title.length, J(r.authors), r.year, r.type, r.url, r.doi, r.pages, r.pmid, 'extra' in r], ['r2', 1000, J([{ family: 'A' }, { family: 'Kim', given: 'Min' }]), undefined, 'other', undefined, '10.1000/ABC', '1–9', '123', false], 'the second: a new id, clipped, cleaned');
        eq([s.refs[2].id, s.refs[2].container], ['b', 'Only a journal name'], 'an id of plain characters, no control characters'); const O = s.objects;
        eq(['cite' in O[0], 'citeStyle' in O[0], J(O[1].cite), 'citeStyle' in O[1], 'citeDoi' in O[1], 'refCols' in O[1], 'cite' in O[2], 'refList' in O[2], 'refList' in O[3]], [false, false, J(['r1', 'r2']), false, false, false, false, false, false], 'citation fields healed');
        eq(J(healScene(JSON.parse(J(s)))), J(s), 'healing twice changes nothing'); }
      // a citation: an ordinary text at the bottom left, small and muted; it follows its reference
      blank(); const [a, b, c] = fig.addRef(CS.zoteroRis), h1 = hist.length, id = fig.cite(a); await settle(); let o = get(id), bx = bbox(id);
      eq([o.type, o.text, J(o.cite), o.citeStyle, o.anchor, hist.length - h1, J([...sel])], ['text', 'Carlsson et al., *Nat Med* 2025', J([a]), 'short', 'start', 1, J([id])], 'the citation element'); ok(o.size >= 12 && o.size <= 20 && /^#[4-6]/.test(o.color), 'small and muted: ' + o.size + ' ' + o.color);
      ok(bx.x < scene.w * .05 && bx.y + bx.h > scene.h * .93 && bx.y + bx.h <= scene.h, 'at the bottom left: ' + J(bx));
      const id2 = fig.cite([b, c], { style: 'authoryear' }); await settle(); const b2 = bbox(id2); ok(b2.y + b2.h <= bbox(id).y + 1 && b2.y > scene.h * .8, 'the second one is stacked above the first: ' + J([b2, bbox(id)])); eq(get(id2).text, '(Smith & de la Cruz, 2021; World Health Organization, 2024)', 'two references in one');
      fig.add('shape', { id: 'box', x: 800, y: 300, w: 400, h: 200 }); const id3 = fig.cite(a, { on: 'box', style: 'vancouver', doi: false }); await settle(); const b3 = bbox(id3), bb = bbox('box'); near(b3.x, bb.x, 6, 'below the element, left-aligned'); ok(b3.y >= bb.y + bb.h && b3.y < bb.y + bb.h + 30, 'just below it: ' + J([b3, bb]));
      const id4 = fig.cite(a, { x: 1000, y: 100 }); eq([get(id4).x, get(id4).y], [1000, 100], 'at a place given'); ok(get(id3).boxW > 0 || bbox(id3).x + bbox(id3).w <= scene.w, 'a long one wraps inside the page');
      for (const bad of [() => fig.cite('nope'), () => fig.cite([]), () => fig.cite(a, { style: 'chicago' }), () => fig.cite(a, { on: 'nope' }), () => fig.updateRef('nope', {}), () => fig.removeRef('nope'), () => fig.refList({ style: 'short' })]) { let t = ''; try { bad(); } catch (e) { t = e.message; } ok(t, 'a wrong call throws: ' + bad); }
      // the reference changes: every citation of it follows, in one step; undo and redo
      const h2 = hist.length; fig.updateRef(a, { short: 'Nat. Med', year: 2026, authors: ['Carlsson, A. B.', 'Berg, K.'] }); eq([get(id).text, get(id3).text.slice(0, 30), hist.length - h2], ['Carlsson & Berg, *Nat. Med* 2026', 'Carlsson AB, Berg K. Rapamycin', 1], 'both citations follow');
      undo(); eq([get(id).text, fig.refs()[0].year], ['Carlsson et al., *Nat Med* 2025', 2025], 'undo'); redo(); eq(get(id).text, 'Carlsson & Berg, *Nat. Med* 2026', 'redo'); undo();
      // style and options through fig.update
      fig.update(id, { citeStyle: 'apa', citeDoi: false }); ok(/^Carlsson, A\. B\., .*\*Nature Medicine\*, \*5\*\(3\), 123–130\.$/.test(get(id).text), 'another style: ' + get(id).text); fig.update(id, { citeStyle: 'short', citeDoi: true }); eq(get(id).text, 'Carlsson et al., *Nat Med* 2025, doi:10.1234/natmed.2025.001', 'with the DOI'); fig.update(id, { citeDoi: false });
      // a text changed by hand is plain text from then on (a message says so; undo links it again)
      const h3 = hist.length; fig.update(id2, { text: 'as shown before' }); await sleep(30); o = get(id2); eq([o.text, 'cite' in o, 'citeStyle' in o, hist.length - h3], ['as shown before', false, false, 1], 'typed over: plain text'); ok(/plain text/.test(D.querySelector('#toast').textContent), 'and the message says so: ' + D.querySelector('#toast').textContent);
      undo(); eq([J(get(id2).cite), get(id2).text], [J([b, c]), '(Smith & de la Cruz, 2021; World Health Organization, 2024)'], 'undo links it again'); fig.update(id2, { text: get(id2).text }); ok(get(id2).cite, 'the same text is no change');
      fig.update(id2, { cite: null }); eq(['cite' in get(id2), 'citeStyle' in get(id2), get(id2).text], [false, false, '(Smith & de la Cruz, 2021; World Health Organization, 2024)'], 'cite: null makes it plain text and keeps the words'); undo();
      // the side panel: the references of the citation, style, options
      fig.select(id2); const P = D.querySelector('#props'); ok(/Citation/i.test(P.textContent) && P.querySelectorAll('.ctpr').length === 2, 'the Citation section lists both references'); { const bs = [...P.querySelectorAll('.ctpr')[0].querySelectorAll('button')]; ok(bs.every(x => x.title && x.getAttribute('aria-label')), 'its buttons are named'); bs.find(x => x.title === 'Move down').click(); }
      eq([J(get(id2).cite), get(id2).text], [J([c, b]), '(World Health Organization, 2024; Smith & de la Cruz, 2021)'], 'reordered'); [...D.querySelectorAll('#props .ctpr')][0].querySelector('button[title^="Take out"]').click(); eq(J(get(id2).cite), J([b]), 'one taken out');
      { const s = [...D.querySelectorAll('#props select')].find(x => [...x.options].some(op => op.value === 'authoryear')); s.value = 'num'; s.dispatchEvent(new Event('change', { bubbles: true })); ok(/^\[\d\]$/.test(get(id2).text), 'the style from the panel: ' + get(id2).text); ok(!D.querySelector('#props .ctpopts'), 'no title / DOI options for a numbered citation'); }
      [...D.querySelectorAll('#props button')].find(x => x.textContent === 'Make plain text').click(); ok(!get(id2).cite && /^\[\d\]$/.test(get(id2).text), 'Make plain text keeps the words');
      // fig.check: a citation of a reference the file does not have, a reference without year or authors
      fig.update(id, { cite: [a, 'r99'] }); eq(get(id).text, 'Carlsson et al., *Nat Med* 2025; ?', 'a missing reference shows “?”'); let ck = fig.check(); ok(ck.some(r => r.id === id && r.level === 'error' && /r99/.test(r.msg)), 'fig.check names it: ' + J(ck.filter(r => r.id === id)));
      fig.addRef({ title: 'Nobody, never' }); ck = fig.check(); ok(ck.some(r => r.level === 'info' && /no authors and no year/.test(r.msg)), 'a reference without authors and year: ' + J(ck.filter(r => r.level === 'info'))); ok(ck.some(r => r.level === 'info' && r.ref === fig.refs()[3].id && /no year/.test(r.msg)), 'the preprint without a year');
      ok(!fig.check().some(r => /unknown field/.test(r.msg)), 'the citation fields are known fields'); fig.update(id, { cite: [a] });
      // removing a reference: its citations lose it, a citation of nothing else goes
      const idB = fig.cite([a, b]), idOnly = fig.cite(b), n0 = scene.objects.length, h4 = hist.length; fig.removeRef(b); eq([J(get(idB).cite), get(idOnly), scene.objects.length - n0, hist.length - h4, fig.refs().some(r => r.id === b)], [J([a]), undefined, -1, 1, false], 'removed: one citation shortened, one gone, one step');
      undo(); ok(get(idOnly) && fig.refs().some(r => r.id === b), 'undo brings all of it back');
      // one undo step per insert; duplicate and paste keep the link
      fig.select(id); duplicate(); await settle(); const dup = [...sel][0]; ok(dup !== id && J(get(dup).cite) === J([a]) && get(dup).text === get(id).text, 'a duplicate is a citation too'); fig.updateRef(a, { year: 2030 }); eq(get(dup).text, get(id).text, 'and follows'); ok(/2030/.test(get(dup).text), 'the new year');
      blank(); eq(fig.refs().length, 0, 'a new figure has no references');
    });

    test('citations: numbers follow the first appearance across slides and a slide move; the reference list stays in step, in columns when long', async () => {
      if (!hasCite) throw new Skip('this editor has no citations'); if (!hasSlides) throw new Skip('this editor has no slides');
      try {
        unslide(); blank(); citePrefsOff(); const ids = fig.addRef([CS.zoteroRis, CS.enw]), [a, b, c, d, e] = ids;
        fig.cite(a, { style: 'num' }); fig.addSlide(); fig.cite([b, a], { style: 'num' }); fig.cite(c, { style: 'short', x: 100, y: 100 }); fig.addSlide(); fig.cite([e, c, b, a], { style: 'sup' });
        eq(J(citeTexts()), J([['[1]'], ['[1, 3]', 'World Health Organization, *WHO fact sheets* 2024'], ['^{1–4}']]), 'numbered in the order of first appearance (on a slide from the top)');
        fig.moveSlide(3, 1); eq(J(citeTexts()), J([['^{1–4}'], ['[4]'], ['[3, 4]', 'World Health Organization, *WHO fact sheets* 2024']]), 'a slide moved: renumbered'); undo(); eq(J(citeTexts()[0]), J(['[1]']), 'undo');
        // the list: on a new slide named References, numbered like the citations, one undo step
        fig.slide(1); const h0 = hist.length, n0 = scene.slides.length, L = fig.refList({ slide: true }); await settle(); const sl = scene.slides[scene.slides.length - 1], lo = sl.objects.find(o => o.refList);
        eq([scene.slides.length - n0, sl.name, CUR, hist.length - h0, lo.id, sl.objects.some(o => o.text === 'References')], [1, 'References', n0, 1, L, true], 'a new last slide with a heading and the list, shown, one step');
        const lines = () => lo.text.split('\n'); eq(lines().map(x => x.slice(0, 14)), ['1. Carlsson AB', '2. World Healt', '3. Smith JA Jr', '4. López-Otín '], 'the cited references in the order of their numbers: ' + J(lines().map(x => x.slice(0, 20))));
        ok(lo.boxW > scene.w * .7 && lo.anchor === 'start' && lo.citeStyle === 'vancouver', 'wrapped to the page'); const bl = bbox(L); ok(bl.y + bl.h < scene.h && bl.x + bl.w <= scene.w, 'inside the page: ' + J(bl));
        // in step: a citation added, a reference changed, a reference removed; the list on another slide than the one shown
        fig.slide(1); const lst = () => scene.slides[scene.slides.length - 1].objects.find(o => o.refList).text.split('\n'); fig.cite(d, { style: 'num', x: 50, y: 50 }); eq([lst().length, lst()[0].slice(0, 9)], [5, '1. Li W, '], 'a new first citation: the list has it, renumbered');
        fig.updateRef(a, { title: 'A new title' }); ok(lst().some(x => /A new title/.test(x)), 'a changed reference'); fig.removeRef(d); eq([lst().length, lst()[0].slice(0, 14)], [4, '1. Carlsson AB'], 'a removed reference');
        undo(); undo(); undo(); eq(lst().length, 4, 'undone'); fig.slide(scene.slides.length);
        // every reference of the file, APA, not numbered when no citation is: alphabetical
        fig.update(L, { refAll: true }); eq(get(L).text.split('\n').length, fig.refs().length, 'all references of the file'); ok(/^5\. /.test(get(L).text.split('\n')[4]), 'the uncited ones after the cited, numbered on');
        for (const sl of scene.slides) for (const o of sl.objects) if (o.cite) o.citeStyle = 'short'; fig.update(L, { citeStyle: 'apa' }); const al = get(L).text.split('\n'); ok(!/^\d/.test(al[0]) && /^Aging Atlas Consortium\. \(2020\)/.test(al[0]) && /^World Health Organization\. \(2024\)/.test(al[al.length - 1]), 'alphabetical, APA, no numbers: ' + J(al.map(x => x.slice(0, 16))));
        // the panel of a list
        fig.select(L); ok(/Reference list/i.test(D.querySelector('#props').textContent) && [...D.querySelectorAll('#props select')].some(s => [...s.options].map(x => x.value).join() === 'vancouver,apa'), 'the list has its own section with the two full styles');
        // typed over: plain text
        fig.update(L, { text: 'my own list' }); ok(!get(L).refList, 'a list typed over is plain text'); undo(); ok(get(L).refList, 'and undo links it again');
        // a long list: two columns, then a smaller size, never below the smallest size; it fits the page
        unslide(); blank(); const many = []; for (let i = 0; i < 40; i++) many.push({ authors: ['Author' + String.fromCharCode(65 + i % 26) + i + ', Alex B.', 'Second, C.', 'Third, D.'], year: 1980 + i, title: 'A fairly long article title number ' + i + ' about the biology of aging in model organisms', container: 'Journal of Long Reference Lists', short: 'J Long Ref Lists', volume: String(i + 1), pages: '100–110', doi: '10.1000/x' + i });
        fig.addRef(many); const h1 = hist.length, L2 = fig.refList({ cited: false }); await settle(); const cols = scene.objects.filter(o => o.refList); eq([cols.length, J(cols.map(o => [o.refCols, o.refCol])), hist.length - h1], [2, J([[2, 1], [2, 2]]), 1], 'two columns, one step');
        const n1 = cols[0].text.split('\n').length, n2 = cols[1].text.split('\n').length; eq(n1 + n2, 40, 'every reference once'); ok(Math.abs(n1 - n2) <= 2, 'about half each: ' + n1 + ' + ' + n2); const B = cols.map(o => bbox(o.id)); ok(B.every(x => x.y >= 0 && x.y + x.h <= scene.h + 1) && B[0].x + B[0].w <= B[1].x + 2 && B[1].x + B[1].w <= scene.w, 'both columns inside the page, side by side: ' + J(B));
        ok(cols[0].size === cols[1].size && cols[0].size >= 11 && cols[0].size <= 18, 'a readable size: ' + cols[0].size); eq(get(L2).id, cols[0].id, 'the first column is returned');
        { blank(); fig.addRef(many.slice(0, 3)); const L3 = fig.refList({ cited: false }); eq([scene.objects.filter(o => o.refList).length, get(L3).size], [1, 22], 'a short list: one column in the larger size'); blank(); eq(get(fig.refList({})).text, 'Nothing is cited in this file yet', 'an empty list says so'); }
        // slides brought in from another figure bring their references; the citations follow the ids they get here
        if (typeof slidesImport === 'function') { blank(); const here = fig.addRef(CS.enw)[0]; fig.cite(here); const other = healScene({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], refs: [{ id: 'r1', type: 'article', authors: [{ family: 'Other', given: 'O.' }], year: 2001, title: 'From the other file', container: 'J Other' }, { id: 'r2', ...refParse(CS.enw).refs[0] }], objects: [{ id: 'q', type: 'text', x: 100, y: 100, text: '', cite: ['r1', 'r2'], citeStyle: 'short' }] });
          slidesImport([['other.json', other]]); await settle(); const q = scene.slides[1].objects.find(o => o.id === 'q'), nw = fig.refs().find(r => r.title === 'From the other file'); ok(nw && nw.id !== 'r1', 'its reference came along under a new id: ' + J(fig.refs().map(r => r.id))); eq([J(q.cite), q.text], [J([nw.id, here]), 'Other, *J Other* 2001; López-Otín et al., *Cell* 2013'], 'its citation follows, and the reference both files have is one'); }
      } finally { unslide(); blank(); }
    });

    test('citations: the dialog: paste, detected, insert; a look-up only on request (fetch stubbed) and offline; edit, remove, the form; Shift+C, the Add panel, a dropped file', async () => {
      if (!hasCite) throw new Skip('this editor has no citations');
      const $$ = s => D.querySelector(s), $all = s => [...D.querySelectorAll(s)], type = async (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(500); }, realFetch = W.fetch; let calls = [], mode = 'ok';
      W.fetch = function (u, o) { const s = String(u && u.url || u); if (!/crossref|ncbi|arxiv|datacite/.test(s)) return realFetch.apply(this, arguments); calls.push(s); if (mode === 'offline' || mode === 'arxivdown' && /export\.arxiv/.test(s)) return Promise.reject(new TypeError('Failed to fetch')); if (mode === '404') return Promise.resolve(new Response('Resource not found.', { status: 404 }));
        if (/datacite/.test(s)) return Promise.resolve(new Response(J({ data: { id: '10.48550/arxiv.1706.03762', attributes: { doi: '10.48550/arxiv.1706.03762', creators: [{ name: 'Vaswani, Ashish', nameType: 'Personal', givenName: 'Ashish', familyName: 'Vaswani' }, { name: 'Shazeer, Noam', givenName: 'Noam', familyName: 'Shazeer' }, { name: 'Google Brain Team', nameType: 'Organizational' }], titles: [{ title: 'Attention Is All You Need' }], publisher: 'arXiv', container: {}, publicationYear: 2017, types: { resourceTypeGeneral: 'Preprint' } } } }), { status: 200 }));
        if (/crossref/.test(s)) return Promise.resolve(new Response(J({ status: 'ok', message: { type: 'journal-article', title: ['A looked-up <i>title</i>'], author: [{ given: 'Ada', family: 'Lovelace', sequence: 'first' }, { given: 'Alan', family: 'Turing' }], 'container-title': ['Journal of Tests'], 'short-container-title': ['J Tests'], issued: { 'date-parts': [[2020, 1, 1]] }, volume: '1', page: '1-9', DOI: '10.1234/abc.def' } }), { status: 200 }));
        if (/ncbi/.test(s)) return Promise.resolve(new Response(CS.nbib.split('\n\n')[0], { status: 200 }));
        return Promise.resolve(new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published><title>Attention Is All\n  You Need</title><author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author><author><name>Niki Parmar</name></author></entry></feed>', { status: 200 })); };
      try {
        unslide(); blank(); citePrefsOff(); sel = new Set(); buildPanel();
        // it opens from the keyboard, the File menu and the Add panel; an empty dialog explains itself
        D.querySelector('#stage').focus(); D.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', shiftKey: true, bubbles: true })); ok(!$$('#modal').hidden && $$('#ctIn'), 'Shift+C opens Add citation'); await sleep(30); eq(D.activeElement.id, 'ctIn', 'then the paste box');
        ok($$('#modalBox').getAttribute('aria-labelledby') && /Add citation/.test($$('#modalBox h2').textContent) && /Where to get a reference/.test($$('#ctDet').textContent), 'named, with the hints of an empty start'); ok($$('#ctOnly').hidden && /example/.test($$('#ctWhere').textContent), 'the preview is an example');
        ok($all('#modalBox button, #modalBox input, #modalBox textarea').every(x => x.hidden || x.type === 'file' || x.title || x.getAttribute('aria-label') || x.textContent.trim() || x.closest('label')), 'every control is named'); $$('#ctGo').click(); ok(!$$('#modal').hidden && /Paste a reference/.test($$('#ctMsg').textContent), 'Insert with nothing says what to do: ' + $$('#ctMsg').textContent);
        D.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ok($$('#modal').hidden, 'Esc closes it');
        ok($$('#fileMenu [data-act="cite"]'), 'File menu item'); $$('#fileMenu [data-act="cite"]').click(); ok(!$$('#modal').hidden && $$('#ctIn'), 'the File menu opens it'); closeModal();
        { const s = $$('#palSearch'); s.value = 'citation'; s.dispatchEvent(new Event('input', { bubbles: true })); await sleep(500); buildPalette(); const it = $all('#palList .pitem').find(x => /^Citation/.test(x.title) && x.dataset.sec === 'Text'); ok(it, 'the Add panel has Citation under Text'); const n = scene.objects.length; it.click(); ok(!$$('#modal').hidden && $$('#ctIn') && scene.objects.length === n, 'it opens the dialog and adds nothing by itself'); closeModal(); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); await sleep(300); buildPalette(); }
        // paste → detected → insert
        citeDialog(); await type($$('#ctIn'), CS.zoteroRis); ok(/Read as RIS/.test($$('#ctDet').textContent) && /4 references/.test($$('#ctDet').textContent), 'detected: ' + $$('#ctDet').textContent); eq($all('#ctFound .ctrow').length, 4, 'four rows, ticked'); ok($all('#ctFound input').every(x => x.checked), 'all ticked');
        ok(!$$('#ctFound').innerHTML.includes('<img') && /p_53 and H_2O/.test($$('#ctFound').textContent), 'the title as text'); eq($$('.ctst.on').dataset.s, 'short', 'the short style first'); ok(/Carlsson et al\., Nat Med 2025; Smith/.test($$('.ctst.on .ctpv').textContent) && $$('.ctst.on .ctpv i'), 'a live preview with the journal in italics: ' + $$('.ctst.on .ctpv').innerHTML.slice(0, 80));
        $all('#ctFound input').slice(1).forEach(x => x.click()); eq($$('.ctst.on .ctpv').textContent, 'Carlsson et al., Nat Med 2025', 'the preview follows the ticks'); $$('.ctst[data-s="authoryear"]').click(); eq([$$('.ctst.on').dataset.s, $$('#ctTitle').disabled], ['authoryear', true], 'another style; no title option for it');
        { const g = $$('#ctStyles'); $$('.ctst.on').focus(); g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); eq([$$('.ctst.on').dataset.s, D.activeElement === $$('.ctst.on'), $$('.ctst.on').getAttribute('aria-checked')], ['short', true, 'true'], 'the arrow keys choose a style'); g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); }
        const h0 = hist.length; $$('#ctGo').click(); await settle(); ok($$('#modal').hidden, 'inserted: the dialog closes'); let c = scene.objects.find(o => o.cite); eq([c.text, c.citeStyle, fig.refs().length, hist.length - h0, J([...sel])], ['(Carlsson et al., 2025)', 'authoryear', 1, 1, J([c.id])], 'the citation, one reference in the file, one undo step, selected');
        ok(/Citation added at the bottom left/.test($$('#toast').textContent), 'a message says where: ' + $$('#toast').textContent); undo(); eq([scene.objects.filter(o => o.cite).length, fig.refs().length], [0, 0], 'one undo takes the citation and the reference away'); redo(); c = scene.objects.find(o => o.cite);
        // again: the style is remembered, the reference is known, below the selected element
        fig.add('shape', { id: 'bx', x: 800, y: 300, w: 300, h: 150 }); fig.select('bx'); citeDialog({ text: CS.zoteroBib }); await sleep(60); eq($$('.ctst.on').dataset.s, 'authoryear', 'the style used last'); ok(/already in this file/.test($all('#ctFound .ctrow')[0].textContent) && !/already/.test($all('#ctFound .ctrow')[2].textContent), 'a known reference is marked'); ok(/below the selected element/.test($$('#ctWhere').textContent), 'says where it goes');
        $all('#ctFound input')[1].click(); $$('.ctst[data-s="short"]').click(); $$('#ctDoi').click(); $$('#ctGo').click(); await settle(); const c2 = get([...sel][0]); eq([c2.text, J(c2.cite), fig.refs().length], ['Carlsson et al., *Nat Med* 2025, doi:10.1234/natmed.2025.001; Vaswani et al., *arXiv* 2017, doi:10.48550/arXiv.1706.03762', J(['r1', 'r2']), 2], 'the known one is not added twice'); near(bbox(c2.id).x, bbox('bx').x, 6, 'below the selected element');
        // only to the references; the file tab: search, tick, numbered preview, edit, remove with a warning
        citePrefsOff(); sel = new Set(); citeDialog({ text: CS.enw }); await sleep(60); ok(!$$('#ctOnly').hidden, 'Only add to the references'); const h1 = hist.length; $$('#ctOnly').click(); eq([fig.refs().length, hist.length - h1, !$$('#ctFilePane').hidden, $$('#ctN').textContent], [5, 1, true, '5'], 'three added in one step; the file tab shows them');
        eq($all('#ctRefs .ctrow').length, 5, 'five rows'); ok(/cited twice|cited 2 times/.test($all('#ctRefs .ctrow')[0].textContent), 'says how often it is cited: ' + $all('#ctRefs .ctrow')[0].textContent.slice(0, 60)); ok($$('#ctQ').hidden, 'no search box for a few');
        $all('#ctRefs [data-a="edit"]')[0].click(); ok(/Edit reference/.test($$('#modalBox h2').textContent) && $$('#rfAuthors').value.split('\n').length === 4 && $$('#rfAuthors').value.includes('van der Berg, Karel'), 'the form: ' + $$('#rfAuthors').value); ok($all('#modalBox .row').every(x => x.querySelector('input,select,textarea')) && /Carlsson AB/.test($$('#rfPv').textContent), 'fields with labels and a preview');
        $$('#rfYear').value = '2031'; $$('#rfAuthors').value = 'Carlsson, Alexander B.\n{Aging Atlas Consortium}\nJean Dupont'; $$('#rfYear').dispatchEvent(new Event('input', { bubbles: true })); ok(/2031/.test($$('#rfPv').textContent), 'the preview follows'); const h2 = hist.length; $$('#rfOk').click(); await sleep(30);
        eq([J(fig.refs()[0].authors), fig.refs()[0].year, hist.length - h2, !!$$('#ctRefs')], [J([{ family: 'Carlsson', given: 'Alexander B.' }, { literal: 'Aging Atlas Consortium' }, { family: 'Dupont', given: 'Jean' }]), 2031, 1, true], 'saved in one step, back in the dialog'); ok(/2031/.test(c2.id && get(c2.id).text) && /2031/.test(get(c.id).text), 'the citations follow');
        $all('#ctRefs [data-a="edit"]')[0].click(); $$('#rfTitle').value = 'never saved'; D.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(30); ok(!$$('#modal').hidden && $$('#ctRefs') && fig.refs()[0].title !== 'never saved', 'Esc in the form goes back to the dialog and saves nothing');
        $all('#ctRefs [data-a="rm"]')[0].click(); ok(/Cited 2 times/.test($all('#ctRefs .ctrow')[0].textContent) && $$('#ctRefs [data-a="rm2"]') && fig.refs().length === 5, 'removing a cited reference asks first'); eq(D.activeElement && D.activeElement.dataset.a, 'keep', 'the focus is on Keep'); $$('#ctRefs [data-a="keep"]').click(); eq([fig.refs().length, !!$$('#ctRefs [data-a="rm2"]')], [5, false], 'kept');
        $all('#ctRefs [data-a="rm"]')[4].click(); eq(fig.refs().length, 4, 'an uncited one goes at once'); ok(/removed/.test($$('#ctMsg').textContent), 'and it says so'); undo(); eq(fig.refs().length, 5, 'undo brings it back'); closeModal();
        citeDialog({ tab: 'file' }); $all('#ctRefs input')[2].click(); $all('#ctRefs input')[3].click(); $$('.ctst[data-s="num"]').click(); ok(/\[\d, \d\]|\[\d–\d\]/.test($$('.ctst.on .ctpv').textContent), 'a numbered preview: ' + $$('.ctst.on .ctpv').textContent); $$('#ctGo').click(); await settle(); ok(/^\[/.test(get([...sel][0]).text) && get([...sel][0]).cite.length === 2, 'two references of the file cited');
        // add to an existing citation from its panel
        fig.select(c.id); [...D.querySelectorAll('#props button')].find(x => x.textContent === 'Add reference…').click(); ok(/Add a reference to this citation/.test($$('#modalBox h2').textContent) && !$$('#ctFilePane').hidden && $$('#ctList').hidden, 'opened for this citation, on the file tab'); $all('#ctRefs input')[1].click(); $$('#ctGo').click(); await settle(); eq(J(get(c.id).cite), J(['r1', 'r2']), 'added to it');
        // a look-up happens only on the button, sends only the identifier, and fills in the reference
        blank(); sel = new Set(); calls = []; citePrefsOff(); citeDialog(); await type($$('#ctIn'), 'https://doi.org/10.1234/abc.def'); eq(calls.length, 0, 'typing an identifier sends nothing'); ok($$('#ctLook') && /Sends only this DOI to Crossref \(api\.crossref\.org\)/.test($$('#ctDet').textContent), 'the line says what is sent where: ' + $$('#ctDet').textContent);
        $$('#ctGo').click(); ok(!$$('#modal').hidden && /Look up/.test($$('#ctMsg').textContent) && calls.length === 0 && !fig.refs().length, 'Insert before the look-up explains, and sends nothing'); $$('#ctLook').click(); for (let i = 0; i < 100 && !/Lovelace/.test($$('#ctFound').textContent); i++) await sleep(30);
        eq(J(calls), J(['https://api.crossref.org/works/10.1234%2Fabc.def']), 'one request, the identifier only'); ok(/Lovelace & Turing 2020/.test($$('#ctFound').textContent) && /A looked-up title/.test($$('#ctFound').textContent) && !$$('#ctLook'), 'filled in: ' + $$('#ctFound').textContent); $$('#ctGo').click(); await settle(); eq(scene.objects.find(o => o.cite).text, 'Lovelace & Turing, *J Tests* 2020', 'and cited');
        eq(J([fig.refs()[0].doi, fig.refs()[0].title, fig.refs()[0].pages]), J(['10.1234/abc.def', 'A looked-up title', '1–9']), 'the reference in the file');
        calls = []; citeDialog(); await type($$('#ctIn'), '23746838\narXiv:1706.03762'); ok(/these identifiers/.test($$('#ctDet').textContent) && /PubMed/.test($$('#ctDet').textContent) && /arXiv/.test($$('#ctDet').textContent), 'two services named'); $$('#ctLook').click(); for (let i = 0; i < 100 && !/Vaswani/.test($$('#ctFound').textContent); i++) await sleep(30);
        eq(calls.length, 2, 'one request each'); ok(/eutils\.ncbi\.nlm\.nih\.gov.*[?&]id=23746838$/.test(calls[0]) && /export\.arxiv\.org\/api\/query\?.*id_list=1706\.03762$/.test(calls[1]) && !calls.some(u => /mail|tool=|api_key|zz-test/.test(u)), 'the identifiers only: ' + J(calls)); ok(/López-Otín et al\. 2013/.test($$('#ctFound').textContent) && /Attention Is All You Need/.test($$('#ctFound').textContent), 'both filled in'); closeModal();
        // offline and unknown: a clear message, the form for filling it in by hand, no second try by itself
        mode = 'offline'; calls = []; citeDialog(); await type($$('#ctIn'), '10.1234/abc.def'); $$('#ctLook').click(); for (let i = 0; i < 100 && !/by hand/.test($$('#ctFound').textContent); i++) await sleep(30); ok(/Crossref (did not answer|could not be asked)/.test($$('#ctFound').textContent) && $$('#ctLook') && !$$('#ctLook').disabled, 'offline: said in the row, the button is back: ' + $$('#ctFound').textContent); await sleep(300); eq(calls.length, 1, 'no retry by itself');
        mode = '404'; calls = []; $$('#ctLook').click(); for (let i = 0; i < 100 && !/not know/.test($$('#ctFound').textContent); i++) await sleep(30); ok(/Crossref and DataCite do not know the DOI 10\.1234\/abc\.def/.test($$('#ctFound').textContent), 'unknown: ' + $$('#ctFound').textContent);
        eq(J(calls), J(['https://api.crossref.org/works/10.1234%2Fabc.def', 'https://api.datacite.org/dois/10.1234%2Fabc.def']), 'a DOI Crossref does not have is asked once at DataCite, as the dialog says'); ok(/DataCite \(api\.datacite\.org\) for a DOI Crossref does not have/.test($$('#ctDet').textContent), 'the line names DataCite: ' + $$('#ctDet').textContent);
        { mode = 'arxivdown'; calls = []; const r = await refLookup({ kind: 'arxiv', id: '1706.03762v5' }); eq(J(calls), J(['https://export.arxiv.org/api/query?max_results=1&id_list=1706.03762v5', 'https://api.datacite.org/dois/10.48550%2FarXiv.1706.03762']), 'arXiv does not answer: its DOI is asked at DataCite');
          eq([r.type, r.container, r.year, r.title, J(r.authors), r.doi, r.url], ['preprint', 'arXiv', 2017, 'Attention Is All You Need', J([{ family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }, { literal: 'Google Brain Team' }]), '10.48550/arXiv.1706.03762', 'https://arxiv.org/abs/1706.03762'], 'and read'); ok(/arXiv \(export\.arxiv\.org\), or to DataCite/.test(refServiceSay(['arxiv'])), 'which the dialog says: ' + refServiceSay(['arxiv'])); mode = '404'; }
        $$('#ctFound [data-a="edit"]').click(); eq($$('#rfDoi').value, '10.1234/abc.def', 'the form keeps the identifier'); $$('#rfAuthors').value = 'Hand, Made'; $$('#rfYear').value = '1999'; $$('#rfTitle').value = 'Typed in'; $$('#rfContainer').value = 'J Hand'; $$('#rfOk').click(); await sleep(30); ok(/Hand 1999/.test($$('#ctFound').textContent) && !$$('#ctLook'), 'filled in by hand: no look-up needed'); closeModal(); mode = 'ok';
        // nothing recognized; by hand from scratch; the form refuses an empty reference
        citeDialog(); await type($$('#ctIn'), '??'); ok(/No reference recognized/.test($$('#ctDet').textContent), 'says when it reads nothing'); $$('#ctManual').click(); $$('#rfOk').click(); ok(/at least/.test($$('#rfMsg').textContent) && $$('#rfOk'), 'an empty form is not saved'); $$('#rfAuthors').value = 'Curie, Marie'; $$('#rfYear').value = '1911'; $$('#rfUrl').value = 'nope'; $$('#rfOk').click(); ok(/http/.test($$('#rfMsg').textContent), 'a link that is none is named');
        $$('#rfUrl').value = ''; $$('#rfOk').click(); await sleep(30); ok(/Curie 1911/.test($$('#ctFound').textContent), 'typed by hand: listed'); closeModal();
        // files: a .ris dropped on the canvas, a CSL .json opened as a figure file, a paste of an export on the canvas
        { const dt = new DataTransfer(); dt.items.add(new File([CS.endnoteRis], 'export.ris', { type: 'application/x-research-info-systems' })); const st = D.querySelector('#stage'), r = st.getBoundingClientRect(); st.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.left + 50, clientY: r.top + 50, bubbles: true, cancelable: true })); for (let i = 0; i < 100 && ($$('#modal').hidden || !$$('#ctFound .ctrow')); i++) await sleep(30);
          ok(!$$('#modal').hidden && /Kenyon et al\. 1993/.test($$('#ctFound').textContent) && /export\.ris/.test($$('#ctDet').textContent), 'a dropped .ris opens the dialog with its reference: ' + ($$('#ctDet') || {}).textContent); closeModal();
          await loadFigFile(new File([CS.csl], 'items.json', { type: 'application/json' })); ok(!$$('#modal').hidden && $all('#ctFound .ctrow').length === 3, 'a CSL JSON file is read as references, not refused as a figure'); closeModal();
          const n = scene.objects.length; ok(pasteText(CS.zoteroBib) && !$$('#modal').hidden && $all('#ctFound .ctrow').length === 3 && scene.objects.length === n, 'an export pasted on the canvas opens the dialog'); closeModal(); pasteText('just some words'); eq(scene.objects.length, n + 1, 'other text is pasted as text'); ok($$('#modal').hidden, 'without a dialog');
          citeDialog(); const dt2 = new DataTransfer(); dt2.items.add(new File([CS.nbib], 'pubmed.nbib')); dt2.items.add(new File([CS.enXml], 'lib.xml')); dt2.items.add(new File(['nothing here'], 'x.bib')); $$('#modalBox').dispatchEvent(new DragEvent('drop', { dataTransfer: dt2, bubbles: true, cancelable: true })); for (let i = 0; i < 100 && $all('#ctFound .ctrow').length < 4; i++) await sleep(30);
          eq($all('#ctFound .ctrow').length, 4, 'files dropped on the dialog: their references together'); ok(/3 files read/.test($$('#ctDet').textContent) && /No references found in x\.bib/.test($$('#ctMsg').textContent), 'and the file without any is named: ' + $$('#ctMsg').textContent); closeModal(); }
        // the reference list dialog
        unslide(); blank(); sel = new Set(); citeDialog(); $$('#ctList').click(); ok(/no references yet/.test($$('#modalBox').textContent) && !$$('#rlGo'), 'no references: it says so'); $$('#rlBack').click(); ok($$('#ctIn'), 'Back returns'); closeModal();
        const ids = fig.addRef(CS.zoteroRis); fig.cite(ids[0], { style: 'num' }); citeDialog(); $$('#ctList').click(); ok(/Cited in this file \(1\)/.test($$('#modalBox').textContent) && /All references of this file \(4\)/.test($$('#modalBox').textContent) && !$$('input[name="rlP"]'), 'counts; a plain figure has no slide choice'); $$('input[name="rlW"][value="all"]').click(); $$('#rlGo').click(); await settle();
        const lo = scene.objects.find(o => o.refList); ok($$('#modal').hidden && lo && lo.refAll && lo.text.split('\n').length === 4 && /^1\. Carlsson/.test(lo.text), 'the list of all four, numbered'); ok(!isDeck(scene), 'still a plain figure');
        if (hasSlides) { fig.addSlide(); citeDialog(); $$('#ctList').click(); ok($$('input[name="rlP"][value="new"]').checked, 'a file with slides: a new slide is offered first'); $$('#rlGo').click(); await settle(); eq([scene.slides.length, scene.slides[2].name, CUR], [3, 'References', 2], 'on a new last slide named References'); }
      } finally { W.fetch = realFetch; try { closeModal(); } catch (e) {} citePrefsOff(); unslide(); blank(); }
    });

    test('citations: saved one reference per line and read back; a file edited outside; two windows merged; PowerPoint and SVG keep the citation as text', async () => {
      if (!hasCite) throw new Skip('this editor has no citations');
      try {
        unslide(); blank(); citePrefsOff(); const ids = fig.addRef([CS.zoteroRis, CS.nbib]), c = fig.cite(ids[0]), n = fig.cite([ids[1], ids[4]], { style: 'sup', x: 300, y: 300 }), L = fig.refList({}); await settle(); await flushSave(); await sleep(100); await flushSave();
        const r = await fetch(FILE, { cache: 'no-store' }), t = await r.text(); eq(t.replace(/\n/g, '') === lastSaved, true, 'the file is the saved state'); ok(/"refs":\[\n\{"id":"r1","type":"article","authors":\[/.test(t) && t.split('\n').filter(l => /^\{"id":"r\d+","type"/.test(l)).length === fig.refs().length, 'one reference per line');
        eq(J(healScene(JSON.parse(t))), J(scene), 'read back, it is the same figure'); const S = JSON.parse(t); ok(S.objects.some(o => o.text === 'Carlsson et al., *Nat Med* 2025' && J(o.cite) === J(['r1']) && o.citeStyle === 'short'), 'the citation is a text element with its words in the file');
        // edited outside (an assistant changes a reference in the file): the citation and the list follow when it is read
        S.refs[0].year = 1999; S.refs[0].short = 'Nat Ag'; fig.set(S); await settle(); eq(get(c).text, 'Carlsson et al., *Nat Ag* 1999', 'the citation follows the edited file'); ok(/Nat Ag\*\. 1999;/.test(get(L).text), 'and the list');
        { const S2 = fig.get(); S2.refs[0].year = 2001; ok(loadText(J(S2)), 'loaded'); eq(get(c).text, 'Carlsson et al., *Nat Ag* 2001', 'also when the file is taken in by a poll'); ok(isClean(), 'and that is a fill-in, not a change of its own'); commit(); }
        // two windows: references are merged by id; one added on both sides under the same id stays twice, and the other side's citation follows its new id
        { const B = JSON.parse(J(scene)), M = JSON.parse(J(scene)), Tt = JSON.parse(J(scene)), nid = refNewId(new Set(B.refs.map(x => x.id)));
          M.refs.push({ id: nid, type: 'article', authors: [{ family: 'Mine' }], year: 2001, title: 'Mine' }); M.refs[1].year = 1111; M.objects.push({ id: 'm1', type: 'text', x: 1, y: 1, text: '', cite: [nid], citeStyle: 'short' });
          Tt.refs.push({ id: nid, type: 'article', authors: [{ family: 'Theirs' }], year: 2002, title: 'Theirs' }); Tt.refs[2].title = 'Changed there'; Tt.refs = Tt.refs.filter(x => x.id !== B.refs[3].id); Tt.objects.push({ id: 't1', type: 'text', x: 1, y: 1, text: '', cite: [nid, 'r1'], citeStyle: 'short' });
          const m = mgMerge(B, M, Tt).scene, R = m.refs, mine = R.find(x => x.title === 'Mine'), theirs = R.find(x => x.title === 'Theirs'); ok(mine && theirs && mine.id === nid && theirs.id !== nid, 'both new references are kept, under two ids: ' + J(R.map(x => x.id)));
          eq([R[1].year, R[2].title, R.some(x => x.id === B.refs[3].id), J(m.objects.find(o => o.id === 'm1').cite), J(m.objects.find(o => o.id === 't1').cite)], [1111, 'Changed there', false, J([nid]), J([theirs.id, 'r1'])], 'a change on each side, a removal, and each citation with its own reference'); }
        // exports: real text
        const svg = await svgString({}); checkSvg(svg, 'citations'); ok(/Carlsson et al\., <tspan font-style="italic">Nat Ag<\/tspan> 2001/.test(svg), 'SVG: the citation is text, its journal in italics'); ok(/baseline-shift="super"/.test(svg), 'and the superscript numbers');
        let p; try { p = await exportPptx(); } catch (e) { if (!opts.strict && OFFLINE.test(e.message)) throw new Skip('PowerPoint library not reachable (offline): ' + e.message); throw e; }
        const Z = await JSZip.loadAsync(p.blob), x = await Z.file('ppt/slides/slide1.xml').async('string'), txt = x.replace(/<[^>]+>/g, ''); ok(txt.includes('Carlsson et al., ') && txt.includes('Nat Ag') && txt.includes(' 2001'), 'PowerPoint: the citation is editable text'); ok(/<a:rPr[^>]*\bi="1"[^>]*>(?:(?!<\/a:r>).)*<a:t>Nat Ag<\/a:t>/.test(x), 'with the journal in italics'); ok(txt.includes('The hallmarks of aging') && /baseline="\d+"/.test(x), 'the list and the superscript are there too');
      } finally { unslide(); blank(); }
    }, 300000);

    test('citations: a copy brings its references; a hand edit after undo; one citation after another stays on the page; emptied fields; long texts; columns as one list; et al.', async () => {
      if (!hasCite) throw new Skip('this editor has no citations');
      const $$ = s => D.querySelector(s), $all = s => [...D.querySelectorAll(s)], type = async (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(500); };
      const A = { type: 'article', authors: ['Lee, Min', 'Park, Jo', 'Kim, Su'], year: 2020, title: 'Paper A', container: 'Journal of Things', short: 'J Things', volume: '5', doi: '10.1000/a_1' }, B = { type: 'article', authors: ['Berg, Sara'], year: 2011, title: 'Paper B', container: 'Cell' };
      try {
        // a citation copied into another figure: its references come along (the other figure has another paper under the same id)
        unslide(); blank(); citePrefsOff(); const [a] = fig.addRef(A), c1 = fig.cite(a); eq([a, get(c1).text], ['r1', 'Lee et al., *J Things* 2020'], 'figure A'); fig.select(c1); copySel(); const cl = JSON.parse(JSON.stringify(clip)); ok(Array.isArray(cl[0].citeRefs) && cl[0].citeRefs[0].title === 'Paper A', 'the copy carries its reference');
        blank(); const [b] = fig.addRef(B); eq(b, 'r1', 'figure B has its own r1'); const h0 = hist.length; pasteObjs(cl); await settle(); let p = get([...sel][0]);
        eq([p.text, fig.refs().length, fig.refs()[0].title, hist.length - h0, 'citeRefs' in p], ['Lee et al., *J Things* 2020', 2, 'Paper B', 1, false], 'pasted: still paper A, added to this file, in one step'); eq(fig.refs().find(r => r.id === p.cite[0]).title, 'Paper A', 'under the id it has here'); ok(!fig.check().some(x => x.level === 'error'), 'nothing wrong with it');
        pasteObjs(cl); await settle(); eq([fig.refs().length, J(get([...sel][0]).cite)], [2, J(p.cite)], 'pasted again: the same reference, not a third');
        pasteObjs([{ id: 'zz', type: 'text', x: 300, y: 300, text: 'Words *of* another file 2020', cite: ['r1'], citeStyle: 'short' }]); await settle(); p = get([...sel][0]); eq([p.text, 'cite' in p, 'citeStyle' in p], ['Words *of* another file 2020', false, false], 'a copy without its references keeps its words as plain text (never this file\'s r1)');
        fig.select(fig.cite(b)); duplicate(); await settle(); ok(J(get([...sel][0]).cite) === J([b]) && get([...sel][0]).text === 'Berg, *Cell* 2011', 'a duplicate stays a citation');
        // fig.set of a plain figure on one slide: the file's references stay, the given ones are merged in
        if (hasSlides) { blank(); const [x1, x2] = fig.addRef([A, B]); const k1 = fig.cite(x1, { style: 'num' }); fig.addSlide({ name: 'Two' }); const h = hist.length;
          fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', refs: [{ id: 'r1', type: 'article', authors: [{ family: 'Quist', given: 'Q' }], year: 1999, title: 'Paper Q', container: 'Q J' }], objects: [{ id: 'q', type: 'text', x: 100, y: 100, text: '', cite: ['r1'], citeStyle: 'short' }] }); await settle();
          eq([fig.refs().length, fig.refs()[0].title, fig.refs()[1].title, get('q').text], [3, 'Paper A', 'Paper B', 'Quist, *Q J* 1999'], 'the references of the file stay and the new one is added'); eq(scene.slides[0].objects.find(o => o.id === k1).text, '[1]', 'the other slide\'s citation is untouched'); eq(fig.refs().find(r => r.id === get('q').cite[0]).title, 'Paper Q', 'the slide cites the reference it was given');
          const n = fig.refs().length; fig.set(fig.get()); eq(fig.refs().length, n, 'fig.set(fig.get()) adds nothing'); while (hist.length > h) undo(); eq(fig.refs().length, 2, 'undone'); unslide(); }
        // a hand edit right after an undo is a hand edit (the restored elements were written over without a word)
        blank(); const [r] = fig.addRef(A), c = fig.cite(r); fig.add('shape', { x: 500, y: 300 }); undo(); fig.update(c, { text: 'Lee and colleagues (my wording)' }); eq([get(c).text, 'cite' in get(c)], ['Lee and colleagues (my wording)', false], 'typed after an undo: kept, plain text now');
        undo(); eq([get(c).text, J(get(c).cite)], ['Lee et al., *J Things* 2020', J([r])], 'undo links it again'); redo(); undo(); editText(get(c)); { const ta = editor && editor.ta; ok(ta, 'typing in place'); ta.value = 'typed on the canvas'; ta.dispatchEvent(new Event('input', { bubbles: true })); finishEdit(); eq([get(c).text, 'cite' in get(c)], ['typed on the canvas', false], 'and on the canvas, after undo and redo'); }
        // an unknown style is named, never kept
        blank(); { const [r2] = fig.addRef(A), c2 = fig.cite(r2), w = fig.update(c2, { citeStyle: 'authorYear' }); ok(w.some(x => /citeStyle/.test(x.msg) && /authoryear/.test(x.msg)), 'fig.update names an unknown style: ' + J(w)); eq(['citeStyle' in get(c2), get(c2).text], [false, 'Lee et al., *J Things* 2020'], 'and it is not kept'); }
        // one citation after another through the dialog: stacked at the bottom left, all on the page, left edges in line
        blank(); sel = new Set(); const made = [];
        for (let i = 0; i < 4; i++) { citeDialog(); await type($$('#ctIn'), 'TY  - JOUR\nAU  - Author' + i + ', A\nAU  - Second, B\nAU  - Third, C\nTI  - Title number ' + i + '\nT2  - Journal of Tests\nPY  - 20' + (10 + i) + '\nER  - '); if (i) ok(/bottom left/.test($$('#ctWhere').textContent), 'with a citation selected the dialog says bottom left: ' + $$('#ctWhere').textContent); $$('#ctGo').click(); await settle(); made.push([...sel][0]); }
        { const bs = made.map(i => bbox(i)); ok(bs.every(x => x.y >= scene.h * .7 && x.y + x.h <= scene.h), 'all four on the page: ' + J(bs.map(x => [Math.round(x.y), Math.round(x.y + x.h)]))); ok(bs.every((x, i) => !i || x.y + x.h <= bs[i - 1].y + 1), 'each above the one before'); ok(bs.every(x => Math.abs(x.x - bs[0].x) < 1.5), 'left edges in line: ' + J(bs.map(x => x.x))); ok(!fig.check().some(x => /outside the page/.test(x.msg)), 'none outside the page'); }
        // below an element only while there is room; else at the bottom, on the page
        { fig.add('shape', { id: 'low', x: 900, y: 860, w: 300, h: 60 }); const k = fig.cite(fig.refs()[0].id, { on: 'low' }); await settle(); const x = bbox(k); ok(x.y + x.h <= scene.h && x.y > 0, 'no room below an element at the bottom edge: still on the page ' + J(x)); const t = fig.add('text', { x: 300, y: 200, text: 'A heading', size: 30 }), k2 = fig.cite(fig.refs()[0].id, { on: t }); await settle(); near(bbox(k2).x, bbox(t).x, 1.5, 'left edge on a text\'s left edge'); ok(bbox(k2).y >= bbox(t).y + bbox(t).h, 'below it'); }
        // the form can empty a field
        blank(); fig.addRef({ ...A, pages: '1–9', issue: '2' }); citeDialog({ tab: 'file' }); await sleep(30); $$('#ctRefs [data-a="edit"]').click(); await sleep(30); for (const k of ['#rfShort', '#rfDoi', '#rfYear', '#rfVolume']) $$(k).value = ''; $$('#rfOk').click(); await sleep(60);
        { const x = fig.refs()[0]; eq(['short' in x, 'doi' in x, 'year' in x, 'volume' in x, x.pages, x.title], [false, false, false, false, '1–9', 'Paper A'], 'emptied fields are gone, the others stay'); ok($$('#ctRefs') && D.activeElement && D.activeElement.dataset.a === 'edit', 'back in the list, on the row\'s Edit'); ok($all('#ctRefs button').every(x => /Paper A|Lee/.test(x.getAttribute('aria-label') || '')), 'each row button names its reference'); } closeModal();
        // et al. in the source; a DOI with < and >; a long run of hyphenated capitals
        { let x = fig.parseRefs('Kenyon, C. et al. A C. elegans mutant that lives twice as long as wild type. Nature 366, 461–464 (1993).')[0]; eq([x.title, x.container, x.etal, x.authors.length, citeShort(x, {})], ['A C. elegans mutant that lives twice as long as wild type', 'Nature', true, 1, 'Kenyon et al., *Nature* 1993'], 'Nature style with et al.');
          x = fig.parseRefs('Harrison DE, et al. Rapamycin fed late in life. Nature. 2009;460(7253):392-395.')[0]; eq([x.title, x.container, citeShort(x, {}), citeAY(x), citeVanc(x, {}).slice(0, 20), citeApa(x, {}).slice(0, 24)], ['Rapamycin fed late in life', 'Nature', 'Harrison et al., *Nature* 2009', 'Harrison et al., 2009', 'Harrison DE, et al. ', 'Harrison, D. E., et al. '], 'Vancouver with et al.');
          x = fig.parseRefs('@article{k, author = {Smith, John and Roe, Ann and others}, title = {T}, journal = {J}, year = 2020}')[0]; eq([x.authors.length, x.etal, citeShort(x, {})], [2, true, 'Smith et al., *J* 2020'], 'BibTeX and others'); ok(/Roe, Ann and others/.test(refsBib([{ id: 'r1', ...x }])), 'and written back'); eq(refParse(refsBib([{ id: 'r1', ...x }])).refs[0].etal, true, 'read back');
          eq(healScene({ version: 4, w: 9, h: 9, objects: [], refs: [{ id: 'r1', authors: [], etal: true, title: 'x' }, { id: 'r2', authors: ['A, B'], etal: 'yes', title: 'y' }, { id: 'r3', authors: ['A, B'], etal: true, title: 'z' }] }).refs.map(r => r.etal).join(), ',,true', 'etal only as true, with authors');
          const sici = '10.1002/(SICI)1096-9861(19990215)404:4<505::AID-CNE6>3.0.CO;2-K'; eq(fig.parseRefs('TY  - JOUR\nAU  - Lee, A\nTI  - X\nDO  - ' + sici + '\nER  - ')[0].doi, sici, 'a DOI field keeps < and >'); eq(fig.parseRefs('Lee A. Title. J. 2001;1:2-3. doi:10.1000/abc<b>')[0].doi, '10.1000/abc', 'in running text they end it');
          const t0 = performance.now(); fig.parseRefs('Van-'.repeat(12500)); fig.parseRefs('MKV--LLA-'.repeat(6000)); fig.parseRefs('Well-Known-'.repeat(15000)); const ms = performance.now() - t0; ok(ms < 1500, 'long runs of hyphenated capitals are read at once: ' + Math.round(ms) + ' ms'); }
        // a long export: read whole, wherever it comes from; many references are added fast; tick all / untick all
        { blank(); let big = ''; for (let i = 0; i < 1500; i++) big += 'TY  - JOUR\nAU  - Author' + i + ', Alex\nAU  - Second, Bo\nTI  - A unique article title number ' + i + ' about the biology of aging in model organisms\nT2  - Journal of Long Lists\nPY  - 2020\nVL  - ' + i + '\nER  - \n\n'; ok(big.length > 2e5, 'more than the box shows');
          citeDialog({ text: big }); await sleep(60); ok(/1500 references/.test($$('#ctDet').textContent) && $all('#ctFound .ctrow').length === 1500, 'all 1500 read: ' + $$('#ctDet').textContent.slice(0, 80)); ok($$('#ctIn').readOnly && /beginning/.test($$('#ctDet').textContent), 'the box shows the beginning and says so');
          $$('#ctDet [data-a="none"]').click(); ok($all('#ctFound input').every(x => !x.checked) && $$('#ctGo').textContent === 'Insert citation' && D.activeElement.dataset.a === 'none', 'Untick all, the keyboard stays on it'); $all('#ctFound input')[2].click(); $$('#ctDet [data-a="all"]').click(); ok($all('#ctFound input').every(x => x.checked) && /1500 references/.test($$('#ctGo').textContent), 'Tick all');
          const t0 = performance.now(); $$('#ctOnly').click(); const ms = performance.now() - t0; eq(fig.refs().length, 1500, 'all added'); ok(ms < 4000, 'in ' + Math.round(ms) + ' ms'); ok(!$$('#ctIn').readOnly, 'the box can be typed in again'); closeModal();
          citeDialog({ text: big }); await sleep(60); ok($all('#ctFound .tag').length >= 1500, 'all found again as already in this file'); $$('#ctDet [data-a="clear"]').click(); ok(!$all('#ctFound .ctrow').length && !$$('#ctIn').readOnly && $$('#ctIn').value === '' && D.activeElement.id === 'ctIn', 'Clear empties the box'); closeModal(); }
        // identifiers not looked up yet are named by what was typed; a style clicked with the mouse keeps the keyboard
        { blank(); citeDialog(); await type($$('#ctIn'), '12345678\narXiv:2301.01234\n10.1234/abc'); const heads = $all('#ctFound .cthead').map(x => x.textContent.trim().replace(/\s+/g, ' ')); eq(J(heads), J(['PMID 12345678', 'arXiv:2301.01234', '10.1234/abc DOI']), 'rows named by their identifier');
          const b = $$('.ctst[data-s="authoryear"]'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); ok(D.activeElement === $$('.ctst.on') && $$('.ctst.on').dataset.s === 'authoryear', 'a clicked style has the keyboard'); closeModal(); }
        // two windows: a reference removed in one and newly cited in the other is kept, and listed
        { const base = { version: 4, w: 1600, h: 900, bg: '#ffffff', refs: [{ id: 'r1', ...refClean(A) }], objects: [{ id: 'c1', type: 'text', x: 10, y: 10, text: 'x', cite: ['r1'] }] }, mine = { version: 4, w: 1600, h: 900, bg: '#ffffff', objects: [] }, theirs = JSON.parse(J(base)); theirs.objects.push({ id: 'c2', type: 'text', x: 10, y: 50, text: 'y', cite: ['r1'] });
          let m = mgMerge(JSON.parse(J(base)), JSON.parse(J(mine)), JSON.parse(J(theirs))); eq([J((m.scene.refs || []).map(r => r.id)), m.scene.objects.map(o => o.id).join(), m.conflicts.length], [J(['r1']), 'c2', 1], 'removed here, newly cited there: the reference is kept and listed'); ok(/reference r1/.test(J(m.conflicts)), J(m.conflicts));
          m = mgMerge(JSON.parse(J(base)), JSON.parse(J(theirs)), JSON.parse(J(mine))); eq([J((m.scene.refs || []).map(r => r.id)), m.conflicts.length], [J(['r1']), 1], 'and the other way round');
          m = mgMerge(JSON.parse(J(base)), JSON.parse(J(mine)), JSON.parse(J(base))); eq(['refs' in m.scene, m.conflicts.length], [false, 0], 'removed with its citation, nothing else: gone, no word'); }
        // a list in two columns is one list: style, DOI and size go to both; a list that got short is one column again; a column deleted leaves the whole list
        { blank(); const many = []; for (let i = 0; i < 40; i++) many.push({ authors: ['Author' + String.fromCharCode(65 + i % 26) + i + ', Alex B.', 'Second, C.', 'Third, D.'], year: 1980 + i, title: 'A fairly long article title number ' + i + ' about the biology of aging in model organisms', container: 'Journal of Long Reference Lists', short: 'J Long Ref Lists', volume: String(i + 1), pages: '100–110', doi: '10.1000/x' + i });
          const ids = fig.addRef(many), L = fig.refList({ cited: false }); await settle(); let cols = () => scene.objects.filter(o => o.refList), all = () => cols().map(o => o.text).join('\n').split('\n'); eq(cols().length, 2, 'two columns'); fig.select(L); const P = $$('#props'); ok(/column 1 of 2/.test(P.textContent), 'the panel says which column');
          { const s = [...P.querySelectorAll('select')].find(x => [...x.options].map(o => o.value).join() === 'vancouver,apa'); s.focus(); s.value = 'apa'; s.dispatchEvent(new Event('change', { bubbles: true })); } eq(J(cols().map(o => o.citeStyle)), J(['apa', 'apa']), 'the style goes to both columns'); ok(D.activeElement.tagName === 'SELECT' && D.activeElement.value === 'apa', 'the style list keeps the keyboard');
          { const cb = [...$$('#props').querySelectorAll('.ctpck input')][0]; cb.click(); } ok(cols().every(o => o.citeDoi === false) && !/doi\.org/.test(all().join(' ')), 'and the DOI option'); eq([all().length, new Set(all()).size], [40, 40], 'every reference once');
          fig.update(L, { size: cols()[0].size + 3, color: '#123456' }); eq([cols()[1].size, cols()[1].color], [cols()[0].size, '#123456'], 'size and color follow in the other column'); const h = hist.length;
          for (const i of ids.slice(1)) refsOf().splice(refsOf().findIndex(r => r.id === i), 1); commit(); render(); eq([cols().length, 'refCols' in cols()[0], cols()[0].text.split('\n').length, scene.objects.some(o => o.text === '·')], [1, false, 1, false], 'one reference left: one column, no stray mark'); ok(cols()[0].boxW > scene.w * .6, 'as wide as the list was: ' + cols()[0].boxW);
          undo(); eq([cols().length, all().length], [2, 40], 'undo brings both columns back'); fig.remove(cols()[0].id); eq([cols().length, 'refCols' in cols()[0], cols()[0].text.split('\n').length], [1, false, 40], 'a column deleted: the other shows the whole list'); }
        // the panel of a citation: a moved reference keeps the keyboard; typed text takes the Citation section away
        { blank(); const [x1, x2, x3] = fig.addRef([A, B, { authors: ['Roe, R'], year: 1992, title: 'Paper C', container: 'J C' }]), k = fig.cite([x1, x2, x3]); fig.select(k); const P = $$('#props'); let bt = P.querySelectorAll('.ctpr')[0].querySelector('[data-k="down"]'); bt.focus(); bt.click();
          eq([J(get(k).cite), D.activeElement.dataset.k, D.activeElement.closest('.ctpr') === P.querySelectorAll('.ctpr')[1]], [J([x2, x1, x3]), 'down', true], 'Move down: the keyboard goes with the reference'); D.activeElement.click(); ok(D.activeElement && P.contains(D.activeElement) && !D.activeElement.disabled, 'at the end the keyboard stays in the row');
          fig.update(k, { text: 'my words' }); await sleep(60); ok(!/Make plain text/.test($$('#props').textContent), 'plain text now: the Citation section is gone from the panel'); ok(!('citeStyle' in get(k)), 'and no citation field is left'); }
      } finally { try { closeModal(); } catch (e) {} unslide(); blank(); }
    }, 240000);

    // --- icon expansions (Import more icons): a pack of three made-up icons in tests/icon-pack-test/ stands for a repository; then the packs that are shipped ---
    const TP = 'zz-test', TPK = k => TP + ':' + k;
    const T_ALPHA = 'Icons: Alpha disc by Test Author A (doi:10.0000/zz.alpha), example.org, CC BY 4.0, adapted';
    const T_BOTH = 'Icons: Alpha disc by Test Author A (doi:10.0000/zz.alpha), Beta peak by Test Author B (doi:10.0000/zz.beta), example.org, CC BY 4.0, adapted';
    let packDir = '';
    // the test pack: known to the editor (imported: false = not imported, true = imported with every part loaded)
    const usePack = async imported => {
      await packInit();
      if (!packDir) {
        const cands = [opts.base, new URL('/tests/', location.origin).href, new URL('/release/tests/', location.origin).href].filter(Boolean).map(c => String(c).replace(/\/?$/, '/') + 'icon-pack-test/');
        for (const c of cands) { try { const r = await fetch(c + 'pack.json', { cache: 'no-store' }); if (r.ok) { packDir = c; break; } } catch (e) {} }
        ok(packDir, 'the test pack (tests/icon-pack-test/pack.json) was not found beside the tests');
      }
      if (!PACKS.by.has(TP)) eq(await packSource(packDir), TP, 'the test pack\'s id');
      if (!imported && packImported(TP)) await packRemove(TP);
      if (imported && !(packImported(TP) && ICONS[TPK('alpha')] && !ICONS[TPK('alpha')].stub)) await fig.importIconPack(TP, { accept: true });
    };
    // and gone again: out of the library, the list and this browser's choices (the file with the figures no longer names it)
    const dropPack = async () => {
      try { if (packImported(TP)) await packRemove(TP); } catch (e) {}
      PACKS.by.delete(TP); { const i = PACKS.list.findIndex(p => p.id === TP); if (i >= 0) PACKS.list.splice(i, 1); }
      for (const k of Object.keys(ICONS)) if (ICONS[k].pack === TP || ICONS[k].pack === 'zz-other') delete ICONS[k];
      delete PACKS.show[TP]; delete PACKS.show.builtin; delete PACKS.show.my; packShowSave(); PACKS.chunk.clear(); packMenu(false); packPalette(); packBar();
      try { if (PACKS.state[TP]) { delete PACKS.state[TP]; await packSaveState(); } } catch (e) {}
    };
    const credLine = () => scene.objects.filter(o => o.type === 'text' && o.iconCredit === true);
    const $q = s => D.querySelector(s);

    test('icon packs: list, terms before import, own groups, show and hide, tooltip', async () => {
      try {
        await usePack(false);
        const row = fig.iconPacks().find(p => p.id === TP); ok(row && row.imported === false && row.shown === false && row.count === 3 && row.license === 'CC BY 4.0 / CC0' && row.name === 'Test pack', 'fig.iconPacks(): ' + J(row));
        // the API refuses what the user has not agreed to
        let err = ''; try { fig.add('icon', { kind: TPK('alpha') }); } catch (e) { err = e.message; } ok(/not imported here/.test(err) && /Test pack/.test(err), 'fig.add of an icon whose pack is not imported: ' + err);
        err = ''; try { await fig.importIconPack(TP); } catch (e) { err = e.message; } ok(/accept: true/.test(err), 'import without accept: ' + err); ok(!packImported(TP), 'and nothing was imported');
        err = ''; try { await fig.importIconPack('zz-nope', { accept: true }); } catch (e) { err = e.message; } ok(/No icon pack/.test(err), 'an unknown pack: ' + err);
        err = ''; try { fig.showIconPacks({ 'zz-nope': false }); } catch (e) { err = e.message; } ok(/no source/.test(err), 'an unknown source: ' + err);
        // the button and its list, with a preview per pack
        const B = $q('#packBtn'); ok(B && /Import more icons/.test(B.textContent) && B.title && B.getClientRects().length, 'the button is in the Add panel'); eq(B.getAttribute('aria-expanded'), 'false', 'closed');
        B.click(); const M = $q('#packMenu'); ok(!M.hidden, 'the list opens'); eq(B.getAttribute('aria-expanded'), 'true', 'aria-expanded'); eq(M.querySelectorAll('.pkrow').length, fig.iconPacks().length, 'one row per pack');
        let rowB = M.querySelector('.pkrow[data-id="' + TP + '"]'); ok(/Test pack/.test(rowB.textContent) && /CC BY 4\.0 \/ CC0/.test(rowB.textContent) && /3 icons/.test(rowB.textContent) && !/Imported/.test(rowB.textContent), 'the row: ' + rowB.textContent);
        for (let i = 0; i < 50 && !rowB.querySelector('.pkpv svg'); i++) await sleep(100); ok(rowB.querySelector('.pkpv svg circle'), 'the preview is drawn from the pack\'s preview icons');
        { const H = D.documentElement, was = H.classList.contains('ui-still'); H.classList.toggle('ui-still', !was); packMenu(true); const pv = () => $q('#packMenu .pkrow[data-id="' + TP + '"] .pkpv'); for (let i = 0; i < 50 && !pv().querySelector('svg'); i++) await sleep(100);
          eq(pv().classList.contains('grid'), !was, 'reduced motion: a still grid; else a cross-fade'); H.classList.toggle('ui-still', was); packMenu(true); for (let i = 0; i < 50 && !pv().querySelector('svg'); i++) await sleep(100); eq(pv().classList.contains('grid'), was, 'and back'); }
        B.focus(); B.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ok(M.hidden && D.activeElement === B, 'Esc closes the list, the focus stays on the button'); B.click(); rowB = M.querySelector('.pkrow[data-id="' + TP + '"]');
        // the pop-up: the terms, and Import only after the box is ticked
        rowB.click(); const box = $q('#modalBox'); ok(!$q('#modal').hidden && /Test pack/.test(box.querySelector('h2').textContent), 'the pop-up opens');
        ok(/I take full responsibility for correctly attributing this repository/.test(box.textContent), 'the box to tick'); ok(/Attribution is required/i.test(box.textContent) && /Credit every CC BY icon/.test(box.textContent) && /Please credit the author of each icon/.test(box.textContent), 'how to credit, and in their words');
        ok([...box.querySelectorAll('a')].some(a => /LICENSE\.txt$/.test(a.getAttribute('href'))) && /3 icons/.test(box.textContent) && /What SiliCoDraw changed/i.test(box.textContent), 'license link, count, what was changed');
        const go = box.querySelector('#pkGo'), tick = box.querySelector('#pkOk'); ok(go.disabled && !tick.checked, 'Import is off until the box is ticked'); go.click(); await sleep(150); ok(!packImported(TP) && !$q('#modal').hidden, 'a click on it does nothing');
        tick.click(); ok(!go.disabled, 'ticked: Import is on'); go.click(); for (let i = 0; i < 100 && (!packImported(TP) || !$q('#modal').hidden); i++) await sleep(100);
        ok(packImported(TP) && $q('#modal').hidden, 'imported, the pop-up closed'); eq(palState.cat, 'Test pack', 'the Add panel shows the pack'); ok($q('#packMenu').hidden && D.activeElement === $q('#packBtn'), 'the list closed, the keyboard is on the button');
        const st = await (await fetch('assets/icon-packs.json?t=' + Date.now(), { cache: 'no-store' })).json(); ok(st[TP] && st[TP].imported === true && st[TP].version === '1' && /^\d{4}-\d\d-\d\d$/.test(st[TP].date), 'kept with the figures (assets/icon-packs.json): ' + J(st[TP]));
        ok(fig.iconPacks().find(p => p.id === TP).imported, 'fig.iconPacks() says so');
        // its own group, the boxes, search
        ok(PALETTE.some(s => s[0] === 'Test pack · Test' && s[1].length === 3), 'a group of its own'); ok([...D.querySelectorAll('#palCats .pcat')].some(c => c.dataset.cat === 'Test pack'), 'and a chip');
        eq([...D.querySelectorAll('#palList .pitem')].length, 3, 'the chip shows only the pack\'s icons');
        const R = $q('#packShow'); ok(!R.hidden && /Show icons from/.test(R.textContent), 'Show icons from'); ok(R.querySelector('input[data-src="builtin"]').checked && R.querySelector('input[data-src="' + TP + '"]').checked, 'both on');
        const S = $q('#palSearch'), search = async v => { S.value = v; buildPalette(); await sleep(60); return [...D.querySelectorAll('#palList .pitem')]; };
        let its = await search('zzalpha'); eq(its.length, 1, 'found by its tag'); const it = its[0]; ok(it.querySelector('.src') && it.querySelector('.src').textContent === 'T', 'the source mark');
        ok(/Alpha disc/.test(it.title) && /from Test pack/.test(it.title) && /by Test Author A/.test(it.title) && /CC BY 4\.0/.test(it.title), 'its title: ' + it.title);
        packTip(it); const tip = $q('#packTip'); ok(!tip.hidden && /Alpha disc/.test(tip.textContent) && /from Test pack/.test(tip.textContent) && /by Test Author A/.test(tip.textContent) && /CC BY 4\.0/.test(tip.textContent), 'the tooltip: ' + tip.textContent); packTip(null); ok(tip.hidden, 'and it goes');
        eq(fig.findIcon('zzbeta')[0], { kind: TPK('beta'), name: 'Beta peak', group: 'Test pack' }, 'fig.findIcon finds it');
        // hidden: neither in the groups nor in the search; shown again with its box
        eq(fig.showIconPacks({ [TP]: false })[TP], false, 'fig.showIconPacks'); its = await search('zzalpha'); eq(its.length, 0, 'hidden: not in the search'); ok(!PALETTE.some(s => s[2] && s[2].pack === TP) || !palNames().includes('Test pack'), 'nor a chip');
        ok(!fig.findIcon('zzbeta').some(x => x.kind === TPK('beta')), 'nor in fig.findIcon'); ok(fig.findIcon('zzbeta', 8, { packs: true }).some(x => x.kind === TPK('beta')), 'unless asked for (packs: true)'); ok(!fig.iconPacks().find(p => p.id === TP).shown, 'shown: false');
        { const cb = $q('#packShow input[data-src="' + TP + '"]'); ok(cb && !cb.checked, 'its box is off'); cb.click(); } its = await search('zzalpha'); eq(its.length, 1, 'the box brings it back');
        fig.showIconPacks({ builtin: false }); its = await search('mouse'); ok(!its.some(b => /\|icon:mouse$/.test(b.dataset.key)), 'SiliCoDraw off: no built-in icon in the search'); ok((await search('zzalpha')).length === 1 && (await search('rectangle')).length >= 1, 'the pack and the shapes stay');
        fig.showIconPacks({ builtin: true }); ok((await search('mouse')).some(b => /\|icon:mouse$/.test(b.dataset.key)), 'and on again'); S.value = ''; palState.cat = 'All'; buildPalette();
        // an icon whose part is not loaded yet (a later start): placed at once, drawn and embedded when the part arrives
        await packRemove(TP); PACKS.state[TP] = { imported: true, date: '2026-01-01', version: '1' }; await packNames(TP); packPalette(); ok(ICONS[TPK('alpha')].stub, 'only its name is known');
        blank(); const a = fig.add('icon', { kind: TPK('alpha'), x: 400, y: 300 }); for (let i = 0; i < 100 && !(scene.icons && scene.icons[TPK('alpha')]); i++) await sleep(50);
        ok(scene.icons && typeof scene.icons[TPK('alpha')].svg === 'string' && scene.icons[TPK('alpha')].pack === TP, 'embedded when its part arrived'); await settle(); ok(D.querySelector('#content [data-id="' + a + '"] circle[fill="#3a7bd5"]'), 'and drawn');
        { const b = bbox(a), k = get(a).size / 100; near(b.w, 80 * k, 1, 'measured by what is seen of it (width)'); near(b.h, 80 * k, 1, 'height'); }
        eq(credLine().length, 1, 'with its credit line'); eq(credLine()[0].text, T_ALPHA, 'the line');
        // out of the library: the figure keeps its copy
        await packRemove(TP); ok(!packImported(TP) && !PALETTE.some(s => s[2] && s[2].pack === TP), 'removed from the library'); ok(ICONS[TPK('alpha')] && scene.icons[TPK('alpha')], 'the figure keeps the icon it uses'); ok(!ICONS[TPK('beta')], 'the others are gone');
        const st2 = await (await fetch('assets/icon-packs.json?t=' + Date.now(), { cache: 'no-store' })).json(); ok(!st2[TP], 'and the file no longer names it');
      } finally { try { closeModal(); } catch (e) {} try { $q('#palSearch').value = ''; palState.cat = 'All'; } catch (e) {} blank(); await dropPack(); }
    }, 180000);

    test('icon packs: the credit line follows the icons; deleted, edited, parts, slides', async () => {
      try {
        await usePack(true); blank();
        const a = fig.add('icon', { kind: TPK('alpha'), x: 300, y: 300 }); await settle();
        eq(credLine().length, 1, 'placing an icon that asks for attribution adds the line'); const L0 = credLine()[0]; eq([L0.text, L0.name, L0.type], [T_ALPHA, 'icon credits', 'text'], 'its text and name'); eq(fig.iconCredits(), T_ALPHA, 'fig.iconCredits()');
        eq(get(a).cred, 1, 'the icon is noted as credited'); { const b = bbox(L0.id); ok(b && b.x >= 0 && b.x + b.w <= scene.w && b.y > scene.h / 2 && b.y + b.h <= scene.h, 'at the bottom of the page: ' + J(b)); }
        fig.add('icon', { kind: TPK('alpha'), x: 500, y: 300 }); eq([credLine().length, credLine()[0].text], [1, T_ALPHA], 'the same icon again: one line, the same text');
        const h0 = hist.length; fig.add('icon', { kind: TPK('beta'), x: 700, y: 300 }); eq(credLine()[0].text, T_BOTH, 'a second creator joins the line'); eq(hist.length, h0 + 1, 'in the same undo step');
        fig.add('icon', { kind: TPK('gamma'), x: 900, y: 300 }); eq(credLine()[0].text, T_BOTH, 'an icon under CC0 changes nothing');
        const full = fig.iconCredits({ full: true }); ok(full.includes('Test Author A. "Alpha disc". Test pack. https://doi.org/10.0000/zz.alpha (CC BY 4.0, adapted)') && /Gamma card by Test Author C/.test(full) && !/Gamma card 2/.test(full) && /credit not required/.test(full), 'the full credits (an icon by the title its author gave it): ' + full);
        ok(/\(CC BY 4\.0: https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/\)/.test(full), 'with the license and its link');
        // embedded with what is needed to credit it elsewhere
        { const d = scene.icons[TPK('beta')]; ok(d && d.pack === TP && d.packName === 'Test pack' && d.by === 'Test Author B' && d.doi === '10.0000/zz.beta' && d.src === 'https://example.org/zz-test/beta' && d.lic === 'CC BY 4.0' && d.req === true && typeof d.svg === 'string', 'scene.icons carries the credits: ' + short(d, 300));
          eq(scene.icons[TPK('gamma')].req, false, 'CC0: no credit asked'); ok(!USER[TPK('beta')] && !Object.keys(USER).some(k => k.startsWith(TP + ':')), 'a pack icon is not one of My icons'); }
        undo(); eq(credLine()[0].text, T_BOTH, 'undo (the CC0 icon)'); undo(); eq(credLine()[0].text, T_ALPHA, 'undo: the line follows'); redo(); eq(credLine()[0].text, T_BOTH, 'redo');
        { const s = await svgString({}); ok(s.includes('Icons: Alpha disc by Test Author A (doi:10.0000/zz.alpha), Beta peak by Test Author B'), 'the SVG export has the line as text'); ok(s.includes('#3a7bd5') && s.includes('#2e9e6b'), 'and the icons'); checkSvg(s, 'pack icons'); }
        ok(!fig.check().some(r => /attribution/.test(r.msg)), 'fig.check: nothing to remind of');
        // above the "Made with SiliCoDraw" line, in its look
        fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], objects: [creditObj(1600, 900)] }); fig.add('icon', { kind: TPK('alpha'), x: 400, y: 300 }); await settle();
        { const L = credLine()[0], bl = bbox(L.id), bc = bbox('credit'); ok(bl.y + bl.h <= bc.y + 1, 'stacked above the Made with line: ' + J([bl, bc])); eq([L.size, L.color, Math.round(L.x)], [12, '#9ca3af', 24], 'the same small muted look'); }
        // deleted: not put back for that repository, but fig.check, the Page panel and the Export dialog say so
        fig.remove(credLine()[0].id); eq(credLine().length, 0, 'deleted'); fig.add('icon', { kind: TPK('beta'), x: 600, y: 300 }); eq(credLine().length, 0, 'another icon of the same repository does not bring it back');
        { const ck = fig.check().filter(r => /attribution/.test(r.msg)); eq(ck.length, 1, 'fig.check reminds'); ok(/Test pack/.test(ck[0].msg) && /no credit line/.test(ck[0].msg) && ck[0].level === 'warn', ck[0].msg); }
        sel = new Set(); buildPanel(); ok(/Icon credits/i.test($q('#props').textContent) && /no credit line on the page/.test($q('#props').textContent) && [...$q('#props').querySelectorAll('button')].some(b => b.textContent === 'Copy full icon credits'), 'the Page panel says so, with Copy full icon credits');
        exportDialog(); await sleep(250); { const E = $q('#exCred'); ok(E && /ask for attribution/.test(E.textContent) && [...E.querySelectorAll('button')].some(b => b.textContent === 'Copy full icon credits'), 'the Export dialog reminds: ' + (E && E.textContent)); } closeModal();
        // an icon from a repository new to the slide brings a line back (here: one a figure embeds from a pack that is not installed)
        registerIcon('zz-other:x', { n: 'Other thing', t: 'other', svg: '<circle r="30" fill="#cc3333"/>', k: ['#cc3333'], c: ['#cc3333', '#cc3333'], pack: 'zz-other', packName: 'Other pack', lic: 'CC BY-SA 4.0', req: true });
        fig.add('icon', { kind: 'zz-other:x', x: 800, y: 300 }); eq(credLine().length, 1, 'a new repository: the line is back'); ok(/Other pack, CC BY-SA 4\.0/.test(credLine()[0].text) && /Alpha disc by Test Author A/.test(credLine()[0].text) && / · /.test(credLine()[0].text), 'for every repository on the slide: ' + credLine()[0].text);
        ok(!fig.check().some(r => /attribution/.test(r.msg)), 'no reminder any more');
        // changed by hand: plain text, left alone
        { const L = credLine()[0]; fig.update(L.id, { text: 'Icons by friends' }); await sleep(40); ok(!('iconCredit' in get(L.id)), 'edited by hand: plain text now'); fig.add('icon', { kind: TPK('alpha'), x: 900, y: 500 }); eq([get(L.id).text, credLine().length], ['Icons by friends', 0], 'and no longer rewritten');
          ok(!fig.check().some(r => /attribution/.test(r.msg)), 'a line named icon credits counts as the credit'); undo(); undo(); ok(get(L.id).iconCredit === true, 'undo brings the link back'); }
        // fig.iconCredits({add: true}) puts a deleted line back
        fig.remove(credLine()[0].id); eq(credLine().length, 0, 'deleted again'); fig.iconCredits({ add: true }); eq(credLine().length, 1, 'fig.iconCredits({add: true}) puts it back');
        // many creators: the repository alone on the page; a repository with one sentence for all
        { const m = n => ({ k: TPK(n), o: {}, m: { pack: TP, packName: 'Test pack', n, by: 'X', lic: 'CC BY 4.0', req: true } }); eq(iconCreditText(['a', 'b', 'c', 'd'].map(m)), 'Icons: Test pack (example.org), CC BY 4.0, adapted', 'more than three: the repository');
          eq(iconCreditText([{ k: 'zz-gen:x', o: {}, m: { pack: 'zz-gen', packName: 'General', n: 'X', credit: 'Images are from General (CC BY 4.0)', per: false, req: true } }]), 'Images are from General (CC BY 4.0)', 'a general credit in the repository\'s own words');
          eq(iconCreditText([{ k: TPK('p_53'), o: {}, m: { pack: TP, packName: 'Test pack', n: 'p_53 *', by: 'A', lic: 'CC BY 4.0', req: true } }]), 'Icons: p\\_53 \\* by A, example.org, CC BY 4.0, adapted', 'names are written as they are (no formatting)');
          eq(iconCreditText([{ k: 'zz-odd:x', o: {}, m: { pack: 'zz-odd', packName: 'Odd', n: 'X', by: 'A', lic: '{#ff0000|LIC} **b**', per: true, req: true } }]), 'Icons: X by A, Odd, \\{#ff0000|LIC} \\*\\*b\\*\\*', 'nor does a license format the line'); }
        // Convert to editable parts and Fuse keep the need for the credit
        blank(); const e = fig.add('icon', { kind: TPK('alpha'), x: 400, y: 300 }); fig.select([e]); explodeSel(); { const parts = scene.objects.filter(o => o.from === TPK('alpha')); ok(parts.length >= 2 && parts.every(p => p.type === 'path'), 'parts: ' + parts.length);
          eq([credLine().length, credLine()[0] && credLine()[0].text], [1, T_ALPHA], 'the parts still ask for the credit'); ok(scene.iconAtt && scene.iconAtt[TPK('alpha')] && scene.iconAtt[TPK('alpha')].by === 'Test Author A' && !scene.icons, 'their credits travel in the figure (iconAtt)');
          fig.select(parts.map(p => p.id)); await fuseSel(false); const cu = scene.objects.find(o => o.type === 'custom'); ok(cu && J(cu.att) === J([TPK('alpha')]), 'fused: the element names the icon'); eq([credLine().length, credLine()[0].text], [1, T_ALPHA], 'and the line stays');
          fig.remove(cu.id); eq(credLine().length, 0, 'nothing left to credit: the line goes'); ok(!scene.iconAtt, 'and the credits'); }
        // a copy on another slide is credited there; each slide has its own line
        blank(); const p1 = fig.add('icon', { kind: TPK('alpha'), x: 400, y: 300 }); fig.addSlide({}); eq(credLine().length, 0, 'a new slide: no line'); fig.add('icon', { kind: TPK('beta'), x: 400, y: 300 });
        eq(credLine().length, 1, 'its own line'); ok(/Beta peak/.test(credLine()[0].text) && !/Alpha/.test(credLine()[0].text), 'for its own icons: ' + credLine()[0].text); fig.slide(1); eq(credLine()[0].text, T_ALPHA, 'the first slide keeps its own');
        copySel.tip = 1; fig.select([p1]); copySel(); fig.addSlide({}); pasteClip(clip); eq(credLine().length, 1, 'pasted on a third slide: credited there'); eq(credLine()[0].text, T_ALPHA, 'its text');
      } finally { try { closeModal(); } catch (e) {} unslide(); blank(); await dropPack(); }
    }, 180000);

    test('icon packs: hidden icons, long lines, other slides, copies, other tabs, ids, what a figure may bring', async () => {
      let cp = null;
      try {
        await usePack(true); blank();
        // hidden and shown again: the line comes back (the editor took it away itself); a line the user deleted stays away
        const a = fig.add('icon', { kind: TPK('alpha'), x: 300, y: 300 }); eq(credLine().length, 1, 'the line');
        fig.update(a, { hidden: true }); eq(credLine().length, 0, 'the icon hidden: no line'); ok(!fig.check().some(r => /attribution/.test(r.msg)), 'and nothing to remind of');
        fig.update(a, { hidden: false }); eq([credLine().length, credLine()[0] && credLine()[0].text], [1, T_ALPHA], 'shown again: the line is back');
        fig.remove(credLine()[0].id); fig.update(a, { hidden: true }); fig.update(a, { hidden: false }); eq(credLine().length, 0, 'a line the user deleted is not put back by hiding and showing'); ok(fig.check().some(r => /no credit line/.test(r.msg)), 'fig.check reminds');
        // a line that gets longer stays on the page: wrapped, growing upward
        fig.set({ version: 4, w: 700, h: 500, bg: '#ffffff', palette: [], objects: [] }); fig.add('icon', { kind: TPK('alpha'), x: 200, y: 200 }); await settle(); const y1 = credLine()[0].y;
        fig.add('icon', { kind: TPK('beta'), x: 400, y: 200 }); await settle();
        { const L = credLine()[0], b = bbox(L.id); eq(L.text, T_BOTH, 'both creators'); ok(L.boxW > 0 && b.x >= 0 && b.x + b.w <= scene.w + 1 && b.y + b.h <= scene.h + 1, 'wrapped inside the page: ' + J([L.boxW, b])); ok(L.y < y1, 'grown upward: ' + J([y1, L.y])); ok(!fig.check().some(r => /outside the page/.test(r.msg)), 'no warning');
          fig.update(L.id, { boxW: 0, x: 420 }); ok(fig.check().some(r => r.id === L.id && /outside the page/.test(r.msg)), 'fig.check names a credit line that runs off the page'); }
        // more than three icons credited one by one: the page line names the repository; fig.check and the Page panel say that the creators still need their credit
        blank(); for (let i = 1; i <= 4; i++) { registerIcon(TPK('more' + i), { n: 'More ' + i, t: 'more', svg: '<circle r="30" fill="#cc3333"/>', k: ['#cc3333'], c: ['#cc3333', '#cc3333'], pack: TP, by: 'Author ' + i, doi: '10.0000/zz.m' + i, lic: 'CC BY 4.0' }); fig.add('icon', { kind: TPK('more' + i), x: 150 * i, y: 300 }); }
        eq(credLine()[0].text, 'Icons: Test pack (example.org), CC BY 4.0, adapted', 'four: the repository alone'); ok(fig.check().some(r => r.level === 'info' && /names only the repository/.test(r.msg)), 'fig.check says so');
        sel = new Set(); buildPanel(); ok(/names only the repository/.test($q('#props').textContent) && !/are credited by the line/.test($q('#props').textContent), 'and the Page panel: ' + $q('#props').textContent.slice(-300));
        ok(/Author 4\. "More 4"\. Test pack\. https:\/\/doi\.org\/10\.0000\/zz\.m4 \(CC BY 4\.0, adapted\)/.test(fig.iconCredits({ full: true })), 'the full credits have every one');
        // ids inside an icon are its own wherever it is drawn (the icon on the canvas lost its gradient when the Add panel, with its thumbnail, was hidden)
        blank(); const g = fig.add('icon', { kind: TPK('gamma'), x: 400, y: 300 }); await settle(); $q('#palSearch').value = 'zzgamma'; buildPalette(); await sleep(300);
        { const G = D.querySelector('#content [data-id="' + g + '"]'), r = G.querySelector('rect[fill^="url(#"]'), id = r.getAttribute('fill').slice(5, -1); ok(G.contains(D.getElementById(id)), 'the icon on the canvas paints from its own gradient (' + id + ')');
          ok(!thumbOf('icon', { kind: TPK('gamma') }).includes('id="' + id + '"') && /linearGradient id="xzzg1-/.test(thumbOf('icon', { kind: TPK('gamma') })), 'a thumbnail has ids of its own');
          const ids = {}; D.querySelectorAll('[id]').forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; }); eq(Object.keys(ids).filter(k => ids[k] > 1), [], 'no id twice in the page'); const s = await svgString({}); ok(s.includes('url(#' + id + ')') && s.includes('id="' + id + '"'), 'and the export is whole'); }
        $q('#palSearch').value = ''; buildPalette();
        // an export right after placing an icon whose part has not come yet waits for it (no placeholder); fig.iconsReady() says when
        blank(); await packRemove(TP); PACKS.state[TP] = { imported: true, date: '2026-01-01', version: '1' }; await packNames(TP); packPalette(); ok(ICONS[TPK('beta')].stub, 'only its name is known');
        const sb = fig.add('icon', { kind: TPK('beta'), x: 400, y: 300 }); ok(fig.check([sb]).some(r => /still loading/.test(r.msg)), 'fig.check says that it is still loading');
        { const s = await svgString({}); ok(!s.includes('stroke-dasharray="6 7"') && s.includes('#2e9e6b'), 'the export has the drawing, not the placeholder'); ok(scene.icons && scene.icons[TPK('beta')], 'and the figure embeds it'); } eq(await fig.iconsReady(), [], 'fig.iconsReady()');
        // a figure's own copy never takes the place of a library icon or its credits: not in a thumbnail of a file nobody opened, not when it is opened
        blank(); await packRemove(TP); PACKS.state[TP] = { imported: true, date: '2026-01-01', version: '1' }; await packNames(TP); packPalette();
        { const fake = { version: 4, w: 400, h: 300, bg: '#ffffff', icons: { [TPK('alpha')]: { n: 'Alpha disc', t: '', svg: '<rect x="-40" y="-40" width="80" height="80" fill="#ff0000"/>', k: [], c: ['#ff0000', '#ff0000'], pack: TP, packName: 'Test pack', lic: 'CC0 1.0', req: false } }, objects: [{ id: 'i1', type: 'icon', kind: TPK('alpha'), x: 200, y: 150, s: 1, r: 0, size: 100 }] };
          const th = sceneSvg(fake, 160, 90); ok(th.includes('#ff0000'), 'the thumbnail draws the file\'s own copy'); ok(ICONS[TPK('alpha')].stub, 'and the library entry is untouched');
          fig.set(fake); eq(await fig.iconsReady(), [], 'opened'); await settle(); ok(ICONS[TPK('alpha')].lib && ICONS[TPK('alpha')].def.svg.includes('#3a7bd5'), 'the library icon is the pack\'s'); ok(D.querySelector('#content [data-id="i1"] circle[fill="#3a7bd5"]'), 'drawn as the pack has it');
          commit(); eq([credLine().length, credLine()[0] && credLine()[0].text], [1, T_ALPHA], 'credited as the pack says with the next change (the copy said: no credit)'); eq(scene.icons[TPK('alpha')].req, true, 'and embedded with the pack\'s credits'); }
        // an import that was canceled leaves nothing to place
        blank(); await packRemove(TP); { let err = ''; try { await packImport(TP, { accept: true, stop: () => true }); } catch (e) { err = e.message; } eq(err, 'canceled', 'canceled'); ok(!packImported(TP) && !ICONS[TPK('alpha')], 'nothing of it stays registered');
          err = ''; try { fig.add('icon', { kind: TPK('alpha') }); } catch (e) { err = e.message; } ok(/not imported here/.test(err), 'fig.add refuses: ' + err); }
        // what another tab imported meanwhile stays in the file when this tab imports or removes a pack
        { const rd = async () => (await fetch('assets/icon-packs.json?t=' + Date.now(), { cache: 'no-store' })).json(), st = await rd(); st['zz-elsewhere'] = { imported: true, date: '2026-01-02', version: '7' }; await fetch('assets/icon-packs.json', { method: 'POST', body: J(st) });
          await fig.importIconPack(TP, { accept: true }); let f = await rd(); ok(f[TP] && f['zz-elsewhere'] && f['zz-elsewhere'].version === '7', 'import: the other tab\'s pack is still noted: ' + J(Object.keys(f)));
          await packRemove(TP); f = await rd(); ok(!f[TP] && f['zz-elsewhere'], 'remove: too'); delete PACKS.state['zz-elsewhere']; await packSaveState(); ok(!(await rd())['zz-elsewhere'], '(tidied up)'); await fig.importIconPack(TP, { accept: true }); }
        // nothing found while a source is unticked: the message says so and offers all sources
        fig.showIconPacks({ [TP]: false }); $q('#palSearch').value = 'zzalpha'; buildPalette(); await sleep(60);
        { const b = $q('#palShowAll'); ok(b && /1 in sources that are hidden/.test($q('#palList').textContent), 'a hidden source has it: ' + $q('#palList').textContent); b.click(); await sleep(60); eq(D.querySelectorAll('#palList .pitem').length, 1, 'Show all sources brings it'); } $q('#palSearch').value = ''; buildPalette();
        // slides: a line made on a slide that is not shown does not land on the Made with line; the reminders cover every slide
        fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], slides: [1, 2].map(i => ({ id: 's' + i, objects: [creditObj(1600, 900), { id: 'ic' + i, type: 'icon', kind: TPK(i === 1 ? 'alpha' : 'beta'), x: 400, y: 300, s: 1, r: 0, size: 120 }] })) }); await settle(); fig.add('shape', { x: 800, y: 300 }); await settle();
        { const S = fig.get({ slides: true }).slides, l1 = S[0].objects.find(o => o.iconCredit === true), l2 = S[1].objects.find(o => o.iconCredit === true), c2 = S[1].objects.find(o => o.id === 'credit'); ok(l1 && l2, 'a line on both slides'); ok(l2.y <= c2.y - c2.size, 'on the slide that is not shown it sits above the Made with line: ' + J([l2.y, c2.y]));
          fig.slide(2); await settle();
          // the glyphs' own box in page px (getBBox): Firefox widens getBoundingClientRect of a text by a few screen px on every side, which bbox() then shows as an overlap of lines that are apart
          const tb = id => { const t = D.querySelector('#content [data-id="' + id + '"] text'), r = t.getBBox(), M = svg.getScreenCTM().inverse().multiply(t.getScreenCTM()), p = new DOMPoint(r.x, r.y).matrixTransform(M), q = new DOMPoint(r.x + r.width, r.y + r.height).matrixTransform(M); return { x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y }; };
          const bl = tb(l2.id), bc = tb('credit'); ok(bl.y + bl.h <= bc.y, 'measured there: no overlap ' + J([bl, bc])); fig.remove(l2.id); fig.slide(1); await settle(); }
        eq(fig.check({ slides: true }).filter(r => /no credit line/.test(r.msg)).map(r => r.slide), [2], 'fig.check({slides: true}) names the slide without a line');
        exportDialog(); await sleep(250); { const E = () => $q('#exCred').textContent, SL = $q('#exSl'), set = v => { SL.value = v; SL.dispatchEvent(new Event('input', { bubbles: true })); }; set('all'); ok(/Slide 2 uses icons from Test pack/.test(E()), 'the Export dialog, all slides: ' + E());
          set([...SL.options].map(o => o.value).find(v => v !== 'all')); ok(/are credited by the line on the page/.test(E()), 'only this slide: credited: ' + E()); } closeModal(); unslide();
        // parts of a converted icon carry their credit on the clipboard (pasted below, where the pack is not installed)
        blank(); { const e = fig.add('icon', { kind: TPK('alpha'), x: 400, y: 300 }); fig.select([e]); explodeSel(); fig.select(scene.objects.filter(o => o.from === TPK('alpha')).map(o => o.id)); copySel.tip = 1; copySel(); cp = JSON.parse(J(clip)); ok(cp.length >= 2 && cp.every(o => o.attRefs && o.attRefs[TPK('alpha')] && o.attRefs[TPK('alpha')].by === 'Test Author A'), 'the copy carries the credits'); }
        // a pack's links are http(s) only; a drawing brings neither a style sheet nor anything from another host
        { packDefine({ id: 'zz-evil', name: 'Evil', url: 'javascript:alert(1)', licenseUrl: 'data:text/html,x', askFrom: 'javascript:1', ask: 'x', license: 'L' }, packDir); packDialog('zz-evil'); const as = [...$q('#modalBox').querySelectorAll('a')].map(x => x.getAttribute('href')); ok(as.length && !as.some(h => /^(javascript|data):/i.test(h)), 'links: ' + J(as)); closeModal(); PACKS.by.delete('zz-evil'); PACKS.list.splice(PACKS.list.findIndex(p => p.id === 'zz-evil'), 1); packBar(); }
        { const s = svgScrub('<style>#topbar{outline:5px solid red}</style><image href="http://example.org/x.png" width="10" height="10"/><image href="assets/x.png" width="10" height="10"/><use href="#a"/><rect id="a" fill="url(http://example.org/p.svg#g)" width="4" height="4"/><circle r="3" fill="url(#g)"/>');
          ok(!/<style/i.test(s) && !/example\.org/.test(s), 'svgScrub: no style sheet, nothing from another host: ' + s); ok(s.includes('href="assets/x.png"') && s.includes('href="#a"') && s.includes('url(#g)'), 'what points into the drawing or this folder stays: ' + s); }
        // the list of packs closes with a press outside it; after Remove from library the keyboard is on the pack's row
        packMenu(true); ok(!$q('#packMenu').hidden && $q('#palette').classList.contains('pk-open'), 'the list is open'); $q('#stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); ok($q('#packMenu').hidden && !$q('#palette').classList.contains('pk-open'), 'a press on the canvas closes it');
        packMenu(true); { const row = $q('#packMenu .pkrow[data-id="' + TP + '"]'); row.focus(); row.click(); await sleep(50); $q('#pkRm').click(); for (let i = 0; i < 60 && (packImported(TP) || !$q('#modal').hidden); i++) await sleep(50); await sleep(100); const af = D.activeElement; ok(af && af.classList.contains('pkrow') && af.dataset.id === TP, 'the focus after Remove: ' + (af && (af.id || af.className || af.tagName))); packMenu(false); }
        // and the copied parts, where the pack is unknown: their credit is in the figure, with its line
        blank(); await dropPack(); ok(!PACKS.by.has(TP) && !ICONS[TPK('alpha')], 'the pack is unknown now'); pasteClip(cp); await settle();
        ok(scene.iconAtt && scene.iconAtt[TPK('alpha')] && scene.iconAtt[TPK('alpha')].by === 'Test Author A', 'pasted: the credits are in the figure'); eq([credLine().length, credLine()[0] && credLine()[0].text], [1, T_ALPHA], 'and the line is there'); ok(/Test Author A/.test(fig.iconCredits({ full: true })), 'fig.iconCredits({full: true})'); ok(!scene.objects.some(o => 'attRefs' in o), 'nothing of the clipboard\'s own fields stays on the elements');
      } finally { try { closeModal(); } catch (e) {} try { $q('#palSearch').value = ''; palState.cat = 'All'; packMenu(false); } catch (e) {} unslide(); blank(); await dropPack(); }
    }, 240000);

    test('icon packs: a figure opens where the pack is not installed', async () => {
      try {
        await usePack(true); blank(); const a = fig.add('icon', { kind: TPK('alpha'), x: 400, y: 300, c1: '#112233' }); const g = fig.add('icon', { kind: TPK('gamma'), x: 700, y: 300 }); await settle(); commit();
        const text = J(fig.get()), line = credLine()[0].id; ok(text.includes('"packName":"Test pack"'), 'the figure names the pack');
        blank(); await dropPack(); ok(!ICONS[TPK('alpha')] && !PACKS.by.has(TP), 'the pack is unknown here');
        let err = ''; try { fig.add('icon', { kind: TPK('alpha') }); } catch (e) { err = e.message; } ok(err || fig.check().some(r => /does not exist/.test(r.msg)), 'an icon of an unknown pack is refused or reported'); blank();
        fig.set(JSON.parse(text)); await settle();
        ok(ICONS[TPK('alpha')] && ICONS[TPK('alpha')].pack === TP && !ICONS[TPK('alpha')].stub, 'registered from the figure'); ok(!USER[TPK('alpha')], 'not added to My icons');
        ok(D.querySelector('#content [data-id="' + a + '"] circle[fill="#112233"]'), 'drawn, in the color it was given'); ok(D.querySelector('#content [data-id="' + g + '"] rect[fill="#8e44ad"]'), 'the other one too');
        eq(get(line).text, T_ALPHA, 'the credit line reads the same'); commit(); eq(J(fig.get()), text, 'opening it changed nothing');
        ok(!PALETTE.some(s => s[2] && s[2].pack === TP) && !fig.findIcon('zzalpha').some(x => x.kind === TPK('alpha')), 'the pack is not offered in the Add panel');
        fig.select([a]); buildPanel(); { const s = [...$q('#props').querySelectorAll('select')].find(x => x.value === TPK('alpha')); ok(s && /Alpha disc \(Test pack\)/.test(s.selectedOptions[0].textContent), 'the properties panel names it'); }
        fig.update(a, { c1: '#00aa55' }); ok(D.querySelector('#content [data-id="' + a + '"] circle[fill="#00aa55"]'), 'recolored like an own icon');
        const s = await svgString({}); ok(s.includes('Icons: Alpha disc by Test Author A') && s.includes('#00aa55'), 'exported with its credit');
        await checkPng(400, 'pack icons'); await checkPdf('pack icons');
      } finally { blank(); await dropPack(); }
    }, 120000);

    // --- color groups of icons (grpOf, the grp field, "Colors in this icon"): a shaded drawing of the test pack's own (red body in four shades, a blue part in two, outline ink, white highlights) ---
    const SHK = TPK('zzshade'), SHADE = { n: 'Shaded test', t: 'zzshade', pack: TP, svg: '<path d="M-40-30h80v60h-80z" fill="#c0392b"/><path d="M-36-26h30v20h-30z" fill="#e06656"/><path d="M6-4h28v26h-28z" fill="#922b21"/><path d="M-30 6h14v14h-14z" fill="#d9483a"/>' +
      '<rect x="-6" y="-26" width="40" height="18" fill="#2471a3"/><rect x="0" y="-22" width="20" height="8" fill="#5dade2"/><circle cx="-22" cy="-16" r="3" fill="#ffffff"/><circle cx="-14" cy="-12" r="2" fill="#fdfdfd"/>' +
      '<path d="M-40-30h80v60h-80z" fill="none" stroke="#222222" stroke-width="1.5"/>', k: ['#c0392b', '#2471a3'], c: ['#c0392b', '#2471a3'], b: [82, 62], lic: 'CC0 1.0' };
    const shadeIcon = () => { registerIcon(SHK, JSON.parse(J(SHADE))); GRP_MEMO.delete(SHK); return SHK; };
    const rowOf = t => [...D.querySelectorAll('#props .row')].find(r => (r.querySelector('span') || {}).textContent === t);
    const node = id => D.querySelector('#content>[data-id="' + id + '"]');

    test('icon colors: OKLab and OKLCH, keeping the differences, gamut, gray, deterministic groups', async () => {
      // round trips: every 6th step of each channel, and some colors of the packs
      let bad = [], n = 0; for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 13) { const h = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''), q = hexOklch(h), back = oklchHex(q[0], q[1], q[2]); n++; if (back !== h) bad.push(h + '→' + back); }
      eq(bad.slice(0, 5), [], 'hex → OKLCH → hex (' + n + ' colors)');
      { const [L, a, b] = hexOklab('#ffffff'); near(L, 1, 1e-4, 'white L'); near(Math.hypot(a, b), 0, 1e-4, 'white is gray'); near(hexOklab('#000000')[0], 0, 1e-6, 'black L'); const r = hexOklab('#ff0000'); near(r[0], .628, .002, 'red L (reference value)'); near(r[1], .2249, .002, 'red a'); near(r[2], .1258, .002, 'red b'); }
      // a group's shades keep their difference to the color that changes
      const shades = ['#c0392b', '#e06656', '#922b21', '#d9483a', '#f1a59a'], ref = '#c0392b';
      for (const n0 of ['#2a6fdb', '#1e9e57', '#e0a100', '#7a3fb0']) {
        const R = hexOklch(ref), N = hexOklch(n0);
        for (const x of shades) { const X = hexOklch(x), Y = hexOklch(grpShift(x, ref, n0)); if (x === ref) { eq(grpShift(x, ref, n0), n0, 'the color that changes becomes the new one'); continue; }
          const dh = a => Math.atan2(Math.sin(a), Math.cos(a)); near(dh(Y[2] - N[2]), dh(X[2] - R[2]), .09, 'hue offset kept (' + x + ' → ' + n0 + ')');
          ok(Math.sign(Y[0] - N[0]) === Math.sign(X[0] - R[0]), 'lighter stays lighter, darker darker (' + x + ' → ' + n0 + ')'); }
        const Ls = shades.map(x => hexOklch(grpShift(x, ref, n0))[0]), L0 = shades.map(x => hexOklch(x)[0]); const ord = a => a.map((v, i) => i).sort((i, j) => a[i] - a[j]).join(); eq(ord(Ls), ord(L0), 'the order of the shades by lightness (' + n0 + ')');
      }
      { const X = hexOklch('#e06656'), R = hexOklch(ref), Y = hexOklch(grpShift('#e06656', ref, '#b04050')), N = hexOklch('#b04050'); near(Y[1] / N[1], X[1] / R[1], .06, 'chroma by the same ratio (in gamut)'); }
      // gamut: a very saturated new color: every shade fits sRGB, the lightness order stays
      { const out = shades.map(x => grpShift(x, ref, '#00ff00')); ok(out.every(h => /^#[0-9a-f]{6}$/.test(h)), 'in gamut: ' + J(out)); const L = out.map(h => hexOklch(h)[0]), L0 = shades.map(x => hexOklch(x)[0]); for (let i = 0; i < L.length; i++) for (let j = 0; j < L.length; j++) if (L0[i] < L0[j] - .01) ok(L[i] < L[j] + 1e-3, 'clamped: lightness order kept ' + J(out)); }
      // gray: a gray new color keeps the lightness steps; a gray group's colored member keeps its own hue
      { const out = shades.map(x => grpShift(x, ref, '#777777')); ok(out.every(h => hexOklch(h)[1] < .03), 'a gray for a colored group: every shade gray ' + J(out)); eq(new Set(out).size, shades.length, 'the steps stay apart'); }
      { const y = grpShift('#5577aa', '#888888', '#cc3333'), Y = hexOklch(y), N = hexOklch('#cc3333'); near(Math.atan2(Math.sin(Y[2] - N[2]), Math.cos(Y[2] - N[2])), 0, .15, 'a gray main: its colored member takes the new hue (no hue to keep an offset from)');
        for (const [x, n0] of [['#8a8070', '#2060d0'], ['#7a8494', '#d02020']]) { const Z = hexOklch(grpShift(x, '#808080', n0)), M = hexOklch(n0); near(Math.atan2(Math.sin(Z[2] - M[2]), Math.cos(Z[2] - M[2])), 0, .2, 'a tinted gray in a gray group follows the new color (' + x + ' → ' + n0 + ')'); }
        { const a = hexOklab(grpShift('#049882', '#c7dbd5', '#ea580c')), b = hexOklab(grpShift('#049882', '#c4dcd5', '#ea580c')); ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < .03, 'two mains that look the same (chroma .023 / .027) give nearly the same shade: no jump at the gray threshold'); } ok(hexOklch(grpShift('#999999', '#888888', '#cc3333'))[1] > .1, 'and a gray member takes the new color'); }
      // groups: deterministic, the materials apart, ink and white last
      await usePack(false); const k = shadeIcon(); const G1 = J(grpOf(k).groups); GRP_MEMO.delete(k); const G2 = J(grpOf(k).groups); eq(G2, G1, 'the same groups twice');
      const G = grpOf(k); eq(G.groups.map(g => g.kind).sort(), ['color', 'color', 'ink', 'white'], 'red, blue, then highlights and outline: ' + J(G.groups.map(g => [g.main, g.kind, g.members]))); ok(G.groups.slice(2).every(g => g.kind !== 'color'), 'outline and highlights listed last');
      eq(G.groups[0].main, '#c0392b', 'the largest group\'s main color is its largest member'); eq(G.groups[0].members.slice().sort(), ['#922b21', '#c0392b', '#d9483a', '#e06656'], 'the red shades are one group');
      eq(G.groups[1].members.slice().sort(), ['#2471a3', '#5dade2'], 'the blue part another'); ok(G.groups[0].share > G.groups[1].share && Math.abs(G.groups.reduce((s, g) => s + g.share, 0) - 1) < 1e-6, 'shares by area');
      eq(G.groups[0].shades, ['#922b21', '#c0392b', '#d9483a', '#e06656'], 'shades from dark to light');
      // a flat two-color icon: two groups; a gradient's stops count
      { const g = grpOf(TPK('alpha')); ok(!g || g.groups.length === 2, 'two colors, two groups'); }
      { registerIcon(TPK('zzgrad'), { n: 'g', pack: TP, svg: '<defs><linearGradient id="q1" gradientUnits="userSpaceOnUse" x1="-40" y1="0" x2="40" y2="0"><stop offset="0" stop-color="#1d4e89"/><stop offset="1" stop-color="#5b9bd5"/></linearGradient></defs><rect x="-40" y="-40" width="80" height="80" fill="url(#q1)"/>', k: [], c: ['#1d4e89', '#5b9bd5'] });
        const g = grpOf(TPK('zzgrad')), sh = c => g.groups.filter(q => q.members.includes(c)).reduce((s, q) => s + q.share / q.members.length, 0); ok(g && g.by.has('#1d4e89') && g.by.has('#5b9bd5'), 'a gradient: its stops are colors of the drawing ' + J(g && g.groups)); ok(sh('#1d4e89') > .3 && sh('#5b9bd5') > .3 && Math.abs(g.groups.reduce((s, q) => s + q.share, 0) - 1) < 1e-6, 'each with its share of what the gradient covers'); delete ICONS[TPK('zzgrad')]; }
      // what grouping must not do: a dark gray beside a material is that material, a clear color is not folded into gray, a far tiny color stays apart;
      // colors only a mask, clip path or filter uses are no group and are never recolored; a <use> circle ends at once
      { const K = TPK('zzmat'); registerIcon(K, { n: 'm', pack: TP, svg: '<rect x="-40" y="-40" width="80" height="50" fill="#474747"/><rect x="-40" y="10" width="80" height="30" fill="#343434"/><circle r="6" fill="#000000"/>', k: [], c: ['#474747', '#343434'] });
        const g = grpOf(K); ok(g.by.get('#343434') === g.by.get('#474747') && g.groups[g.by.get('#474747')].kind === 'color', 'a dark gray right beside a gray material is the same material ' + J(g.groups.map(q => [q.main, q.kind, q.members]))); delete ICONS[K]; }
      { const K = TPK('zzcross'); registerIcon(K, { n: 'x', pack: TP, svg: '<rect x="-40" y="-40" width="80" height="80" fill="#e5e5e5"/><circle r="5" fill="#007cf3"/><circle cx="20" r="3" fill="#11c0c9"/>', k: [], c: ['#e5e5e5', '#007cf3'] });
        const g = grpOf(K); ok(g.by.get('#007cf3') !== g.by.get('#e5e5e5') && g.by.get('#11c0c9') !== g.by.get('#e5e5e5'), 'a small clear blue in a gray cell is not folded into the gray ' + J(g.groups.map(q => q.members))); delete ICONS[K]; }
      { const K = TPK('zzmask'); registerIcon(K, { n: 'k', pack: TP, svg: '<defs><linearGradient id="mg" gradientUnits="userSpaceOnUse" x1="-40" x2="40"><stop offset="0" stop-color="#000000"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient><mask id="mk" maskUnits="userSpaceOnUse"><rect x="-50" y="-50" width="100" height="100" fill="url(#mg)"/><circle r="2"/></mask></defs><g mask="url(#mk)"><rect x="-40" y="-40" width="80" height="80" fill="#e1c48f"/><circle r="20"/></g>', k: [], c: ['#e1c48f', '#000000'] });
        const g = grpOf(K); ok(!g.by.has('#ffffff'), 'a color only a mask uses is no group ' + J(g.groups.map(q => q.members)));
        const out = grpApply(g.svg, new Map([['#e1c48f', '#3050c0'], ['#000000', '#ff00ff'], ['#ffffff', '#00ff00']]), g.black); ok(out.includes('stop-color="#ffffff"') && out.includes('stop-color="#000000"') && out.includes('fill="#3050c0"'), 'recoloring leaves the mask and its gradient alone ' + out); ok(/<mask fill="#000000"/.test(out) && /^<g fill="#ff00ff">/.test(out), 'an unfilled shape takes the new black, a mask\'s own contents stay black'); delete ICONS[K]; }
      { const s = '<g id="a"><path d="M0 0h10v10z"/><use href="#b"/><use href="#b"/><use href="#b"/></g><g id="b"><use href="#a"/><use href="#a"/><use href="#a"/></g>', t0 = performance.now(), R = grpPaint(s, null); ok(performance.now() - t0 < 500 && (!R || R.shapes < 1000), '<use> going round in a circle: done at once (' + Math.round(performance.now() - t0) + ' ms, ' + (R && R.shapes) + ' shapes)'); }
      await dropPack();
    }, 120000);

    test('icon colors: the grp field, drawing, panel, highlight, undo, check, save, copies, exports', async () => {
      try {
        await usePack(true); blank(); const k = shadeIcon(), G = grpOf(k);
        // old files: an element without grp draws exactly as before (c1 / c2 through the color keys)
        const id = fig.add('icon', { kind: k, x: 400, y: 300, size: 200 }); await settle(); const ic = ICONS[k];
        const asMade = node(id).innerHTML, ser = s => { const g = D.createElementNS('http://www.w3.org/2000/svg', 'g'); g.innerHTML = s; return g.innerHTML; }; ok(asMade.includes(ser(iconIds(recolorSvg(ic.def.svg, ic.def.k, ic.c[0], ic.c[1], ic.def.kt, ic.c), get(id)))), 'without grp: the drawing recolorSvg makes, as before');
        fig.update(id, { c1: '#22aa44' }); const oldWay = node(id).innerHTML; ok(oldWay.includes('fill="#22aa44"') && oldWay.includes('fill="#e06656"'), 'without grp: c1 changes only the color key (as before)'); fig.update(id, { c1: ic.c[0] });
        // grp {} with the group colors as made: the same drawing, byte for byte
        fig.update(id, { grp: {}, c1: G.groups[0].main, c2: G.groups[1].main }); eq(node(id).innerHTML, asMade, 'grp with every group at its own color: drawn exactly as made');
        // the API: groups, a color per group, One color, Reset
        const ci = fig.iconColors(id); eq([ci.mode, ci.groups.length, ci.groups[0].field, ci.groups[2].field], ['groups', 4, 'c1', 'grp'], 'fig.iconColors lists the groups');
        fig.iconColors(id, { '#c0392b': '#2a6fdb' }); let o = get(id); eq(o.c1, '#2a6fdb', 'the largest group is c1'); eq(o.grp['#c0392b'], '#2a6fdb', 'and is in grp by its main color');
        let h = node(id).innerHTML; ok(h.includes('fill="#2a6fdb"') && !/fill="#(c0392b|e06656|922b21|d9483a)"/.test(h), 'every red shade follows'); ok(h.includes('fill="#2471a3"') && h.includes('stroke="#222222"'), 'the other groups stay');
        fig.iconColors(id, { [G.groups.findIndex(g => g.kind === 'ink') + 1]: '#aa0000' }); o = get(id); eq(o.grp['#222222'], '#aa0000', 'a third or later group goes into grp by its main color'); ok(node(id).innerHTML.includes('stroke="#aa0000"'), 'the outline is recolored');
        let err = ''; try { fig.iconColors(id, { '#123456': '#000' }); } catch (e) { err = e.message; } ok(/no group/.test(err) && /#c0392b/.test(err), 'an unknown group is refused: ' + err);
        fig.iconColors(id, '#1e9e57'); o = get(id); eq(o.c1, '#1e9e57', 'One color: the largest group takes it'); ok(Math.abs(hexOklch(o.c2)[2] - hexOklch('#1e9e57')[2]) < .05, 'the others the same hue at their own lightness ' + J(o)); ok(!o.grp['#222222'] && !o.grp['#ffffff'], 'outline ink and white highlights stay as made ' + J(o.grp));
        fig.iconColors(id, null); o = get(id); ok(!('grp' in o) && o.c1 === ic.c[0] && o.c2 === ic.c[1], 'Reset: no grp, the library colors'); eq(node(id).innerHTML, asMade, 'drawn as made again');
        // fig.update / fig.check: a bad group key, a value that is no color; the file's repairs
        let w = fig.update(id, { grp: { '#123456': '#ff0000', '#ffffff': 'nope' } }); ok(w.some(r => /#123456 is not a color of this icon/.test(r.msg) && /did you mean/.test(r.msg)), 'fig.update names a key that is no color of the icon: ' + J(w)); ok(!('#ffffff' in get(id).grp), 'a value that is no color is dropped');
        ok(fig.check([id]).some(r => /grp: #123456/.test(r.msg)), 'fig.check names it too'); w = fig.update(id, { grp: { '#2471a3': '#ff0000' } }); ok(!w.length && node(id).innerHTML.includes('fill="#ff0000"'), 'a key of group 2 colors group 2 ' + J(w));
        fig.update(id, { grp: null }); ok(!('grp' in get(id)), 'grp: null takes it off');
        { const s = { version: 4, w: 800, h: 600, bg: '#ffffff', objects: [{ id: 'g1', type: 'icon', kind: k, x: 100, y: 100, s: 1, r: 0, size: 100, c1: '#c0392b', c2: '#2471a3', grp: { '#FFFFFF': '#00f', '#222222': 7 } }, { id: 'g2', type: 'icon', kind: k, x: 300, y: 100, s: 1, r: 0, size: 100, grp: ['x'] }] };
          scrubObj(s.objects[0]); scrubObj(s.objects[1]); eq(s.objects[0].grp, { '#ffffff': '#0000ff' }, 'read from a file: keys lowercased, a short value spelled out, a number dropped'); ok(!('grp' in s.objects[1]), 'a grp that is no object is dropped'); }
        ok(fig.schema('icon').fields.some(f => f.key === 'grp'), 'fig.schema lists grp');
        // the panel: a swatch per group, the c1 / c2 fields stand aside
        blank(); const a = fig.add('icon', { kind: k, x: 400, y: 300, size: 200 }); fig.select([a]); await settle(); const P = $q('#props');
        const sw = () => [...P.querySelectorAll('.grpsw')], big = G.groups.filter(g => g.share >= GRP_K.tiny).length; ok(big < 4, 'the test icon has a group too small to see'); eq(sw().length, big, 'a swatch per group big enough to see');
        { const m = [...P.querySelectorAll('.grprow .grplink')].find(x => /^More/.test(x.textContent)); ok(m && m.textContent === 'More (' + (4 - big) + ')', 'the tiny ones behind More'); m.click(); eq(sw().length, 4, 'More shows every group'); [...P.querySelectorAll('.grprow .grplink')].find(x => x.textContent === 'Fewer').click(); eq(sw().length, big, 'Fewer'); } ok(!rowOf('main color') && !rowOf('accent color'), 'no main / accent color fields beside it');
        ok(sw().every(b => b.getAttribute('aria-label') && b.title), 'each swatch has a name'); ok(/Color 1: #c0392b/.test(sw()[0].getAttribute('aria-label')) && /Outline/.test(sw()[G.groups.findIndex(g => g.kind === 'ink')].getAttribute('aria-label')), 'named by kind');
        eq(sw()[0].querySelectorAll('s').length, 4, 'a strip of its shades');
        // hover: the group is shown on the canvas, nothing changes in the figure
        const before = J(scene), saved0 = lastSaved; sw()[1].dispatchEvent(new PointerEvent('pointerenter')); h = node(a).innerHTML; ok(h.includes('fill="#2471a3"') && !h.includes('fill="#c0392b"'), 'under the pointer: the blue group as it is, the rest dimmed');
        eq(J(scene), before, 'nothing changed'); eq(lastSaved, saved0, 'nothing saved'); const ex = await svgString({}); ok(ex.includes('fill="#c0392b"'), 'an export meanwhile shows the icon as it is'); ok(!ICON_HL, 'and ends the highlight');
        sw()[1].dispatchEvent(new PointerEvent('pointerenter')); sw()[1].dispatchEvent(new PointerEvent('pointerleave')); ok(!ICON_HL && node(a).innerHTML.includes('fill="#c0392b"'), 'leaving it shows the icon again');
        sw()[2].focus(); if (!ICON_HL) sw()[2].dispatchEvent(new FocusEvent('focus')); ok(ICON_HL && ICON_HL.gi === 2, 'focus shows it too'); sw()[2].blur(); sw()[2].dispatchEvent(new FocusEvent('blur')); ok(!ICON_HL, 'and blur ends it');
        // pick a color: live while dragging, one undo step when done
        const c10 = get(a).c1; sw()[0].click(); let inp = P.querySelector('.grped input[type=color]'); ok(inp && (D.activeElement === inp || !D.hasFocus()), 'the swatch opens its color, with the keyboard on it'); ok(sw()[0].getAttribute('aria-pressed') === 'true', 'pressed');
        inp.value = '#3355cc'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.value = '#2244bb'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); await settle();
        eq(get(a).c1, '#2244bb', 'c1 set'); undo(); await settle(); eq([get(a).c1, 'grp' in get(a)], [c10, false], 'one undo step takes the whole drag back'); redo(); await settle(); eq(get(a).c1, '#2244bb', 'redo'); ok(grpOn(get(a)) && get(a).grp['#c0392b'] === '#2244bb', 'grp: the element is colored by groups now');
        ok(/#2244bb/.test(sw()[0].getAttribute('aria-label')) && /made as #c0392b/.test(sw()[0].getAttribute('aria-label')), 'the swatch says so');
        ok(P.querySelector('.grpq button[aria-label="Use #2244bb"]'), 'the color is among the recent ones');
        const ink = G.groups.findIndex(g => g.kind === 'ink'); if (!sw().some(b => +b.dataset.gi === ink)) [...P.querySelectorAll('.grprow .grplink')].find(x => /^More/.test(x.textContent)).click(); sw().find(b => +b.dataset.gi === ink).click(); P.querySelector('.grpq button').click(); await settle(); ok(get(a).grp['#222222'], 'a quick pick for the outline'); undo(); await settle(); ok(!(get(a).grp || {})['#222222'] && get(a).c1 === '#2244bb', 'its own undo step'); redo(); await settle();
        [...P.querySelectorAll('.grped .grplink')].find(b => b.textContent === 'Reset this color').click(); await settle(); ok(!get(a).grp['#222222'], 'Reset this color');
        undo(); await settle(); ok(get(a).grp['#222222'], 'undo brings it back'); redo(); await settle();
        // the arrows move between the swatches
        sw()[0].focus(); P.querySelector('.grprow').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); eq(D.activeElement, sw()[1], 'ArrowRight: the next swatch'); sw()[1].blur();
        [...P.querySelectorAll('.grphead .grplink')][0].click(); await settle(); ok(!('grp' in get(a)), 'Reset colors: the field goes'); eq(get(a).c1, ic.c[0], 'and the library colors are back');
        // several icons of one kind: one row for all; of different kinds: c1 / c2 as before
        const b = fig.add('icon', { kind: k, x: 700, y: 300, size: 120 }); fig.select([a, b]); await settle(); ok($q('#props .grpbox') && !rowOf('main color'), 'two of one kind: the row');
        $q('#props .grpsw').click(); inp = $q('#props .grped input[type=color]'); inp.value = '#884400'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); await settle(); eq([get(a).c1, get(b).c1], ['#884400', '#884400'], 'one color for both');
        const c = fig.add('icon', { kind: 'cell', x: 900, y: 300 }); fig.select([a, c]); await settle(); ok(!$q('#props .grpbox') && rowOf('main color'), 'different kinds: main color as before');
        fig.select([c]); await settle(); ok(!$q('#props .grpbox') && rowOf('main color') && rowOf('accent color'), 'a built-in icon keeps its two color fields');
        // another kind: the largest group keeps the color it had
        { fig.update(a, { kind: TPK('alpha') }); eq(get(a).c1, '#884400', 'another kind (fig.update): the largest group keeps its color'); eq(get(a).c2, '#f5a623', 'the second, never changed, takes the new kind\'s own'); eq(Object.keys(get(a).grp).sort(), grpOf(TPK('alpha')).groups.slice(0, 2).map(g => g.main).sort(), 'the rest starts as made'); fig.update(a, { kind: k });
          fig.select([a]); await settle(); const ks = rowOf('kind').querySelector('select'); ks.value = 'cell'; ks.dispatchEvent(new Event('input', { bubbles: true })); ks.dispatchEvent(new Event('change', { bubbles: true })); await settle(); eq([get(a).kind, get(a).c1, 'grp' in get(a)], ['cell', '#884400', false], 'a built-in kind from the list: no grp, the main color kept'); ok(rowOf('main color') && !$q('#props .grpbox'), 'its two color fields'); fig.update(a, { kind: k, grp: {} }); }
        // grp given outside the panel: the look stays (c1 / c2 there were the library's keys); grp: null puts the library's c1 / c2 back
        { const P2 = TPK('zzpair'); registerIcon(P2, { n: 'p', pack: TP, svg: '<rect x="-40" y="-40" width="80" height="50" fill="#705c68"/><rect x="-40" y="10" width="80" height="30" fill="#dcc9a9"/><circle r="4" fill="#201a24"/>', k: ['#dcc9a9', '#705c68'], c: ['#dcc9a9', '#705c68'] });
          const q1 = fig.add('icon', { kind: P2, grp: { '#201a24': '#ff0000' } }), I = fig.iconColors(q1).groups; eq(I.slice(0, 2).map(g => g.color), I.slice(0, 2).map(g => g.main), 'fig.add with grp: the two largest groups drawn as made (c1 / c2 were the keys, in another order) ' + J(I));
          const q2 = fig.add('icon', { kind: P2 }); fig.update(q2, { grp: {} }); eq(fig.iconColors(q2).groups.map(g => g.color), fig.iconColors(q2).groups.map(g => g.main), 'fig.update with grp: {}: unchanged');
          fig.update(q2, { grp: null }); eq([get(q2).c1, get(q2).c2, 'grp' in get(q2)], ['#dcc9a9', '#705c68', false], 'grp: null: the library\'s c1 / c2 back');
          // the first change in group mode keeps every color of the other groups exactly as c1 / c2 drew them
          const q3 = fig.add('icon', { kind: k }); fig.update(q3, { c1: '#2563eb', c2: '#f0a000' }); const b0 = grpNow(get(q3), ic, G), gi = G.groups.findIndex(g => g.kind === 'ink');
          fig.iconColors(q3, { [gi + 1]: '#00aa00' }); const a0 = grpNow(get(q3), ic, G), moved = [...b0].filter(([c, v]) => G.by.get(c) !== gi && a0.get(c) !== v); eq(moved, [], 'an icon recolored with c1 / c2: changing the outline leaves every other color as it was');
          ok(Object.keys(get(q3).grp).some(x => x[0] === '='), 'kept as exact colors ("=#color") ' + J(get(q3).grp)); fig.iconColors(q3, { 1: '#aa3300' }); ok(!Object.keys(get(q3).grp).some(x => x[0] === '=' && G.by.get(x.slice(1)) === 0), 'a change to that group drops its exact colors');
          // the groups are found by the colors grp names: the same targets when the two largest rank the other way
          const o3 = get(q3), Gs = { ...G, groups: [G.groups[1], G.groups[0], ...G.groups.slice(2)], by: new Map([...G.by].map(([c, i]) => [c, i === 0 ? 1 : i === 1 ? 0 : i])) }; eq(J([...grpTargets(o3, Gs)].sort()), J([...grpTargets(o3, G)].sort()), 'a near tie that ranks the two largest the other way changes nothing');
          // another kind whose drawing has not come yet: refused, nothing changed
          ICONS[P2].stub = true; const was = J(get(q3)); let er = ''; try { fig.update(q3, { kind: P2 }); } catch (x) { er = x.message; } delete ICONS[P2].stub; ok(/iconsReady/.test(er) && J(get(q3)) === was, 'another kind still loading: refused, nothing changed: ' + er);
          fig.remove([q1, q2, q3]); delete ICONS[P2]; GRP_MEMO.delete(P2); }
        // the panel's keys and state: Esc closes the group's color (the icon stays selected), a click shows the group on the canvas, a new selection starts closed
        fig.select([a]); await settle(); $q('#props .grpsw').click(); ok(ICON_HL && ICON_HL.gi === 0, 'a click (or tap) shows the group on the canvas for a moment'); const ci2 = $q('#props .grped input[type=color]'); ci2.focus();
        ci2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); eq(fig.selected(), [a], 'Esc in the color: the icon stays selected'); ok($q('#props .grped').hidden && (D.activeElement === $q('#props .grpsw') || !D.hasFocus()), 'the color closes, the focus back on its swatch');
        $q('#props .grpsw').click(); fig.select([]); await settle(); fig.select([a]); await settle(); ok($q('#props .grped').hidden, 'selected again: the group\'s color starts closed');
        // the phone sheet's quick row is Color 1
        { fig.iconColors(a, null); await settle(); const Q = phQuick($q('#props'), get(a)), row = Q && Q.querySelector('.phqc'); ok(row && /Color 1/.test(row.textContent), 'the quick color row of an icon with groups is Color 1'); const bt = [...row.querySelectorAll('button.phsw')].find(x => x.dataset.c === '#ffffff'); bt.click(); await settle(); const gs = fig.iconColors(a).groups; eq(gs[0].color, '#ffffff', 'a tap sets group 1'); ok(gs.slice(1).every(g => g.color === g.main), 'and only that group ' + J(gs)); undo(); await settle(); }
        // look-alike: two groups recolored to the same color
        fig.iconColors(a, { 1: '#2471a3', 2: '#2471a3' }); ok(colorCheck().alike.some(r => r.id === a && /look alike after recoloring/.test(r.msg)), 'the color check names two groups that now look alike');
        // save → the file; copies into a figure where the icon is unknown; exports
        blank(); const e = fig.add('icon', { kind: k, x: 400, y: 300, size: 200, grp: { '#222222': '#cc00cc' }, c1: '#1e9e57', c2: '#2471a3' }); await settle(); commit(); const drawn = node(e).innerHTML; ok(drawn.includes('stroke="#cc00cc"') && drawn.includes('fill="#1e9e57"'), 'drawn from the file\'s fields');
        await flushSave(); const t = await (await fetch(FILE + '?t=' + Date.now(), { cache: 'no-store' })).text(); ok(t.includes('"grp":{"#222222":"#cc00cc"}'), 'saved in the figure file'); ok(/"icons":\{"zz-test:zzshade"/.test(t), 'with the drawing embedded');
        const text = J(fig.get()); fig.select([e]); copySel.tip = 1; copySel(); const cp = JSON.parse(J(clip)); ok(cp[0].grp && cp[0].iconDef, 'the copy carries grp and the drawing');
        blank(); delete ICONS[k]; GRP_MEMO.delete(k); pasteClip(cp); await settle(); { const p = scene.objects.find(o => o.type === 'icon'); ok(p && J(p.grp) === J({ '#222222': '#cc00cc' }), 'pasted where the icon is unknown: grp kept'); eq(node(p.id).innerHTML.replace(/-[\w]+(?=["'),])/g, ''), drawn.replace(/-[\w]+(?=["'),])/g, ''), 'and drawn the same'); }
        blank(); delete ICONS[k]; GRP_MEMO.delete(k); fig.set(JSON.parse(text)); await settle(); eq(node(e).innerHTML, drawn, 'a figure opened where the icon is unknown: drawn the same from its embedded copy');
        const s = await svgString({}); ok(s.includes('stroke="#cc00cc"') && s.includes('fill="#1e9e57"') && !s.includes('fill="#c0392b"'), 'SVG: the new colors');
        await checkPng(400, 'icon groups'); await checkPdf('icon groups');
        { const sv = sceneSvg(fig.get(), 160, 90); ok(sv.includes('#cc00cc') && sv.includes('#1e9e57'), 'a thumbnail (Home, slides) too'); }
        // Convert to editable parts keeps the colors
        fig.select([e]); explodeSel(); await settle(); ok(scene.objects.some(o => o.type === 'path' && o.stroke === '#cc00cc') && scene.objects.some(o => o.type === 'path' && o.fill === '#1e9e57'), 'Convert to editable parts: the parts keep the new colors');
        undo(); await settle();
        let p = null; try { p = await exportPptx(); } catch (x) { if (opts.strict || !OFFLINE.test(x.message)) throw x; }
        if (p) { const z = await JSZip.loadAsync(p.blob), svgs = Object.keys(z.files).filter(f => /^ppt\/media\/.*\.svg$/.test(f)); let any = false; for (const f of svgs) if ((await z.file(f).async('string')).includes('#cc00cc')) any = true; ok(any, 'PowerPoint: the picture of the icon has the new colors'); }
        // fixed icons (no color key) get their groups too
        registerIcon(TPK('zzfixed'), { n: 'f', pack: TP, fixed: true, svg: '<path d="M-30-20h60v40h-60z" fill="#ffffff" stroke="#111111" stroke-width="2"/>', k: [], c: ['#ffffff', '#111111'] }); blank(); const fx = fig.add('icon', { kind: TPK('zzfixed'), x: 300, y: 300, size: 150 }); fig.select([fx]); await settle();
        ok($q('#props .grpbox') && !/keeps its own colors/.test($q('#props').textContent), 'an icon without color keys: its groups can be recolored'); delete ICONS[TPK('zzfixed')];
      } finally { blank(); await dropPack(); }
    }, 240000);

    test('icon packs: the shipped packs are complete and safe', async () => {
      await packInit(); const packs = PACKS.list.filter(p => p.id !== TP); if (!packs.length) throw new Skip('no icon packs in this copy (icon-expansions/index.json)');
      const host = D.createElementNS('http://www.w3.org/2000/svg', 'svg'); host.setAttribute('viewBox', '-50 -50 100 100'); host.style.cssText = 'position:absolute;left:-9999px;top:0;width:100px;height:100px'; D.body.appendChild(host);
      const get1 = async u => { const r = await fetch(u, { cache: 'no-store' }); ok(r.ok, u + ': HTTP ' + r.status); return r; }; let total = 0; const note = [];
      try {
        for (const P of packs) {
          const W1 = P.id + ': ';
          for (const k of ['id', 'name', 'url', 'license', 'licenseUrl', 'credit', 'how', 'plain', 'changes', 'retrieved', 'version']) ok(typeof P[k] === 'string' && P[k].trim(), W1 + 'pack.json has no ' + k);
          ok(/^https:\/\//.test(P.url) && /^https:\/\//.test(P.licenseUrl) && (P.askFrom === undefined || /^https:\/\//.test(P.askFrom)), W1 + 'links'); ok(['required', 'none', 'mixed'].includes(P.attribution), W1 + 'attribution: ' + P.attribution); ok(typeof P.shareAlike === 'boolean' && typeof P.perIcon === 'boolean', W1 + 'shareAlike / perIcon');
          ok(/^\d{4}-\d\d-\d\d$/.test(P.retrieved), W1 + 'retrieved'); ok(P.count > 0 && Array.isArray(P.chunks) && P.chunks.length, W1 + 'count and parts'); if (P.shareAlike) ok(typeof P.shareAlikeText === 'string' && P.shareAlikeText.length > 40, W1 + 'share-alike is explained');
          eq(J((await (await get1(P.dir + 'pack.json')).json()).chunks), J(P.chunks), W1 + 'index.json and pack.json agree');
          const lic = await (await get1(P.dir + 'LICENSE.txt')).text(), att = await (await get1(P.dir + 'ATTRIBUTION.md')).text(); ok(lic.length > 1500 && /Retrieved:\s+\d{4}-\d\d-\d\d/.test(lic), W1 + 'LICENSE.txt with its retrieval date'); ok(/What SiliCoDraw changed/.test(att) && /asks to be credited/.test(att), W1 + 'ATTRIBUTION.md');
          if (P.perIcon) ok(/\| Icon \| Creator \|/.test(att), W1 + 'ATTRIBUTION.md lists the credits per icon');
          const names = await (await get1(P.dir + 'names.json')).json(), pv = await (await get1(P.dir + 'preview.json')).json(); ok(Object.keys(pv).length >= 6 && Object.keys(pv).length <= 16, W1 + 'preview icons: ' + Object.keys(pv).length);
          const seen = new Set(), inkKeys = []; let n = 0, bytes = 0;
          for (let ci = 0; ci < P.chunks.length; ci++) {
            const ch = P.chunks[ci], r = await get1(P.dir + ch.file), tx = await r.text(), d = JSON.parse(tx); bytes += tx.length; ok(tx.length < 4e6, W1 + ch.file + ' is ' + tx.length + ' bytes (parts stay under a few MB)'); eq(Object.keys(d).length, ch.count, W1 + ch.file + ' count');
            for (const k of Object.keys(d)) {
              const v = d[k], w = k + ': '; n++; ok(new RegExp('^' + P.id + ':[a-z0-9][a-z0-9-]*$').test(k), w + 'key not in the pack\'s namespace'); ok(!seen.has(k), w + 'twice'); seen.add(k);
              ok(typeof v.n === 'string' && v.n.trim(), w + 'no name'); ok(typeof v.t === 'string', w + 'no tags'); ok(typeof v.svg === 'string' && v.svg.length > 20 && v.svg.length <= (150000), w + 'drawing size ' + (v.svg || '').length);   
              ok(svgScrub(v.svg) === v.svg, w + 'svgScrub changes it');
              { const idm = new Map(); for (const m of v.svg.matchAll(/<([a-zA-Z]+)\b[^>]*?\sid="([^"]+)"/g)) { ok(!idm.has(m[2]), w + 'the id ' + m[2] + ' is used twice'); idm.set(m[2], m[1]); }   // (the page clip once had the id of the 31st gradient: that shape lost its fill)
                for (const m of v.svg.matchAll(/\b(fill|stroke|clip-path|mask)="url\(#([^)]+)\)"/g)) { const tg = idm.get(m[2]); ok(tg && (m[1] === 'clip-path' ? tg === 'clipPath' : m[1] === 'mask' ? tg === 'mask' : /Gradient$|^pattern$/.test(tg)), w + m[1] + ' points to ' + (tg || 'nothing') + ' (' + m[2] + ')'); } } ok(!/<\s*(script|foreignObject|image|text|style|use|a)\b|\son[a-z]+\s*=|javascript:|href="(?!#)|url\((?!#)|data:/i.test(v.svg), w + 'holds something an icon must not');
              ok(Array.isArray(v.k) && v.k.length <= 2 && v.k.every(c => /^#[0-9a-f]{6}$/.test(c)) && Array.isArray(v.c) && v.c.length === 2, w + 'colors k / c'); if (v.k.length) ok(v.svg.includes('"' + v.k[0] + '"'), w + 'its main color is not in the drawing (not recolorable)');
              if ('kt' in v) ok(Array.isArray(v.kt) && v.kt.length >= 1 && v.kt.length <= v.k.length && v.kt.every(L => Array.isArray(L) && L.every(c => /^#[0-9a-f]{6}$/.test(c) && v.svg.includes('"' + c + '"') && !v.k.includes(c))), w + 'shades kt: ' + J(v.kt)); if ('kt' in v) ok(v.kt.every(L => L.length <= 256), w + 'more than 256 shades of a key (the editor reads 256)');  if (v.fixed) ok(v.fixed === true && !v.k.length, w + 'fixed');
              ok(Array.isArray(v.b) && v.b.length === 2 && v.b.every(x => x > 0 && x <= 96.6) && Math.max(...v.b) >= 90, w + 'does not fit its box: ' + J(v.b));
              const nm = names[k]; ok(nm && nm.n === v.n && nm.f === ci, w + 'names.json does not know it (or its part)');
              if (P.perIcon) ok(typeof v.src === 'string' && /^https:\/\//.test(v.src) && typeof v.lic === 'string' && v.lic, w + 'no page or license (the pack is credited per icon)');
              if (P.attribution === 'mixed') ok(/^(CC BY 4\.0|CC0 1\.0)$/.test(v.lic), w + 'license ' + v.lic); for (const f of ['by', 'doi', 'cat']) if (f in v) ok(typeof v[f] === 'string' && v[f].trim(), w + 'empty ' + f);
              if (n % 9 === 0) { const g = D.createElementNS('http://www.w3.org/2000/svg', 'g'); g.innerHTML = v.svg; host.appendChild(g); const b = g.getBBox(); g.remove(); ok(b.width > 1 && b.height > 1 && [b.x, b.y, b.width, b.height].every(Number.isFinite), w + 'draws nothing'); }
            }
            await frame();
          }
          if (P.id === 'scidraw') {   // every author the repository names; no likeness of a real person, no logo of the repository; a numbered library name keeps the title its author gave
            eq(names['scidraw:mouse-ded16e1d'] && names['scidraw:mouse-ded16e1d'].by, 'Lex Kravitz, Ethan Tyler', W1 + 'co-authors'); ok(!Object.keys(names).some(k => /einstein|scidraw-(logo|icon)/.test(k)), W1 + 'an icon that is left out on purpose is back');
            { const m = names['scidraw:mouse-09d7b739']; ok(m && m.n === 'Mouse 2' && m.title === 'Mouse', W1 + 'title of a numbered name: ' + J(m)); } ok(/adapted/.test(P.credit) && /adapted/.test(P.how), W1 + 'the credit says that the drawings were adapted'); }
          eq(n, P.count, W1 + 'icons in the parts'); eq(Object.keys(names).length, n, W1 + 'names.json'); ok(Object.keys(pv).every(k => seen.has(k)), W1 + 'a preview icon that is not in the pack'); total += n; note.push(P.id + ' ' + n + ' (' + (bytes / 1e6).toFixed(1) + ' MB)');
        }
      } finally { host.remove(); }
      return { note: total + ' icons: ' + note.join(', ') };
    }, 480000);


    // ---------- crop ----------
    {
      const CR = { l: .2, t: .1, r: .1, b: .2 };
      const pe = (type, x, y, o = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, ...o });
      // a crop handle (l, t, r, b, tl, tr, bl, br, m) dragged by dx, dy page px
      const dragH = (k, dx, dy, o) => { const h = D.querySelector(`#overlay [data-h="crop"][data-k="${k}"]`); ok(h, 'no crop handle ' + k); const r = h.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        h.dispatchEvent(pe('pointerdown', x, y, o)); svg.dispatchEvent(pe('pointermove', x + dx * zoom, y + dy * zoom, o)); svg.dispatchEvent(pe('pointerup', x + dx * zoom, y + dy * zoom, o)); };
      const key = (k, o = {}) => D.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
      const node = id => D.querySelector(`#content>[data-id="${id}"]`);
      const PIC = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#4488cc"/><circle cx="200" cy="200" r="150" fill="#ffcc33"/></svg>');
      const rect = (x, y, w, h, more) => fig.add('shape', { kind: 'rect', x, y, w, h, fill: '#5fae8b', stroke: 'none', sw: 0, ...more });

      test('crop: every type that can be cropped draws a clip and gets smaller bounds; arrows and comments cannot', async () => {
        blank(); const ids = {}; types.forEach((t, i) => { ids[t] = fig.add(t, { ...at(i), ...(t === 'image' ? { src: PIC, w: 120, h: 80, fit: 'crop' } : t === 'comment' ? { text: 'a note' } : {}) }); }); await settle();   // (a comment without text is removed by the editor)
        let n = 0; const none = [];
        for (const t of types) { const id = ids[t]; if (t === 'arrow' || t === 'comment') continue; const b0 = bbox(id); if (!b0 || (b0.w < 3 && b0.h < 3)) { none.push(t); continue; }
          const N = cropNatOf(get(id)), o0 = get(id); if (!N) { none.push(t); continue; }   // nothing drawn (an empty sketch shows only the editor's "empty" marker): nothing to crop near(N.w, b0.w, 1.5 + b0.w * .09, t + ': its own width against the selection frame'); near(N.h, b0.h, 1.5 + b0.h * .09, t + ': its own height');   // (text is measured at 100 %: the canvas, zoomed out, rounds its letters a little wider)
          const w = fig.update(id, { crop: CR }); eq(w, [], t + ': warnings'); eq(get(id).crop, CR, t + ': the field'); const g = node(id), fr = g.firstElementChild, b1 = bbox(id);
          eq(fr.getAttribute('class'), 'cropframe', t + ': the frame comes first'); const cp = g.querySelector(':scope>clipPath'), cg = g.querySelector(':scope>g.cropped'); ok(cp && cg && cg.getAttribute('clip-path') === `url(#${cp.id})`, t + ': clip path and clipped drawing');
          ok(finiteBox(b1), t + ': bounds'); const tol = 1.2;
          if (b0.w >= 3) { near(b1.w, N.w * .7, tol, t + ': width'); near(b1.x, o0.x + N.x + N.w * .2, tol, t + ': left'); ok(b1.w < b0.w * .85, t + ': not narrower'); } if (b0.h >= 3) { near(b1.h, N.h * .7, tol, t + ': height'); near(b1.y, o0.y + N.y + N.h * .1, tol, t + ': top'); ok(b1.h < b0.h * .85, t + ': not lower'); }
          eq([get(id).x, get(id).y], [at(types.indexOf(t)).x, at(types.indexOf(t)).y], t + ': the anchor stays'); n++; }
        ok(n >= types.length - 6, 'only ' + n + ' types were cropped (nothing drawn: ' + none.join(', ') + ')');
        eq(new Set([...D.querySelectorAll('#content clipPath[id^="crop"]')].map(c => c.id)).size, n, 'a clip id per element');
        // arrows and comments
        for (const t of ['arrow', 'comment']) { const w = fig.update(ids[t], { crop: CR }); ok(w.some(x => /cannot be cropped/.test(x.msg)), t + ': no warning'); ok(!('crop' in get(ids[t])), t + ': the field stayed'); let th = false; try { fig.crop(ids[t], CR); } catch (e) { th = true; } ok(th, t + ': fig.crop did not throw');
          sel = new Set([ids[t]]); eq(cropStart(), false, t + ': crop mode started'); ok(!cropping, t + ': cropping'); }
        sel = new Set(); checkSvg(await svgString({}), 'all types cropped'); await checkPng(600, 'all types cropped'); eq(fig.check().filter(x => /crop/.test(x.msg)), [], 'fig.check');
      });

      test('crop: bounds everywhere (rotated, flipped, scaled, align, connector, hit-test, pinned comment, off-page)', async () => {
        if (drag) dragCancel();   // (a box selection an earlier test left open: comments do not follow their elements during a drag)
        blank(); const u = rect(400, 300, 700, 500, { fill: '#eeeeee' }), a = rect(400, 300, 200, 100); fit(); await frame();
        eq(fig.crop(a, { l: .25, b: .2 }), { l: .25, t: 0, r: 0, b: .2 }, 'fig.crop returns the crop'); eq(fig.crop(a), { l: .25, t: 0, r: 0, b: .2 }, 'fig.crop(id)');
        const B = (x, y, w, h, what) => { const b = bbox(a); near(b.x, x, .7, what + ': x'); near(b.y, y, .7, what + ': y'); near(b.w, w, .7, what + ': w'); near(b.h, h, .7, what + ': h'); };
        B(350, 250, 150, 80, 'cropped'); { const l = fig.list().find(x => x.id === a).bbox; near(l[0], 350, 1, 'fig.list'); near(l[2], 150, 1, 'fig.list width'); }
        // a press on the cropped-away part goes to what is under it
        { const r = svg.getBoundingClientRect(), at2 = (x, y) => { const g = pickAt({ clientX: r.left + x * zoom, clientY: r.top + y * zoom }); return g && g.dataset.id; }; eq(at2(320, 290), u, 'the cropped-away left part'); eq(at2(420, 340), u, 'the cropped-away bottom'); eq(at2(420, 290), a, 'the part that shows'); }
        fig.update(a, { flip: true }); B(300, 250, 150, 80, 'flipped: its own left is on the right');
        fig.update(a, { flip: false, r: 90 }); B(370, 250, 80, 150, 'turned 90°: cropped along its own sides');
        fig.update(a, { r: 0, s: 2 }); B(300, 200, 300, 160, 'scaled'); eq([get(a).x, get(a).y], [400, 300], 'the anchor never moves');
        fig.update(a, { s: 1 });
        // a connector's end meets the cropped outline (auto side, and a fixed side)
        { const t = rect(425, 520, 40, 40), c = fig.connect(t, a); near(get(c).y2, 330 + 4, .8, 'the end below the cropped bottom'); const c2 = fig.connect(t, { id: a, side: 'w' }); near(get(c2).x2, 350 - 4, .8, 'the end left of the cropped left side'); near(get(c2).y2, 290, .8, 'in the middle of what shows');
          sel = new Set([a, t]); align('l'); near(bbox(a).x, bbox(t).x, .7, 'align left uses the cropped left side'); fig.remove([t]); }
        // a comment pinned to it sits on what shows
        { showComments = true; fig.update(a, { x: 400, y: 300 }); const cm = fig.add('comment', { text: 'note', x: 0, y: 0, on: a }); await frame(); const q = get(cm), b = bbox(a); ok(q.on && q.on.id === a, 'pinned: ' + J(q.on)); ok(q.x >= b.x - 1 && q.x <= b.x + b.w + 1 && q.y >= b.y - 1 && q.y <= b.y + b.h + 1, 'the pin is not on the cropped element: ' + J([q.x, q.y, b])); fig.remove(cm); }
        // only its cropped-away half is on the page: parked off the page
        fig.update(a, { x: -10, crop: null }); ok(!('crop' in get(a)), 'crop: null removes the field'); eq(offPageId(a), false, 'whole: on the page'); fig.crop(a, { r: .5 }); eq(offPageId(a), true, 'cropped: off the page'); ok(!(await svgString({})).includes('crop' + a), 'not in the SVG');
        fig.crop(a, null); eq(fig.crop(a), null, 'fig.crop(id, null)');
        // an animation's effect runs over the cropped bounds
        fig.update(a, { x: 400 }); fig.crop(a, { l: .5 }); near(animBox(a).w, 100, .7, 'animBox');
      });

      test('crop: crop mode (handles, one undo step, redo, Esc, arrow keys, proportions, fields, a press outside)', async () => {
        if (drag) dragCancel(); blank(); const a = rect(700, 400, 600, 400), ar = fig.add('arrow', {}); fit(); await frame(); commit();
        sel = new Set([a]); buildPanel(); ok([...D.querySelectorAll('#props button')].some(b => b.textContent === 'Crop'), 'no Crop button in the panel'); ok(![...D.querySelectorAll('#props button')].some(b => b.textContent === 'Remove crop'), 'Remove crop without a crop');
        const h0 = hist.length, s0 = lastSaved; ok(cropStart(a), 'crop mode did not start'); ok(cropping && cropping.id === a, 'cropping');
        eq(D.querySelectorAll('#overlay rect[data-h="crop"]').length, 8, 'handles: four sides, four corners'); ok(D.querySelector('#overlay path[data-h="crop"][data-k="m"]'), 'the frame can be moved'); ok(D.querySelector('#cropSec'), 'the crop panel'); eq(D.querySelectorAll('#cropSec input[data-crop]').length, 4, 'four fields');
        for (const h of D.querySelectorAll('#overlay [data-h="crop"]')) ok(h.querySelector('title') && h.querySelector('title').textContent, 'a handle without a tooltip');
        dragH('r', -60, 0); near(cropping.c.r, .1, .004, 'right handle'); dragH('t', 0, 40); near(cropping.c.t, .1, .004, 'top handle'); dragH('tl', 120, 0); near(cropping.c.l, .2, .004, 'corner'); near(cropping.c.t, .1, .004, 'corner: top as it was');
        eq([hist.length, lastSaved], [h0, s0], 'nothing is committed while cropping'); ok(!('crop' in get(a)), 'the element is untouched while cropping'); ok(!node(a).querySelector('.cropframe'), 'the whole element shows while cropping'); near(bbox(a).w, 600, .7, 'whole bounds while cropping');
        eq(D.querySelector('#cropSec input[data-crop="r"]').value, '10', 'the field follows the handle');
        key('Enter'); ok(!cropping, 'Enter did not apply'); near(get(a).crop.r, .1, .004, 'applied'); ok(hist[hist.length - 1] === s0 && lastSaved !== s0, 'not one undo step'); near(bbox(a).w, 600 * .7, .7, 'cropped bounds'); ok([...D.querySelectorAll('#props button')].some(b => b.textContent === 'Remove crop'), 'no Remove crop in the panel');
        const c1 = J(get(a).crop); undo(); ok(!('crop' in get(a)), 'undo'); eq(lastSaved, s0, 'undo: the state before'); redo(); eq(J(get(a).crop), c1, 'redo'); const s1 = lastSaved;
        // Esc cancels; while a handle is held it only takes the drag back
        cropStart(a); dragH('b', 0, -80); near(cropping.c.b, .2, .004, 'bottom'); key('Escape'); ok(!cropping, 'Esc did not leave crop mode'); eq(J(get(a).crop), c1, 'Esc changed the crop'); eq(lastSaved, s1, 'Esc made a step');
        // arrow keys: the side last touched; Shift on a corner keeps the proportions; a preset
        cropStart(a); dragH('r', -6, 0); const r0 = cropping.c.r; key('ArrowLeft'); near(cropping.c.r - r0, 1 / 600, 1e-4, 'ArrowLeft moves the right side 1 px'); key('ArrowRight', { shiftKey: true }); near(cropping.c.r - r0, -9 / 600, 1e-4, 'Shift+ArrowRight: 10 px');
        dragH('t', 0, 4); const t0 = cropping.c.t; key('ArrowDown'); near(cropping.c.t - t0, 1 / 400, 1e-4, 'ArrowDown moves the top side'); eq(get(a).x, 700, 'the arrows did not nudge the element');
        { const ra = () => 600 * (1 - cropping.c.l - cropping.c.r) / (400 * (1 - cropping.c.t - cropping.c.b)), q0 = ra(); dragH('br', -90, -10, { shiftKey: true }); near(ra(), q0, .01, 'Shift on a corner'); }
        { const s = D.querySelector('#cropRatio'); s.value = '1'; s.dispatchEvent(new Event('change', { bubbles: true })); near(600 * (1 - cropping.c.l - cropping.c.r), 400 * (1 - cropping.c.t - cropping.c.b), .5, '1 : 1'); near(cropping.c.l, cropping.c.r, 1e-6, 'centered'); dragH('r', -50, 0); near(600 * (1 - cropping.c.l - cropping.c.r), 400 * (1 - cropping.c.t - cropping.c.b), .5, 'a side keeps 1 : 1');
          s.value = 'o'; s.dispatchEvent(new Event('change', { bubbles: true })); eq(cropping.c, { l: 0, r: 0, t: 0, b: 0 }, 'Original'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); }
        // the fields; Done
        { const i = D.querySelector('#cropSec input[data-crop="l"]'); i.value = '30'; i.dispatchEvent(new Event('input', { bubbles: true })); near(cropping.c.l, .3, 1e-6, 'left field'); const j = D.querySelector('#cropSec input[data-crop="r"]'); j.value = '95'; j.dispatchEvent(new Event('input', { bubbles: true })); ok(cropping.c.l + cropping.c.r < 1, 'the fields can leave nothing');
          [...D.querySelectorAll('#cropSec button')].find(b => b.textContent === 'Reset crop').click(); eq(cropping.c, { l: 0, t: 0, r: 0, b: 0 }, 'Reset crop'); i.value = '25'; i.dispatchEvent(new Event('input', { bubbles: true }));
          const p1 = lastSaved; [...D.querySelectorAll('#cropSec button')].find(b => b.textContent === 'Done').click(); ok(!cropping, 'Done'); eq(get(a).crop, { l: .25, t: 0, r: 0, b: 0 }, 'Done applies'); ok(hist[hist.length - 1] === p1 && lastSaved !== p1, 'Done: not one step'); }
        // moving the frame; a press outside applies
        cropStart(a); dragH('m', 600, 0); eq([cropping.c.l, cropping.c.r].map(v => +v.toFixed(3)), [.25, 0], 'the frame stops at the element\'s side'); dragH('m', -60, 0); near(cropping.c.l, .15, .004, 'frame moved'); near(cropping.c.r, .1, .004, 'frame moved: right');
        { const p1 = lastSaved; D.querySelector('header').dispatchEvent(pe('pointerdown', 5, 5)); ok(!cropping, 'a press outside did not end crop mode'); near(get(a).crop.r, .1, .004, 'a press outside applies'); ok(hist[hist.length - 1] === p1 && lastSaved !== p1, 'a press outside: not one step'); }
        // a turned and mirrored element: the handles follow its own sides
        fig.update(a, { r: 30, flip: true, crop: null }); cropStart(a); { const o = get(a), p0 = toGlobal(o, [0, 0]), p1 = toGlobal(o, [1, 0]); dragH('l', (p1.x - p0.x) * 120, (p1.y - p0.y) * 120); near(cropping.c.l, .2, .006, 'turned and flipped: left'); dragH('b', Math.sin(30 * Math.PI / 180) * 80, -Math.cos(30 * Math.PI / 180) * 80); near(cropping.c.b, .2, .006, 'turned and flipped: bottom'); } key('Enter'); near(get(a).crop.l, .2, .006, 'applied on the turned element');
        // Remove crop; what cannot be cropped
        sel = new Set([a]); eq(cropClear(), 1, 'Remove crop'); ok(!('crop' in get(a)), 'the field is gone');
        sel = new Set([a, ar]); eq(cropStart(), false, 'two elements'); sel = new Set([ar]); eq(cropStart(), false, 'an arrow'); fig.update(a, { locked: true }); eq(cropStart(a), false, 'a locked element'); fig.update(a, { locked: false });
        // Shift+X starts it; undo while cropping applies first, then undoes that
        sel = new Set([a]); render(); key('X', { shiftKey: true }); ok(cropping, 'Shift+X'); dragH('r', -60, 0); key('z', { ctrlKey: true }); ok(!cropping && !('crop' in get(a)), 'Ctrl+Z while cropping');
        // deleted from outside while cropping: the mode ends
        cropStart(a); fig.remove(a); ok(!cropping, 'crop mode outlived its element');
      });
      test('crop: crop mode and slides, file edits, menus, view controls, flipped fields, focus', async () => {
        if (drag) dragCancel(); D.querySelectorAll('.pop.open').forEach(p => p.classList.remove('open'));
        // changing slides applies the crop on the slide it was set on (slides may share element ids)
        const sh = { type: 'shape', kind: 'rect', x: 400, y: 300, w: 400, h: 200, fill: '#5fae8b', stroke: 'none', sw: 0, s: 1, r: 0 };
        fig.set({ version: 4, w: 1600, h: 900, bg: '#ffffff', palette: [], slides: [{ id: 's1', objects: [{ id: 'o1', ...sh }] }, { id: 's2', objects: [{ id: 'o1', ...sh }] }, { id: 's3', objects: [{ id: 'o9', ...sh }] }] });
        fig.slide(1); fit(); await frame(); ok(cropStart('o1'), 'crop mode'); cropping.c = { ...cropping.c, l: .3 }; key('PageDown'); await frame();
        const sl = () => fig.get({ slides: true }).slides; eq(fig.slides().find(s => s.current).n, 2, 'PageDown went on'); ok(!cropping, 'crop mode outlived the slide'); near((sl()[0].objects[0].crop || {}).l, .3, 1e-6, 'slide 1 got its crop'); ok(!sl()[1].objects[0].crop, 'slide 2 got the crop meant for slide 1');
        fig.slide(3); ok(cropStart('o9'), 'crop mode on slide 3'); cropping.c = { ...cropping.c, l: .4 }; fig.slide(1); near((sl()[2].objects[0].crop || {}).l, .4, 1e-6, 'fig.slide applied the crop first'); fig.removeSlide(3); fig.removeSlide(2); ok(!fig.get({ slides: true }).slides, 'back to a plain figure');
        // an untouched frame leaves a crop that came from the file meanwhile alone
        blank(); const a = rect(700, 400, 600, 400, { crop: { l: .5 } }); fit(); await frame(); commit(); cropStart(a); get(a).crop = { l: 0, t: .3, r: 0, b: 0 }; render(); eq(cropping.c, { l: 0, t: .3, r: 0, b: 0 }, 'the frame follows the file'); key('Enter'); eq(get(a).crop, { l: 0, t: .3, r: 0, b: 0 }, 'an untouched frame wrote over the file\'s crop');
        // the right-click menu: Apply crop / Cancel crop; Esc closes the menu first
        const cm = D.querySelector('#ctxMenu'), menu = () => { ctxMenuAt({ clientX: 300, clientY: 300, altKey: false, kbd: true }); return [...cm.querySelectorAll('button')].map(x => x.textContent.replace(/(Enter|Esc|Shift.*)$/, '')); };
        cropStart(a); cropping.c = { l: .1, t: .1, r: .1, b: .1 }; let items = menu(); ok(cm.classList.contains('open'), 'no menu'); ok(items.includes('Apply crop') && items.includes('Cancel crop') && items.includes('Remove crop'), 'Apply / Cancel crop in the menu: ' + items.join('|')); ok(!items.includes('Crop'), 'Crop in the menu while cropping');
        key('Escape'); ok(!cm.classList.contains('open'), 'Esc left the menu open'); ok(cropping && cropping.c.l === .1, 'Esc on the menu cancelled the crop'); menu(); [...cm.querySelectorAll('button')].find(x => x.textContent.startsWith('Cancel crop')).click(); ok(!cropping, 'Cancel crop'); eq(get(a).crop, { l: 0, t: .3, r: 0, b: 0 }, 'Cancel crop changed the crop');
        // zoom keys and the toolbar's view buttons keep crop mode
        cropStart(a); cropping.c = { ...cropping.c, l: .2 }; key('=', { ctrlKey: true }); ok(cropping, 'Ctrl+= ended crop mode'); D.querySelector('#bFit').dispatchEvent(pe('pointerdown', 5, 5)); ok(cropping, 'Fit ended crop mode'); key('Escape'); ok(!cropping, 'Esc'); eq(get(a).crop.l, 0, 'Esc kept the frame'); fit(); await frame();
        // a flipped element: "left %" is the side seen on the left (its own right); a field shows the value used after leaving it
        fig.update(a, { flip: true, crop: null }); cropStart(a); { const L = D.querySelector('#cropSec input[data-crop="r"]'); ok(L && L.closest('label').textContent.startsWith('left'), 'flipped: the left field edits the own right side'); L.value = '25'; L.dispatchEvent(new Event('input', { bubbles: true })); near(cropping.c.r, .25, 1e-6, 'flipped left field');
          const R = D.querySelector('#cropSec input[data-crop="l"]'); R.value = '95'; R.dispatchEvent(new Event('input', { bubbles: true })); eq(R.value, '95', 'typing is kept while typing'); R.dispatchEvent(new Event('change', { bubbles: true })); eq(+R.value, Math.round(cropping.c.l * 1000) / 10, 'the field shows the value used'); ok(cropping.c.l < .95, 'clamped'); }
        // Done (by keyboard) leaves the focus on the canvas; Remove crop too
        { const b = [...D.querySelectorAll('#cropSec button')].find(x => x.textContent === 'Done'); b.focus(); b.click(); ok(!cropping, 'Done'); eq(D.activeElement, D.querySelector('#stage'), 'Done dropped the focus'); }
        { const b = [...D.querySelectorAll('#props button')].find(x => x.textContent === 'Remove crop'); ok(b, 'Remove crop'); b.focus(); b.click(); ok(!get(a).crop, 'removed'); eq(D.activeElement, D.querySelector('#stage'), 'Remove crop dropped the focus'); }
        // the schema; a picture's panel has one "Crop"
        ok(!fig.schema('arrow').common.includes('crop') && !fig.schema('comment').common.includes('crop') && fig.schema('shape').common.includes('crop'), 'schema: crop only for what can be cropped');
        const im = fig.add('image', { src: PIC, w: 300, h: 300, fit: 'stretch' }); sel = new Set([im]); buildPanel(); eq([...D.querySelectorAll('#props button')].filter(x => x.textContent === 'Crop').length, 1, 'a picture\'s panel: one button called Crop');
        ok([...D.querySelectorAll('#props button')].some(x => x.textContent === 'Fill the frame'), 'the fit toggle'); sel = new Set(); buildPanel();
      });

      test('crop: exports (SVG, PNG, PDF clip, PowerPoint srcRect and pictures), thumbnails and the slideshow have ids of their own', async () => {
        blank(); const a = rect(300, 200, 400, 200), tx = fig.add('text', { x: 200, y: 520, text: 'Cropped text stays text', size: 40, anchor: 'start' }), ic = fig.add('icon', { kind: 'cell', x: 900, y: 250, size: 160 }),
          im = fig.add('image', { x: 1100, y: 600, w: 200, h: 120, fit: 'crop', fx: .5, fy: .5, src: PIC }), whole = fig.add('image', { x: 700, y: 700, w: 200, h: 120, fit: 'crop', src: PIC });
        fig.crop(a, { l: .5 }); fig.crop(tx, { r: .5 }); fig.crop(ic, { t: .3 }); fig.crop(im, { l: .1, t: .2, r: .3 }); await settle();
        near(bbox(im).w, 120, .7, 'picture: width'); near(bbox(im).h, 96, .7, 'picture: height'); eq([get(im).fit, get(im).fx, get(im).fy, get(im).w], ['crop', .5, .5, 200], 'the picture keeps its fit');
        const doc = checkSvg(await svgString({}), 'cropped'); eq(doc.querySelectorAll('clipPath[id^="crop"]').length, 4, 'SVG: clip paths'); for (const g of doc.querySelectorAll('g.cropped')) { const m = /#([^)]+)/.exec(g.getAttribute('clip-path')); ok(m && doc.getElementById(m[1]), 'SVG: a clip that is not there'); }
        // PNG: the cropped-away half of the rectangle is page color
        { const p = await makePng(800, 96, {}), bm = await createImageBitmap(new Blob([p.bytes], { type: 'image/png' })), cv = D.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; const g = cv.getContext('2d'); g.drawImage(bm, 0, 0); const px = (x, y) => [...g.getImageData(Math.round(x / 2), Math.round(y / 2), 1, 1).data].slice(0, 3);
          eq(px(200, 200), [255, 255, 255], 'PNG: the cropped-away half'); eq(px(400, 200), [95, 174, 139], 'PNG: the half that shows'); }
        // PDF: a real clip per cropped element, text stays text, nothing becomes a picture but the pictures
        { let clips = 0, texts = 0, pics = 0; const o1 = W.pdfClip, o2 = W.pdfText, o3 = W.pdfPic; W.pdfClip = (...x) => { clips++; return o1(...x); }; W.pdfText = (...x) => { texts++; return o2(...x); }; W.pdfPic = (...x) => { pics++; return o3(...x); };
          try { const r = await makePdf({ mm: 120, dpi: 150 }); eq(r.pages, 1, 'PDF page'); } finally { W.pdfClip = o1; W.pdfText = o2; W.pdfPic = o3; } ok(clips >= 4, 'PDF: ' + clips + ' clips'); ok(texts >= 1, 'PDF: the cropped text is no text'); eq(pics, 0, 'PDF: something became a picture'); await checkPdf('cropped'); }
        // thumbnails and the slideshow: clip ids of their own
        { const ids = s => (s.match(/ id="crop[^"]*"/g) || []), t1 = ids(sceneSvg(fig.get(), 200, 120)), t2 = ids(sceneSvg(fig.get(), 200, 120)), cv = [...D.querySelectorAll('#content clipPath[id^="crop"]')].map(c => ` id="${c.id}"`), sh = ids(await svgString({ show: true }));
          eq(t1.length, 4, 'thumbnail: clips'); eq(new Set([...t1, ...t2, ...cv, ...sh]).size, 16, 'clip ids clash between the canvas, two thumbnails and the slideshow'); }
        // PowerPoint: the picture with PowerPoint's own crop (fit and crop together), the others as pictures of what shows; an animation still finds its shape
        fig.animate(a, { fx: 'fade' });
        let p = null; try { p = await exportPptx(null, { current: true }); } catch (e) { if (opts.strict || !OFFLINE.test(e.message)) throw e; }
        if (p) { eq(p.cropped, 3, 'PowerPoint: cropped elements as pictures'); eq(p.skipped, 0, 'PowerPoint: skipped'); const z = await JSZip.loadAsync(p.blob), x = await z.file('ppt/slides/slide1.xml').async('string'), sr = [...x.matchAll(/<a:srcRect([^>]*)\/>/g)].map(m => Object.fromEntries([...m[1].matchAll(/(\w)="(-?\d+)"/g)].map(q => [q[1], +q[2]])));
          eq((x.match(/<p:pic>/g) || []).length, 5, 'PowerPoint: pictures'); const c = sr.find(s => Math.abs((s.l || 0) - 10000) < 60); ok(c, 'PowerPoint: no srcRect for the cropped picture: ' + J(sr)); near(c.r, 30000, 60, 'srcRect right'); near(c.t, 32000, 60, 'srcRect top: the fit\'s 20 % and the crop\'s 12 %'); near(c.b, 20000, 60, 'srcRect bottom: the fit');
          const w = sr.find(s => s !== c); ok(w && Math.abs((w.t || 0) - 20000) < 60 && !(w.l > 0), 'PowerPoint: the picture without a crop keeps its fit: ' + J(sr));
          const m = /<p:spTgt spid="(\d+)"/.exec(x); ok(m && new RegExp('<p:cNvPr id="' + m[1] + '"').test(x), 'PowerPoint: the animation has no shape'); }
        fig.removeAnim(fig.anims().map(q => q.id));
      });

      test('crop: copies, parts, fused elements, own icons, repairs, checks, the API, save and load', async () => {
        blank(); const ic = fig.add('icon', { kind: 'cell', x: 300, y: 300, size: 200, label: 'Cell' }), a = rect(700, 300, 200, 100), b2 = rect(700, 500, 200, 100, { r: 90 }); fig.crop(ic, { l: .3, b: .25 }); fig.crop(a, { r: .5 }); fig.crop(b2, { t: .5 }); await settle();
        // duplicate and copy / paste
        sel = new Set([ic]); duplicate(); { const d = [...sel][0]; ok(d !== ic, 'duplicate'); eq(get(d).crop, get(ic).crop, 'the copy keeps the crop'); ok(node(d).querySelector('clipPath').id !== node(ic).querySelector('clipPath').id, 'the copy has a clip id of its own'); near(bbox(d).w, bbox(ic).w, .7, 'the copy\'s bounds'); fig.remove(d); }
        sel = new Set([a]); copySel(); pasteClip(getClip()); { const d = [...sel][0]; ok(d !== a, 'paste'); eq(get(d).crop, { l: 0, t: 0, r: .5, b: 0 }, 'paste keeps the crop'); fig.remove(d); }
        // Convert to editable parts: the parts together look as the cropped icon did; Fuse: the same again, as one element
        const b0 = bbox(ic), inB = (b, what) => ok(b.x >= b0.x - 1 && b.y >= b0.y - 1 && b.x + b.w <= b0.x + b0.w + 1 && b.y + b.h <= b0.y + b0.h + 1, what + ' reaches past the crop: ' + J([b, b0]));
        sel = new Set([ic]); explodeSel(); await frame(); const parts = [...sel]; ok(parts.length > 3, 'parts'); ok(parts.some(p => get(p).crop), 'no part is cropped'); parts.forEach(p => inB(bbox(p), 'a part'));
        { const U = selBox(); near(U.x, b0.x, 1.5, 'parts: left'); near(U.y, b0.y, 1.5, 'parts: top'); near(U.x + U.w, b0.x + b0.w, 1.5, 'parts: right'); }
        await fuseSel(false); await frame(); const fu = [...sel][0]; eq(get(fu).type, 'custom', 'fused'); ok(/<clipPath id="crop/.test(get(fu).svg) && /class="cropframe"/.test(get(fu).svg), 'the fused element keeps the crops'); inB(bbox(fu), 'the fused element'); eq(get(fu).svg, svgScrub(get(fu).svg), 'svgScrub changes it');
        sel = new Set([fu]); explodeSel(); await frame(); [...sel].forEach(p => inB(bbox(p), 'a part of the fused element')); await fuseSel(false); const fu2 = [...sel][0];
        // a fused element is cropped as a whole
        { const f0 = bbox(fu2); fig.crop(fu2, { r: .5 }); near(bbox(fu2).w, f0.w / 2, 1, 'a fused element cropped again'); fig.remove(fu2); }
        // two cropped shapes fused: the bounds are what shows of both
        { const ba = bbox(a), bb = bbox(b2); sel = new Set([a, b2]); await fuseSel(false); const f = [...sel][0], bf = bbox(f); near(bf.x, Math.min(ba.x, bb.x), 1, 'fused: left'); near(bf.w, Math.max(ba.x + ba.w, bb.x + bb.w) - Math.min(ba.x, bb.x), 1, 'fused: width'); near(bf.h, Math.max(ba.y + ba.h, bb.y + bb.h) - Math.min(ba.y, bb.y), 1, 'fused: height'); }
        // repairs: a crop that is none is dropped, a good one is tidied
        { const mk = c => ({ type: 'shape', id: 'q' + Math.random(), x: 1, y: 1, crop: c }), h = c => healScene({ w: 100, h: 100, objects: [mk(c)] }).objects[0];
          for (const c of [{ l: 2 }, { l: 'x' }, { l: .6, r: .5 }, { t: .5, b: .5 }, 'left', 5, [0.1], { l: -.1 }, { l: 0, t: 0, r: 0, b: 0 }, {}, null, { l: true }, { l: { x: 1 } }, { l: 25 }]) ok(!('crop' in h(c)), 'a bad crop was kept: ' + J(c));
          eq(h({ l: '0.1' }).crop, { l: .1, t: 0, r: 0, b: 0 }, 'a number as text'); eq(h({ l: .123456, b: .2, extra: 1 }).crop, { l: .1235, t: 0, r: 0, b: .2 }, 'tidied'); ok(!('crop' in healScene({ objects: [{ type: 'arrow', id: 'z', x1: 0, y1: 0, x2: 9, y2: 9, crop: { l: .1 } }] }).objects[0]), 'an arrow kept a crop'); }
        // checks: wrong sides and ranges, with what was meant
        { const s = rect(1200, 200, 100, 100); let w = fig.update(s, { crop: { left: .1 } }); ok(w.some(x => /unknown side “left”/.test(x.msg) && /did you mean “l”/.test(x.msg)), 'left: ' + J(w)); ok(!('crop' in get(s)), 'a crop of unknown sides only was kept');
          w = fig.update(s, { crop: { l: 25 } }); ok(w.some(x => /not a fraction/.test(x.msg) && /0\.25/.test(x.msg)), 'percent: ' + J(w)); w = fig.update(s, { crop: { l: .6, r: .6 } }); ok(w.some(x => /leaves nothing/.test(x.msg)), 'nothing left: ' + J(w)); w = fig.update(s, { crop: 'half' }); ok(w.some(x => /is not \{l, t, r, b\}/.test(x.msg)), 'no object: ' + J(w));
          w = fig.update(s, { crop: { l: .1, top: .2 } }); ok(w.some(x => /“top”/.test(x.msg)), 'one unknown side'); eq(get(s).crop, { l: .1, t: 0, r: 0, b: 0 }, 'the known side is kept');
          ok(fig.schema('shape').common.includes('crop'), 'fig.schema'); let th = 0; for (const c of [{ l: 2 }, { left: .1 }, 'x']) try { fig.crop(s, c); } catch (e) { th++; } eq(th, 3, 'fig.crop takes a bad crop'); let t2 = false; try { fig.crop('nope'); } catch (e) { t2 = true; } ok(t2, 'fig.crop: unknown id');
          const p1 = lastSaved; fig.crop(s, { t: .5 }); eq(get(s).crop, { l: 0, t: .5, r: 0, b: 0 }, 'fig.crop'); ok(hist[hist.length - 1] === p1 && lastSaved !== p1, 'fig.crop: not one step'); const p2 = lastSaved; fig.crop(s, { t: .5 }); eq(lastSaved, p2, 'the same crop again made a step'); }
        // text is typed into the whole element: crop mode ends first
        { const t = fig.add('text', { x: 300, y: 700, text: 'Typed', size: 30 }); fig.crop(t, { r: .3 }); cropStart(t); editText(get(t)); ok(!cropping, 'editing in crop mode'); finishEdit(); eq(get(t).crop, { l: 0, t: 0, r: .3, b: 0 }, 'the crop after editing'); }
        // save → load: with crops the file is the figure; without any, load → save changes no byte and writes no crop
        commit(); await flushSave(); await sleep(100); await flushSave();
        { const t = await (await fetch(FILE, { cache: 'no-store' })).text(); ok(/"crop":\{"l":0,"t":0,"r":0\.3,"b":0\}/.test(t), 'the file has no crop'); eq(J(healScene(JSON.parse(t))), J(scene), 'the file, loaded again'); ok(loadText(t), 'loadText'); eq(J(scene), t.replace(/\n/g, ''), 'loaded and written again'); }
        blank(); types.forEach((t, i) => fig.add(t, at(i))); await settle(); commit(); await settle(); await flushSave(); await sleep(100); await flushSave();
        { const t = await (await fetch(FILE, { cache: 'no-store' })).text(); ok(!/"crop":/.test(t), 'a figure without crops has the field in its file'); ok(loadText(t), 'loadText'); await settle(); eq(J(scene), t.replace(/\n/g, ''), 'a figure without crops is not the same after load → save'); }
      });
    }

    // ---------- the app icon (brand/) ----------
    test('brand: the app icon in the top bar, on Home, as the tab icon, and the files of brand/', async () => {
      const paths = el => [...el.querySelectorAll('path,circle')].map(e => e.getAttribute('d') || [e.getAttribute('cx'), e.getAttribute('cy'), e.getAttribute('r')].join(' '));   // the drawing, without ids
      const clean = (s, what) => { const bad = s.match(/<(text|mask|clipPath|image|use|foreignObject|script|style)\b|xlink:|href=/i); ok(!bad, what + ': text, a mask, a clip path or a reference: ' + (bad && bad[0])); eq(svgScrub(s), s, what + ': svgScrub changes it'); };
      const colors = (s, what) => { for (const c of ['#1d4ed8', '#6d28d9', '#f4e7c5', '#d55e00', '#e69f00', '#009e73']) ok(s.includes(c), what + ': the color ' + c + ' is missing'); };
      // the top-bar logo: the small icon drawn inline, at 22 px, inside the Home button that keeps its role and name
      const br = D.querySelector('header .brand'), lg = br && br.querySelector('svg.logo');
      ok(lg, 'the top bar has no svg.logo'); eq([br.getAttribute('role'), br.getAttribute('aria-label'), lg.getAttribute('aria-hidden')], ['button', 'SiliCoDraw: Home, all your figures', 'true'], 'the brand button');
      clean(lg.innerHTML, 'top-bar logo'); colors(lg.innerHTML, 'top-bar logo');
      if (!PHONE()) { const r = lg.getBoundingClientRect(); eq([Math.round(r.width), Math.round(r.height)], [22, 22], 'the logo\'s size'); }
      const gid = lg.querySelector('linearGradient').id; ok(gid && D.querySelectorAll('[id="' + gid + '"]').length === 1, 'the logo\'s gradient id is not unique in the page: ' + gid);
      const hl = D.querySelector('#home svg.hmlogo'); ok(hl, 'Home has no logo'); eq(paths(hl), paths(lg), 'Home\'s logo is the top bar\'s'); ok(hl.querySelector('linearGradient').id !== gid, 'the two logos share a gradient id');
      // the tab icon: the same drawing as a data URI, a home-screen icon file beside it, the browser bar in the top bar's color
      const fl = D.querySelector('link[rel="icon"]'); ok(fl && fl.getAttribute('type') === 'image/svg+xml' && /^data:image\/svg\+xml,/.test(fl.getAttribute('href')), 'no SVG favicon as a data URI');
      const ft = decodeURIComponent(fl.getAttribute('href').replace(/^data:image\/svg\+xml,/, '')), fd = new DOMParser().parseFromString(ft, 'image/svg+xml');
      ok(!fd.querySelector('parsererror') && fd.documentElement.localName === 'svg' && fd.documentElement.getAttribute('viewBox') === '0 0 1024 1024', 'the favicon does not parse as SVG: ' + short(ft));
      clean(ft.replace(/^<svg[^>]*>|<\/svg>$/g, ''), 'favicon'); colors(ft, 'favicon'); eq(paths(fd.documentElement), paths(lg), 'the favicon is the top bar\'s logo');
      eq((D.querySelector('link[rel="apple-touch-icon"]') || {}).getAttribute && D.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'), 'brand/icon-180.png', 'apple-touch-icon');
      { // the browser bar takes the top bar's color, and the flat style drops the logo's shadow, in every style and theme
        const hd = D.querySelector('header'), rgb = c => { const s = D.createElement('i'); s.style.color = c; D.body.appendChild(s); const v = getComputedStyle(s).color; s.remove(); return v; }, p0 = { style: UI.style, theme: UI.theme };
        try { for (const style of ['classic', 'soft', 'flat', 'contrast']) for (const theme of ['light', 'dark']) { fig.prefs({ style, theme });
          eq(rgb((D.querySelector('meta[name="theme-color"]') || {}).content), getComputedStyle(hd).backgroundColor, 'theme-color follows the top bar (' + style + ', ' + theme + ')');
          if (style === 'flat') eq([getComputedStyle(lg).boxShadow, getComputedStyle(hl).boxShadow], ['none', 'none'], 'the flat style keeps a logo shadow (' + theme + ')'); } }
        finally { fig.prefs(p0); }
      }
      // the files: from the program folder (the website build has only the home-screen icon beside its page)
      const get = async (u, type) => { const r = await fetch(u, { cache: 'no-store' }); ok(r.ok, u + ': HTTP ' + r.status); eq((r.headers.get('content-type') || '').split(';')[0], type, u + ': content type'); return new Uint8Array(await r.arrayBuffer()); };
      const png = async (u, n) => { const b = await get(u, 'image/png'); eq([...b.slice(1, 4)], [80, 78, 71], u + ': PNG signature'); if (n) eq([new DataView(b.buffer).getUint32(16), new DataView(b.buffer).getUint32(20)], n, u + ': size'); };
      if (WEB) { await png('brand/icon-180.png', [180, 180]); }
      const base = WEB ? '/brand/' : 'brand/', td = new TextDecoder();
      for (const f of ['icon.svg', 'icon-small.svg', 'icon-macos.svg', 'mark.svg', 'mark-dark.svg', 'lockup.svg', 'lockup-dark.svg']) {
        const t = td.decode(await get(base + f, 'image/svg+xml')), d = new DOMParser().parseFromString(t, 'image/svg+xml');
        ok(!d.querySelector('parsererror'), f + ' does not parse'); ok(d.documentElement.getAttribute('viewBox'), f + ': no viewBox');
        clean(t.replace(/^<svg[^>]*>|<\/svg>\s*$/g, ''), f); ok(/#(?:d55e00|e69f00|009e73)/.test(t), f + ': no paint dots');
        if (f === 'icon-small.svg') eq(paths(d.documentElement), paths(lg), 'brand/icon-small.svg differs from the editor\'s inline logo (paste the new one in)');
        if (f === 'icon.svg') ok(t.includes('#1d4ed8') && t.includes('#6d28d9') && t.includes('#f4e7c5'), 'icon.svg: the tile and palette colors');
      }
      for (const n of [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024]) await png(base + 'icon-' + n + '.png', [n, n]);
      await png(base + 'social-preview.png', [1280, 640]);
      { const b = await get(base + 'icon.ico', 'image/x-icon'), v = new DataView(b.buffer); eq([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)], [0, 1, 6], 'icon.ico header');
        const sz = []; for (let i = 0; i < 6; i++) { const e = 6 + 16 * i, len = v.getUint32(e + 8, true), off = v.getUint32(e + 12, true); ok(off + len <= b.length, 'icon.ico: an entry runs past the end'); sz.push(b[e] || 256); } eq(sz, [16, 24, 32, 48, 64, 256], 'icon.ico sizes'); }
      { const b = await get(base + 'SiliCoDraw.icns', 'image/icns'), v = new DataView(b.buffer); eq(td.decode(b.slice(0, 4)), 'icns', 'icns magic'); eq(v.getUint32(4), b.length, 'icns length');
        const ty = []; for (let o = 8; o < b.length;) { const l = v.getUint32(o + 4); ok(l > 8 && o + l <= b.length, 'icns: an entry runs past the end'); ty.push(td.decode(b.slice(o, o + 4))); eq([...b.slice(o + 9, o + 12)], [80, 78, 71], 'icns ' + ty[ty.length - 1] + ': PNG data'); o += l; }
        eq(ty.sort(), ['ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14', 'icp4', 'icp5'], 'icns entries'); }
      ok(/same license/i.test(td.decode(await get(base + 'README.md', 'text/markdown'))), 'brand/README.md names the license');
    });

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
