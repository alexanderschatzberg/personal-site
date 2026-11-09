# pm log: grabby aliens simulation

Branch: `pm/grabby-aliens` · Plan: `plan.md` · Started: 2026-11-09
State: awaiting merge OK

## For the user

- 2026-11-09 **check**: Donut picking assumes the donut points and the occluder share one transform, which is true today. If the donut drawing is ever restructured, re-check tap accuracy edge-on.
- 2026-11-09 **review**: When the cosmic web leaves clumps no front can leave, the engine adds the fewest shortest 'bridge' links between them, so empires can cross voids. Without bridges, galaxies in an isolated clump could never be reached.
- 2026-11-09 **review**: Cosmic web scale: real voids are ~0.1–0.3 Gly across, smaller than the ~1.5 Gly spacing between the simulated dots (each dot is ~5×10⁸ galaxies). The default web scale (12 Gly) is enlarged so the structure is visible. It is not to scale.
- 2026-11-09 **review**: The 2D torus is drawn as a donut, but the physics still uses a flat torus: distances don't stretch on the outside of the donut the way they would on a real ring surface. The 3D torus stays a cube with wrap hints.
- 2026-11-09 **unfixed (minor)**: The phone sheet tabs have no matching tabpanel role, so screen-reader semantics are incomplete. The heavy-run note and the info card can overlap at the top in portrait.
- 2026-11-09 **review**: A phone [apply] writes galaxies=2000 into the URL, so a link shared from a phone opens a 2000-galaxy run on desktop too.
- 2026-11-09 **review**: Civilization names are zero-based (civ-00, civ-01, …).
- 2026-11-09 **review**: A shared link replays exactly in the same browser engine. Across browsers (Safari vs Chrome), tiny floating-point differences in Math.exp/log could in principle change a run. Making that bulletproof would need hand-written maths functions; probably not worth it.
- 2026-11-09 **check**: Nobody has seen the page in a browser yet. The agents have no browser, so the WebGL rendering, globe and cube rotation, overlays, phone layout and theme repaint are unverified. Open `npm run dev` → /projects/grabby-aliens/.
- 2026-11-09 **review**: These choices were made by the page agent: the drawer opens by default at widths ≥900px; the 2d/3d and geometry buttons rerun the simulation straight away; the globe and cube spin slowly until you drag them (not with reduced motion); speeds are 1×/4×/16×; ←/→ steps 1% of the run.
- 2026-11-09 **check**: Nothing in the repo type-checks TypeScript (typescript / @astrojs/check aren't installed). Want me to add `astro check` to the build?
- 2026-11-09 **review** [resolved: round 2 adds ΛCDM]: The simulation ran on fixed distances, with no cosmic expansion.
- 2026-11-09 **review**: The default run spans 0–200 Gyr, not 0–40 as in the mockup. At 0.3–0.9c, crossing a 93 Gly universe takes 100+ Gyr, so 40 Gyr would end with most of it empty. You can change this with the tEnd field in the drawer.
- 2026-11-09 **review**: Default p(life) is 1e-22 per planet. Each dot stands for 2e12 ÷ 4000 = 5×10⁸ real galaxies, so this gives roughly 20 civilizations per run. Nobody knows the real value; I tuned it for a readable run.
- 2026-11-09 **review**: The 2×10¹² galaxy count (Conselice et al. 2016) is a high estimate. Some later measurements suggest a few hundred billion. It only affects how p(life) maps to the number of civilizations.
- 2026-11-09 **review**: The war rule is mine: the stance is decided once per pair at first contact, there is one battle per front arrival, and there are no retries. Repelled fronts stop.

## Notes

- 2026-11-09 Phase 0: The user chose: all three might models (selectable), hard-steps origin times, a rotating globe for the sphere, and local worktrees. The user picked Theater layout 05.
- 2026-11-09 Phase 1: Expansion travels along a k-nearest-neighbour graph with travel time distance/speed, not continuous spheres. This handles torus and sphere metrics and per-galaxy battles uniformly. The whole history is precomputed and the timeline replays it, which makes time reversal cheap.
- 2026-11-09 Phase 1: There are two parallel units. U2 builds against stubs that are dropped at merge. The contract (`src/sim/grabby/types.ts`) was written by the PM before branching.
- 2026-11-09 Phase 2: U1 engine done (77k tokens, 4 commits, 20 tests; mutation-checked several). Defaults gave 9–13 civs over 6 seeds; 50k 3d run 352 ms. Merged into pm/grabby-aliens; tests green.
- 2026-11-09 Phase 2: tsc not installed, so engine is not type-checked beyond vitest's type stripping. Build (astro/vite) also strips types. Logged below.
- 2026-11-09 Phase 2: U2 page done (107k tokens, 4 commits). It wrote no unit tests because vitest wasn't in node_modules when it ran (U1 installed it concurrently, and an install pruned it). It smoke-checked the URL round-trip, palette, playback maths and the stub timeline with throwaway scripts, and diffed the built site against the baseline: the existing pages are unchanged apart from the new card.
- 2026-11-09 Phase 3: Merged U1, then U2. The add/add conflicts on engine.ts and timeline.ts were resolved to U1's versions, dropping the TEMP stubs. Gate: `npm test` 20/20, `npm run build` OK, and the worker chunk was emitted.
- 2026-11-09 Phase 4: Round 1 review (102k tokens): 7 minor findings, no blocker or major. Verified and folded into round 2:
  - URL params drift through the fmt rounding and slider steps
  - double pixel ratio on the dot size
  - full colour-buffer upload every frame
  - the frontier model's worst case is slow
  - no view tests
  Not fixed: determinism across browsers. Math.exp/log/pow can differ in the last bit between JS engines, so a shared URL could differ between Safari and Chrome. Logged as a user item.
- 2026-11-09 Phase 2 (round 2): The user added cosmic expansion (ΛCDM, H0 + ΩΛ, lifetime = tEnd), a growing display (true size until today, log after), zoom/pan in 2D and 3D, and civ borders as outline lines (translucent patches in 3D). The contract gained H0, omegaLambda, scale, tToday and edges. Units U3 (engine) and U4 (view) are in parallel.
- 2026-11-09 Phase 2 (round 2): U4 view done (9 commits, 33 view tests). The palette test passed against unchanged code, so it was not shipped. Its TEMP stub commit 9fd3c62 must be dropped at merge, and only after U3's engine fills edges/scale/tToday. Choices made: [no expansion] applies immediately; every param is held in a number box, and the sliders are companions only; border buffers grow by doubling instead of being preallocated.
- 2026-11-09 Phase 3 (round 2): Merged U3 then U4 and reverted U4's TEMP stub (45024c7). Gate 80/80 tests, build OK. U3 measured tToday 13.797 Gyr and an event horizon of 16.56 Gly. U3 found the defaults never spread with expansion (origins land after 100 Gyr); the user chose a life window.
- 2026-11-09 Round 2b: U5 added lifeWindowGyr (default 20), committed on the feature branch. 83/83 tests, build OK. Per seed with the defaults (civs/colonize/conquer/tLast): 5eed 13/722/4/149.6, a 25/1471/90/157.8, b 24/1745/226/187.5, c 17/1083/53/146.3, d 19/1515/27/163.8, e 19/1212/69/146.8.
- 2026-11-09 Round 3: The user asked for a phone experience: a bottom sheet, lighter phone defaults, tap-for-info and landscape. U6 is a single agent on the feature branch. The final adversarial review covers rounds 2–3 together after it.
- 2026-11-09 Round 3: U6 phone layout done (5 commits, 105 tests, build OK). PM one-liner: Base.astro adds viewport-fit=cover only for bare pages, so the safe-area CSS works on the sim page and other pages are unaffected. U6 caveats went to the final review: a phone [apply] writes galaxies=2000 to the URL; civ names are zero-based (civ-00); the tabs lack a tabpanel; the note and the info card can overlap; there may be a brief desktop-bar flash on phones before the JS runs.
- 2026-11-09 Phase 4 (rounds 2–3 review, 145k tokens): 1 major, 2 minor.
  - Major (verified against three r187 WebGLAttributes.js, which clears updateRanges itself after upload): renderer.ts:154/164/363 pre-clear update ranges and drop ranges from an earlier seek that haven't been uploaded yet. A pending theme full-upload followed by a partial seek uploads only the partial ranges. The result is stale dot and border colours.
  - Minor: Float32 scale overflows to Infinity at H0 ≥ ~105 with tEnd 1000, giving a NaN group scale.
  - Minor: the frontier info card counts the neighbourhood on every frame.
  All three go to fix round 1.
- 2026-11-09 Phase 5 fix round 1: 3 commits (584a620, eab6073, 28627ba), 114 tests. Re-review: findings 1 and 3 closed. Finding 2 moved: clamping a(t) to 3e38 freezes growth and shows the wrong a and scale bar past t≈595 Gyr at H0=150/ΩΛ=0.99/tEnd=1000. New minor: hidden border layer accumulates updateRanges without bound. Both are cheap, so fix round 2. Contract change by the PM: SimResult.scale is now Float64Array (a max ≈ e^153 within RANGES, finite as a double).
- 2026-11-09 Phase 5 fix round 2: 1c5ad90 (scale Float64, no clamp, formatA) and fda9101 (UploadTracker caps pending ranges at 64, then switches to a full upload). The PM read the small fix diff directly, skipping a third reviewer agent to save tokens, and found no new issues. Note: a seek that changes more than 64 separate ranges now does a full colour upload, which is cheap. Gate: 118/118 tests, build OK.
- 2026-11-09 Round 4: User feedback after use:
  - the camera tracks the true a(t), with growth only before today
  - the run ends only when nothing more is reachable; tEnd is now a hidden 5000 Gyr safety cap
  - a donut torus in 2D
  - a cosmic web via a Voronoi kinematic model, with clumpiness and web scale
  - clicks pick owned regions only
  - an advanced drawer and tooltips
  Contract updated. U7 (engine) and U8 (view) run in parallel.
- 2026-11-09 Round 4: U8 view done (6 commits, 94 view tests). Tests changed to follow the round 4 spec:
  - growth: "1+ln a" became "d = min(a, 1)".
  - end texts updated.
  - The lifetime-label test became "tEndGyr never shown".
  - The space/life/war/cosmos tabs test became a basic/advanced test.
  The PM checked each change against criteria 28, 32 and 33: they track the spec and none of them weakens a check.
  - UI constants: DEPTH_PX 4, donut 2(R+r) = size, initial tilt -0.9 rad, fit margin 1.3.
  - Known limitation: a front-facing point hidden by the other side of the tube at grazing angles can still be picked.
- 2026-11-09 Round 4: U7 engine done (7 commits).
  - Cosmic web via a Voronoi kinematic model. Clustering rises with clumpiness: count-in-cells variance/mean in flat 2d goes 0.90 → 4.72 → 30.3.
  - Judgement call: added Borůvka "bridges" so the kNN graph stays connected when the web splits it into clumps (about 30 islands otherwise). 50k 2d went from 165 to 837 ms.
  - Default tLast per seed is 139–188 Gyr, all below the 5000 cap. With H0 = 0 every galaxy gets settled.
  - Merged U7, then U8. The PM updated the `edges` comment in types.ts. Gate: 160/160 tests, build OK.
- 2026-11-09 Round 4 review (138k tokens): 1 major, 2 minor.
  - Major: donut picking ignored self-occlusion (the torus is non-convex).
  - Minor: the planetsPerGalaxy help text was wrong.
  - Minor: the web-scale clamp was silent.
  Fixed in ccefe65 / ad6341c / 87bf07e. The PM read torusBlocks and the toLocal transform: it marches the SDF from the point to the camera in the donut's local space, under uniform scale. It matches a brute-force march with 0 differences. No third reviewer was spawned. Gate: 170/170 tests, build OK.
