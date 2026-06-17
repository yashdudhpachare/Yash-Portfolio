import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;

  void main() {
    float d = distance(vUv, vec2(0.5));

    // Small bright crisp point with a tight, restrained halo
    float pulse = 0.94 + 0.06 * sin(uTime * 1.4);
    float core = smoothstep(0.045, 0.0, d) * 1.6;
    float halo = pow(smoothstep(0.32, 0.0, d), 4.0) * 0.5;

    float intensity = (core + halo) * pulse;
    vec3 col = vec3(0.9, 0.93, 1.0) * intensity;
    gl_FragColor = vec4(col, intensity);
  }
`;

export default function Orb({ position = [0, 1.5, -4], scale = 2.4 }) {
  const matRef = useRef();
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh position={position} scale={[scale, scale, 1]}>
      <planeGeometry args={[1, 1]} />
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
    </mesh>
  );
}
