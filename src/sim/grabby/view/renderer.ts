// three.js view of a SimResult: one Points cloud with per-vertex colour.
// 2d flat/torus: orthographic, top-down. Sphere: perspective globe. 3d: perspective cube.
// Sphere and 3d can be dragged to rotate. Renders only when something changed.
import * as THREE from 'three';
import type { SimResult, Timeline } from '../types';
import { civColor } from './palette';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isDark = () => document.documentElement.dataset.theme === 'dark';

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

export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private group = new THREE.Group();
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  private persp = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  private camera: THREE.Camera = this.ortho;
  private points?: THREE.Points;
  private colors?: Float32Array;
  private outline?: THREE.LineSegments;
  private occluder?: THREE.Mesh;
  private material: THREE.PointsMaterial;
  private result?: SimResult;
  private civColors: THREE.Color[] = [];
  private unclaimed = new THREE.Color();
  private frame = 0;
  private draggable = false;
  private autoSpin = false;
  private dragging = false;
  private last = { x: 0, y: 0 };
  private extent = 1; // half-size of what the ortho camera must fit
  private cleanup: (() => void)[] = [];

  constructor(private container: HTMLElement, private reducedMotion: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);
    this.material = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, map: dotTexture(), alphaTest: 0.5 });
    this.scene.add(this.group);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.cleanup.push(() => ro.disconnect());

    const onVis = () => (document.hidden ? this.stop() : this.request());
    document.addEventListener('visibilitychange', onVis);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis));

    const el = this.renderer.domElement;
    const down = (e: PointerEvent) => {
      if (!this.draggable) return;
      this.dragging = true;
      this.autoSpin = false;
      this.last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      this.rotate(dx * 0.006, dy * 0.006);
    };
    const up = () => (this.dragging = false);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    this.resize();
  }

  /** Swap in a new run: rebuilds the point cloud, outline and camera. */
  setResult(r: SimResult) {
    this.result = r;
    const { dim, geometry, sizeGly: L } = r.params;
    const n = r.positions.length / 3;
    this.disposeScene();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    this.colors = new Float32Array(n * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    // Fewer, bigger dots for small runs; smaller dots when there are many.
    this.material.size = Math.max(1.5, Math.min(4, 3 * Math.sqrt(4000 / n))) * this.renderer.getPixelRatio();
    this.points = new THREE.Points(geo, this.material);
    this.group.add(this.points);
    this.group.quaternion.identity();

    const sphere = geometry === 'sphere';
    if (!sphere) this.points.position.set(-L / 2, -L / 2, dim === 3 ? -L / 2 : 0);

    if (sphere) {
      const R = L / (2 * Math.PI);
      // A background-coloured ball just inside the globe hides its far side.
      this.occluder = new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 48, 32), new THREE.MeshBasicMaterial());
      this.group.add(this.occluder);
      this.camera = this.persp;
      this.persp.position.set(0, 0, R * 4.2);
      this.group.rotation.set(0.35, 0, 0);
    } else if (dim === 3) {
      const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(L, L, L));
      this.outline = new THREE.LineSegments(box, new THREE.LineBasicMaterial());
      this.group.add(this.outline);
      this.camera = this.persp;
      this.persp.position.set(0, 0, L * 2.6);
      this.group.rotation.set(0.45, -0.6, 0);
    } else {
      this.camera = this.ortho;
      this.extent = L / 2;
      if (geometry === 'torus') {
        const h = L / 2;
        const pts = [[-h, -h], [h, -h], [h, -h], [h, h], [h, h], [-h, h], [-h, h], [-h, -h]].map(([x, y]) => new THREE.Vector3(x, y, 0));
        this.outline = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ dashSize: L / 80, gapSize: L / 80 }));
        this.outline.computeLineDistances();
        this.group.add(this.outline);
      }
    }
    this.persp.lookAt(0, 0, 0);
    this.draggable = sphere || dim === 3;
    this.autoSpin = this.draggable && !this.reducedMotion;
    this.renderer.domElement.style.cursor = this.draggable ? 'grab' : '';
    this.resize();
    this.applyTheme();
  }

  /** Recolour. Pass the timeline after a seek; only `changed` galaxies are touched unless full. */
  update(tl: Timeline, full = false) {
    const c = this.colors;
    if (!c || !this.points) return;
    const paint = (g: number) => {
      const o = tl.owner[g];
      const col = o < 0 ? this.unclaimed : (this.civColors[o] ??= new THREE.Color(civColor(o, isDark())));
      c[g * 3] = col.r;
      c[g * 3 + 1] = col.g;
      c[g * 3 + 2] = col.b;
    };
    if (full) for (let g = 0; g < tl.owner.length; g++) paint(g);
    else for (let k = 0; k < tl.changedCount; k++) paint(tl.changed[k]);
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.request();
  }

  /** Re-read the theme colours. Call update(tl, true) afterwards to repaint the points. */
  applyTheme() {
    const dark = isDark();
    this.unclaimed.setStyle(css('--rule') || (dark ? '#4a4a45' : '#b9b9b2'));
    this.civColors = (this.result?.civs ?? []).map((c) => new THREE.Color(civColor(c.id, dark)));
    if (this.outline) (this.outline.material as THREE.LineBasicMaterial).color.setStyle(css('--rule'));
    if (this.occluder) (this.occluder.material as THREE.MeshBasicMaterial).color.setStyle(css('--bg'));
    this.request();
  }

  private rotate(yaw: number, pitch: number) {
    const q = new THREE.Quaternion();
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.group.quaternion.premultiply(q);
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    this.group.quaternion.premultiply(q);
    this.request();
  }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    // Leave room for the overlays at the top and bottom.
    const half = this.extent * 1.25, a = w / h;
    const hh = a >= 1 ? half : half / a;
    Object.assign(this.ortho, { left: -hh * a, right: hh * a, top: hh, bottom: -hh });
    this.ortho.updateProjectionMatrix();
    this.request();
  }

  /** Ask for one frame. Frames keep coming only while the globe/cube spins. */
  request() {
    if (this.frame || document.hidden) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.autoSpin) this.rotate(0.0015, 0);
      this.renderer.render(this.scene, this.camera);
    });
  }

  private stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private disposeScene() {
    for (const o of [this.points, this.outline, this.occluder]) {
      if (!o) continue;
      this.group.remove(o);
      o.geometry.dispose();
      if (o !== this.points) (o.material as THREE.Material).dispose();
    }
    this.points = this.outline = this.occluder = undefined;
  }

  dispose() {
    this.stop();
    this.cleanup.forEach((f) => f());
    this.disposeScene();
    this.material.map?.dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
