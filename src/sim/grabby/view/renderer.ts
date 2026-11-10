// three.js view of a SimResult: one Points cloud with per-vertex colour, plus borders.
// 2d flat: orthographic, top-down (drag pans, wheel/pinch zooms at the cursor).
// Sphere: perspective globe. 2d torus: perspective donut (see donut.ts; the sim metric stays the
// flat torus). 3d: perspective cube, dashed when its faces wrap. These orbit on drag, dolly on
// wheel/pinch and pan on right-drag or shift-drag. The universe is drawn at its comoving
// positions × the display scale d(t) = min(a, 1) (a scale on a group; the position buffer is
// never rewritten), and the user's zoom and pan multiply on top.
// Renders only when something changed or the view is moving.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SimResult, Timeline } from '../types';
import { BorderSet, SEGMENT_FRACTION, slotFrame, slotSegment, type Space } from './borders';
import { civColor } from './palette';
import { MAX_PIXEL_RATIO } from './phone';
import { dotStyle } from './dots';
import { donutRadii, donutSegment, embedPositions } from './donut';
import { pickOwnedNear, projectForPick, ScreenGrid, torusVisible, type Facing } from './pick';
import { updateRanges } from './ranges';
import { UploadTracker } from './upload';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isDark = () => document.documentElement.dataset.theme === 'dark';
/** Smallest rendered scale: a = 0 would collapse the group to a singular matrix. */
const MIN_SCALE = 1e-4;
/** Opacity of the 3d border patches. */
const PATCH_OPACITY = 0.15;
/** The background-coloured occluders sit this fraction inside the globe / donut surface. */
const OCCLUDER_SHRINK = 0.985;

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


/**
 * Border drawing. 2d and sphere: one LineSegments (2 vertices per active slot). 3d: one
 * InstancedMesh of translucent quads perpendicular to the edge. Buffers grow by doubling up to
 * edges × 2 slots, and the draw range is the active count.
 */
class BorderLayer {
  readonly set: BorderSet;
  object?: THREE.LineSegments | THREE.InstancedMesh;
  /** Pending GPU uploads of the object's per-slot attributes, with floats per slot. */
  private uploads: [UploadTracker, number][] = [];
  private capacity = 0;
  private visible = true;
  private frame = new Float64Array(7);
  private seg = new Float64Array(6);
  private mapped = new Float64Array(6);
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
    /** Maps a flat segment into the drawn space (the donut); absent = drawn as is. */
    private mapSegment?: (seg: Float64Array, out: Float64Array) => void,
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
      this.uploads = [[new UploadTracker(mesh.instanceMatrix), 16], [new UploadTracker(mesh.instanceColor), 3]];
    } else {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 6), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 6), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
      lines.frustumCulled = false;
      this.object = lines;
      this.uploads = ['position', 'color'].map((name): [UploadTracker, number] => [new UploadTracker(geo.getAttribute(name) as THREE.BufferAttribute), 6]);
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
      if (this.mapSegment) this.mapSegment(this.seg, this.mapped);
      const geo = this.object.geometry;
      const pos = geo.getAttribute('position').array as Float32Array;
      const c = geo.getAttribute('color').array as Float32Array;
      pos.set(this.mapSegment ? this.mapped : this.seg, k * 6);
      for (let v = 0; v < 2; v++) {
        c[k * 6 + v * 3] = col.r;
        c[k * 6 + v * 3 + 1] = col.g;
        c[k * 6 + v * 3 + 2] = col.b;
      }
    }
  }

  /** Set the draw range and upload [lo, hi] of the written entries (with any still pending). */
  private commit(lo: number, hi: number) {
    const n = this.set.activeCount;
    if (this.object instanceof THREE.InstancedMesh) this.object.count = n;
    else if (this.object) this.object.geometry.setDrawRange(0, n * 2);
    if (hi < lo) return;
    for (const [up, size] of this.uploads) up.markRange(lo * size, (hi - lo + 1) * size);
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
    this.uploads = [];
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
  private colorUpload?: UploadTracker;
  private outline?: THREE.LineSegments;
  private occluder?: THREE.Mesh;
  private borders?: BorderLayer;
  /** 2d torus: galaxy positions on the donut and their outward normals. */
  private donut?: { world: Float32Array; normals: Float32Array };
  private bordersOn = true;
  private material: THREE.PointsMaterial;
  private result?: SimResult;
  private civColors: THREE.Color[] = [];
  private unclaimed = new THREE.Color();
  private frame = 0;
  private extent = 1; // half-size of what the ortho camera must fit at s = 1
  private cleanup: (() => void)[] = [];
  /** Screen positions and depths for picking, reused between taps. */
  private screenXY = new Float32Array(0);
  private depth = new Float32Array(0);
  /** The pick grid for the view it was built for (matrices, camera, canvas rect); rebuilt only
   *  when a tap comes after the view changed. */
  private pickCache?: { key: Float64Array; grid: ScreenGrid; visible?: (i: number) => boolean };
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
    this.pickCache = undefined;
    const { dim, geometry, sizeGly: L } = r.params;
    const n = r.positions.length / 3;
    this.disposeScene();

    const sphere = geometry === 'sphere';
    const donut = dim === 2 && geometry === 'torus';
    this.donut = donut ? embedPositions(r.positions, L) : undefined;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.donut ? this.donut.world : r.positions, 3));
    this.colors = new Float32Array(n * 3);
    const colorAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', colorAttr);
    this.colorUpload = new UploadTracker(colorAttr);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.content.add(this.points);
    this.group.rotation.set(0, 0, 0);
    this.scaler.scale.setScalar(1);

    const centred = sphere || donut;
    this.content.position.set(centred ? 0 : -L / 2, centred ? 0 : -L / 2, !centred && dim === 3 ? -L / 2 : 0);

    if (donut) {
      const { R, r: tube } = donutRadii(L);
      // A background-coloured donut just inside the surface hides its far side.
      this.occluder = new THREE.Mesh(new THREE.TorusGeometry(R, tube * OCCLUDER_SHRINK, 48, 128), new THREE.MeshBasicMaterial());
      this.scaler.add(this.occluder);
      this.camera = this.persp;
      this.persp.position.set(0, 0, this.fitDistance(R + tube));
      this.group.rotation.set(-0.9, 0, 0);
    } else if (sphere) {
      const R = L / (2 * Math.PI);
      // A background-coloured ball just inside the globe hides its far side.
      this.occluder = new THREE.Mesh(new THREE.SphereGeometry(R * OCCLUDER_SHRINK, 48, 32), new THREE.MeshBasicMaterial());
      this.scaler.add(this.occluder);
      this.camera = this.persp;
      this.persp.position.set(0, 0, R * 4.2);
      this.group.rotation.set(0.35, 0, 0);
    } else if (dim === 3) {
      // A wrapping (torus) cube gets a dashed outline, like the 2d wrap, plus the page's note.
      const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(L, L, L));
      const wraps = geometry === 'torus';
      this.outline = new THREE.LineSegments(box, wraps ? new THREE.LineDashedMaterial({ dashSize: L / 60, gapSize: L / 60 }) : new THREE.LineBasicMaterial());
      if (wraps) this.outline.computeLineDistances();
      this.scaler.add(this.outline);
      this.camera = this.persp;
      this.persp.position.set(0, 0, L * 2.6);
      this.group.rotation.set(0.45, -0.6, 0);
    } else {
      this.camera = this.ortho;
      this.ortho.position.set(0, 0, 100);
      this.ortho.zoom = 1;
      this.extent = L / 2;
    }
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    const space: Space = { dim, geometry, sizeGly: L };
    const { R, r: tube } = donutRadii(L);
    const map = donut ? (seg: Float64Array, out: Float64Array) => donutSegment(seg, L, R, tube, out) : undefined;
    this.borders = new BorderLayer(this.content, r.positions, r.edges, space, (c) => this.civColor(c), map);
    this.borders.setVisible(this.bordersOn);

    this.resize();
    this.setupControls(dim === 2 && !sphere && !donut);
    this.applyTheme();
  }

  /** Camera distance that fits a ball of this radius (with a margin for the overlays) in the
   *  current viewport, on narrow portrait screens too. */
  private fitDistance(radius: number): number {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const half = Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2) * Math.min(1, w / h);
    return (radius * 1.3) / half;
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
    const up = this.colorUpload!;
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
      // null = full upload; otherwise only the changed stretches, on top of any still pending.
      if (ranges) for (const r of ranges) up.markRange(r.start, r.count);
      else up.markFull();
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
   * The owned galaxy a tap at a viewport point opens, or -1 (see pickOwned). Projects every galaxy
   * with the drawing's own transform (display scale, donut, user zoom) into a screen grid, once
   * per view; points behind the camera, off screen or on the far side of the globe or donut are
   * left out. A tap then looks only at the grid cells around it, and asks the (costly) donut
   * self-occlusion test only of those candidates.
   */
  pick(clientX: number, clientY: number, maxPx: number, owner: Int32Array): number {
    const r = this.result;
    if (!r || !this.points) return -1;
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const viewProj = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const model = this.content.matrixWorld.elements;
    const cam = this.camera.position;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const key = Float64Array.from([...model, ...viewProj, cam.x, cam.y, cam.z, rect.left, rect.top, rect.width, rect.height]);
    const c = this.pickCache;
    if (!c || c.key.length !== key.length || c.key.some((v, i) => v !== key[i])) {
      const n = r.positions.length / 3;
      if (this.screenXY.length !== n * 2) {
        this.screenXY = new Float32Array(n * 2);
        this.depth = new Float32Array(n);
      }
      // The donut's occluder (same radii as setResult's mesh) sits in the scaler, as content does
      // with no offset, so it shares the points' local space and world matrix.
      const radii = donutRadii(r.params.sizeGly);
      const torus = { R: radii.R, r: radii.r * OCCLUDER_SHRINK };
      const facing: Facing = this.donut ? { kind: 'normals', normals: this.donut.normals } : r.params.geometry === 'sphere' ? { kind: 'sphere' } : { kind: 'none' };
      const local = this.donut ? this.donut.world : r.positions;
      const camXYZ = [cam.x, cam.y, cam.z];
      projectForPick(local, facing, model, viewProj, camXYZ, rect, this.screenXY, this.depth);
      this.pickCache = { key, grid: new ScreenGrid(this.screenXY), visible: this.donut ? torusVisible(local, model, camXYZ, torus) : undefined };
    }
    const persp = this.camera instanceof THREE.PerspectiveCamera;
    const { grid, visible } = this.pickCache!;
    return pickOwnedNear(grid, this.screenXY, persp ? this.depth : null, owner, clientX, clientY, maxPx, visible);
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
    this.applyDots(dark);
    this.request();
  }

  /** Dot size, opacity and blending for this run's count and the theme (see dots.ts). */
  private applyDots(dark: boolean) {
    const m = this.material;
    const d = dotStyle(this.result ? this.result.positions.length / 3 : 0, dark);
    const translucent = d.opacity < 1;
    const blending = d.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    // alphaTest compares the texel's alpha × opacity: scale it so the round dot's edge survives.
    const alphaTest = 0.5 * d.opacity;
    if (m.transparent !== translucent || m.blending !== blending || m.alphaTest !== alphaTest) m.needsUpdate = true;
    m.size = d.size;
    m.opacity = d.opacity;
    m.transparent = translucent;
    m.depthWrite = !translucent;
    m.blending = blending;
    m.alphaTest = alphaTest;
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
    this.donut = undefined;
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
