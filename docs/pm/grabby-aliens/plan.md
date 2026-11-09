# Plan: grabby aliens simulation

## Goal

A full-window page at `/projects/grabby-aliens/` that simulates grabby civilizations spreading through a universe of galaxies. It uses the "Theater" layout (design 05 at https://claude.ai/artifact/BMtctWHYUezTDgngJzEfaT): the simulation fills the window, the controls sit in small overlays, settings live in a `[params]` drawer and a time bar runs along the bottom. It matches the site's look: IBM Plex Mono, the colour tokens in `src/styles/global.css`, `[bracket]` buttons and the dark/light toggle.

The shared contract is `src/sim/grabby/types.ts` (Params, DEFAULTS, RANGES, SimResult, Timeline). Both units build against it. Neither may change it without reporting first.

## Acceptance criteria

1. The same Params and seed always give the same SimResult (deterministic). A different seed gives a different one.
2. Geometry works in 2d (flat, torus, sphere) and 3d (flat, torus). Sphere is disabled in 3d.
3. Every numeric param can be changed within RANGES from the drawer. `[apply]` reruns the simulation off the main thread, and `[reroll]` picks a new seed.
4. Time runs forwards, backwards (the scrubber can be dragged back), plays at several speeds and pauses.
5. All three might models (power, log, frontier) can be chosen from the drawer.
6. A civilization never arises in a galaxy that is already owned. A civ with temperament 0 never conquers anything.
7. The defaults (types.ts DEFAULTS) produce a handful to a few dozen civilizations.
8. 2d flat/torus uses an orthographic top-down view. 2d sphere is a rotating globe you can drag. 3d is a cube you can drag to rotate.
9. The page reads the site theme (`data-theme` on `<html>`, same localStorage key as `Base.astro`) and its toggle switches it.
10. The params and seed are kept in the URL query string, so a run can be shared.
11. A project card for it appears on `/projects/` and links to the page.
12. `npm run build` passes and `npm test` passes.
13. simulate() with 50,000 galaxies in 3d finishes in under ~3 s in Node on a laptop.

## Out of scope

- Cosmic expansion: distances are fixed (comoving), with no Hubble flow.
- Individual planets. A galaxy is a point with a planet count.
- A poster/preview image for the card. The card shows its placeholder.
- Sound and mobile-specific gestures beyond drag-to-rotate.

## Units

### U1 — engine

Owns `src/sim/grabby/rng.ts`, `geometry.ts`, `engine.ts`, `timeline.ts`, `src/sim/grabby/*.test.ts`, plus the vitest devDependency and a `"test": "vitest run"` script in `package.json`. It reads `src/sim/grabby/types.ts`, the contract, which it must not change.

The algorithm, which is a specification and not a suggestion:

1. **RNG.** `rng.ts` hashes the seed string (e.g. cyrb128) into sfc32 or mulberry32. All randomness comes from it, in a fixed order, so results are deterministic. Never use Math.random.
2. **Clamp** the Params to RANGES and merge them over DEFAULTS. If speedMin > speedMax, swap them; do the same for the might range. `geometry: 'sphere'` with `dim: 3` becomes `'flat'`.
3. **Positions** are uniform. Flat or torus: a square or cube of side sizeGly, from 0 to size. Sphere: uniform on the surface of a sphere with radius sizeGly/(2π), centred at the origin.
4. **Distance** (`geometry.ts`):
   - flat: Euclidean.
   - torus: minimum-image (wrap each axis at sizeGly).
   - sphere: great-circle distance, R·angle.
5. **Neighbour graph.** Each galaxy links to its k nearest under the metric (k = 8 in 2d, 12 in 3d), symmetrised. Build it with a uniform grid or bucket so it isn't O(n²). Torus buckets wrap. For the sphere, bucket by 3d position and use chord distance to rank. Expansion travels along these edges.
6. **Origins.** The chance that a point ever produces a civ is q = 1 − exp(−pLife · planetsPerGalaxy · REAL_GALAXIES / galaxies). Each point that succeeds gets an origin time t0 = tEndGyr · u^(1/(hardSteps+1)). The civ draws speed uniform in [speedMin, speedMax], temper = clamp(normal(temperMean, temperSpread)), and baseMight uniform in [mightMin, mightMax]. A candidate whose galaxy is already owned at t0 never arises and is not added to `civs`. Civ ids are assigned in order of arising.
7. **Event loop.** A binary-heap priority queue keyed by (t, sequence number).
   - An `arise` event sets the owner and pushes arrivals to its neighbours.
   - An arrival of civ A at galaxy g from galaxy s, at t = t_send + d(s,g)/A.speed, is ignored if A no longer owns s at arrival time, i.e. the front was cut.
   - If g is unowned, A colonizes it and pushes arrivals from g.
   - If g is owned by A, the arrival is ignored.
   - If g is owned by B, then:
     - On the first contact of the ordered pair (A,B), log `meet` and decide A's stance towards B once: war with probability A.temper (log `war` or `peace`). The stance persists for that ordered pair.
     - If A is at peace with B, A stops there.
     - If A is at war with B, a battle: attacker might mA = might(A, g), defender mB = might(B, g) × defenderBonus, and A wins with probability mA/(mA+mB). A win is a `conquer`: ownership changes and A pushes arrivals from g. A loss is a `repel`. At most one battle per (A, g, source s), so there are no retry loops.
     - When a civ's held count reaches 0, log `extinct`.
   - Stop when the queue is empty or the next t > tEndGyr.
8. **Might.**
   - power: base·N^α.
   - log: base·ln(1+N).
   - frontier: base·(galaxies A owns within frontierRadiusGly of g). Use the grid, and count at least 1.
   - N is the civ's held count at that moment.
9. **Output.** A SimResult with events sorted by t. Each OwnershipEvent has `prev` set. The log gets arise, meet, war, peace, extinct and repel events, and `conquer` events only for a civ's first conquest of each other civ, so the log stays short.
10. **Timeline** (`timeline.ts`). `createTimeline(r)` keeps a cursor into `events`. Seeking forwards applies events; seeking backwards un-applies them using `prev`. It keeps `owner`, `held`, `claimed`, `alive` and `changed` up to date incrementally.

Tests (vitest, red-first), at least:
- determinism, and that a different seed differs
- torus wrap distance and sphere great-circle distance
- no civ arises on an owned galaxy
- temper 0 for everyone means no `conquer` events
- defenderBonus 5 with equal might makes conquests rarer than with bonus 1, over a few seeds
- seeking to t, then 0, then t gives the same owner array as a fresh timeline seeking to t, and `held` sums equal `claimed`
- clamping and the swap of an inverted range
- the defaults give between 3 and 80 civs on a handful of seeds (report the actual counts)
- a 50k-galaxy 3d run is timed and reported

Prove it with `npx vitest run src/sim/grabby`.

### U2 — page, renderer and controls

Owns:
- `src/pages/projects/grabby-aliens.astro`
- `src/sim/grabby/view/**`
- `src/sim/grabby/worker.ts`
- `src/content/projects/grabby-aliens.md`

It may make small edits to `src/layouts/Base.astro` (e.g. a `bare` prop that hides the site header and footer and lets the page fill the window) and to `src/components/ProjectCard.astro` (if an internal `url` needs handling).

It reads `types.ts`, `Base.astro`, `src/styles/global.css` (the tokens), `ProjectCard.astro`, `src/lib.ts` (projectHref, projectHasPage), `src/content.config.ts`, `src/demos/example-project.ts` (how three.js is used here), and the design file at `/private/tmp/claude-501/-Users-alexander-Desktop-developer-personal-site/d8e646cc-3d49-47ae-b535-b3370ff49ae4/scratchpad/grabby/project/Theater.dc.html`, which is the layout to reproduce.

U2 builds against the contract only. To run its page before U1 lands, it may add stub `src/sim/grabby/engine.ts` and `timeline.ts` that satisfy the contract (a few fake civs growing in circles), in **one commit whose subject starts with `TEMP stub`**. The PM will drop them for U1's files at merge.

What to build:
- **Page.** It uses Base (bare) so it gets the theme script, fonts and tokens. The root is full-viewport (`100dvh`) and the canvas fills it. The overlays follow Theater.dc.html:
  - Top-left: `← zander schatzberg ~/projects/grabby-aliens`, linking to /projects/.
  - Top-right: `[2d] [3d] · [flat] [torus] [sphere] · [params] [dark]`. Sphere is disabled when 3d is on.
  - A readout under the top-left link: the time in Gyr (large), % claimed, and civs alive.
  - A right drawer with every Params field. Number fields show their RANGES. There is a might-model select with α and frontier radius fields, a seed field, and `[apply]` and `[reroll]` buttons.
  - Along the bottom: `[◀◀] [▶] [▶▶]`, a scrubber from 0 to tEndGyr with a "today" mark at TODAY_GYR, and a speed label.
  - The drawer stacks or overlays sensibly at phone width.
  - Use real buttons, inputs and labels, aria-labels on the icon buttons, and a visible focus.
- **Worker** (`worker.ts`). It receives Params, calls `simulate`, and posts the SimResult back, transferring `positions`. Load it with `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`. Show a "simulating…" state while it runs.
- **Renderer** (`view/`). three.js Points with per-vertex colour.
  - Unclaimed galaxies are dim grey, the theme's rule colour.
  - Each civ gets a colour from a palette that works in both themes (start from the mock's palette: light `#b4532a #2f5fa8 #8a7314 #3f7a3c #7d4fa0`, dark `#e07a52 #6f9be0 #c9b04a #7fb37a #b48fd6`). Extend it deterministically for more civs, e.g. by rotating hue at the same lightness.
  - On seek, update only the colours of the `changed` galaxies.
  - Cameras:
    - 2d flat/torus: orthographic, fit to the square. The torus shows a dashed boundary.
    - Sphere: perspective, globe, drag to rotate.
    - 3d: perspective, cube outline, drag to rotate.
  - Keep pointer drag small and dependency-free, or use three's OrbitControls from `three/examples/jsm`.
  - Stop the render loop when the tab is hidden. Re-render only when something changed or the view is moving.
  - Rebuild colours when the theme changes.
- **Playback.** Play advances time at a rate (e.g. 1×, 4× or 16× of a base rate, such that 1× crosses tEndGyr in ~60 s). `▶▶` cycles the speed and `◀◀` restarts. The scrubber seeks both ways. Don't autoplay if `prefers-reduced-motion` is set. Keyboard: space plays and pauses, and ←/→ step, but not while focus is in an input.
- **URL.** Params that differ from DEFAULTS are written to the query string with `history.replaceState` on apply, and read on load.
- **Card.** `grabby-aliens.md` has title "Grabby Aliens", the description "[One-line description, written later.]", `url: /projects/grabby-aliens/`, `order: 2` and no body, so the slug route makes no page and the card links to the url.

Prove it with `npm run build` (the page appears in `dist/projects/grabby-aliens/index.html` and the worker chunk is emitted). Also run `npm run dev` and check that the page returns 200 with curl. There's no browser automation, so report what you could not see.

## Waves

- **Wave 1, in parallel:** U1 (engine) and U2 (page, using stubs). Each has its own worktree and branch.
- **Integration:** merge U1, then U2, taking U1's engine and timeline over U2's stubs. Then gate with `npm test && npm run build`.

---

# Round 2: cosmic expansion, zoom/pan, borders, review minors

These were added by the user after round 1. The contract additions in `types.ts` are Params `H0` and `omegaLambda` (with RANGES and DEFAULTS), the constants `KMS_MPC_TO_PER_GYR` and `SCALE_SAMPLES`, and SimResult `scale`, `tToday` and `edges`. `tEndGyr` is now presented as the universe's **lifetime**. The user's choices:
- real ΛCDM cosmology
- the universe visibly grows on screen: true size until today, slower after
- borders drawn as outline lines (in 3D, faint translucent patches)
- zoom and pan in both 2D and 3D

## Acceptance criteria (round 2)

14. With H0 = 0, simulate() gives exactly the same SimResult events and log as before the cosmology change (static universe, a ≡ 1), for the same params and seed.
15. With the defaults, tToday is 13.8 ± 0.1 Gyr.
16. Fronts travel in comoving distance at dχ/dt = v / a(t), and a galaxy beyond the event horizon is never reached.
17. H0 and ΩΛ can be edited in the drawer, and the run-length field is labelled "lifetime".
18. The displayed universe grows with time as specified below, with a scale bar and an a(t) readout.
19. Zoom (wheel or pinch) and pan (drag; in 3D right-drag or shift-drag, while plain drag orbits) work in every view, and there is a `[reset view]` control.
20. Borders between civs, and between a civ and unclaimed space, are drawn and update while scrubbing.
21. The round 1 review minors are fixed (listed under U4 and U3).

## U3: cosmology in the engine

This unit **owns** `src/sim/grabby/cosmology.ts` (new), `engine.ts`, `geometry.ts`, and the engine tests. It must not change `types.ts`; report instead.

- **`cosmology.ts`** works for flat ΛCDM, with Ωm = 1 − ΩΛ and H = H0 × KMS_MPC_TO_PER_GYR in 1/Gyr.
  - Scale factor: a(t) = (Ωm/ΩΛ)^{1/3} · sinh^{2/3}(1.5·√ΩΛ·H·t). When ΩΛ = 0 it is (1.5·H·t)^{2/3}. When H0 = 0, a ≡ 1.
  - Today: tToday = (2/(3H√ΩΛ))·asinh(√(ΩΛ/Ωm)), or 2/(3H) when ΩΛ = 0. Return null if it falls outside [0, tEnd]. When H0 = 0, return TODAY_GYR.
  - Conformal time: η(t) = ∫₀ᵗ dt'/a(t'). Build a table that handles the t^{-2/3} singularity at 0, for example a nonuniform grid t = tEnd·s³ with s uniform, or analytic behaviour near 0. It must be monotonic, with an inverse η → t by interpolation or bisection. When H0 = 0, η(t) = t exactly.
  - It exports the `scale` sampling as SCALE_SAMPLES values over [0, tEnd].
- **`engine.ts`**: an arrival time is no longer t_send + d/v. Solve η(t_arr) = η(t_send) + d/v, where d is the comoving distance (the existing metric on `positions`). If the right-hand side is beyond η(tEnd), don't push the arrival. With H0 = 0 this must reduce *exactly* to the old arithmetic, so branch on it. The frontier radius stays comoving.
- **Fill** `scale`, `tToday` and `edges`: the existing kNN graph, deduplicated, with i < j.
- **Frontier performance** (review minor 5): the worst case dim 3, galaxies 50000, sizeGly 10, frontierRadiusGly 100, pLife 1e-10, mightModel frontier must finish in under 10 s in Node. One shortcut: when the radius covers the whole universe, use the held count. Pick whatever approach gets there, document it, and add a timed test.
- **Tests, red-first:**
  - criterion 14: snapshot-compare H0 = 0 against the pre-change engine. Commit a small fixture generated from the round 1 engine *before* changing it.
  - criterion 15
  - η is monotonic and inverts round-trip
  - an event-horizon test: a 2-galaxy-style or tiny setup where the target is beyond the horizon is never reached, but would be reached with H0 = 0
  - `edges` is valid: i < j, no duplicates, and it matches the kNN
  - the frontier worst-case timing
- **Report** the default civ counts with expansion on, for the same 6 seeds as round 1 (5eed, a, b, c, d, e), and the 50k 3d timing.

## U4: view (expansion display, zoom and pan, borders, review fixes, view tests)

This unit **owns** `src/pages/projects/grabby-aliens.astro`, `src/sim/grabby/view/**`, `worker.ts`, and new `src/sim/grabby/view/*.test.ts` (vitest is installed now; `npm test` runs it). It must not change `types.ts` or engine files. To run the page before U3 lands, it may add stub fields in the worker only, inside a commit whose subject starts with `TEMP stub`. Better: just build defensively, treating a missing `scale` as all 1s, a missing `edges` as computed in the view from nothing (no borders), and a missing `tToday` as TODAY_GYR, then remove those fallbacks once U3's fields are guaranteed by the contract. Simplest of all: don't stub, and code against the contract as written.

- **Drawer:**
  - an `H0` field (km/s/Mpc; 0 = no expansion)
  - an `ΩΛ` field
  - rename tEnd to "lifetime (Gyr)"
  - a `[no expansion]` preset button that sets H0 to 0
- **Growth display.** Let a(t) be the interpolated `scale`. The displayed scale is:
  - s(t) = a(t) when a ≤ 1
  - s(t) = 1 + ln(a(t)) when a > 1
  - s(t) = 1 when H0 = 0

  Rendered positions are the centred comoving position × s(t), via a scale on the Points object or a group, not by rewriting the buffer. The sphere radius scales the same way. When the 2D flat/torus/3D view is unzoomed, the camera fits the box at s = 1, so early times show a small dense universe growing to fill the view by today and then slowly overflowing it. In the bottom-left corner put:
  - a scale bar: a fixed screen length labelled with the physical Gly it spans at the current a(t) and zoom
  - a readout: `a = 0.42`
- **Today mark.** It uses `tToday` (hidden if null).
- **Zoom and pan:**
  - Orthographic 2D: wheel or pinch zooms at the cursor and drag pans.
  - Perspective sphere and 3D: drag orbits, wheel or pinch zooms (dolly), and right-drag or shift-drag pans.
  - three's OrbitControls is fine here: `three/examples/jsm/controls/OrbitControls.js`, with rotation disabled in 2D.
  - Add `[reset view]` to the top bar.
  - Keep the existing auto-spin-until-touched behaviour.
- **Borders.** For each edge (i, j) where owner[i] ≠ owner[j] and at least one is owned, draw a short segment for each owned side.
  - In 2D, the segment is perpendicular to the edge at its midpoint, long enough to roughly match the edge length (about 0.6 × the edge length), offset slightly toward that owner's side, in that owner's colour.
  - On the sphere, the segment is tangent to the surface.
  - In 3D, draw a small translucent quad (opacity ~0.15) perpendicular to the edge at the midpoint, in the owner's colour.
  - Implementation: one preallocated LineSegments geometry for 2D/sphere, or InstancedMesh for 3D, sized for every edge × 2, with the draw range set to the active count.
  - Recompute after each seek, but only touching edges incident to `changed` galaxies. Keep an index from galaxy to its incident edges.
  - Torus edges that wrap must not draw a line across the whole map. Use the minimum-image midpoint, and draw at both images or skip the wrapped portion.
  - Borders get a `[borders]` toggle, on by default.
- **Review fixes (round 1):**
  1. Number inputs keep full precision: `fmt` is only for display labels, never for values written into inputs, or the value round-trips exactly.
  2. Range inputs: don't let a slider's step snap the URL or param value. Pair each slider with a number input that holds the true value, or set the step to `any` and keep a separate state value.
  3. Remove the double pixel-ratio multiplication on `material.size` (renderer.ts:97); three already applies the pixel ratio.
  4. Upload only the changed colour ranges. Use `attribute.addUpdateRange` / `clearUpdateRanges` (three r160+), coalescing contiguous ranges, or fall back to a full upload when more than ~25% changed.
- **Tests, red-first:**
  - url round-trip, including full-precision values and hostile values
  - field coverage of every RANGES key, including H0 and omegaLambda
  - palette determinism
  - playback math
  - the growth display function s(a)
  - border-segment selection for a tiny owner array plus edges, including the torus wrap case
- **Prove it** with `npx vitest run src/sim/grabby/view`, `npm run build`, and a dev server curl 200 on port 4331 (stop it afterwards: `npx astro dev stop` or kill it).

## Waves (round 2)

U3 and U4 run in parallel in fresh worktrees off pm/grabby-aliens. Merge U3, then U4. Gate: `npm test && npm run build`. Then one fresh reviewer on the round 2 diff.

## Round 2 addendum: the run ends when nothing more can be reached

The user wants the simulation to end once no more galaxies can be reached.

- **U3 (engine):**
  - The run ends when the queue is empty: no pending arrival can land before tEnd, which includes fronts stopped by the event horizon, and no pending arise remains.
  - Pending `arise` candidates whose galaxy is already owned should be dropped as soon as their galaxy is taken, or skipped cheaply. Either way they must not keep the run "alive" artificially. (An arise on a still-unowned galaxy is a real possible event and counts.)
  - Set `tLast` to the time of the final event when the queue emptied before tEnd, and to tEnd otherwise.
  - Add a test: with expansion on and the defaults, tLast < tEndGyr whenever the queue empties. Also a tiny case where everything is claimed early and tLast is that time.
- **U4 (view):**
  - The scrubber and playback span 0 to `tLast`, not tEnd.
  - At the end, playback stops, and the readout shows `ended · no more galaxies reachable` (or `ended · lifetime reached` when tLast = tEnd).
  - The lifetime field stays as an upper cap.
  - The 1× playback speed is based on the span to tLast.

## Round 2b: the life window

U3 found that with expansion on, the defaults never spread. Origins drawn from ∝ t^6 on [0, 200 Gyr] land after 100 Gyr, when a(t) is too large for any front to reach a neighbour. The user chose a separate **life window**. The contract gained `lifeWindowGyr` (default 20, range [1, 1000]).

**U5 (one agent, engine and view):**
- Engine: t0 = min(lifeWindowGyr, tEndGyr) · u^(1/(hardSteps+1)).
- The H0 = 0 snapshot fixture (criterion 14) was generated with an implicit window of tEnd. Its cases must pass `lifeWindowGyr` equal to their tEndGyr explicitly, so the fixture stays valid unchanged. Don't regenerate the fixture.
- View: add a "life window (Gyr)" field next to hard steps. The fields/RANGES coverage test must include it, and so must the URL round-trip.
- Add a test: with the defaults (expansion on), at least one civ conquers or colonizes at least one galaxy other than its origin on most of the 6 seeds. Report the measured counts per seed: civs, colonize events, tLast.

## Round 3: the phone experience (U6)

The user's choices:
- a bottom-sheet layout
- lighter defaults on phones
- tap a civilization for info
- a landscape layout

### Acceptance criteria (round 3)

22. **Portrait phone** (coarse pointer, width ≤ 600px, portrait):
    - The simulation fills the screen (100dvh, safe-area insets respected).
    - The top bar shows `← grabby aliens` and `[≡]`.
    - Under it, a compact readout: `24.8 Gyr · 31%`.
    - The bottom has a slim time bar: `[▶]`, the scrubber and the speed. All targets are ≥ 44px.
    - Above the time bar sits a **bottom sheet** with a grab handle. It has three snap states: collapsed (handle only), half (about 50dvh) and full (about 90dvh). It moves by dragging the handle, by tapping the handle or `[≡]`, and by keyboard (the handle is a button, with aria-expanded set).
    - Inside the sheet:
      - tabs `space · life · war · cosmos` that group the existing FIELDS
      - the top-bar toggles: 2d/3d, geometry, borders, reset view, theme
      - `[apply]` and `[reroll]` pinned at the sheet's bottom
    - The sheet scrolls internally, and the page itself never scrolls.
    - Dragging inside the canvas never moves the sheet, and dragging the sheet never moves the camera.
23. **Landscape phone** (coarse pointer, height ≤ 500px, landscape): the controls move to a right side rail (about 300px, scrollable) like the desktop drawer. The time bar sits along the bottom of the canvas area, and the readout is top-left. There is no bottom sheet.
24. **Lighter phone defaults:**
    - On a phone (coarse pointer and min(screen w, h) ≤ 600), when the URL has no `galaxies` param, the run uses 2000 galaxies.
    - The galaxies field caps at 15000 on phones.
    - A URL value above the cap is honoured, and a small dismissible note appears: `heavy run · may be slow on this device`.
    - The device pixel ratio is capped at 2 on phones.
    - The phone-default logic is pure and tested: a function of the device flags and URL params that returns the effective params.
25. **Tap for info:** tapping (or clicking, on desktop too) near a galaxy picks the nearest galaxy within ~24px on screen (use a raycaster Points threshold, or screen-space projection). If its galaxy is owned at the current time, a small card shows:
    - the civ's colour swatch and name (`civ-07`)
    - when it arose (Gyr)
    - its speed in c
    - its temperament (0–1) with the word peaceful, wary or aggressive (<0.33, <0.67, else)
    - its base might
    - its current might under the selected model (for frontier, show `base × local galaxies`, evaluated at the tapped galaxy, or `—` if too costly)
    - the galaxies it holds now

    The card updates while scrubbing and closes on `[×]` or a tap on empty space. A tap on an unowned galaxy shows `unclaimed galaxy`. The current-might maths is pure and tested.
26. Desktop is unchanged, apart from the tap-for-info card, which also works there by click. Existing tests stay green, and `npm run build` passes.

### Files

U6 owns:
- `src/pages/projects/grabby-aliens.astro`
- `src/sim/grabby/view/**`, including new tests

No engine or `types.ts` changes. If the civ info needs a field the contract lacks, compute it in the view from `SimResult.civs` and the timeline, or report.

Prove it with:
- `npm test`
- `npm run build`
- a dev server curl 200 on port 4332, stopped afterwards

There is no browser, so list what couldn't be verified visually. Simulating a phone viewport with curl isn't possible.

---

# Round 4: user feedback after first use

The user asked for:
1. auto zoom-out at the true expansion rate, with the run ending only when no empire can reach any more galaxies
2. a 2D torus shown as a donut
3. galaxy structure like our universe (a cosmic web)
4. a click opening the region clicked, never an unclaimed galaxy (broken in 3D)
5. complex settings under an advanced drawer
6. tooltips on anything confusing

The contract changes, already in `types.ts`:
- Params `clumpiness` (default 0.7, range 0–1) and `webScaleGly` (default 12, range 2–100).
- `tEndGyr` is now a hidden safety cap: default 5000, range up to 10000, not shown in the UI.
- `SimResult.scale` is sampled over **[0, tLast]**, not [0, tEnd].

## Acceptance criteria (round 4)

27. **Run end.** The run ends at the last event, when nothing more can happen: no pending arrival can land (fronts are cut, at peace, or beyond the event horizon) and no pending arise remains. tEndGyr is only a safety cap. With the defaults, tLast < tEndGyr on all 6 seeds (report the values). With H0 = 0, the run ends when every reachable galaxy is settled.
28. **Camera.** Rendered positions are physical: comoving × a(t). The camera's auto-zoom keeps the today view fixed after today. Effective display scale is d(t) = min(a(t), 1), so before today the universe visibly grows from a dense start and after today the map holds still. The scale bar and the `a =` readout show the true values. The user's own zoom and pan multiply on top. `[reset view]` returns to the auto-fit.
29. **Donut torus.** In 2D torus mode, the galaxies, borders, picking and camera use a donut embedding:
    - u = x/size, v = y/size, both mapped to angles.
    - Major radius R and minor radius r with R ≈ 2.5r, sized to fit the view.
    - The simulation metric stays the flat torus (minimum image). Only the drawing changes.
    - Drag rotates the donut, as on the globe.
    - 3D torus stays a cube, but shows faded wrap copies of the territory colours across each face, or a clear wrap indicator. It is never mis-drawn.
30. **Cosmic web.** Positions come from a Voronoi kinematic model (van de Weygaert):
    - Nuclei are placed with mean spacing webScaleGly.
    - Each galaxy starts uniform and is moved away from its nearest nucleus towards the Voronoi walls (3D) or edges (2D), and into filaments and nodes by a second step, by a fraction set by clumpiness.
    - clumpiness 0 means exactly uniform, consuming the RNG in the same order as before, so the H0 = 0 fixture still matches when its cases pin clumpiness 0 and tEndGyr 200.
    - It works for flat (clamped to the box), torus (wraps) and sphere (nuclei on the sphere, great-circle distance, result re-projected onto the surface), in 2D and 3D.
    - It is deterministic.
    - Tests check a measurable statistic: clustering is stronger than uniform. For example, the nearest-neighbour distance variance, or the count-in-cells variance, rises with clumpiness. Report the measured values.
31. **Click picks a region.** Clicking or tapping opens the info card only for an **owned** galaxy:
    - Among owned galaxies within about 24px on screen of the pointer, pick the nearest on screen. In 3D, prefer the one closest to the camera within a few px.
    - Galaxies hidden on the far side of the globe or donut don't count.
    - If no owned galaxy is within range, close any open card and open nothing.
    - Unclaimed galaxies are never shown, so the "unclaimed galaxy" card is removed.
    - The pick runs on the same transformed positions as the drawing: physical scale, donut embedding, user zoom.
    - Pure selection logic is tested in 2D, in 3D with depth, and on the donut.
32. **Advanced drawer.**
    - The main drawer or phone sheet shows only the basics: galaxies, clumpiness, p(life), speed min/max, temperament mean, seed, `[apply]` and `[reroll]`.
    - `[advanced]` expands a section, or a tab on phones, holding everything else: universe size, web scale, planets per galaxy, hard steps, life window, temperament spread, might model, might min/max, α, frontier radius, defender bonus, H0, ΩΛ and `[no expansion]`.
    - The open or closed state is remembered in localStorage (wrapped in try/catch).
    - tEndGyr is not shown anywhere.
33. **Tooltips.**
    - Every field except the obvious ones gets a `[?]` button. Every advanced field has one, as do clumpiness, p(life), temperament and speed. The button opens a short plain-English explanation.
    - It works on hover, keyboard focus (Escape closes it) and tap. Use `aria-describedby` or an accessible popover.
    - Only one is open at a time, and it stays inside the screen on phones.
    - The copy lives in one table (`view/help.ts`). A test checks that every field shown in the advanced drawer has help text.
    - The text is accurate to the model. Don't invent facts: cite "Planck 2018" for the H0/ΩΛ defaults and "Hanson et al. 2021" for hard steps. Other numbers come only from types.ts comments.
34. **Gate:** `npm test` and `npm run build` pass, and no existing test is weakened.

## U7: engine (criteria 27, 30, plus the scale span)

U7 owns `engine.ts`, `geometry.ts`, `cosmology.ts`, a new `structure.ts`, and the engine tests and fixture case files. The fixture JSON must not be regenerated: cases pin `clumpiness: 0` and `tEndGyr: 200` explicitly, along with the existing `lifeWindowGyr` pin. Watch the time-span edge cases:
- The cosmology table is now built over [0, tEndGyr = 5000], so check the table resolution near today and the etaInf tail.
- `scale` is sampled over [0, tLast] after the run.

## U8: view (criteria 28, 29, 31, 32, 33)

U8 owns `grabby-aliens.astro`, `view/**` and `worker.ts`.

It must also make sure that:
- the `lifetime` field is removed
- the scrubber spans [0, tLast], as now
- the readout's end text no longer says "lifetime reached". Use `ended · cap reached` when tLast = tEndGyr, otherwise `ended · no more galaxies in reach`.

## Waves

U7 and U8 run in parallel in separate worktrees off pm/grabby-aliens. Merge U7, then U8. Gate. Then one reviewer on the round 4 diff.
