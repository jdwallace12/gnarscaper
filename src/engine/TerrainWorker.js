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
let currentSnowPack = 50;

const _tmpBase = new THREE.Color();
const _tmpResult = new THREE.Color();

function _colorForHeight(h, seaLevel, steepness = 0, snowAmount = 0, curvature = 0) {
  const base = _tmpBase;
  const result = _tmpResult;
  
  if (h < seaLevel - 4) {
    base.copy(DEEP_WATER);
  } else if (h < seaLevel - 1) {
    base.lerpColors(DEEP_WATER, SHALLOW, (h - (seaLevel - 4)) / 3);
  } else if (h < seaLevel + 0.5) {
    // Beach: transition from shallow water to sand
    base.lerpColors(SHALLOW, SAND, (h - (seaLevel - 1)) / 1.5);
  } else if (h < seaLevel + 2.5) {
    // Beach: transition from sand to low grass
    base.lerpColors(SAND, GRASS_LOW, (h - (seaLevel + 0.5)) / 2.0);
  } else if (h < seaLevel + 18) {
    base.lerpColors(GRASS_LOW, GRASS_HIGH, (h - (seaLevel + 2.5)) / 15.5);
  } else if (h < seaLevel + 28) {
    base.lerpColors(GRASS_HIGH, ALPINE_MEADOW, (h - (seaLevel + 18)) / 10);
  } else if (h < seaLevel + 37) {
    base.lerpColors(ALPINE_MEADOW, ROCK, (h - (seaLevel + 28)) / 9);
  } else if (h < seaLevel + 57) {
    base.lerpColors(ROCK, ROCK_DARK, (h - (seaLevel + 37)) / 20);
  } else {
    base.copy(ROCK_DARK);
  }

  if (h > seaLevel + 0.5 && steepness > 0.6) {
    const steepFactor = Math.min((steepness - 0.6) / 0.5, 1.0);
    result.lerpColors(base, ROCK, steepFactor);
    base.copy(result);
  }

  const packFactor = currentSnowPack / 100.0;
  
  // Base elevation where snow line starts. 
  // At 50% slider, this is exactly the original seaLevel + 57!
  const baseElevation = (seaLevel + 57) - (packFactor - 0.5) * 40.0;
  
  const flatness = Math.max(0, 1.0 - steepness * 2.0);
  
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

  const totalSnow = Math.max(snowAmount, naturalSnow);

  if (totalSnow > 0.05) {
    result.lerpColors(base, SNOW, Math.min(totalSnow, 1.0));
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

  // Choose a random diagonal direction for the mountain range
  const isDiagonalA = Math.random() > 0.5;
  const spineThickness = 0.35 + Math.random() * 0.1;

  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const nx = x / res;
      const nz = z / res;

      // ---- Domain warping for organic distortion ----
      const warpScale = 3.0;
      const warpStrength = 0.15;
      const warpX = fbm((nx + seedWarp) * warpScale, (nz + seedWarp) * warpScale, 3, 2.0, 0.5);
      const warpZ = fbm((nx + seedWarp + 100) * warpScale, (nz + seedWarp + 100) * warpScale, 3, 2.0, 0.5);
      const wnx = nx + warpX * warpStrength;
      const wnz = nz + warpZ * warpStrength;

      // ---- Continuous Mountain Spine ----
      // Warp the distance calculation so the mountain range snakes naturally
      const spineWarp = fbm(wnx * 2.0, wnz * 2.0, 4, 2.0, 0.5) * 0.3;
      
      let spineDist = 0;
      if (isDiagonalA) {
        spineDist = Math.abs(nx - nz + spineWarp) / Math.SQRT2;
      } else {
        spineDist = Math.abs(nx + nz - 1 + spineWarp) / Math.SQRT2;
      }
      
      // Smooth falloff from the spine (1 at center, 0 at edges)
      const falloff = Math.max(0, 1 - spineDist / spineThickness);
      
      // Modulate the spine height with noise to create distinct peaks and passes along the range
      const peakNoise = fbm((wnx + seedX) * 2.5, (wnz + seedZ) * 2.5, 3, 2.0, 0.5);
      const envelope = falloff * falloff * (3 - 2 * falloff) * (0.5 + peakNoise * 0.5);

      // ---- Layered noise ----
      const baseScale = 3.5;
      const base = fbm((wnx + seedX) * baseScale, (wnz + seedZ) * baseScale, 6, 2.0, 0.5);

      const ridgeScale = 4.0;
      const ridged = ridgedNoise((wnx + seedX) * ridgeScale, (wnz + seedZ) * ridgeScale, 5, 2.2, 0.5);

      const detailScale = 12.0;
      const detail = fbm((wnx + seedX) * detailScale, (wnz + seedZ) * detailScale, 4, 2.0, 0.45);

      const ridgeBlend = envelope * 0.7 + 0.3;
      const mainNoise = base * (1 - ridgeBlend) + ridged * ridgeBlend;

      // Base terrain: higher average elevation with more amplitude for rolling green hills
      const baseTerrainHeight = (base + 0.3) * 40.0;
      
      // Scale height: taller mountains with dramatic relief
      const maxHeight = 180;
      let h = baseTerrainHeight + envelope * maxHeight * (0.5 + mainNoise * 0.5);

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

    const curvature = hL + hR + hU + hD - 4.0 * h;

    const c = _colorForHeight(h, seaLevel, steepness, snowmap[i], curvature);
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
    if (msg.snowPack !== undefined) currentSnowPack = msg.snowPack;
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
      const { toolName, cx, cz, radius, strength, isStart, toolState, noiseAmount } = msg;
      
      // Re-hydrate any necessary state for continuous tools like Ramp or Flatten
      if (toolState) {
        Object.assign(tool, toolState);
      }
      
      const mapToApply = tool.isSnowBrush ? snowmap : heightmap;
      tool.apply(mapToApply, resolution, cx, cz, radius, strength, isStart, noiseAmount, snowmap, heightmap);
      
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
  else if (msg.type === 'updateHeightmap') {
    if (msg.heightmap) heightmap.set(msg.heightmap);
    const colors = computeColors(currentSeaLevel);
    self.postMessage({
      type: 'colors_update',
      colors: colors,
      heightmap: new Float32Array(heightmap)
    });
  }
  else if (msg.type === 'updateSnowPack') {
    currentSnowPack = msg.snowPack;
    const colors = computeColors(currentSeaLevel);
    self.postMessage({
      type: 'colors_update',
      colors: colors
    });
  }
};
