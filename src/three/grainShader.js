// Shared fragment shader for fine dust-grain particles
export const grainFragment = /* glsl */ `
  precision highp float;

  varying float vBright;
  varying float vAlpha;
  varying float vTwinkle;
  varying vec3 vColor;

  uniform float uFade;

  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    float core = 1.0 - smoothstep(0.32, 0.5, d);
    float intensity = core * vBright * vTwinkle;

    vec3 color = vColor * intensity;
    float alpha = core * vAlpha * uFade;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

// Mostly-cool palette with rare warm accents
export const PALETTE = [
  [0.85, 0.9, 1.0],
  [0.62, 0.74, 1.0],
  [0.7, 0.82, 0.98],
  [1.0, 0.86, 0.74],
  [0.78, 0.88, 0.95],
];

export function pickColor() {
  const cr = Math.random();
  if (cr < 0.82) return PALETTE[0];
  if (cr < 0.92) return PALETTE[1];
  if (cr < 0.97) return PALETTE[2];
  if (cr < 0.99) return PALETTE[3];
  return PALETTE[4];
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
