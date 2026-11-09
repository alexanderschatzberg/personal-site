// Page controller: reads params from the URL, runs the worker, drives the timeline,
// the renderer, the drawer and the time bar.
import { createTimeline } from '../timeline';
import { DEFAULTS, type Params, type SimResult, type Timeline } from '../types';
import type { WorkerRequest, WorkerResponse } from '../worker';
import { FIELDS, fmt, fromInput, toInput } from './fields';
import { displayScale, physicalPerRendered, scaleAt } from './growth';
import { advance, endStatus, nextSpeed, span, SPEEDS, step } from './playback';
import { Renderer } from './renderer';
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
  };
  const bordersBtn = $('.g-borders');
  /** Screen length of the scale bar, CSS px (matches .g-scalebar-line in the page). */
  const SCALE_BAR_PX = 100;

  let params: Params = { ...DEFAULTS, ...queryToParams(location.search) };
  let result: SimResult | undefined;
  let tl: Timeline | undefined;
  let t = 0;
  let tSpan = 0; // playable span: 0 .. tLast
  let a = 1; // scale factor at t
  let s = 1; // displayed scale at t
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
  }

  /** Scale the drawn universe for time t, and refresh the a(t) readout. */
  function grow() {
    if (!result) return;
    a = scaleAt(result.scale, result.params.tEndGyr, t);
    s = displayScale(a, result.params.H0);
    out.a.textContent = `a = ${a > 0 && a < 0.01 ? a.toPrecision(2) : a.toFixed(2)}`;
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
    out.time.textContent = t.toFixed(1);
    out.claimed.textContent = n ? ((tl.claimed / n) * 100).toFixed(1) : '0';
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
    }
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

  // ---------- drawer ----------
  function setDrawer(open: boolean) {
    drawer.hidden = !open;
    drawerBtn.setAttribute('aria-expanded', String(open));
    drawerBtn.textContent = open ? '[× params]' : '[params]';
  }
  drawerBtn.addEventListener('click', () => setDrawer(drawer.hidden));
  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setDrawer(false);
      drawerBtn.focus();
    }
  });
  setDrawer(matchMedia('(min-width: 900px)').matches);

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

  // ---------- theme ----------
  new MutationObserver(() => {
    renderer.applyTheme();
    if (tl) renderer.update(tl, true);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  writeForm();
  syncBar();
  run();
}
