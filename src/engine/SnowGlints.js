import * as THREE from 'three/webgpu';

/**
 * Glistening diamond snow micro-sparkles scattered across the terrain snow surface.
 * Inspired by Grand Mountain Adventure's sunlit snow glint effect and real-world snow crystal reflections.
 */
export class SnowGlints {
  constructor(terrain, count = 4000) {
    this.terrain = terrain;
    this.count = count;
    this.group = new THREE.Group();

    this.geometry = new THREE.BufferGeometry();
    this._positions = new Float32Array(count * 3);
    this._phases = new Float32Array(count);
    this._baseSizes = new Float32Array(count);
    this._colors = new Float32Array(count * 3);

    // Populate initial sparkle cloud
    for (let i = 0; i < count; i++) {
      const rx = (Math.random() - 0.5) * 160;
      const rz = (Math.random() - 0.5) * 160;
      const h = this.terrain.getInterpolatedHeight(rx, rz);
      const isSnow = this.terrain.getSnowCover(rx, rz) > 0.1;

      this._positions[i * 3 + 0] = rx;
      this._positions[i * 3 + 1] = isSnow ? h + 0.05 : -1000;
      this._positions[i * 3 + 2] = rz;

      this._phases[i] = Math.random() * Math.PI * 2;
      this._baseSizes[i] = 0.25 + Math.random() * 0.65;

      // Color tints: mostly brilliant white with subtle spectral pastel cyan/violet glints
      const tint = Math.random();
      if (tint < 0.65) {
        this._colors[i * 3 + 0] = 1.0;
        this._colors[i * 3 + 1] = 1.0;
        this._colors[i * 3 + 2] = 1.0;
      } else if (tint < 0.85) {
        this._colors[i * 3 + 0] = 0.92;
        this._colors[i * 3 + 1] = 0.98;
        this._colors[i * 3 + 2] = 1.0;
      } else {
        this._colors[i * 3 + 0] = 1.0;
        this._colors[i * 3 + 1] = 0.97;
        this._colors[i * 3 + 2] = 0.92;
      }
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this._colors, 3));

    // Generate procedural diamond starburst sprite texture
    const sparkleTexture = SnowGlints._createSparkleTexture();

    // Sparkling star material with additive blending and soft falloff
    this.material = new THREE.PointsMaterial({
      map: sparkleTexture,
      vertexColors: true,
      size: 0.65,
      transparent: true,
      opacity: 0.92,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
    this.group.add(this.mesh);

    this._time = 0;
  }

  /**
   * Generates a 4-point diamond starburst sparkle sprite texture with central bloom.
   */
  static _createSparkleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const cx = 32;
    const cy = 32;

    // Radial bloom halo
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.2, 'rgba(235, 248, 255, 0.7)');
    grad.addColorStop(0.5, 'rgba(180, 225, 255, 0.25)');
    grad.addColorStop(1, 'rgba(140, 200, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    // 4-point diamond star spikes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx, 60);
    ctx.moveTo(4, cy);
    ctx.lineTo(60, cy);
    ctx.stroke();

    // Diagonal subtle glint
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy - 14);
    ctx.lineTo(cx + 14, cy + 14);
    ctx.moveTo(cx + 14, cy - 14);
    ctx.lineTo(cx - 14, cy + 14);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  update(dt, centerPos) {
    if (!centerPos) return;

    this._time += dt;

    const posAttr = this.geometry.attributes.position;
    const array = posAttr.array;
    const radius = 95;
    const diameter = radius * 2;

    // Shift sparkles as the camera/player moves so sparkles always envelope the viewer
    for (let i = 0; i < this.count; i++) {
      let x = array[i * 3 + 0];
      let z = array[i * 3 + 2];

      let dx = x - centerPos.x;
      let dz = z - centerPos.z;

      let wrap = false;
      if (dx > radius) { x -= diameter; wrap = true; }
      else if (dx < -radius) { x += diameter; wrap = true; }

      if (dz > radius) { z -= diameter; wrap = true; }
      else if (dz < -radius) { z += diameter; wrap = true; }

      if (wrap) {
        const snowCover = this.terrain.getSnowCover(x, z);
        const h = this.terrain.getInterpolatedHeight(x, z);
        array[i * 3 + 0] = x;
        array[i * 3 + 1] = (snowCover > 0.1) ? h + 0.05 : -1000;
        array[i * 3 + 2] = z;
      }
    }

    posAttr.needsUpdate = true;

    // Dynamic crystalline twinkle: multi-frequency sparkle shimmer
    this.material.opacity = 0.82 + Math.sin(this._time * 4.5) * 0.14 + Math.cos(this._time * 8.2) * 0.04;
  }
}

