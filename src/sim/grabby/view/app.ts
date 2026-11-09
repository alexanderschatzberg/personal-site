// Page controller: reads params from the URL, runs the worker, drives the timeline,
// the renderer, the drawer and the time bar.
import { Space } from '../geometry';
import { createTimeline } from '../timeline';
import { DEFAULTS, RANGES, type Params, type SimResult, type Timeline } from '../types';
import type { WorkerRequest, WorkerResponse } from '../worker';
import { civName, currentMight, mightText, reuseLocalCount, temperamentWord, type LocalCountCache } from './civinfo';
import { FIELDS, fmt, fromInput, TABS, toInput, type Tab } from './fields';
import { displayScale, formatA, physicalPerRendered, runScaleAt } from './growth';
import { advance, endStatus, nextSpeed, span, SPEEDS, step } from './playback';
import { LANDSCAPE_MQ, PORTRAIT_MQ, type Layout } from './layout';
import { civColor } from './palette';
import { capGalaxies, isPhone, PHONE_GALAXY_CAP, phoneParams } from './phone';
import { isTap, PICK_RADIUS_PX } from './pick';
import { Renderer } from './renderer';
import { cycleSnap, snapAfterDrag, snapHeights, stepSnap, type Snap } from './sheet';
import { clampNum, clipSeed, paramsToQuery, queryToParams } from './url';

export function mount(root: HTMLElement) {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const $$ = <T extends Element = HTMLElement>(sel: string) => Array.from(root.querySelectorAll(sel)) as T[];

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = $('.g-stage');
  const form = $<HTMLFormElement>('.g-form');
  const drawer = $('.g-drawer');
  const drawerBtn = $('.g-drawer-toggle');
  const playBtn = $('.g-play');
  const scrubber = $<HTMLInputElement>('.g-scrubber');
  const today = $('.g-today');
  const speedLabel = $('.g-speed-label');
  const out = {
    time: $('.g-time'),
    claimed: $('.g-claimed'),
    alive: $('.g-alive'),
    status: $('.g-status'),
    ended: $('.g-ended'),
    a: $('.g-a'),
    scale: $('.g-scalebar-label'),
    miniTime: $('.g-mini-time'),
    miniPct: $('.g-mini-pct'),
  };
  const bordersBtn = $('.g-borders');
  /** Screen length of the scale bar, CSS px (matches .g-scalebar-line in the page). */
  const SCALE_BAR_PX = 100;

  // Phones start lighter unless the URL says otherwise (see phone.ts).
  const phone = isPhone({ coarse: matchMedia('(pointer: coarse)').matches, screenW: screen.width, screenH: screen.height });
  const start = phoneParams(phone, queryToParams(location.search));
  let params: Params = { ...DEFAULTS, ...start.params };
  let result: SimResult | undefined;
  let tl: Timeline | undefined;
  let t = 0;
  let tSpan = 0; // playable span: 0 .. tLast
  let a = 1; // scale factor at t
  let s = 1; // display scale d(t) = min(a, 1)
  let playing = false;
  let speed = 0;
  let lastFrame = 0;
  let raf = 0;

  let renderer: Renderer;
  try {
    renderer = new Renderer(stage, reducedMotion);
  } catch {
    out.status.textContent = '[webgl unavailable]';
    return;
  }

  // ---------- worker ----------
  let worker: Worker | undefined;
  let runId = 0;
  function run() {
    // A newer run replaces one still in flight.
    worker?.terminate();
    worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    const id = ++runId;
    setPlaying(false);
    root.dataset.busy = 'true';
    root.setAttribute('aria-busy', 'true');
    out.status.textContent = '[simulating…]';
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== id) return;
      worker?.terminate();
      worker = undefined;
      root.dataset.busy = 'false';
      root.removeAttribute('aria-busy');
      if ('error' in e.data) {
        out.status.textContent = '[simulation failed]';
        console.error(e.data.error);
        return;
      }
      out.status.textContent = '';
      load(e.data.result);
    };
    worker.onerror = (e) => {
      if (id !== runId) return;
      root.dataset.busy = 'false';
      root.removeAttribute('aria-busy');
      out.status.textContent = '[simulation failed]';
      console.error(e);
    };
    worker.postMessage({ id, params } satisfies WorkerRequest);
  }

  function load(r: SimResult) {
    result = r;
    space = undefined;
    closeInfo();
    params = { ...r.params };
    writeForm();
    syncBar();
    tl = createTimeline(r);
    renderer.setResult(r);
    tSpan = span(r);
    scrubber.max = String(tSpan);
    const tToday = r.tToday;
    today.hidden = tToday === null || !(tSpan > 0) || tToday > tSpan;
    if (tToday !== null && tSpan > 0) today.style.left = `${(tToday / tSpan) * 100}%`;
    t = 0;
    tl.seek(0);
    renderer.update(tl, true);
    grow();
    readout();
    if (!reducedMotion) setPlaying(true);
  }

  // ---------- time ----------
  function seek(to: number) {
    if (!tl || !result) return;
    t = Math.min(tSpan, Math.max(0, to));
    tl.seek(t);
    renderer.update(tl);
    grow();
    readout();
    showInfo();
  }

  /** Scale the drawn universe for time t, and refresh the a(t) readout. */
  function grow() {
    if (!result) return;
    a = runScaleAt(result, t);
    s = displayScale(a, result.params.H0);
    out.a.textContent = `a = ${formatA(a)}`;
    renderer.setScale(s);
    scaleBar();
  }

  /** Physical Gly spanned by the scale bar at the current a(t) and zoom. */
  function scaleBar() {
    if (!result) return;
    const gly = SCALE_BAR_PX * renderer.worldPerPixel() * physicalPerRendered(a, s);
    out.scale.textContent = `${fmt(Number(gly.toPrecision(2)))} Gly`;
  }
  renderer.onView = scaleBar;

  function readout() {
    if (!tl || !result) return;
    const n = result.positions.length / 3;
    const pct = n ? (tl.claimed / n) * 100 : 0;
    out.time.textContent = t.toFixed(1);
    out.claimed.textContent = n ? pct.toFixed(1) : '0';
    out.miniTime.textContent = t.toFixed(1);
    out.miniPct.textContent = String(Math.round(pct));
    out.alive.textContent = String(tl.alive);
    out.ended.textContent = endStatus(t, result.tLast, result.params.tEndGyr) ?? '';
    if (document.activeElement !== scrubber || !playing) scrubber.value = String(t);
    scrubber.setAttribute('aria-valuetext', `${t.toFixed(1)} billion years`);
  }

  function setPlaying(on: boolean) {
    playing = on && !!result;
    playBtn.textContent = playing ? '[❚❚]' : '[▶]';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    cancelAnimationFrame(raf);
    raf = 0;
    if (playing && !document.hidden) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(tick);
    } else showInfo(); // stopped: replace a throttled frontier count with the exact one
  }

  function tick(now: number) {
    raf = 0;
    if (!playing || !result) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000); // a long pause shouldn't jump
    lastFrame = now;
    seek(advance(t, dt, tSpan, speed));
    if (t >= tSpan) return setPlaying(false);
    raf = requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (!result) return;
    if (!playing && t >= tSpan) seek(0);
    setPlaying(!playing);
  }

  playBtn.addEventListener('click', togglePlay);
  $('.g-restart').addEventListener('click', () => seek(0));
  $('.g-speed').addEventListener('click', () => {
    speed = nextSpeed(speed);
    speedLabel.textContent = `${SPEEDS[speed]}×`;
  });
  scrubber.addEventListener('input', () => seek(Number(scrubber.value)));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && playing) setPlaying(true);
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea')) return;
    if (e.key === ' ') {
      if (target.closest('button, a')) return; // let the focused control handle space
      e.preventDefault();
      togglePlay();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && result) {
      e.preventDefault();
      setPlaying(false);
      seek(step(t, e.key === 'ArrowLeft' ? -1 : 1, tSpan));
    }
  });

  // ---------- view toggles ----------
  function syncBar() {
    for (const b of $$<HTMLButtonElement>('[data-dim]')) b.setAttribute('aria-pressed', String(Number(b.dataset.dim) === params.dim));
    for (const b of $$<HTMLButtonElement>('[data-geometry]')) {
      b.setAttribute('aria-pressed', String(b.dataset.geometry === params.geometry));
      if (b.dataset.geometry === 'sphere') b.disabled = params.dim === 3;
    }
  }

  function apply(next: Partial<Params>) {
    params = { ...params, ...next };
    if (params.dim === 3 && params.geometry === 'sphere') params.geometry = 'flat';
    syncBar();
    const q = paramsToQuery(params);
    history.replaceState(null, '', q ? `?${q}` : location.pathname);
    run();
  }

  for (const b of $$<HTMLButtonElement>('[data-dim]')) b.addEventListener('click', () => apply({ ...readForm(), dim: Number(b.dataset.dim) as 2 | 3 }));
  for (const b of $$<HTMLButtonElement>('[data-geometry]'))
    b.addEventListener('click', () => apply({ ...readForm(), geometry: b.dataset.geometry as Params['geometry'] }));

  $('.g-reset-view').addEventListener('click', () => renderer.resetView());
  bordersBtn.addEventListener('click', () => {
    const on = bordersBtn.getAttribute('aria-pressed') !== 'true';
    bordersBtn.setAttribute('aria-pressed', String(on));
    renderer.setBorders(on);
  });

  // ---------- drawer / sheet / rail ----------
  // Desktop: [params] opens a right drawer. Landscape phone: [≡] opens a right rail. Portrait
  // phone: the drawer is a bottom sheet with three snaps; [≡] and its handle move it.
  const handle = $<HTMLButtonElement>('.g-handle');
  const sheetView = $('.g-sheet-view');
  const top = $('.g-top');
  const portraitMq = matchMedia(PORTRAIT_MQ);
  const landscapeMq = matchMedia(LANDSCAPE_MQ);
  let layout: Layout | undefined;
  let snap: Snap = 'collapsed';

  /** The view toggles and the theme button live in the top bar on desktop, in the sheet/rail on
   *  phones. They are moved, not copied, so their state and listeners stay single. */
  const movable = [$('.g-view'), $('.theme-toggle')].map((el) => ({ el, parent: el.parentElement!, next: el.nextSibling }));
  function placeToggles(inSheet: boolean) {
    if (inSheet) for (const m of movable) sheetView.append(m.el);
    else for (const m of movable) m.parent.insertBefore(m.el, m.next);
  }

  function setDrawer(open: boolean) {
    drawer.hidden = !open;
    drawerBtn.setAttribute('aria-expanded', String(open));
    drawerBtn.textContent = layout === 'landscape' ? (open ? '[×]' : '[≡]') : open ? '[× params]' : '[params]';
  }

  function heights() {
    const bottom = drawer.getBoundingClientRect().bottom;
    const avail = bottom - top.getBoundingClientRect().bottom;
    return snapHeights(root.clientHeight, handle.offsetHeight || 44, avail);
  }

  function setSnap(next: Snap) {
    snap = next;
    drawer.dataset.snap = next;
    drawer.style.setProperty('--sheet-h', `${heights()[next]}px`);
    const open = next !== 'collapsed';
    handle.setAttribute('aria-expanded', String(open));
    drawerBtn.setAttribute('aria-expanded', String(open));
    handle.setAttribute('aria-label', `Parameters sheet, ${next}`);
  }

  function applyLayout() {
    const next: Layout = portraitMq.matches ? 'portrait' : landscapeMq.matches ? 'landscape' : 'desktop';
    if (next === layout) {
      if (next === 'portrait') setSnap(snap); // re-measure after a resize
      return;
    }
    layout = next;
    root.dataset.layout = next;
    placeToggles(next !== 'desktop');
    if (next === 'portrait') {
      drawer.hidden = false;
      drawerBtn.textContent = '[≡]';
      drawerBtn.setAttribute('aria-label', 'Parameters');
      setSnap('collapsed');
    } else {
      delete drawer.dataset.snap;
      drawer.style.removeProperty('--sheet-h');
      if (next === 'landscape') drawerBtn.setAttribute('aria-label', 'Parameters');
      else drawerBtn.removeAttribute('aria-label');
      setDrawer(next === 'landscape' || matchMedia('(min-width: 900px)').matches);
    }
  }

  drawerBtn.addEventListener('click', () => {
    if (layout === 'portrait') setSnap(cycleSnap(snap));
    else setDrawer(drawer.hidden);
  });
  drawer.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (layout === 'portrait') {
      setSnap('collapsed');
      handle.focus();
    } else {
      setDrawer(false);
      drawerBtn.focus();
    }
  });

  // Handle: tap or Enter/Space cycles, ↑/↓ step, drag follows the finger and snaps on release.
  let drag: { id: number; y0: number; h0: number; t0: number; lastY: number; lastT: number; v: number; moved: boolean } | undefined;
  let swallowClick = false;
  handle.addEventListener('click', () => {
    if (swallowClick) return void (swallowClick = false);
    setSnap(cycleSnap(snap));
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    setSnap(stepSnap(snap, e.key === 'ArrowUp' ? 1 : -1));
  });
  handle.addEventListener('pointerdown', (e) => {
    if (layout !== 'portrait' || drag) return;
    handle.setPointerCapture(e.pointerId);
    const now = performance.now();
    drag = { id: e.pointerId, y0: e.clientY, h0: drawer.getBoundingClientRect().height, t0: now, lastY: e.clientY, lastT: now, v: 0, moved: false };
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    if (!drag.moved && isTap(0, e.clientY - drag.y0, 0)) return;
    drag.moved = true;
    drawer.toggleAttribute('data-dragging', true);
    const hs = heights();
    const h = Math.min(hs.full, Math.max(hs.collapsed, drag.h0 + drag.y0 - e.clientY));
    drawer.style.setProperty('--sheet-h', `${h}px`);
    if (now > drag.lastT) drag.v = (drag.lastY - e.clientY) / (now - drag.lastT);
    drag.lastY = e.clientY;
    drag.lastT = now;
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = undefined;
    drawer.removeAttribute('data-dragging');
    if (!d.moved) return; // a tap: the click handler cycles
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
    // A pause before release cancels the flick.
    const v = performance.now() - d.lastT > 100 ? 0 : d.v;
    setSnap(snapAfterDrag(drawer.getBoundingClientRect().height, v, heights()));
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // Tabs (portrait sheet): show one group of fields at a time.
  const tabs = $$<HTMLButtonElement>('.g-tab');
  function selectTab(tab: Tab, focus = false) {
    form.dataset.tab = tab;
    for (const b of tabs) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
  }
  for (const b of tabs) {
    b.addEventListener('click', () => selectTab(b.dataset.tab as Tab));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation(); // not a time step
      const i = TABS.indexOf(b.dataset.tab as Tab) + (e.key === 'ArrowRight' ? 1 : -1);
      selectTab(TABS[(i + TABS.length) % TABS.length], true);
    });
  }

  applyLayout();
  portraitMq.addEventListener('change', applyLayout);
  landscapeMq.addEventListener('change', applyLayout);
  window.addEventListener('resize', applyLayout);

  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;

  function writeForm() {
    for (const f of FIELDS) input(f.key).value = toInput(params[f.key]);
    input('mightModel').value = params.mightModel;
    input('seed').value = params.seed;
    syncForm();
  }

  function syncForm() {
    // Sliders only mirror the number boxes; the boxes hold the true value.
    for (const sl of $$<HTMLInputElement>('input[data-slider]')) {
      const v = fromInput(input(sl.dataset.slider!).value);
      if (v !== null) sl.value = String(v);
    }
    const model = input('mightModel').value;
    for (const f of FIELDS) {
      if (!f.model) continue;
      const off = f.model !== model;
      (input(f.key) as HTMLInputElement).disabled = off;
      input(f.key).closest('.g-field')?.toggleAttribute('data-off', off);
    }
  }
  form.addEventListener('input', (e) => {
    const sl = e.target as HTMLInputElement;
    if (sl.dataset?.slider) input(sl.dataset.slider).value = sl.value;
    syncForm();
  });

  /** Form values, clamped to RANGES. A blank or invalid box keeps the current value. */
  function readForm(): Partial<Params> {
    const next: Partial<Params> = {};
    for (const f of FIELDS) {
      const v = fromInput(input(f.key).value);
      next[f.key] = v !== null ? clampNum(f.key, v) : params[f.key];
    }
    next.galaxies = capGalaxies(phone, next.galaxies!, params.galaxies);
    next.mightModel = input('mightModel').value as Params['mightModel'];
    const seed = clipSeed(input('seed').value);
    next.seed = seed || params.seed;
    return next;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    apply(readForm());
  });
  $('.g-no-expansion').addEventListener('click', () => {
    input('H0').value = '0';
    apply(readForm());
  });
  $('.g-reroll').addEventListener('click', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const seed = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    input('seed').value = seed;
    apply({ ...readForm(), seed });
  });

  // ---------- phone galaxies cap and heavy-run note ----------
  if (phone) {
    const g = input('galaxies') as HTMLInputElement;
    g.max = String(PHONE_GALAXY_CAP);
    const sl = root.querySelector<HTMLInputElement>('input[data-slider="galaxies"]');
    if (sl) sl.max = String(PHONE_GALAXY_CAP);
    const hint = g.closest('.g-field')?.querySelector('.g-hint');
    if (hint) hint.textContent = `range ${fmt(RANGES.galaxies[0])} – ${fmt(PHONE_GALAXY_CAP)} on this device`;
  }
  const note = $('.g-note');
  note.hidden = !start.heavy;
  $('.g-note-close').addEventListener('click', () => (note.hidden = true));

  // ---------- tap for info ----------
  const info = $('.g-info');
  const infoOut = {
    swatch: $('.g-swatch'),
    name: $('.g-info-name'),
    t0: $('.g-info-t0'),
    speed: $('.g-info-speed'),
    temper: $('.g-info-temper'),
    base: $('.g-info-base'),
    model: $('.g-info-model'),
    might: $('.g-info-might'),
    held: $('.g-info-held'),
  };
  let picked = -1;
  let space: Space | undefined;
  /** Last frontier count on the card; reused for a few frames during playback. */
  let counted: LocalCountCache | null = null;
  const sig = (v: number) => fmt(Number(v.toPrecision(3)));

  /** Own galaxies within the frontier radius of g (the engine's frontier count), throttled during playback. */
  function localCount(g: number, civ: number): number {
    const now = performance.now();
    if (reuseLocalCount(counted, g, civ, now, playing)) return counted!.count;
    counted = { g, civ, at: now, count: countWithin(g, civ) };
    return counted.count;
  }

  function countWithin(g: number, civ: number): number {
    const r = result!;
    space ??= new Space(r.positions, r.params.dim, r.params.geometry, r.params.sizeGly);
    if (r.params.frontierRadiusGly >= space.maxDist * (1 + 1e-12)) return tl!.held[civ];
    return space.countWithin(g, r.params.frontierRadiusGly, tl!.owner, civ);
  }

  function showInfo() {
    if (picked < 0 || !tl || !result) return;
    info.hidden = false;
    const o = tl.owner[picked];
    info.toggleAttribute('data-empty', o < 0);
    if (o < 0) {
      infoOut.name.textContent = 'unclaimed galaxy';
      infoOut.swatch.style.background = '';
      return;
    }
    const civ = result.civs[o];
    const p = result.params;
    const held = tl.held[o];
    const local = p.mightModel === 'frontier' ? localCount(picked, o) : null;
    const might = currentMight(p.mightModel, civ.baseMight, held, p.mightExponent, local);
    infoOut.swatch.style.background = civColor(civ.id, document.documentElement.dataset.theme === 'dark');
    infoOut.name.textContent = civName(civ.id);
    infoOut.t0.textContent = `${civ.t0.toFixed(2)} Gyr`;
    infoOut.speed.textContent = `${sig(civ.speed)} c`;
    infoOut.temper.textContent = `${civ.temper.toFixed(2)} · ${temperamentWord(civ.temper)}`;
    infoOut.base.textContent = sig(civ.baseMight);
    infoOut.model.textContent = `might now (${p.mightModel})`;
    infoOut.might.textContent = mightText(p.mightModel, civ.baseMight, might, local);
    infoOut.held.textContent = `${held.toLocaleString('en-US')} ${held === 1 ? 'galaxy' : 'galaxies'}`;
  }

  function closeInfo() {
    picked = -1;
    counted = null;
    info.hidden = true;
  }
  $('.g-info-close').addEventListener('click', closeInfo);

  // A tap (or click) on the canvas picks a galaxy; drags rotate/pan as before. Multi-touch is never a tap.
  const downs = new Map<number, { x: number; y: number; t: number }>();
  let multi = false;
  const canvas = renderer.canvas;
  canvas.addEventListener('pointerdown', (e) => {
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (downs.size > 1) multi = true;
  });
  const up = (e: PointerEvent) => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    const wasMulti = multi;
    if (downs.size === 0) multi = false;
    if (!d || wasMulti || e.type === 'pointercancel' || e.button > 0) return;
    if (!isTap(e.clientX - d.x, e.clientY - d.y, performance.now() - d.t)) return;
    const g = renderer.pick(e.clientX, e.clientY, PICK_RADIUS_PX);
    if (g < 0) return closeInfo();
    picked = g;
    showInfo();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  // ---------- theme ----------
  new MutationObserver(() => {
    renderer.applyTheme();
    if (tl) renderer.update(tl, true);
    showInfo();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  writeForm();
  syncBar();
  run();
}
