# pm log: grabby aliens simulation

Branch: `pm/grabby-aliens` · Plan: `plan.md` · Started: 2026-11-09
State: implementing

## For the user

- 2026-11-09 **check**: Nothing in the repo type-checks TypeScript (typescript / @astrojs/check aren't installed). Want me to add `astro check` to the build?
- 2026-11-09 **review**: The simulation runs on fixed distances, with no cosmic expansion. The grabby aliens papers do include expansion. Adding it later would change how fast bubbles appear to grow.
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
