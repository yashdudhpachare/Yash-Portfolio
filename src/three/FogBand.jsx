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

// Real flowing mist: domain-warped fbm advected over time so the fog curls and
// drifts like it's carried on air currents. Several layers at different depths,
// tints and speeds stack into believable atmosphere.
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uOpacity;
  uniform float uElong;
  uniform float uSpeed;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6); // rotate each octave to kill axis artifacts
    for(int i=0;i<6;i++){ v += a*noise(p); p = m*p; a *= 0.5; }
    return v;
  }

  void main(){
    vec2 uv = vUv;

    // Soft elliptical falloff so the layer has no hard edges.
    vec2 c = uv - 0.5;
    float radial = smoothstep(0.55, 0.0, length(c * vec2(1.0, uElong)));
    radial = pow(radial, 1.3);

    float t = uTime * uSpeed;
    vec2 p = uv * vec2(3.2, 3.2 * uElong);
    vec2 flow = vec2(t * 0.6, -t); // drift sideways and rise like warm air

    // Two-stage domain warp -> curling wisps that advect and rise over time.
    vec2 q = vec2(
      fbm(p + flow),
      fbm(p + flow + vec2(5.2, 1.3))
    );
    vec2 r = vec2(
      fbm(p + 3.0 * q + vec2(1.7, 9.2) + flow * 0.5),
      fbm(p + 3.0 * q + vec2(8.3, 2.8) - flow * 0.5)
    );
    float f = fbm(p + 3.4 * r);
    f = smoothstep(0.16, 0.86, f); // carve wispy tendrils with negative space

    // Fine detail layer for thin curling filaments riding on the body of fog.
    float det = fbm(p * 2.3 + 4.0 * r + flow * 1.4);
    f *= 0.7 + 0.5 * det;

    float density = radial * f;
    float alpha = density * uOpacity;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uTint * alpha, alpha);
  }
`;

export default function FogBand({
  position = [0, 0, -7],
  scale = [46, 20, 1],
  tint = [0.36, 0.42, 0.6],
  opacity = 0.28,
  elong = 2.6,
  speed = 0.04,
}) {
  const matRef = useRef();
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(tint[0], tint[1], tint[2]) },
      uOpacity: { value: opacity },
      uElong: { value: elong },
      uSpeed: { value: speed },
    }),
    [tint, opacity, elong, speed]
  );

  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh position={position} scale={scale} userData={{ baseOpacity: opacity }}>
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
