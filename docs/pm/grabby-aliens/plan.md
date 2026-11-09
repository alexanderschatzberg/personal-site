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
