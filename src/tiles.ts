import * as THREE from "three";
import { tileChildren, tileGeometry, tileKey, type TileId } from "./geo";

const MIN_ZOOM = 5;
const MAX_ZOOM = 19;
const MAX_LEAVES = 1600;
const REFINE_PIXELS = 256;

type State = "idle" | "loading" | "ready" | "error";
type TileNode = {
  id: TileId;
  key: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  state: State;
};

export class TileRenderer {
  private nodes = new Map<string, TileNode>();
  private active = new Set<string>();
  private frustum = new THREE.Frustum();
  private viewProjection = new THREE.Matrix4();
  private loader = new THREE.TextureLoader().setCrossOrigin("anonymous");

  constructor(
    private scene: THREE.Scene,
    private changed: () => void,
  ) {}

  update(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    camera.updateMatrixWorld(true);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const centerLongitude = Math.atan2(forward.x, forward.z);
    const centerLatitude = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    const centerTile = (id: TileId, margin = 1): boolean => {
      const count = 2 ** id.z;
      const x = THREE.MathUtils.euclideanModulo(Math.floor((centerLongitude / (2 * Math.PI) + 0.5) * count), count);
      const y = THREE.MathUtils.clamp(Math.floor((1 - Math.asinh(Math.tan(centerLatitude)) / Math.PI) / 2 * count), 0, count - 1);
      const dx = Math.abs(id.x - x);
      return Math.min(dx, count - dx) <= margin && Math.abs(id.y - y) <= margin;
    };
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);

    const leaves: TileId[] = [];
    const candidate = (id: TileId) => {
      const node = this.getNode(id);
      if (!this.frustum.intersectsSphere(node.mesh.geometry.boundingSphere!)) return null;
      return { id, node, pixels: this.projectedPixels(node, camera, width, height), center: centerTile(id) };
    };
    const root = candidate({ z: 0, x: 0, y: 0 });
    const candidates = root ? [root] : [];
    let leafCount = candidates.length;

    while (candidates.length) {
      candidates.sort((a, b) => Number(a.center) - Number(b.center) || a.pixels - b.pixels);
      const { id, pixels } = candidates.pop()!;
      const belowMinimum = id.z < MIN_ZOOM;
      if (id.z < MAX_ZOOM && (belowMinimum || pixels > REFINE_PIXELS) && (belowMinimum || leafCount < MAX_LEAVES)) {
        const children = tileChildren(id).map(candidate).filter(child => child !== null);
        if (children.length && (belowMinimum || leafCount + children.length - 1 <= MAX_LEAVES)) {
          leafCount += children.length - 1;
          candidates.push(...children);
          continue;
        }
      }
      leaves.push(id);
    }

    const needed = new Set<string>();
    for (const leaf of leaves) {
      let { z, x, y } = leaf;
      while (z >= 0) {
        needed.add(`${z}/${x}/${y}`);
        z--;
        x >>= 1;
        y >>= 1;
      }
    }
    this.active = needed;

    for (const node of this.nodes.values()) node.mesh.visible = false;
    for (const key of needed) {
      const node = this.nodes.get(key)!;
      if (node.state === "ready" || node.id.z === 0) node.mesh.visible = true;
    }

    this.prune();
    for (const key of needed) {
      const node = this.nodes.get(key)!;
      if (node.id.z >= MIN_ZOOM && node.state === "idle") this.load(node);
    }
  }

  private getNode(id: TileId): TileNode {
    const key = tileKey(id);
    const existing = this.nodes.get(key);
    if (existing) return existing;

    const geometry = tileGeometry(id);
    const material = new THREE.MeshBasicMaterial({
      color: id.z === 0 ? 0x666666 : 0xffffff,
      side: THREE.FrontSide,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = id.z;
    this.scene.add(mesh);

    const node: TileNode = { id, key, mesh, state: "idle" };
    this.nodes.set(key, node);
    return node;
  }

  private projectedPixels(
    node: TileNode,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ): number {
    const positions = node.mesh.geometry.getAttribute("position");
    const stride = Math.max(1, Math.floor(Math.sqrt(positions.count) / 8));
    const point = new THREE.Vector3();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let front = 0, behind = 0;

    for (let i = 0; i < positions.count; i += stride) {
      point.fromBufferAttribute(positions, i).applyMatrix4(camera.matrixWorldInverse);
      if (-point.z <= camera.near) {
        behind++;
        continue;
      }
      point.applyMatrix4(camera.projectionMatrix);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      front++;
    }

    if (behind || !front) return Infinity;
    return Math.max((maxX - minX) * width, (maxY - minY) * height) / 2;
  }

  private load(node: TileNode): void {
    node.state = "loading";
    const { z, x, y } = node.id;
    const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    this.loader.load(url, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      node.mesh.material.map = texture;
      node.mesh.material.color.set(0xffffff);
      node.mesh.material.needsUpdate = true;
      node.state = "ready";
      if (this.active.has(node.key)) node.mesh.visible = true;
      this.prune();
      this.changed();
    }, undefined, () => {
      node.state = "error";
      this.prune();
      this.changed();
    });
  }

  private prune(): void {
    for (const node of this.nodes.values()) {
      if (this.active.has(node.key) || node.state === "loading") continue;
      this.scene.remove(node.mesh);
      node.mesh.geometry.dispose();
      node.mesh.material.map?.dispose();
      node.mesh.material.dispose();
      this.nodes.delete(node.key);
    }
  }
}
