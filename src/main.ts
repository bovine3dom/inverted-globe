import * as THREE from "three";
import "./style.css";
import { TileRenderer } from "./tiles";

const canvas = document.querySelector<HTMLCanvasElement>("#globe")!;
const searchContainer = document.querySelector<HTMLElement>("#search-container")!;
const searchInput = document.querySelector<HTMLInputElement>("#city-search")!;
const cityResults = document.querySelector<HTMLElement>("#city-results")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x777777);
const camera = new THREE.PerspectiveCamera(70, 1, 0.00001, 3);

const CAP_ANGLE = Math.PI / 2 - Math.atan(Math.sinh(Math.PI));
const capMaterial = new THREE.MeshBasicMaterial({ color: 0x777777, side: THREE.BackSide });
scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 8, 0, Math.PI * 2, 0, CAP_ANGLE), capMaterial));
scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 8, 0, Math.PI * 2, Math.PI - CAP_ANGLE, CAP_ANGLE), capMaterial));

const MAX_RADIUS = 0.9999;
const MAX_LATITUDE = Math.PI / 2 - 0.0001;
let radius = 0;
let longitude = 0;
let latitude = 0;

function wrapLongitude(value: number): number {
  return THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI;
}

function readView(): void {
  const values = location.hash.slice(1).split(",").map(Number);
  if (values.length !== 3 || !values.every(Number.isFinite)) return;
  radius = THREE.MathUtils.clamp(values[0], 0, MAX_RADIUS);
  longitude = wrapLongitude(values[1]);
  latitude = THREE.MathUtils.clamp(values[2], -MAX_LATITUDE, MAX_LATITUDE);
}

function surfaceDirection(): THREE.Vector3 {
  const cosLat = Math.cos(latitude);
  return new THREE.Vector3(
    cosLat * Math.sin(longitude),
    Math.sin(latitude),
    cosLat * Math.cos(longitude),
  );
}

function applyView(): void {
  const cosLat = Math.cos(latitude);
  const direction = surfaceDirection();
  const north = new THREE.Vector3(
    -Math.sin(latitude) * Math.sin(longitude),
    cosLat,
    -Math.sin(latitude) * Math.cos(longitude),
  );

  camera.position.copy(direction).multiplyScalar(radius);
  camera.up.set(0, 1, 0);
  if (cosLat < 0.02) camera.up.copy(north);
  camera.lookAt(direction);
}

readView();
applyView();

let renderFrame = 0;
function scheduleRender(): void {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderer.render(scene, camera);
  });
}

const tiles = new TileRenderer(scene, () => scheduleRender());
let selectionTimer = 0;
function updateTiles(): void {
  selectionTimer = 0;
  tiles.update(camera, canvas.width, canvas.height);
  scheduleRender();
}
function scheduleTileUpdate(): void {
  if (!selectionTimer) selectionTimer = window.setTimeout(updateTiles, 80);
}

let stateTimer = 0;
function saveView(): void {
  stateTimer = 0;
  const hash = [radius, longitude, latitude].map(value => Number(value.toFixed(5))).join(",");
  const url = new URL(location.href);
  url.hash = hash;
  history.replaceState(history.state, "", url);
}
function scheduleSave(): void {
  window.clearTimeout(stateTimer);
  stateTimer = window.setTimeout(saveView, 180);
}
function setSurfaceDirection(direction: THREE.Vector3): void {
  latitude = THREE.MathUtils.clamp(Math.asin(direction.y), -MAX_LATITUDE, MAX_LATITUDE);
  if (Math.hypot(direction.x, direction.z) > 1e-8) {
    longitude = wrapLongitude(Math.atan2(direction.x, direction.z));
  }
}

function surfaceAngle(radius: number, viewAngle: number): number {
  const distance = -radius * Math.cos(viewAngle) + Math.sqrt(1 - radius ** 2 * Math.sin(viewAngle) ** 2);
  return Math.atan2(distance * Math.sin(viewAngle), radius + distance * Math.cos(viewAngle));
}

function zoomTo(nextRadius: number, clientX: number, clientY: number): void {
  const rect = canvas.getBoundingClientRect();
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const pixels = Math.hypot(dx, dy);
  const focalPixels = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const viewAngle = Math.atan(pixels / focalPixels);
  const turn = surfaceAngle(radius, viewAngle) - surfaceAngle(nextRadius, viewAngle);

  if (pixels && Math.abs(turn) > 1e-8) {
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const tangent = screenRight.multiplyScalar(dx / pixels).addScaledVector(screenUp, -dy / pixels).normalize();
    const direction = surfaceDirection()
      .multiplyScalar(Math.cos(turn))
      .addScaledVector(tangent, Math.sin(turn))
      .normalize();
    setSurfaceDirection(direction);
  }
  radius = nextRadius;
}

function panSurface(dx: number, dy: number): void {
  const pixels = Math.hypot(dx, dy);
  if (!pixels) return;
  const direction = surfaceDirection();
  const focalPixels = canvas.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const screenAngle = Math.atan(pixels / focalPixels);
  const angle = screenAngle - Math.asin(radius * Math.sin(screenAngle));
  const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const tangent = screenRight.multiplyScalar(-dx / pixels)
    .addScaledVector(screenUp, dy / pixels)
    .normalize();

  direction.multiplyScalar(Math.cos(angle))
    .addScaledVector(tangent, Math.sin(angle))
    .normalize();
  setSurfaceDirection(direction);
}

function changedView(): void {
  applyView();
  scheduleRender();
  scheduleTileUpdate();
  scheduleSave();
}

function resize(): void {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  updateTiles();
}
window.addEventListener("resize", resize);

let highlightedCity = -1;
let cityGeocoder: Promise<typeof import("tiny-geocoder/browser")> | undefined;
function hideCityResults(): void {
  cityResults.style.display = "none";
  highlightedCity = -1;
}
function jumpToCity(latitudeDegrees: number, longitudeDegrees: number): void {
  latitude = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(latitudeDegrees), -MAX_LATITUDE, MAX_LATITUDE);
  longitude = wrapLongitude(THREE.MathUtils.degToRad(longitudeDegrees));
  radius = Math.max(radius, 0.9995);
  changedView();
}
function selectCity(item: HTMLElement): void {
  const latitudeDegrees = Number(item.dataset.lat);
  const longitudeDegrees = Number(item.dataset.lng);
  if (!Number.isFinite(latitudeDegrees) || !Number.isFinite(longitudeDegrees)) return;
  searchInput.value = item.textContent ?? "";
  hideCityResults();
  jumpToCity(latitudeDegrees, longitudeDegrees);
}
searchInput.addEventListener("input", async () => {
  cityResults.replaceChildren();
  const query = searchInput.value.trim();
  if (query.length < 2) return hideCityResults();
  const { getCitiesStartsWith } = await (cityGeocoder ??= import("tiny-geocoder/browser"));
  if (query !== searchInput.value.trim()) return;
  for (const city of getCitiesStartsWith(query, 10, true)) {
    if (!city.name || !Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)) continue;
    const item = document.createElement("div");
    item.dataset.lat = String(city.latitude);
    item.dataset.lng = String(city.longitude);
    item.textContent = `${city.name} (population: ${Number((city.population ?? 0).toPrecision(2)).toLocaleString()})`;
    cityResults.append(item);
  }
  highlightedCity = -1;
  cityResults.style.display = cityResults.childElementCount ? "block" : "none";
});
searchInput.addEventListener("keydown", event => {
  const items = cityResults.children;
  if (!items.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    highlightedCity = event.key === "ArrowDown"
      ? (highlightedCity + 1) % items.length
      : highlightedCity <= 0 ? items.length - 1 : highlightedCity - 1;
    Array.from(items).forEach((item, index) => item.classList.toggle("highlighted", index === highlightedCity));
  } else if (event.key === "Enter") {
    event.preventDefault();
    selectCity(items[highlightedCity < 0 ? 0 : highlightedCity] as HTMLElement);
  } else if (event.key === "Escape") hideCityResults();
});
cityResults.addEventListener("click", event => {
  const item = (event.target as HTMLElement).closest<HTMLElement>("#city-results div");
  if (item) selectCity(item);
});
document.addEventListener("click", event => {
  if (!searchContainer.contains(event.target as Node)) hideCityResults();
});

const pointers = new Map<number, { x: number; y: number }>();
let pinchDistance = 0;
const pointerDistance = (): number => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
const pointerCenter = (): { x: number; y: number } => {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

canvas.addEventListener("pointerdown", event => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  pinchDistance = pointers.size === 2 ? pointerDistance() : 0;
});
canvas.addEventListener("pointermove", event => {
  const previous = pointers.get(event.pointerId);
  if (!previous) return;

  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const distance = pointerDistance();
    if (pinchDistance > 0 && distance > 0) {
      const nextRadius = THREE.MathUtils.clamp(1 - (1 - radius) * pinchDistance / distance, 0, MAX_RADIUS);
      const center = pointerCenter();
      zoomTo(nextRadius, center.x, center.y);
    }
    pinchDistance = distance;
  } else {
    panSurface(event.clientX - previous.x, event.clientY - previous.y);
  }
  changedView();
});
function endPointer(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  pinchDistance = 0;
  if (selectionTimer) {
    window.clearTimeout(selectionTimer);
    updateTiles();
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener("wheel", event => {
  event.preventDefault();
  const factor = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1;
  const delta = event.deltaY * factor;
  const nextRadius = THREE.MathUtils.clamp(1 - (1 - radius) * Math.exp(delta * 0.003), 0, MAX_RADIUS);
  zoomTo(nextRadius, event.clientX, event.clientY);
  changedView();
}, { passive: false });

resize();
