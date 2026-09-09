import * as THREE from "three/webgpu";

export class Terrain {
  /**
   * @param {number} size
   * @param {number} resolution
   */
  constructor(size = 200, resolution = 256) {
    this.size = size;
    this.resolution = resolution;
    this.heightmap = new Float32Array(resolution * resolution);
    this.snowmap = new Float32Array(resolution * resolution);
    this.grassmap = new Float32Array(resolution * resolution);
    this.snowPack = 100;
    this.seaLevel = 1;

    this.geometry = new THREE.PlaneGeometry(
      size,
      size,
      resolution - 1,
      resolution - 1,
    );
    this.geometry.rotateX(-Math.PI / 2); // lay flat

    const count = this.geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Generate procedural micro-crystalline snow normal & roughness maps
    const { normalMap, roughnessMap } = Terrain._createSnowTextures();

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap,
      roughness: 0.62,
      metalness: 0.04,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // Initialize Worker
    this.worker = new Worker(new URL('./TerrainWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = this._onWorkerMessage.bind(this);

    // Track tool state from worker
    this._toolState = {};

    this.onInitListeners = [];

    this.worker.postMessage({
      type: 'init',
      size: this.size,
      resolution: this.resolution,
      snowPack: this.snowPack
    });
  }

  addOnInitListener(callback) {
    this.onInitListeners.push(callback);
  }

  /* ---- Worker Handling ---- */

  _onWorkerMessage(e) {
    const msg = e.data;
    if (msg.heightmap) this.heightmap.set(msg.heightmap);
    if (msg.snowmap) this.snowmap.set(msg.snowmap);
    if (msg.grassmap) this.grassmap.set(msg.grassmap);
    if (msg.toolState) this._toolState = msg.toolState;

    if (msg.colors || msg.heightmap) {
      this._applyBuffersToMesh(msg.heightmap, msg.colors);
    }

    if (msg.type === 'init_done') {
      this.onInitListeners.forEach(cb => cb(msg));
    }
  }

  _applyBuffersToMesh(heights, colors) {
    const pos = this.geometry.attributes.position;
    const col = this.geometry.attributes.color;

    if (heights) {
      for (let i = 0; i < pos.count; i++) {
          pos.setY(i, heights[i]);
      }
      pos.needsUpdate = true;
      this.geometry.computeVertexNormals();
      this.geometry.computeBoundingBox();
      this.geometry.computeBoundingSphere();
    }
    
    if (colors) {
      col.array.set(colors);
      col.needsUpdate = true;
    }
  }

  /* ---- public API ---- */

  getHeight(gx, gz) {
    if (gx < 0 || gx >= this.resolution || gz < 0 || gz >= this.resolution)
      return 0;
    return this.heightmap[gz * this.resolution + gx];
  }

  getSnowAmount(gx, gz) {
    if (gx < 0 || gx >= this.resolution || gz < 0 || gz >= this.resolution)
      return 0;
    return this.snowmap[gz * this.resolution + gx];
  }

  getGrassAmount(gx, gz) {
    if (gx < 0 || gx >= this.resolution || gz < 0 || gz >= this.resolution)
      return 0;
    return this.grassmap[gz * this.resolution + gx];
  }

  setHeight(gx, gz, value) {
    if (gx < 0 || gx >= this.resolution || gz < 0 || gz >= this.resolution)
      return;
    this.heightmap[gz * this.resolution + gx] = value;
  }

  /** Get smooth interpolated height at world position */
  getInterpolatedHeight(wx, wz) {
    const half = this.size / 2;
    const fx = ((wx + half) / this.size) * (this.resolution - 1);
    const fz = ((wz + half) / this.size) * (this.resolution - 1);
    
    if (fx < 0 || fx >= this.resolution - 1 || fz < 0 || fz >= this.resolution - 1) {
      const { gx, gz } = this.worldToGrid(wx, wz);
      return this.getHeight(gx, gz);
    }

    const gx0 = Math.floor(fx);
    const gx1 = gx0 + 1;
    const gz0 = Math.floor(fz);
    const gz1 = gz0 + 1;
    
    const tx = fx - gx0;
    const tz = fz - gz0;
    
    const h00 = this.getHeight(gx0, gz0);
    const h10 = this.getHeight(gx1, gz0);
    const h01 = this.getHeight(gx0, gz1);
    const h11 = this.getHeight(gx1, gz1);
    
    const h0 = h00 * (1 - tx) + h10 * tx;
    const h1 = h01 * (1 - tx) + h11 * tx;
    
    return h0 * (1 - tz) + h1 * tz;
  }

  /** Convert world (x, z) → grid indices */
  worldToGrid(wx, wz) {
    const half = this.size / 2;
    const gx = Math.round(((wx + half) / this.size) * (this.resolution - 1));
    const gz = Math.round(((wz + half) / this.size) * (this.resolution - 1));
    return { gx, gz };
  }

  /** Get cumulative snow cover value (painted or natural/dynamic) at world position */
  getSnowCover(wx, wz) {
    const { gx, gz } = this.worldToGrid(wx, wz);
    const paintSnow = this.getSnowAmount(gx, gz);
    
    const h = this.getInterpolatedHeight(wx, wz);
    
    // Calculate steepness by sampling heights around the position
    const spacing = this.size / (this.resolution - 1);
    const hL = this.getInterpolatedHeight(wx - spacing, wz);
    const hR = this.getInterpolatedHeight(wx + spacing, wz);
    const hU = this.getInterpolatedHeight(wx, wz - spacing);
    const hD = this.getInterpolatedHeight(wx, wz + spacing);
    
    const gradX = (hR - hL) / (2 * spacing);
    const gradZ = (hD - hU) / (2 * spacing);
    const steepness = Math.sqrt(gradX * gradX + gradZ * gradZ);
    
    // Calculate dynamic snow using the custom physical snow accumulation score
    const packFactor = this.snowPack / 100.0;
    
    // Base elevation where snow line starts. 
    // At 50% slider, this is exactly the original seaLevel + 57!
    const baseElevation = (this.seaLevel + 57) - (packFactor - 0.5) * 40.0;
    
    const flatness = Math.max(0, 1.0 - steepness * 2.0);
    const curvature = hL + hR + hU + hD - 4.0 * h;
    
    // Ridges/crests (curvature < 0) only get wind-scoured if they are steep.
    // Smooth peaks or ridges (low steepness) bypass the wind-scour penalty!
    const windScour = curvature < 0 ? curvature * Math.min(1.0, steepness * 3.0) : curvature;
    
    // Concavity and flatness score helps snow accumulate lower in couloirs/valleys,
    // while convex ridges push the snow line higher.
    const score = flatness * 0.4 + windScour * 0.6;
    
    // Adjust height based on local terrain features
    const effectiveHeight = h + score * 15.0;
    
    // Natural snow scales smoothly over a 15-unit transition zone
    const naturalSnow = Math.min(1.0, Math.max(0, (effectiveHeight - baseElevation) / 15.0));
    
    return Math.max(paintSnow, naturalSnow);
  }

  snapshot() {
    return {
      heightmap: new Float32Array(this.heightmap),
      snowmap: new Float32Array(this.snowmap),
      grassmap: new Float32Array(this.grassmap)
    };
  }

  restore(snap) {
    if (snap.heightmap) this.heightmap.set(snap.heightmap);
    if (snap.snowmap) this.snowmap.set(snap.snowmap);
    if (snap.grassmap) this.grassmap.set(snap.grassmap);
    
    this.worker.postMessage({
      type: 'init',
      size: this.size,
      resolution: this.resolution,
      heightmap: this.heightmap,
      snowmap: this.snowmap,
      grassmap: this.grassmap,
      snowPack: this.snowPack
    });
  }


  reset(seaLevel = 0) {
    this.worker.postMessage({ type: 'reset' });
  }

  shiftGlobalHeight(delta) {
    this.worker.postMessage({ type: 'shiftGlobal', delta });
  }

  /** Paint / Sculpt asynchronously via Worker */
  sculpt(toolName, cx, cz, radius, strength, isStart, noiseAmount) {
    this.worker.postMessage({
      type: 'sculpt',
      toolName,
      cx,
      cz,
      radius,
      strength,
      isStart,
      noiseAmount,
      toolState: this._toolState
    });
  }

  /** Push modified heightmap to worker to update geometry and colors */
  updateHeightmap() {
    this.worker.postMessage({ type: 'updateHeightmap', heightmap: this.heightmap });
  }

  /** Update coloring based on sea level */
  updateMesh(seaLevel = 0) {
    this.seaLevel = seaLevel;
    this.worker.postMessage({ type: 'updateSeaLevel', seaLevel });
  }

  /** Update coloring based on snow pack density */
  updateSnowPack(snowPack = 50) {
    this.snowPack = snowPack;
    this.worker.postMessage({ type: 'updateSnowPack', snowPack });
  }

  /** Capture pre-smooth baseline snapshot */
  smoothStart() {
    this.worker.postMessage({ type: 'smoothStart' });
  }

  /** Apply global smoothing (0-100) across the whole terrain heightmap */
  smoothGlobal(value = 0) {
    this.worker.postMessage({ type: 'smoothGlobal', value });
  }

  /** Flatten a circular landing/boarding pad in local heightmap & sync with worker */
  flattenPad(wx, wz, radius = 12) {
    const half = this.size / 2;
    const cx = Math.round(((wx + half) / this.size) * (this.resolution - 1));
    const cz = Math.round(((wz + half) / this.size) * (this.resolution - 1));
    if (cx < 0 || cx >= this.resolution || cz < 0 || cz >= this.resolution) return;

    const gridRadius = Math.ceil((radius / this.size) * (this.resolution - 1));
    const targetH = this.getHeight(cx, cz);

    const minX = Math.max(0, cx - gridRadius);
    const maxX = Math.min(this.resolution - 1, cx + gridRadius);
    const minZ = Math.max(0, cz - gridRadius);
    const maxZ = Math.min(this.resolution - 1, cz + gridRadius);

    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const dx = gx - cx;
        const dz = gz - cz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist <= gridRadius) {
          const t = dist / gridRadius;
          const falloff = (1 - t * t) * (1 - t * t);
          const i = gz * this.resolution + gx;
          this.heightmap[i] = this.heightmap[i] * (1 - falloff) + targetH * falloff;
        }
      }
    }

    this.worker.postMessage({ type: 'flattenPad', wx, wz, radius });
    this.updateHeightmap();
  }

  /**
   * Generates seamless procedural crystalline snow normal and roughness maps.
   */
  static _createSnowTextures() {
    const texSize = 512;
    const normalCanvas = document.createElement('canvas');
    normalCanvas.width = texSize;
    normalCanvas.height = texSize;
    const normalCtx = normalCanvas.getContext('2d');

    const roughnessCanvas = document.createElement('canvas');
    roughnessCanvas.width = texSize;
    roughnessCanvas.height = texSize;
    const roughnessCtx = roughnessCanvas.getContext('2d');

    const normalImg = normalCtx.createImageData(texSize, texSize);
    const normalData = normalImg.data;
    const roughImg = roughnessCtx.createImageData(texSize, texSize);
    const roughData = roughImg.data;

    const heightField = new Float32Array(texSize * texSize);

    const grad = (x, y) => {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return n - Math.floor(n);
    };

    const noise2D = (x, y, period) => {
      const px = ((x % period) + period) % period;
      const py = ((y % period) + period) % period;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const x1 = (x0 + 1) % period;
      const y1 = (y0 + 1) % period;
      const fx = px - x0;
      const fy = py - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);

      const n00 = grad(x0, y0);
      const n10 = grad(x1, y0);
      const n01 = grad(x0, y1);
      const n11 = grad(x1, y1);

      const nx0 = n00 * (1 - sx) + n10 * sx;
      const nx1 = n01 * (1 - sx) + n11 * sx;
      return nx0 * (1 - sy) + nx1 * sy;
    };

    for (let y = 0; y < texSize; y++) {
      for (let x = 0; x < texSize; x++) {
        // Layer 1: Fine high-frequency ice crystal micro-facets
        const fineP = 32;
        const fine = noise2D(x / (texSize / fineP), y / (texSize / fineP), fineP);

        // Layer 2: Wind-sculpted sastrugi drifts (diagonal ripples)
        const sastrugiP = 8;
        const sx = x * 0.85 + y * 0.52;
        const sastrugi = Math.sin(sx / (texSize / sastrugiP) * Math.PI * 2) * 0.5 + 0.5;

        // Layer 3: Soft powder waves
        const waveP = 4;
        const wave = noise2D(x / (texSize / waveP), y / (texSize / waveP), waveP);

        const h = fine * 0.35 + sastrugi * 0.45 + wave * 0.20;
        heightField[y * texSize + x] = h;
      }
    }

    const bumpStrength = 4.5;
    for (let y = 0; y < texSize; y++) {
      for (let x = 0; x < texSize; x++) {
        const xL = (x - 1 + texSize) % texSize;
        const xR = (x + 1) % texSize;
        const yU = (y - 1 + texSize) % texSize;
        const yD = (y + 1) % texSize;

        const hL = heightField[y * texSize + xL];
        const hR = heightField[y * texSize + xR];
        const hU = heightField[yU * texSize + x];
        const hD = heightField[yD * texSize + x];
        const hCenter = heightField[y * texSize + x];

        const dx = (hR - hL) * bumpStrength;
        const dy = (hD - hU) * bumpStrength;
        const len = Math.sqrt(dx * dx + dy * dy + 1.0);

        const nx = -dx / len;
        const ny = -dy / len;
        const nz = 1.0 / len;

        const idx = (y * texSize + x) * 4;

        normalData[idx + 0] = Math.round((nx * 0.5 + 0.5) * 255);
        normalData[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        normalData[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        normalData[idx + 3] = 255;

        // Realistic roughness: wind-packed drifts are slightly glossier (~0.42), powder hollows ~0.77
        const rough = 0.42 + (1.0 - hCenter) * 0.35;
        const rByte = Math.round(rough * 255);
        roughData[idx + 0] = rByte;
        roughData[idx + 1] = rByte;
        roughData[idx + 2] = rByte;
        roughData[idx + 3] = 255;
      }
    }

    normalCtx.putImageData(normalImg, 0, 0);
    roughnessCtx.putImageData(roughImg, 0, 0);

    const normalTexture = new THREE.CanvasTexture(normalCanvas);
    normalTexture.wrapS = THREE.RepeatWrapping;
    normalTexture.wrapT = THREE.RepeatWrapping;
    normalTexture.repeat.set(64, 64);

    const roughnessTexture = new THREE.CanvasTexture(roughnessCanvas);
    roughnessTexture.wrapS = THREE.RepeatWrapping;
    roughnessTexture.wrapT = THREE.RepeatWrapping;
    roughnessTexture.repeat.set(64, 64);

    return { normalMap: normalTexture, roughnessMap: roughnessTexture };
  }
}
