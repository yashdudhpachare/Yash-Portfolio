import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";

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
  attribute vec3 aMountain;

  varying float vBright;
  varying float vAlpha;
  varying float vTwinkle;
  varying vec3 vColor;

  void main() {
    // Two-stage morph driven by scroll:
    //   stage 0 -> 1 : dust  -> mountain
    //   stage 1 -> 2 : mountain -> hand
    float stage = clamp(uProgress, 0.0, 2.0);
    vec3 morphed;
    if (stage <= 1.0) {
      morphed = mix(position, aMountain, smoothstep(0.0, 1.0, stage));
    } else {
      morphed = mix(aMountain, aTarget, smoothstep(0.0, 1.0, stage - 1.0));
    }

    // "formed-ness" used to calm vibration & lift brightness once shaped
    float ease = clamp(stage, 0.0, 1.0);

    // Per-grain vibration; strongest as loose dust, calmer once formed
    float ph = aPhase;
    float amp = (0.09 + aScale * 0.05) * (1.0 - ease * 0.7);
    morphed.x += sin(uTime * 3.1 + ph) * amp + sin(uTime * 7.3 + ph * 2.1) * amp * 0.35;
    morphed.y += cos(uTime * 2.7 + ph * 1.3) * amp + cos(uTime * 6.1 + ph * 1.7) * amp * 0.35;
    morphed.z += sin(uTime * 2.3 + ph * 0.7) * amp * 0.6;

    vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);
    float dist = -mvPosition.z;

    vTwinkle = 0.55 + 0.45 * sin(uTime * 1.2 + aPhase);

    float fogFade = smoothstep(uFar, uFar * 0.28, dist);
    float nearFade = smoothstep(3.0, 14.0, dist);
    vAlpha = fogFade * nearFade;

    // Hand grains read a touch brighter so the shape is legible
    vBright = aBright * (1.0 + ease * 0.4);
    vColor = aColor;

    gl_PointSize = uSize * aScale * uPixelRatio * (60.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 0.0, 2.4);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying float vBright;
  varying float vAlpha;
  varying float vTwinkle;
  varying vec3 vColor;

  void main() {
    float d = distance(gl_PointCoord, vec2(0.5));
    float core = 1.0 - smoothstep(0.32, 0.5, d);
    float intensity = core * vBright * vTwinkle;

    vec3 color = vColor * intensity;
    float alpha = core * vAlpha;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

// Build a single position-only geometry from every mesh in the loaded scene
function buildMergedGeometry(scene) {
  const geos = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o.isMesh && o.geometry) {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const ng = new THREE.BufferGeometry();
      ng.setAttribute("position", g.getAttribute("position").clone());
      geos.push(ng);
    }
  });
  if (geos.length === 0) return null;
  return geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
}

export default function Starfield({ count = 200000, progressRef, rotationRef }) {
  const matRef = useRef();
  const groupRef = useRef();
  const { scene } = useGLTF("/models/hand.glb");

  const { positions, scales, brights, phases, colors, targets, mountains } =
    useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const brights = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const targets = new Float32Array(count * 3);
    const mountains = new Float32Array(count * 3);

    // Procedural mountain skyline (layered sines) — particles fill below the ridge
    const ridgeAt = (x) =>
      Math.sin(x * 0.25) * 4.5 +
      Math.sin(x * 0.6 + 1.3) * 2.2 +
      Math.sin(x * 1.3 + 2.1) * 1.1 +
      Math.sin(x * 2.7 + 0.5) * 0.6;

    const palette = [
      [0.85, 0.9, 1.0],
      [0.62, 0.74, 1.0],
      [0.7, 0.82, 0.98],
      [1.0, 0.86, 0.74],
      [0.78, 0.88, 0.95],
    ];

    // --- Dust (home) positions: bottom-heavy full-width curtain ---
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 240;
      const yBias = Math.pow(Math.random(), 3.4);
      positions[i * 3 + 1] = -66 + yBias * 128;
      positions[i * 3 + 2] = -(66 + Math.random() * 22);

      scales[i] = 0.55 + Math.random() * 0.5;
      const floorBoost = 1.0 + (1.0 - yBias) * 0.6;
      brights[i] = (0.22 + Math.pow(Math.random(), 2.6) * 1.2) * floorBoost;
      phases[i] = Math.random() * Math.PI * 2.0;

      const cr = Math.random();
      let p;
      if (cr < 0.82) p = palette[0];
      else if (cr < 0.92) p = palette[1];
      else if (cr < 0.97) p = palette[2];
      else if (cr < 0.99) p = palette[3];
      else p = palette[4];
      const jt = 0.05;
      colors[i * 3 + 0] = Math.min(1, p[0] + (Math.random() - 0.5) * jt);
      colors[i * 3 + 1] = Math.min(1, p[1] + (Math.random() - 0.5) * jt);
      colors[i * 3 + 2] = Math.min(1, p[2] + (Math.random() - 0.5) * jt);

      // --- Mountain target: jagged ridge, particles fill below the skyline ---
      const mx = (Math.random() - 0.5) * 56;
      const top = ridgeAt(mx) + 5.5;
      const bottom = -15;
      const my = bottom + Math.random() * (top - bottom);
      const mz = (Math.random() - 0.5) * 12 - 2;
      mountains[i * 3 + 0] = mx;
      mountains[i * 3 + 1] = my - 1;
      mountains[i * 3 + 2] = mz;
    }

    // --- Hand (target) positions: sampled from the model surface ---
    const merged = buildMergedGeometry(scene);
    if (merged) {
      merged.computeBoundingBox();
      const bb = merged.boundingBox;
      const center = new THREE.Vector3();
      bb.getCenter(center);
      const size = new THREE.Vector3();
      bb.getSize(size);
      const targetHeight = 26;
      const scale = targetHeight / Math.max(size.x, size.y, size.z);

      // Center the hand at the origin so it can spin in place (turntable)
      const offset = new THREE.Vector3(0, 0, 0);
      const sampler = new MeshSurfaceSampler(new THREE.Mesh(merged)).build();
      const tmp = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        sampler.sample(tmp);
        tmp.sub(center).multiplyScalar(scale).add(offset);
        targets[i * 3 + 0] = tmp.x;
        targets[i * 3 + 1] = tmp.y;
        targets[i * 3 + 2] = tmp.z;
      }
    } else {
      targets.set(positions);
    }

    return { positions, scales, brights, phases, colors, targets, mountains };
  }, [count, scene]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: 1.35 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uFar: { value: 155 },
      uProgress: { value: 0 },
    }),
    []
  );

  useFrame((state, delta) => {
    const k = Math.min(1, delta * 3.5);
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      const target = progressRef ? progressRef.current : 0;
      const cur = matRef.current.uniforms.uProgress.value;
      matRef.current.uniforms.uProgress.value += (target - cur) * k;
    }
    if (groupRef.current) {
      // Scroll-driven turntable rotation of the formed hand
      const targetRot = rotationRef ? rotationRef.current : 0;
      groupRef.current.rotation.y += (targetRot - groupRef.current.rotation.y) * k;
    }
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
          <bufferAttribute attach="attributes-aScale" count={count} array={scales} itemSize={1} />
          <bufferAttribute attach="attributes-aBright" count={count} array={brights} itemSize={1} />
          <bufferAttribute attach="attributes-aPhase" count={count} array={phases} itemSize={1} />
          <bufferAttribute attach="attributes-aColor" count={count} array={colors} itemSize={3} />
          <bufferAttribute attach="attributes-aTarget" count={count} array={targets} itemSize={3} />
          <bufferAttribute attach="attributes-aMountain" count={count} array={mountains} itemSize={3} />
        </bufferGeometry>
        <shaderMaterial
          ref={matRef}
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

useGLTF.preload("/models/hand.glb");
