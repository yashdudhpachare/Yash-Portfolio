import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import { grainFragment, pickColor, smoothstep } from "./grainShader.js";

export const HAND_CENTER = new THREE.Vector3(0, 8, -120);

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
    float amp = (0.06 + aScale * 0.04) * (1.0 - ease * 0.6);
    morphed.x += sin(uTime * 2.6 + ph) * amp;
    morphed.y += cos(uTime * 2.2 + ph * 1.3) * amp;
    morphed.z += sin(uTime * 1.9 + ph * 0.7) * amp * 0.6;

    vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);
    float dist = -mvPosition.z;

    vTwinkle = 0.7 + 0.3 * sin(uTime * 1.3 + aPhase);
    float fogFade = smoothstep(uFar, uFar * 0.18, dist);
    float nearFade = smoothstep(2.0, 10.0, dist);
    vAlpha = fogFade * nearFade;
    vBright = aBright * (1.0 + ease * 0.5);
    vColor = aColor;

    gl_PointSize = uSize * aScale * uPixelRatio * (70.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 0.0, 3.2);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

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

export default function HandCloud({ count = 120000, sRef }) {
  const matRef = useRef();
  const { scene } = useGLTF("/models/hand.glb");

  const { positions, scales, brights, phases, colors, targets } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const brights = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const targets = new Float32Array(count * 3);

    const merged = buildMergedGeometry(scene);
    let center = new THREE.Vector3();
    let scale = 1;
    let sampler = null;
    if (merged) {
      merged.computeBoundingBox();
      const bb = merged.boundingBox;
      bb.getCenter(center);
      const size = new THREE.Vector3();
      bb.getSize(size);
      scale = 34 / Math.max(size.x, size.y, size.z);
      sampler = new MeshSurfaceSampler(new THREE.Mesh(merged)).build();
    }

    const tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      if (sampler) {
        sampler.sample(tmp);
        tmp.sub(center).multiplyScalar(scale).add(HAND_CENTER);
      } else {
        tmp.set(0, 0, 0);
      }
      targets[i * 3 + 0] = tmp.x;
      targets[i * 3 + 1] = tmp.y;
      targets[i * 3 + 2] = tmp.z;

      // Home: scattered below the final spot so the hand RISES into place
      positions[i * 3 + 0] = tmp.x + (Math.random() - 0.5) * 18;
      positions[i * 3 + 1] = tmp.y - 28 - Math.random() * 14;
      positions[i * 3 + 2] = tmp.z + (Math.random() - 0.5) * 18;

      scales[i] = 0.6 + Math.random() * 0.5;
      brights[i] = 0.4 + Math.pow(Math.random(), 2.2) * 1.3;
      phases[i] = Math.random() * Math.PI * 2.0;

      const p = pickColor();
      const jt = 0.05;
      colors[i * 3 + 0] = Math.min(1, p[0] + (Math.random() - 0.5) * jt);
      colors[i * 3 + 1] = Math.min(1, p[1] + (Math.random() - 0.5) * jt);
      colors[i * 3 + 2] = Math.min(1, p[2] + (Math.random() - 0.5) * jt);
    }
    return { positions, scales, brights, phases, colors, targets };
  }, [count, scene]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: 1.45 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uFar: { value: 360 },
      uProgress: { value: 0 },
      uFade: { value: 0 },
    }),
    []
  );

  useFrame((state) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      const s = sRef ? sRef.current : 0;
      const p = smoothstep(0.45, 0.72, s);
      matRef.current.uniforms.uProgress.value = p;
      matRef.current.uniforms.uFade.value = p;
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

useGLTF.preload("/models/hand.glb");
