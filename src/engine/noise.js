// Simple hash-based 2D noise (no dependencies)
export function hash(x, y) {
  let h = (x * 374761393 + y * 668265263 + 1234567) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h & 0x7fffffff) / 0x7fffffff; // 0..1
}

// Smooth value noise with bicubic interpolation
export function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  // Quintic smoothstep for smoother derivatives
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  const v00 = hash(ix, iy);
  const v10 = hash(ix + 1, iy);
  const v01 = hash(ix, iy + 1);
  const v11 = hash(ix + 1, iy + 1);

  const a = v00 + (v10 - v00) * ux;
  const b = v01 + (v11 - v01) * ux;
  return (a + (b - a) * uy) * 2 - 1; // -1..1
}

// Fractal Brownian Motion — layered noise at multiple scales
export function fbm(x, y, octaves, lacunarity, gain) {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency, y * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / maxAmp;
}

// Ridged multifractal noise — creates sharp mountain ridges
export function ridgedNoise(x, y, octaves, lacunarity, gain) {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmp = 0;
  let weight = 1;

  for (let i = 0; i < octaves; i++) {
    let n = Math.abs(valueNoise(x * frequency, y * frequency));
    n = 1 - n;     // Invert so ridges become peaks
    n = n * n;      // Sharpen the ridges
    n *= weight;    // Weight successive octaves by previous
    weight = Math.min(1, Math.max(0, n * 2)); // Clamp weight

    sum += n * amplitude;
    maxAmp += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / maxAmp;
}
