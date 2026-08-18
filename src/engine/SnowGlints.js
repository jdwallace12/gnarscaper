import * as THREE from 'three/webgpu';

/**
 * Glistening diamond snow micro-sparkles scattered across the terrain snow surface.
 * Inspired by Grand Mountain Adventure's sunlit snow glint effect.
 */
export class SnowGlints {
  constructor(terrain, count = 2500) {
    this.terrain = terrain;
    this.count = count;
    this.group = new THREE.Group();

    this.geometry = new THREE.BufferGeometry();
    this._positions = new Float32Array(count * 3);
    this._phases = new Float32Array(count);
    this._baseSizes = new Float32Array(count);

    // Populate initial sparkle cloud around origin
    for (let i = 0; i < count; i++) {
      const rx = (Math.random() - 0.5) * 140;
      const rz = (Math.random() - 0.5) * 140;
      const h = this.terrain.getInterpolatedHeight(rx, rz);

      this._positions[i * 3 + 0] = rx;
      this._positions[i * 3 + 1] = h + 0.05;
      this._positions[i * 3 + 2] = rz;

      this._phases[i] = Math.random() * Math.PI * 2;
      this._baseSizes[i] = 0.25 + Math.random() * 0.45;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));

    // Sparkling star material
    this.material = new THREE.PointsMaterial({
      color: 0xfff7fb,
      size: 0.45,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
    this.group.add(this.mesh);

    this._time = 0;
    this._lastCenter = new THREE.Vector3();
  }

  update(dt, centerPos) {
    if (!centerPos) return;

    this._time += dt;

    const posAttr = this.geometry.attributes.position;
    const array = posAttr.array;
    const radius = 90;
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
        array[i * 3 + 1] = (snowCover > 0.1) ? h + 0.05 : -1000; // Hide off snow
        array[i * 3 + 2] = z;
      }
    }

    posAttr.needsUpdate = true;

    // Twinkle opacity oscillation
    this.material.opacity = 0.75 + Math.sin(this._time * 5.0) * 0.15;
  }
}
