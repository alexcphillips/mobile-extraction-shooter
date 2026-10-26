import * as THREE from 'three';

const SKY = 0x9fb3c8;
const FOG_FAR = 120;

/** An empty world: ground, fog and one box, drawn unlit. */
export function createScene(canvas: HTMLCanvasElement): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 20, FOG_FAR);

  // The far plane follows the fog distance.
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, FOG_FAR);
  camera.position.set(0, 1.7, 6);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x6b8f4e }),
  );
  scene.add(ground);

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xc8a165 }),
  );
  box.position.set(0, 0.5, 0);
  scene.add(box);

  function resize(): void {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  renderer.setAnimationLoop((time) => {
    box.rotation.y = time / 1000;
    renderer.render(scene, camera);
  });
}
