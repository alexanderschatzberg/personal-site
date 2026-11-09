# pm log: grabby aliens simulation

Branch: `pm/grabby-aliens` · Plan: `plan.md` · Started: 2026-11-09
State: round 2 implementing

## For the user

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
