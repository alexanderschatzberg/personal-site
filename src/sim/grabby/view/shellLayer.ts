// three.js side of the 3d territory shells: owns the shell worker, sends it owner snapshots
// (latest wins), turns its replies into one translucent Mesh per civ inside the points' own group
// (so display scale, rotation, zoom and pan apply), crossfades updates, sorts the shells back to
// front, and raycasts them for picking. No grid work happens here: that is all in the worker.
import * as THREE from 'three';
import type { SimResult } from '../types';
import type { ShellRequest, ShellResponse } from './shellWorker';
import { gridSize, KERNEL_RADIUS, SIGMA_CELLS } from './shellfield';
import {
  isoLevel,
  ISO_FRACTION,
  LatestWins,
  SHELL_FACE_OPACITY,
  SHELL_FADE_MS,
  SHELL_RIM_OPACITY,
  SHELL_RIM_POWER,
  SHARED_WALL_DRAWN_TWICE,
  type CivShell,
  type ShellHit,
} from './shells';

const VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uFade;
uniform float uFace;
uniform float uRim;
uniform float uPower;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  // Fresnel: faint face-on, stronger where the surface turns edge-on, so overlapping shells
  // keep visible outlines. abs(): both sides of the surface are drawn.
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float a = mix(uFace, uRim, pow(1.0 - facing, uPower)) * uFade;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

interface Shown {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  fade: number;
  target: number;
}

interface CivMeshes {
  cur?: Shown;
  old?: Shown;
  centroid: [number, number, number];
}

export class ShellLayer {
  private group = new THREE.Group();
  private worker: Worker;
  private queue = new LatestWins<{ owner: Int32Array; civCount: number }>();
  private seq = 0;
  private civs = new Map<number, CivMeshes>();
  private last = 0;
  private visible = true;
  private disposed = false;
  private fadeMs: number;
  private v = new THREE.Vector3();

  constructor(
    parent: THREE.Object3D,
    r: SimResult,
    private colorOf: (civ: number) => THREE.Color,
    reducedMotion: boolean,
    /** Ask the renderer for a frame. */
    private request: () => void,
  ) {
    this.fadeMs = reducedMotion ? 0 : SHELL_FADE_MS;
    parent.add(this.group);
    const n = r.positions.length / 3;
    const G = gridSize(n);
    const periodic = r.params.geometry === 'torus';
    console.info(
      `[grabby] shells: G = ${G} for ${n} galaxies, σ = ${SIGMA_CELLS} cells (kernel radius ${KERNEL_RADIUS}), iso = ${isoLevel().toPrecision(3)} ` +
        `(${ISO_FRACTION} × one galaxy's mean blurred peak), ${periodic ? 'periodic' : 'flat'}; opacity ${SHELL_FACE_OPACITY} face-on → ${SHELL_RIM_OPACITY} ` +
        `at grazing angles (power ${SHELL_RIM_POWER}), crossfade ${this.fadeMs} ms; touching territories share one wall, ` +
        `${SHARED_WALL_DRAWN_TWICE ? 'drawn twice (once in each civ colour)' : 'drawn once'}`,
    );
    this.worker = new Worker(new URL('./shellWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<ShellResponse>) => this.receive(e.data);
    this.worker.onerror = (e) => {
      console.error('[grabby] shell worker failed', e);
      this.next();
    };
    this.worker.postMessage({ type: 'init', positions: r.positions.slice(), L: r.params.sizeGly, G, periodic } satisfies ShellRequest);
  }

  /** Queue a snapshot of `owner` (copied now). Older waiting snapshots are dropped. */
  submit(owner: Int32Array, civCount: number) {
    const job = this.queue.submit({ owner: owner.slice(), civCount });
    if (job) this.send(job);
  }

  private send(job: { owner: Int32Array; civCount: number }) {
    this.worker.postMessage({ type: 'job', seq: ++this.seq, owner: job.owner, civCount: job.civCount } satisfies ShellRequest, [job.owner.buffer]);
  }

  private next() {
    const job = this.queue.finish();
    if (job) this.send(job);
  }

  private receive(msg: ShellResponse) {
    if (this.disposed) return;
    this.next();
    if ('error' in msg) {
      console.error('[grabby] shell job failed', msg.error);
      return;
    }
    const seen = new Set<number>();
    for (const s of msg.shells) {
      seen.add(s.civ);
      this.show(s);
    }
    for (const [civ, m] of this.civs) if (!seen.has(civ) && m.cur) this.retire(m);
    this.request();
  }

  private makeMesh(s: CivShell): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const geo = this.makeGeometry(s);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: this.colorOf(s.civ).clone() },
        uFade: { value: 0 },
        uFace: { value: SHELL_FACE_OPACITY },
        uRim: { value: SHELL_RIM_OPACITY },
        uPower: { value: SHELL_RIM_POWER },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.userData.civ = s.civ;
    this.group.add(mesh);
    return mesh;
  }

  /** New geometry for a civ. A shell still fading in just takes it; a settled one crossfades to it. */
  private show(s: CivShell) {
    let m = this.civs.get(s.civ);
    if (!m) this.civs.set(s.civ, (m = { centroid: s.centroid }));
    m.centroid = s.centroid;
    if (m.cur && m.cur.target === 1 && m.cur.fade < 1) {
      const geo = m.cur.mesh.geometry;
      m.cur.mesh.geometry = this.makeGeometry(s);
      geo.dispose();
      return;
    }
    if (m.cur) this.retire(m);
    const mesh = this.makeMesh(s);
    m.cur = { mesh, fade: this.fadeMs ? 0 : 1, target: 1 };
    mesh.material.uniforms.uFade.value = m.cur.fade;
  }

  private makeGeometry(s: CivShell) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(s.normals, 3));
    return geo;
  }

  /** Fade the civ's current shell out (dropping any shell already fading out). */
  private retire(m: CivMeshes) {
    if (m.old) this.drop(m.old);
    m.old = m.cur;
    m.cur = undefined;
    if (m.old) m.old.target = 0;
  }

  private drop(s: Shown) {
    s.mesh.removeFromParent();
    s.mesh.geometry.dispose();
    s.mesh.material.dispose();
  }

  /** Advance the crossfades. Returns true while any is still moving (keep the frames coming). */
  tick(now: number): boolean {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    const step = this.fadeMs ? dt / this.fadeMs : 1;
    let moving = false;
    for (const [civ, m] of this.civs) {
      for (const key of ['cur', 'old'] as const) {
        const s = m[key];
        if (!s) continue;
        if (s.fade !== s.target) {
          s.fade = s.target > s.fade ? Math.min(s.target, s.fade + step) : Math.max(s.target, s.fade - step);
          s.mesh.material.uniforms.uFade.value = s.fade;
        }
        if (s.fade !== s.target) moving = true;
        else if (s.target === 0) {
          this.drop(s);
          m[key] = undefined;
        }
      }
      if (!m.cur && !m.old) this.civs.delete(civ);
    }
    if (!moving) this.last = 0;
    return moving;
  }

  /** Draw order back to front by each civ's centroid distance from the camera (after the points). */
  sort(camera: THREE.Camera) {
    if (!this.visible) return;
    const cam = camera.position;
    const order: [number, CivMeshes][] = [];
    for (const m of this.civs.values()) {
      this.v.set(m.centroid[0], m.centroid[1], m.centroid[2]);
      this.group.localToWorld(this.v);
      order.push([this.v.distanceToSquared(cam), m]);
    }
    order.sort((a, b) => b[0] - a[0]);
    order.forEach(([, m], i) => {
      if (m.old) m.old.mesh.renderOrder = 1 + 2 * i;
      if (m.cur) m.cur.mesh.renderOrder = 2 + 2 * i;
    });
  }

  /** Re-read the civ colours (after a theme change). */
  recolor() {
    for (const [civ, m] of this.civs)
      for (const s of [m.cur, m.old]) if (s) (s.mesh.material.uniforms.uColor.value as THREE.Color).copy(this.colorOf(civ));
    this.request();
  }

  setVisible(on: boolean) {
    this.visible = on;
    this.group.visible = on;
  }

  /** Shell hits along a ray (world space), with the hit points in the galaxies' own coordinates. */
  hits(raycaster: THREE.Raycaster): ShellHit[] {
    if (!this.visible) return [];
    const meshes: THREE.Object3D[] = [];
    for (const m of this.civs.values()) if (m.cur) meshes.push(m.cur.mesh);
    this.group.updateWorldMatrix(true, true);
    return raycaster.intersectObjects(meshes, false).map((h) => {
      const p = this.group.worldToLocal(h.point.clone());
      return { distance: h.distance, civ: h.object.userData.civ as number, point: [p.x, p.y, p.z] };
    });
  }

  dispose() {
    this.disposed = true;
    this.worker.terminate();
    for (const m of this.civs.values()) for (const s of [m.cur, m.old]) if (s) this.drop(s);
    this.civs.clear();
    this.group.removeFromParent();
  }
}
