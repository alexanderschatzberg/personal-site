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
