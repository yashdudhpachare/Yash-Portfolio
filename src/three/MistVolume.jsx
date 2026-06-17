import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { smoothstep } from "./grainShader.js";

// Volumetric mist made of many large, soft, overlapping puffs that live in the
// SAME 3D space as the dust. Because each puff has real depth it parallaxes with
// the camera, fades with distance and drifts on slow currents — reading as mist
// in the environment rather than a flat plane.
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uProgress;
  uniform float uFar;

  attribute float aScale;
  attribute float aPhase;
  attribute float aSeed;

  varying float vAlpha;
  varying vec3 vTint;
  varying float vSeed;

  void main() {
    vec3 pos = position;

    // Slow, curling advection so the body of fog rolls and rises on air currents.
    float t = uTime * 0.05;
    pos.x += sin(t + aPhase) * 7.0 + sin(t * 0.5 + aSeed) * 3.5;
    pos.y += sin(t * 0.6 + aPhase * 1.3) * 2.5 + t * 0.4; // gentle rise
    pos.z += cos(t * 0.4 + aSeed) * 5.0;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mv.z;

    // Hero only: dissolve as the field gathers into the mountain.
    float heroMask = 1.0 - smoothstep(0.0, 0.2, uProgress);
    // Depth fade (far fog dissolves) + near fade (don't smother the lens).
    float fog = smoothstep(uFar, uFar * 0.12, dist) * smoothstep(6.0, 40.0, dist);
    // Banked low: thin out toward the upper void.
    float top = 1.0 - smoothstep(-8.0, 34.0, position.y);

    vAlpha = fog * top * heroMask;
    vSeed = aSeed;
    // Cooler and a touch brighter with depth for atmospheric perspective.
    vTint = mix(vec3(0.30, 0.40, 0.60), vec3(0.46, 0.58, 0.82), smoothstep(10.0, 220.0, dist));

    gl_PointSize = aScale * uPixelRatio * (900.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 0.0, 620.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  varying vec3 vTint;
  varying float vSeed;
  uniform float uTime;

  // Cheap value noise so each puff has an irregular, broken edge (not a disc).
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;

    // Soft gaussian core.
    float g = exp(-d * d * 6.5);
    // Break up the silhouette with drifting noise so it looks wispy.
    float n = noise(gl_PointCoord * 4.0 + vec2(vSeed * 10.0, uTime * 0.05));
    g *= 0.55 + 0.7 * n;

    float a = g * vAlpha * 0.085;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vTint * a, a);
  }
`;

export default function MistVolume({ count = 900, sRef }) {
  const matRef = useRef();

  const { positions, scales, phases, seeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const phases = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const zt = Math.pow(Math.random(), 1.4); // concentrate nearer, fan into depth
      const z = 16 - zt * 210;
      const xspread = 90 + zt * 240;
      positions[i * 3 + 0] = (Math.random() - 0.5) * xspread;
      positions[i * 3 + 1] = -52 + Math.pow(Math.random(), 2.2) * 60; // banked low
      positions[i * 3 + 2] = z;
      scales[i] = 26 + Math.random() * 64; // large soft puffs
      phases[i] = Math.random() * Math.PI * 2.0;
      seeds[i] = Math.random() * 10.0;
    }
    return { positions, scales, phases, seeds };
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uProgress: { value: 0 },
      uFar: { value: 200 },
    }),
    []
  );

  useFrame((state) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      const s = sRef ? sRef.current : 0;
      matRef.current.uniforms.uProgress.value = smoothstep(0.06, 0.5, s);
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aScale" count={count} array={scales} itemSize={1} />
        <bufferAttribute attach="attributes-aPhase" count={count} array={phases} itemSize={1} />
        <bufferAttribute attach="attributes-aSeed" count={count} array={seeds} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
