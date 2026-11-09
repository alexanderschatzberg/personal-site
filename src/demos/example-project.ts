// Example three.js demo. Each file in src/demos/ is its own bundle and only
// downloads when a visitor scrolls to it on that project's page.
//
// Contract: export a default function that takes the container element,
// builds the scene inside it, and returns a cleanup function.
import * as THREE from 'three';

export default function mount(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.z = 5;

  const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
  const material = new THREE.MeshBasicMaterial({ color: fg, wireframe: true });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), material);
  scene.add(mesh);

  // Follow the site's light/dark toggle.
  const themeObserver = new MutationObserver(() => {
    material.color.set(getComputedStyle(document.documentElement).getPropertyValue('--fg').trim());
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const animate = (t: number) => {
    mesh.rotation.x = t * 0.0002;
    mesh.rotation.y = t * 0.0003;
    renderer.render(scene, camera);
  };

  // Only render while the demo is on screen.
  const visibility = new IntersectionObserver(([entry]) => {
    renderer.setAnimationLoop(entry.isIntersecting ? animate : null);
  });
  visibility.observe(container);

  return () => {
    visibility.disconnect();
    resizeObserver.disconnect();
    themeObserver.disconnect();
    renderer.setAnimationLoop(null);
    renderer.dispose();
    mesh.geometry.dispose();
    material.dispose();
    renderer.domElement.remove();
  };
}
