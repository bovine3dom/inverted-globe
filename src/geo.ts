import * as THREE from "three";

export interface TileId {
  z: number;
  x: number;
  y: number;
}

export function tileKey({ z, x, y }: TileId): string {
  return `${z}/${x}/${y}`;
}

export function tileGeometry({ z, x, y }: TileId): THREE.BufferGeometry {
  const segments = z < 2 ? 16 : z < 6 ? 8 : 2;
  const stride = segments + 1;
  const positions = new Float32Array(stride * stride * 3);
  const uvs = new Float32Array(stride * stride * 2);
  const indices: number[] = [];
  const n = 2 ** z;

  for (let j = 0; j <= segments; j++) {
    const v = j / segments;
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const X = (x + u) / n;
      const Y = (y + v) / n;
      const lon = 2 * Math.PI * (X - 0.5);
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Y)));
      const cosLat = Math.cos(lat);
      const index = j * stride + i;

      positions[3 * index] = cosLat * Math.sin(lon);
      positions[3 * index + 1] = Math.sin(lat);
      positions[3 * index + 2] = cosLat * Math.cos(lon);
      uvs[2 * index] = u;
      uvs[2 * index + 1] = 1 - v;

      if (i < segments && j < segments) {
        const a = index;
        const b = index + 1;
        const d = index + stride;
        const c = d + 1;
        indices.push(a, b, c, a, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function tileChildren({ z, x, y }: TileId): TileId[] {
  return [
    { z: z + 1, x: x * 2, y: y * 2 },
    { z: z + 1, x: x * 2 + 1, y: y * 2 },
    { z: z + 1, x: x * 2, y: y * 2 + 1 },
    { z: z + 1, x: x * 2 + 1, y: y * 2 + 1 },
  ];
}
