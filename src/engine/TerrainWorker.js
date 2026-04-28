import * as THREE from 'three';
import { TOOLS } from '../tools/tools.js';
import { fbm, ridgedNoise } from './noise.js';

const DEEP_WATER = new THREE.Color(0x0a2a4a);
const SHALLOW = new THREE.Color(0x1a6e8e);
const SAND = new THREE.Color(0xc2b280);
const GRASS_LOW = new THREE.Color(0x4a7c3f);
const GRASS_HIGH = new THREE.Color(0x2d5a27);
const ALPINE_MEADOW = new THREE.Color(0x6b7f4a);
const ROCK = new THREE.Color(0x6b6b6b);
const ROCK_DARK = new THREE.Color(0x4a4a4a);
const SNOW = new THREE.Color(0xf0f0f0);

let size = 200;
let resolution = 256;
let heightmap = null;
let snowmap = null;
let currentSeaLevel = 0;

const _tmpBase = new THREE.Color();
const _tmpResult = new THREE.Color();

function _colorForHeight(h, seaLevel, steepness = 0, snowAmount = 0) {
  const base = _tmpBase;
  const result = _tmpResult;
  
  if (h < seaLevel - 4) {
    base.copy(DEEP_WATER);
  } else if (h < seaLevel - 1) {
    base.lerpColors(DEEP_WATER, SHALLOW, (h - (seaLevel - 4)) / 3);
  } else if (h < seaLevel + 0.5) {
    base.lerpColors(SHALLOW, SAND, (h - (seaLevel - 1)) / 1.5);
  } else if (h < seaLevel + 8) {
    base.lerpColors(SAND, GRASS_LOW, (h - (seaLevel + 0.5)) / 7.5);
  } else if (h < seaLevel + 18) {
    base.lerpColors(GRASS_LOW, GRASS_HIGH, (h - (seaLevel + 8)) / 10);
  } else if (h < seaLevel + 28) {
    base.lerpColors(GRASS_HIGH, ALPINE_MEADOW, (h - (seaLevel + 18)) / 10);
  } else if (h < seaLevel + 37) {
    base.lerpColors(ALPINE_MEADOW, ROCK, (h - (seaLevel + 28)) / 9);
  } else if (h < seaLevel + 57) {
    base.lerpColors(ROCK, ROCK_DARK, (h - (seaLevel + 37)) / 20);
  } else if (h < seaLevel + 77) {
    base.lerpColors(ROCK_DARK, SNOW, (h - (seaLevel + 57)) / 20);
  } else {
    base.copy(SNOW);
  }

  if (h > seaLevel + 0.5 && steepness > 0.6) {
    const steepFactor = Math.min((steepness - 0.6) / 0.5, 1.0);
    result.lerpColors(base, ROCK, steepFactor);
    base.copy(result);
  }

  if (snowAmount > 0.05) {
    result.lerpColors(base, SNOW, Math.min(snowAmount, 1.0));
    return result;
  }

  return base;
}

// ---- Noise utilities moved to noise.js ----

function _generateInitialTerrain() {
  const res = resolution;

  // Random seed offsets so each map is unique
  const seedX = Math.random() * 1000;
  const seedZ = Math.random() * 1000;
  const seedWarp = Math.random() * 1000;

  // Generate 2-4 mountain peaks at random positions
  const numPeaks = 2 + Math.floor(Math.random() * 3);
  const peaks = [];
  for (let p = 0; p < numPeaks; p++) {
    peaks.push({
      x: 0.25 + Math.random() * 0.5,  // Keep peaks away from edges
      z: 0.25 + Math.random() * 0.5,
      height: 0.6 + Math.random() * 0.4, // Height multiplier 0.6-1.0
      radius: 0.2 + Math.random() * 0.15  // Falloff radius
    });
  }

  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const nx = x / res;
      const nz = z / res;

      // ---- Mountain envelope from multiple peaks ----
      let envelope = 0;
      for (const peak of peaks) {
        const dx = nx - peak.x;
        const dz = nz - peak.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const falloff = Math.max(0, 1 - dist / peak.radius);
        // Smooth cubic falloff for natural mountain base shape
        envelope = Math.max(envelope, falloff * falloff * (3 - 2 * falloff) * peak.height);
      }

      // ---- Domain warping for organic distortion ----
      // Warp the sample coordinates by noise, creating erosion-like patterns
      const warpScale = 3.0;
      const warpStrength = 0.15;
      const warpX = fbm((nx + seedWarp) * warpScale, (nz + seedWarp) * warpScale, 3, 2.0, 0.5);
      const warpZ = fbm((nx + seedWarp + 100) * warpScale, (nz + seedWarp + 100) * warpScale, 3, 2.0, 0.5);
      const wnx = nx + warpX * warpStrength;
      const wnz = nz + warpZ * warpStrength;

      // ---- Layered noise ----
      // Base terrain: broad rolling hills
      const baseScale = 3.5;
      const base = fbm((wnx + seedX) * baseScale, (wnz + seedZ) * baseScale, 6, 2.0, 0.5);

      // Ridged noise: sharp mountain ridges and peaks
      const ridgeScale = 4.0;
      const ridged = ridgedNoise((wnx + seedX) * ridgeScale, (wnz + seedZ) * ridgeScale, 5, 2.2, 0.5);

      // Fine detail: small bumps and roughness
      const detailScale = 12.0;
      const detail = fbm((wnx + seedX) * detailScale, (wnz + seedZ) * detailScale, 4, 2.0, 0.45);

      // ---- Combine layers ----
      // Blend between smooth base and sharp ridges based on elevation
      // Higher areas get more ridged features, lower areas stay smooth
      const ridgeBlend = envelope * 0.7 + 0.3;
      const mainNoise = base * (1 - ridgeBlend) + ridged * ridgeBlend;

      // Scale height: taller mountains with dramatic relief
      const maxHeight = 130;
      let h = envelope * maxHeight * (0.5 + mainNoise * 0.5);

      // Add fine detail scaled by elevation (more detail at higher elevation)
      h += detail * 4.0 * Math.max(0.2, envelope);

      // ---- Edge falloff ---- 
      // Smooth terrain to zero at map boundaries
      const edgeX = 1 - Math.pow(2 * nx - 1, 6);
      const edgeZ = 1 - Math.pow(2 * nz - 1, 6);
      h *= Math.min(edgeX, edgeZ);

      heightmap[z * res + x] = Math.max(0, h);
    }
  }
}

function computeColors(seaLevel = 0) {
  const count = resolution * resolution;
  const colors = new Float32Array(count * 3);
  const spacing = size / (resolution - 1);
  const invSpacing2 = 1 / (2 * spacing);

  for (let i = 0; i < count; i++) {
    const h = heightmap[i];

    const gx = i % resolution;
    const gz = (i / resolution) | 0;

    const hL = gx > 0 ? heightmap[gz * resolution + (gx - 1)] : heightmap[gz * resolution + gx];
    const hR = gx < resolution - 1 ? heightmap[gz * resolution + (gx + 1)] : heightmap[gz * resolution + gx];
    const hU = gz > 0 ? heightmap[(gz - 1) * resolution + gx] : heightmap[gz * resolution + gx];
    const hD = gz < resolution - 1 ? heightmap[(gz + 1) * resolution + gx] : heightmap[gz * resolution + gx];

    const gradX = (hR - hL) * invSpacing2;
    const gradZ = (hD - hU) * invSpacing2;
    const steepness = Math.sqrt(gradX * gradX + gradZ * gradZ);

    const c = _colorForHeight(h, seaLevel, steepness, snowmap[i]);
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  return colors;
}

self.onmessage = function (e) {
  const msg = e.data;

  if (msg.type === 'init') {
    size = msg.size || 200;
    resolution = msg.resolution || 256;
    
    heightmap = new Float32Array(resolution * resolution);
    snowmap = new Float32Array(resolution * resolution);
    
    if (msg.heightmap && msg.snowmap) {
      heightmap.set(msg.heightmap);
      snowmap.set(msg.snowmap);
    } else {
      _generateInitialTerrain();
    }
    
    if (msg.seaLevel !== undefined) currentSeaLevel = msg.seaLevel;
    const colors = computeColors(currentSeaLevel);
    
    self.postMessage({
      type: 'init_done',
      heightmap: new Float32Array(heightmap), // copy to send back
      snowmap: new Float32Array(snowmap),
      colors: colors
    });
  } 
  else if (msg.type === 'sculpt') {
    const { toolName, cx, cz, radius, strength, isStart, toolState } = msg;
    const tool = TOOLS[toolName];
    
    if (tool && tool.apply) {
      // Re-hydrate any necessary state for continuous tools like Ramp or Flatten
      if (toolState) {
        Object.assign(tool, toolState);
      }
      
      const mapToApply = tool.isSnowBrush ? snowmap : heightmap;
      tool.apply(mapToApply, resolution, cx, cz, radius, strength, isStart);
      
      // Sanitize: replace any NaNs with 0 to prevent disappearing terrain
      for (let i = 0; i < heightmap.length; i++) {
        if (isNaN(heightmap[i])) heightmap[i] = 0;
        if (isNaN(snowmap[i])) snowmap[i] = 0;
      }

      const colors = computeColors(currentSeaLevel);
      
      self.postMessage({
        type: 'sculpt_done',
        heightmap: new Float32Array(heightmap),
        snowmap: new Float32Array(snowmap),
        colors: colors,
        // Send state back so main thread can store it if needed
        toolState: {
           _targetHeight: tool._targetHeight,
           _startX: tool._startX,
           _startZ: tool._startZ,
           _startH: tool._startH
        }
      });
    }
  }
  else if (msg.type === 'shiftGlobal') {
    const { delta } = msg;
    for (let i = 0; i < heightmap.length; i++) {
      heightmap[i] += delta;
    }
    const colors = computeColors(currentSeaLevel);
    self.postMessage({
      type: 'shift_done',
      heightmap: new Float32Array(heightmap),
      colors: colors
    });
  }
  else if (msg.type === 'reset') {
    heightmap.fill(0);
    snowmap.fill(0);
    const colors = computeColors(currentSeaLevel);
    self.postMessage({
      type: 'reset_done',
      heightmap: new Float32Array(heightmap),
      snowmap: new Float32Array(snowmap),
      colors: colors
    });
  }
  else if (msg.type === 'updateSeaLevel') {
    currentSeaLevel = msg.seaLevel;
    const colors = computeColors(currentSeaLevel);
    self.postMessage({
      type: 'colors_update',
      colors: colors
    });
  }
};
