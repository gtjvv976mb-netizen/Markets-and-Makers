import * as THREE from "three";
import { BUSINESS } from "./data";
import { BUSINESS_PROCEDURAL_SPECS, proceduralSceneFor } from "./proceduralAssets";

const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
const labels = document.querySelector<HTMLElement>("#labels")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
renderer.setScissorTest(true);

const modelStem = (model: string): string => (model.split("/").pop() ?? "").replace(/\.glb$/i, "");
const cards = Object.entries(BUSINESS).map(([license, config], index) => {
  const stem = modelStem(config.model);
  const building = proceduralSceneFor(config.model)!;
  const spec = BUSINESS_PROCEDURAL_SPECS[stem]!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(index % 2 === 0 ? 0x08777a : 0x086d72);
  scene.add(new THREE.HemisphereLight(0xdaf4ef, 0x234b47, 2.25));
  const sun = new THREE.DirectionalLight(0xffe5ad, 4.3);
  sun.position.set(-8, 13, 10);
  scene.add(sun);
  scene.add(building);

  const bounds = new THREE.Box3().setFromObject(building, true);
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.46, 4.5);
  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
  const direction = new THREE.Vector3(1.15, 0.88, 1.25).normalize();
  camera.position.copy(centre).addScaledVector(direction, radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.46)));
  camera.lookAt(centre.x, bounds.min.y + size.y * 0.37, centre.z);

  const mesh = building.children.find((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh)!;
  const triangles = (mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute("position").count) / 3;
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `<div class="label"><div class="identity"><div class="index">${String(index + 1).padStart(2, "0")} · ${license.toUpperCase()}</div><div class="name">${config.name}</div><div class="cue">${spec.heroProp}</div></div><div class="stats">${triangles.toLocaleString()} tris<br>1 mesh · 1 material</div></div>`;
  labels.append(card);
  return { scene, camera };
});

const render = (): void => {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = renderer.getPixelRatio();
  const renderWidth = Math.floor(width * pixelRatio);
  const renderHeight = Math.floor(height * pixelRatio);
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) renderer.setSize(width, height, false);

  const headerPx = 92;
  const gap = 8;
  const padX = 10;
  const padBottom = 10;
  const cellWidth = (width - padX * 2 - gap * 4) / 5;
  const cellHeight = (height - headerPx - padBottom - gap * 2) / 3;
  cards.forEach(({ scene, camera }, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    const x = padX + column * (cellWidth + gap);
    const top = headerPx + row * (cellHeight + gap);
    const y = height - top - cellHeight;
    camera.aspect = cellWidth / cellHeight;
    camera.updateProjectionMatrix();
    renderer.setViewport(x, y, cellWidth, cellHeight);
    renderer.setScissor(x, y, cellWidth, cellHeight);
    renderer.render(scene, camera);
  });
};

window.addEventListener("resize", render);
render();
