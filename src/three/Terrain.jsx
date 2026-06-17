import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { grainFragment, pickColor, smoothstep } from "./grainShader.js";

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uFar;
  uniform float uProgress;

  attribute float aScale;
  attribute float aBright;
  attribute float aPhase;
  attribute vec3 aColor;
  attribute vec3 aTarget;

  varying float vBright;
  varying float vAlpha;
  varying float vTwinkle;
  varying vec3 vColor;

  void main() {
    float ease = smoothstep(0.0, 1.0, clamp(uProgress, 0.0, 1.0));
    vec3 morphed = mix(position, aTarget, ease);

    float ph = aPhase;
    float amp = (0.09 + aScale * 0.05) * (1.0 - ease * 0.55);
    morphed.x += sin(uTime * 2.4 + ph) * amp;
    morphed.y += cos(uTime * 2.1 + ph * 1.3) * amp;
    morphed.z += sin(uTime * 1.8 + ph * 0.7) * amp * 0.6;

    vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);
    float dist = -mvPosition.z;

    vTwinkle = 0.6 + 0.4 * sin(uTime * 1.1 + aPhase);
    float fogFade = smoothstep(uFar, uFar * 0.18, dist);
    float nearFade = smoothstep(2.0, 10.0, dist);
    vAlpha = fogFade * nearFade;
    vBright = aBright;
    vColor = aColor;

    gl_PointSize = uSize * aScale * uPixelRatio * (70.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 0.0, 3.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Mountain height with a flat valley corridor down the middle (x ~ 0)
function terrainHeight(x, z) {
  const n =
    (Math.sin(x * 0.08) * 0.5 + 0.5) * (Math.sin(z * 0.05 + 1.3) * 0.5 + 0.5) +
    0.6 * (Math.sin(x * 0.17 + 2.1) * 0.5 + 0.5) * (Math.sin(z * 0.11) * 0.5 + 0.5) +
    0.3 * (Math.sin(x * 0.31 + 0.6) * 0.5 + 0.5);
  const peak = (n / 1.9) * 46;
  const valley = smoothstep(16, 70, Math.abs(x)); // 0 in corridor, 1 on the sides
  return -2 + peak * valley;
}

export default function Terrain({ count = 160000, sRef }) {
  const matRef = useRef();

  const { positions, scales, brights, phases, colors, targets } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const brights = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const targets = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Dust home: the approved bottom-heavy hero curtain
      positions[i * 3 + 0] = (Math.random() - 0.5) * 240;
      const yBias = Math.pow(Math.random(), 3.4);
      positions[i * 3 + 1] = -66 + yBias * 128;
      positions[i * 3 + 2] = -(66 + Math.random() * 22);

      // Terrain target: 3D mountains in depth with a center valley
      const tx = (Math.random() - 0.5) * 280;
      const tz = 30 - Math.random() * 320;
      const ty = terrainHeight(tx, tz) + (Math.random() - 0.5) * 2.5;
      targets[i * 3 + 0] = tx;
      targets[i * 3 + 1] = ty;
      targets[i * 3 + 2] = tz;

      scales[i] = 0.55 + Math.random() * 0.5;
      brights[i] = 0.22 + Math.pow(Math.random(), 2.6) * 1.1;
      phases[i] = Math.random() * Math.PI * 2.0;

      const p = pickColor();
      const jt = 0.05;
      colors[i * 3 + 0] = Math.min(1, p[0] + (Math.random() - 0.5) * jt);
      colors[i * 3 + 1] = Math.min(1, p[1] + (Math.random() - 0.5) * jt);
      colors[i * 3 + 2] = Math.min(1, p[2] + (Math.random() - 0.5) * jt);
    }
    return { positions, scales, brights, phases, colors, targets };
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: 1.4 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uFar: { value: 360 },
      uProgress: { value: 0 },
      uFade: { value: 1 },
    }),
    []
  );

  useFrame((state) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      // Stay as the clean hero dust (terrain "wall" morph disabled)
      matRef.current.uniforms.uProgress.value = 0;
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aScale" count={count} array={scales} itemSize={1} />
        <bufferAttribute attach="attributes-aBright" count={count} array={brights} itemSize={1} />
        <bufferAttribute attach="attributes-aPhase" count={count} array={phases} itemSize={1} />
        <bufferAttribute attach="attributes-aColor" count={count} array={colors} itemSize={3} />
        <bufferAttribute attach="attributes-aTarget" count={count} array={targets} itemSize={3} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={grainFragment}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
