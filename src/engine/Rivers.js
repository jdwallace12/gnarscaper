import * as THREE from 'three/webgpu';
import { fbm } from './noise.js';

/**
 * Rivers — carves gentle river channels with a visible water mesh.
 *
 * The water ribbon mesh gradually slopes from source to mouth height.
 * Terrain carving is soft and natural with fractal tributary valleys.
 */
export class Rivers {
  constructor(terrain) {
    this.terrain = terrain;
    this.rivers = [];
    this.group = new THREE.Group();
    this._time = 0;
  }

  // ---- Public API ----

  buildRiver(p1, p2, channelWidth = 8, channelDepth = 6) {
    const mainPath = this._tracePath(p1, p2);

    // Collect all channels: main + tributaries
    const channels = [];
    channels.push({ path: mainPath, width: channelWidth, depth: channelDepth, isMain: true });
    this._spawnTributaries(mainPath, channelWidth, channelDepth, channels, 0);

    // Gentle carving
    for (const ch of channels) {
      this._carveAlongPath(ch.path, ch.width, ch.depth, ch.isMain);
    }

    // Sync heightmap to worker
    this.terrain.updateHeightmap();

    // Build visible water ribbon along main channel
    const mesh = this._buildWaterMesh(mainPath, channelWidth * 0.5, channelDepth);
    this.group.add(mesh);

    this.rivers.push({ p1: p1.clone(), p2: p2.clone(), mesh, path: mainPath, channelWidth, channelDepth });
  }

  removeNear(wx, wz, radius) {
    this.rivers = this.rivers.filter(r => {
      const hit = r.path.some(pt => {
        const dx = pt.x - wx, dz = pt.z - wz;
        return Math.sqrt(dx * dx + dz * dz) < radius;
      });
      if (hit) this.group.remove(r.mesh);
      return !hit;
    });
  }

  clear() {
    this.rivers.forEach(r => this.group.remove(r.mesh));
    this.rivers = [];
  }

  update(dt) {
    this._time += dt;
    this.rivers.forEach(r => {
      if (r.mesh && r.mesh.material) {
        const t = this._time;
        const pulse = Math.sin(t * 1.2) * 0.03;
        r.mesh.material.color.setRGB(0.047 + pulse * 0.4, 0.294 + pulse * 0.8, 0.451 + pulse);
        r.mesh.material.opacity = 0.82 + Math.sin(t * 2.0) * 0.03;
      }
    });
  }

  // ---- Path tracing ----

  _tracePath(p1, p2) {
    const steps = 200;
    const totalDist = p1.distanceTo(p2);
    const seed = Math.random() * 500;

    const lineDX = p2.x - p1.x;
    const lineDZ = p2.z - p1.z;
    const lineLen = Math.sqrt(lineDX * lineDX + lineDZ * lineDZ) || 1;
    const perpX = -lineDZ / lineLen;
    const perpZ = lineDX / lineLen;

    // Meander amplitude scales with river length — big rivers get big curves
    const amplitude = totalDist * 0.2;

    // Random phase offsets so each river has unique curves
    const phase1 = Math.random() * Math.PI * 2;
    const phase2 = Math.random() * Math.PI * 2;

    // Number of S-curves along the river (3-5 bends)
    const freq1 = 2.5 + Math.random() * 1.5; // primary large bends
    const freq2 = freq1 * 2.3;               // secondary smaller wobble

    const path = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bx = p1.x + lineDX * t;
      const bz = p1.z + lineDZ * t;

      // Envelope: zero at endpoints, full in the middle
      const envelope = Math.sin(t * Math.PI);
      // Sharper taper at the very ends for clean connection
      const taper = Math.min(t * 5, 1) * Math.min((1 - t) * 5, 1);

      // Layered sinuous curves
      const wave1 = Math.sin(t * Math.PI * 2 * freq1 + phase1) * amplitude * 0.7;
      const wave2 = Math.sin(t * Math.PI * 2 * freq2 + phase2) * amplitude * 0.25;

      // Organic noise for irregularity
      const noise = fbm((bx + seed) * 0.02, (bz + seed) * 0.02, 3, 2.0, 0.5) * amplitude * 0.15;

      const offset = (wave1 + wave2 + noise) * envelope * taper;

      const wx = bx + perpX * offset;
      const wz = bz + perpZ * offset;
      const wy = this.terrain.getInterpolatedHeight(wx, wz);
      path.push(new THREE.Vector3(wx, wy, wz));
    }
    return path;
  }

  // ---- Fractal tributaries ----

  _spawnTributaries(parentPath, parentWidth, parentDepth, channels, level) {
    if (level >= 2) return;

    const scale = 0.5;
    const tribWidth = parentWidth * scale;
    const tribDepth = parentDepth * scale;
    const count = level === 0 ? 5 : 2;
    const tribLen = parentWidth * 3.5 * (1 - level * 0.3);
    const tribSteps = 25;
    const spacing = Math.max(4, Math.floor(parentPath.length / (count + 2)));

    for (let idx = 0; idx < count; idx++) {
      const i = spacing + idx * spacing;
      if (i >= parentPath.length - 4) continue;

      const pt = parentPath[i];
      const prev = parentPath[Math.max(0, i - 3)];
      const next = parentPath[Math.min(parentPath.length - 1, i + 3)];
      const fwdX = next.x - prev.x, fwdZ = next.z - prev.z;
      const fwdLen = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ) || 1;
      const nfx = fwdX / fwdLen, nfz = fwdZ / fwdLen;
      const pX = -nfz, pZ = nfx;
      const side = (idx % 2 === 0) ? 1 : -1;
      const seed = Math.random() * 500;

      const tribPath = [pt.clone()];
      for (let s = 1; s <= tribSteps; s++) {
        const t = s / tribSteps;
        const noise = fbm((pt.x + seed + s * 3) * 0.04, (pt.z + seed + s * 3) * 0.04, 2, 2.0, 0.5);
        const wx = pt.x + pX * side * tribLen * t + (-nfx * tribLen * t * 0.2) + pX * noise * tribWidth;
        const wz = pt.z + pZ * side * tribLen * t + (-nfz * tribLen * t * 0.2) + pZ * noise * tribWidth;
        const wy = this.terrain.getInterpolatedHeight(wx, wz);
        tribPath.push(new THREE.Vector3(wx, wy, wz));
      }

      channels.push({ path: tribPath, width: tribWidth, depth: tribDepth, isMain: false });
      this._spawnTributaries(tribPath, tribWidth, tribDepth, channels, level + 1);
    }
  }

  // ---- Gentle terrain carving ----

  _carveAlongPath(path, channelWidth, channelDepth, isMain) {
    const terrain = this.terrain;
    const res = terrain.resolution;
    const halfSize = terrain.size / 2;

    // Gentle erosion: smaller watershed, softer slopes
    const watershedWidth = channelWidth * 2.5;
    const gridWatershed = (watershedWidth / terrain.size) * (res - 1);
    const gridChannel = (channelWidth / terrain.size) * (res - 1);
    const r = Math.ceil(gridWatershed);

    // Compute smooth descending bed heights from source to mouth
    const startY = path[0].y;
    const endY = path[path.length - 1].y;

    path.forEach((pt, stepIdx) => {
      const t = stepIdx / Math.max(1, path.length - 1);
      const taper = isMain ? 1.0 : (1.0 - t * 0.7);

      // Smooth gradual slope from source to mouth
      const smoothT = t * t * (3 - 2 * t);
      const bedY = startY + (endY - startY) * smoothT;

      const effWidth = gridChannel * taper;
      const effDepth = channelDepth * taper * 0.4; // Much gentler carving

      const cgx = Math.round(((pt.x + halfSize) / terrain.size) * (res - 1));
      const cgz = Math.round(((pt.z + halfSize) / terrain.size) * (res - 1));

      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const gx = cgx + dx, gz = cgz + dz;
          if (gx < 0 || gx >= res || gz < 0 || gz >= res) continue;

          const dist = Math.sqrt(dx * dx + dz * dz);
          const effWatershed = gridWatershed * taper;
          if (dist > effWatershed) continue;

          const idx = gz * res + gx;
          const currentH = terrain.heightmap[idx];

          if (dist <= effWidth) {
            // Inner channel: gentle U-shape
            const normDist = effWidth > 0.001 ? dist / effWidth : 0;
            const uShape = normDist * normDist;
            const targetH = (bedY - effDepth) + effDepth * uShape;

            if (currentH > targetH) {
              terrain.heightmap[idx] = targetH;
            }
          } else {
            // Outer slopes: very gentle blend toward channel edge
            const wDist = (dist - effWidth) / Math.max(0.001, effWatershed - effWidth);
            const falloff = 1.0 - wDist;
            const smooth = falloff * falloff * (3 - 2 * falloff);
            const targetH = currentH + (bedY - currentH) * smooth * 0.25;

            if (targetH < currentH) {
              terrain.heightmap[idx] = targetH;
            }
          }
        }
      }
    });
  }

  // ---- Smooth water ribbon mesh ----

  _buildWaterMesh(path, halfWidth, _channelDepth) {
    const n = path.length;
    const tangents = this._smoothTangents(path);

    const positions = [];
    const indices = [];

    // Sample post-carve terrain heights, then smooth them
    const heights = [];
    for (let i = 0; i < n; i++) {
      heights.push(this.terrain.getInterpolatedHeight(path[i].x, path[i].z));
    }
    // Smooth heights over a wide window to prevent jagged Y
    for (let pass = 0; pass < 3; pass++) {
      const w = 6;
      const tmp = [...heights];
      for (let i = 0; i < n; i++) {
        let sum = 0, cnt = 0;
        for (let k = -w; k <= w; k++) {
          const j = Math.max(0, Math.min(n - 1, i + k));
          const weight = 1.0 - Math.abs(k) / (w + 1);
          sum += tmp[j] * weight;
          cnt += weight;
        }
        heights[i] = sum / cnt;
      }
    }
    // Enforce monotonic descent (water flows downhill)
    for (let i = 1; i < n; i++) {
      if (heights[i] > heights[i - 1]) heights[i] = heights[i - 1];
    }

    for (let i = 0; i < n; i++) {
      const pt = path[i];

      // Sit just above the carved terrain surface
      const y = heights[i] + 0.25;

      const perpX = -tangents[i].z;
      const perpZ = tangents[i].x;

      positions.push(pt.x - perpX * halfWidth, y, pt.z - perpZ * halfWidth);
      positions.push(pt.x + perpX * halfWidth, y, pt.z + perpZ * halfWidth);

      if (i < n - 1) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x0c4b73),
      transparent: true,
      opacity: 0.82,
      roughness: 0.1,
      metalness: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Heavily smoothed tangent vectors — prevents ribbon tearing */
  _smoothTangents(path) {
    const n = path.length;

    // Raw tangents
    let tangents = [];
    for (let i = 0; i < n; i++) {
      const prev = path[Math.max(0, i - 1)];
      const next = path[Math.min(n - 1, i + 1)];
      tangents.push({ x: next.x - prev.x, z: next.z - prev.z });
    }

    // 4 passes of wide-window smoothing
    for (let pass = 0; pass < 4; pass++) {
      const smoothed = [];
      const w = 8;
      for (let i = 0; i < n; i++) {
        let sx = 0, sz = 0, wt = 0;
        for (let k = -w; k <= w; k++) {
          const j = Math.max(0, Math.min(n - 1, i + k));
          const weight = 1.0 - Math.abs(k) / (w + 1);
          sx += tangents[j].x * weight;
          sz += tangents[j].z * weight;
          wt += weight;
        }
        smoothed.push({ x: sx / wt, z: sz / wt });
      }
      tangents = smoothed;
    }

    // Normalize
    return tangents.map(t => {
      const len = Math.sqrt(t.x * t.x + t.z * t.z) || 1;
      return { x: t.x / len, z: t.z / len };
    });
  }
}
