// three.js view of a SimResult: one Points cloud with per-vertex colour, plus borders.
// 2d flat/torus: orthographic, top-down (drag pans, wheel/pinch zooms at the cursor).
// Sphere: perspective globe. 3d: perspective cube. Both orbit on drag, dolly on wheel/pinch and
// pan on right-drag or shift-drag. The universe is drawn at its comoving positions × the
// displayed scale s(t) (a scale on a group; the position buffer is never rewritten).
// Renders only when something changed or the view is moving.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SimResult, Timeline } from '../types';
import { BorderSet, SEGMENT_FRACTION, slotFrame, slotSegment, type Space } from './borders';
import { civColor } from './palette';
import { MAX_PIXEL_RATIO } from './phone';
import { nearestOnScreen } from './pick';
import { updateRanges } from './ranges';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isDark = () => document.documentElement.dataset.theme === 'dark';
/** Smallest rendered scale: a = 0 would collapse the group to a singular matrix. */
const MIN_SCALE = 1e-4;
/** Opacity of the 3d border patches. */
const PATCH_OPACITY = 0.15;

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Point size in CSS pixels: fewer, bigger dots for small runs. three applies the pixel ratio. */
function pointSize(n: number): number {
  return Math.max(1.5, Math.min(4, 3 * Math.sqrt(4000 / Math.max(1, n))));
}

/**
 * Border drawing. 2d and sphere: one LineSegments (2 vertices per active slot). 3d: one
 * InstancedMesh of translucent quads perpendicular to the edge. Buffers grow by doubling up to
 * edges × 2 slots, and the draw range is the active count.
 */
class BorderLayer {
  readonly set: BorderSet;
  object?: THREE.LineSegments | THREE.InstancedMesh;
  private capacity = 0;
  private visible = true;
  private frame = new Float64Array(7);
  private seg = new Float64Array(6);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private dir = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);
  private at = new THREE.Vector3();
  private size = new THREE.Vector3();
  private patches: boolean;

  constructor(
    private parent: THREE.Object3D,
    private positions: Float32Array,
    edges: Uint32Array,
    private space: Space,
    private colorOf: (civ: number) => THREE.Color,
  ) {
    this.set = new BorderSet(edges, positions.length / 3);
    this.patches = space.dim === 3;
  }

  /** Make room for n slots. Returns true if the buffers were rebuilt (all must be rewritten). */
  private ensure(n: number) {
    if (n <= this.capacity) return false;
    let cap = Math.max(1024, this.capacity);
    while (cap < n) cap *= 2;
    cap = Math.min(cap, this.set.edges.length);
    this.disposeObject();
    this.capacity = cap;
    if (this.patches) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: PATCH_OPACITY, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.object = mesh;
    } else {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 6), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 6), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
      lines.frustumCulled = false;
      this.object = lines;
    }
    this.object.visible = this.visible;
    this.parent.add(this.object);
    return true;
  }

  /** Sync with the timeline. full = every edge and every buffer entry (new run or theme). */
  update(owner: Int32Array, changed: Int32Array | null, changedCount: number, full: boolean) {
    const set = this.set;
    if (set.edges.length === 0) return;
    if (full || !changed) set.sync(owner);
    else set.sync(owner, changed, changedCount);
    const grew = this.ensure(set.activeCount);
    let lo = Infinity, hi = -1;
    const write = (k: number) => {
      const slot = set.active[k];
      this.write(k, slot, set.shown[slot]);
      if (k < lo) lo = k;
      if (k > hi) hi = k;
    };
    if (full || grew) for (let k = 0; k < set.activeCount; k++) write(k);
    else for (let d = 0; d < set.dirtyCount; d++) if (set.dirty[d] < set.activeCount) write(set.dirty[d]);
    this.commit(lo, hi);
  }

  private write(k: number, slot: number, civ: number) {
    const f = this.frame;
    slotFrame(this.positions, this.set.edges, slot, this.space, f);
    const col = this.colorOf(civ);
    if (this.object instanceof THREE.InstancedMesh) {
      this.dir.set(f[3], f[4], f[5]);
      this.q.setFromUnitVectors(this.z, this.dir);
      const s = SEGMENT_FRACTION * f[6];
      this.m.compose(this.at.set(f[0], f[1], f[2]), this.q, this.size.set(s, s, 1));
      this.object.setMatrixAt(k, this.m);
      this.object.setColorAt(k, col);
    } else if (this.object) {
      slotSegment(f, this.space, this.seg);
      const geo = this.object.geometry;
      const pos = geo.getAttribute('position').array as Float32Array;
      const c = geo.getAttribute('color').array as Float32Array;
      pos.set(this.seg, k * 6);
      for (let v = 0; v < 2; v++) {
        c[k * 6 + v * 3] = col.r;
        c[k * 6 + v * 3 + 1] = col.g;
        c[k * 6 + v * 3 + 2] = col.b;
      }
    }
  }

  /** Set the draw range and upload only [lo, hi] of the written entries. */
  private commit(lo: number, hi: number) {
    const n = this.set.activeCount;
    if (this.object instanceof THREE.InstancedMesh) {
      this.object.count = n;
      if (hi < lo) return;
      for (const [attr, size] of [[this.object.instanceMatrix, 16], [this.object.instanceColor!, 3]] as const) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(lo * size, (hi - lo + 1) * size);
        attr.needsUpdate = true;
      }
    } else if (this.object) {
      const geo = this.object.geometry;
      geo.setDrawRange(0, n * 2);
      if (hi < lo) return;
      for (const name of ['position', 'color']) {
        const attr = geo.getAttribute(name) as THREE.BufferAttribute;
        attr.clearUpdateRanges();
        attr.addUpdateRange(lo * 6, (hi - lo + 1) * 6);
        attr.needsUpdate = true;
      }
    }
  }

  setVisible(on: boolean) {
    this.visible = on;
    if (this.object) this.object.visible = on;
  }

  private disposeObject() {
    if (!this.object) return;
    this.object.removeFromParent();
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    if (this.object instanceof THREE.InstancedMesh) this.object.dispose();
    this.object = undefined;
  }

  dispose() {
    this.disposeObject();
  }
}

export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  /** Initial orientation of the globe/cube. */
  private group = new THREE.Group();
  /** Displayed scale s(t). */
  private scaler = new THREE.Group();
  /** Moves the uncentred comoving positions so the box is centred on the origin. */
  private content = new THREE.Group();
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  private persp = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
  private camera: THREE.OrthographicCamera | THREE.PerspectiveCamera = this.ortho;
  private controls?: OrbitControls;
  private points?: THREE.Points;
  private colors?: Float32Array;
  private outline?: THREE.LineSegments;
  private occluder?: THREE.Mesh;
  private borders?: BorderLayer;
  private bordersOn = true;
  private material: THREE.PointsMaterial;
  private result?: SimResult;
  private civColors: THREE.Color[] = [];
  private unclaimed = new THREE.Color();
  private frame = 0;
  private extent = 1; // half-size of what the ortho camera must fit at s = 1
  private cleanup: (() => void)[] = [];
  /** Screen positions for picking, reused between taps. */
  private screenXY = new Float32Array(0);
  /** Called after each rendered frame, e.g. to refresh the scale bar. */
  onView?: () => void;

  constructor(private container: HTMLElement, private reducedMotion: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);
    this.material = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, map: dotTexture(), alphaTest: 0.5 });
    this.scene.add(this.group);
    this.group.add(this.scaler);
    this.scaler.add(this.content);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.cleanup.push(() => ro.disconnect());

    const onVis = () => (document.hidden ? this.stop() : this.request());
    document.addEventListener('visibilitychange', onVis);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis));
    // Right-drag pans; don't open the context menu over the canvas.
    const el = this.renderer.domElement;
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener('contextmenu', noMenu);
    this.cleanup.push(() => el.removeEventListener('contextmenu', noMenu));
    this.resize();
  }

  /** Swap in a new run: rebuilds the point cloud, outline, borders, camera and controls. */
  setResult(r: SimResult) {
    this.result = r;
    const { dim, geometry, sizeGly: L } = r.params;
    const n = r.positions.length / 3;
    this.disposeScene();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    this.colors = new Float32Array(n * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.material.size = pointSize(n);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.content.add(this.points);
    this.group.rotation.set(0, 0, 0);
    this.scaler.scale.setScalar(1);

    const sphere = geometry === 'sphere';
    this.content.position.set(sphere ? 0 : -L / 2, sphere ? 0 : -L / 2, !sphere && dim === 3 ? -L / 2 : 0);

    if (sphere) {
      const R = L / (2 * Math.PI);
      // A background-coloured ball just inside the globe hides its far side.
      this.occluder = new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 48, 32), new THREE.MeshBasicMaterial());
      this.scaler.add(this.occluder);
      this.camera = this.persp;
      this.persp.position.set(0, 0, R * 4.2);
      this.group.rotation.set(0.35, 0, 0);
    } else if (dim === 3) {
      const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(L, L, L));
      this.outline = new THREE.LineSegments(box, new THREE.LineBasicMaterial());
      this.scaler.add(this.outline);
      this.camera = this.persp;
      this.persp.position.set(0, 0, L * 2.6);
      this.group.rotation.set(0.45, -0.6, 0);
    } else {
      this.camera = this.ortho;
      this.ortho.position.set(0, 0, 100);
      this.ortho.zoom = 1;
      this.extent = L / 2;
      if (geometry === 'torus') {
        const h = L / 2;
        const pts = [[-h, -h], [h, -h], [h, -h], [h, h], [h, h], [-h, h], [-h, h], [-h, -h]].map(([x, y]) => new THREE.Vector3(x, y, 0));
        this.outline = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ dashSize: L / 80, gapSize: L / 80 }));
        this.outline.computeLineDistances();
        this.scaler.add(this.outline);
      }
    }
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    const space: Space = { dim, geometry, sizeGly: L };
    this.borders = new BorderLayer(this.content, r.positions, r.edges, space, (c) => this.civColor(c));
    this.borders.setVisible(this.bordersOn);

    this.resize();
    this.setupControls(dim === 2 && !sphere);
    this.applyTheme();
  }

  private setupControls(flat: boolean) {
    this.controls?.dispose();
    const c = new OrbitControls(this.camera, this.renderer.domElement);
    c.target.set(0, 0, 0);
    if (flat) {
      c.enableRotate = false;
      c.zoomToCursor = true;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      c.minZoom = 0.2;
      c.maxZoom = 400;
    } else {
      c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      const d = this.camera.position.length();
      c.minDistance = d / 200;
      c.maxDistance = d * 5;
      // Spin slowly until the viewer touches it (≈ 70 s per turn at 60 fps).
      c.autoRotate = !this.reducedMotion;
      c.autoRotateSpeed = 0.85;
    }
    c.addEventListener('change', () => this.request());
    c.addEventListener('start', () => (c.autoRotate = false));
    c.update();
    c.saveState();
    this.controls = c;
    this.renderer.domElement.style.cursor = flat ? 'move' : 'grab';
  }

  /** Back to the fitted, unzoomed view of this run. */
  resetView() {
    this.controls?.reset();
    this.request();
  }

  private civColor(o: number) {
    return (this.civColors[o] ??= new THREE.Color(civColor(o, isDark())));
  }

  /** Recolour. Pass the timeline after a seek; only `changed` galaxies are touched unless full. */
  update(tl: Timeline, full = false) {
    const c = this.colors;
    if (!c || !this.points) return;
    this.borders?.update(tl.owner, full ? null : tl.changed, tl.changedCount, full);
    const attr = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const ranges = full ? null : updateRanges(tl.changed, tl.changedCount, tl.owner.length, 3);
    if (!ranges || ranges.length > 0) {
      const paint = (g: number) => {
        const o = tl.owner[g];
        const col = o < 0 ? this.unclaimed : this.civColor(o);
        c[g * 3] = col.r;
        c[g * 3 + 1] = col.g;
        c[g * 3 + 2] = col.b;
      };
      if (full) for (let g = 0; g < tl.owner.length; g++) paint(g);
      else for (let k = 0; k < tl.changedCount; k++) paint(tl.changed[k]);
      attr.clearUpdateRanges();
      // null = full upload (no ranges); otherwise upload only the changed stretches.
      if (ranges) for (const r of ranges) attr.addUpdateRange(r.start, r.count);
      attr.needsUpdate = true;
    }
    this.request();
  }

  /** Displayed scale s(t) of the universe (1 = true size today). */
  setScale(s: number) {
    const v = Math.max(MIN_SCALE, s);
    if (this.scaler.scale.x === v) return;
    this.scaler.scale.setScalar(v);
    this.request();
  }

  setBorders(on: boolean) {
    this.bordersOn = on;
    this.borders?.setVisible(on);
    this.request();
  }

  /** The canvas, for pointer listeners (e.g. tap to pick). */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Galaxy nearest to a viewport point within maxPx CSS px, or -1. Projects every galaxy to the
   * screen; points behind the camera, off screen or on the far side of the globe are skipped.
   */
  pick(clientX: number, clientY: number, maxPx: number): number {
    const r = this.result;
    if (!r || !this.points) return -1;
    const pos = r.positions;
    const n = pos.length / 3;
    if (this.screenXY.length !== n * 2) this.screenXY = new Float32Array(n * 2);
    const xy = this.screenXY;
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const world = this.content.matrixWorld.elements;
    const clip = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).multiply(this.content.matrixWorld).elements;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const globe = !!this.occluder;
    const cam = this.camera.position;
    for (let i = 0; i < n; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      xy[2 * i] = xy[2 * i + 1] = NaN;
      if (globe) {
        // World position p on a sphere centred at the origin: visible when the camera is on the
        // outer side of the tangent plane at p, i.e. p · (cam − p) > 0.
        const px = world[0] * x + world[4] * y + world[8] * z + world[12];
        const py = world[1] * x + world[5] * y + world[9] * z + world[13];
        const pz = world[2] * x + world[6] * y + world[10] * z + world[14];
        if (px * (cam.x - px) + py * (cam.y - py) + pz * (cam.z - pz) <= 0) continue;
      }
      const w = clip[3] * x + clip[7] * y + clip[11] * z + clip[15];
      if (!(w > 0)) continue;
      const nx = (clip[0] * x + clip[4] * y + clip[8] * z + clip[12]) / w;
      const ny = (clip[1] * x + clip[5] * y + clip[9] * z + clip[13]) / w;
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;
      xy[2 * i] = rect.left + ((nx + 1) / 2) * rect.width;
      xy[2 * i + 1] = rect.top + ((1 - ny) / 2) * rect.height;
    }
    return nearestOnScreen(xy, clientX, clientY, maxPx);
  }

  /** Rendered world units per CSS pixel at the view's focus (the controls' target). */
  worldPerPixel(): number {
    const h = this.container.clientHeight || 1;
    if (this.camera instanceof THREE.OrthographicCamera) return (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / h;
    const dist = this.controls ? this.camera.position.distanceTo(this.controls.target) : this.camera.position.length();
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2)) / h;
  }

  /** Re-read the theme colours. Call update(tl, true) afterwards to repaint points and borders. */
  applyTheme() {
    const dark = isDark();
    this.unclaimed.setStyle(css('--rule') || (dark ? '#4a4a45' : '#b9b9b2'));
    this.civColors = (this.result?.civs ?? []).map((c) => new THREE.Color(civColor(c.id, dark)));
    if (this.outline) (this.outline.material as THREE.LineBasicMaterial).color.setStyle(css('--rule'));
    if (this.occluder) (this.occluder.material as THREE.MeshBasicMaterial).color.setStyle(css('--bg'));
    this.request();
  }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    // Fit the box at s = 1, leaving room for the overlays at the top and bottom.
    const half = this.extent * 1.25, a = w / h;
    const hh = a >= 1 ? half : half / a;
    Object.assign(this.ortho, { left: -hh * a, right: hh * a, top: hh, bottom: -hh });
    this.ortho.updateProjectionMatrix();
    this.request();
  }

  /** Ask for one frame. Frames keep coming only while the globe/cube auto-spins. */
  request() {
    if (this.frame || document.hidden) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      // With autoRotate on, update() moves the camera and its 'change' asks for the next frame.
      if (this.controls?.autoRotate) this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.onView?.();
    });
  }

  private stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private disposeScene() {
    this.borders?.dispose();
    this.borders = undefined;
    for (const o of [this.points, this.outline, this.occluder]) {
      if (!o) continue;
      o.removeFromParent();
      o.geometry.dispose();
      if (o !== this.points) (o.material as THREE.Material).dispose();
    }
    this.points = this.outline = this.occluder = undefined;
  }

  dispose() {
    this.stop();
    this.cleanup.forEach((f) => f());
    this.controls?.dispose();
    this.disposeScene();
    this.material.map?.dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
