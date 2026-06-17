import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { MOUNT_CENTER, MOUNT_SIZE } from "./MountainCloud.jsx";

// Dev tool: renders the solid textured model (toggle PREVIEW in Scene.jsx)
// for locating landmarks like the cottage and tuning camera positions.
export default function ModelPreview() {
  const { scene } = useGLTF("/models/mountain.glb");

  const obj = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = MOUNT_SIZE / Math.max(size.x, size.y, size.z);
    clone.position.sub(center).multiplyScalar(scale).add(MOUNT_CENTER);
    clone.scale.setScalar(scale);
    return clone;
  }, [scene]);

  return (
    <group>
      <ambientLight intensity={1.2} />
      <directionalLight position={[50, 80, 30]} intensity={2} />
      <primitive object={obj} />
    </group>
  );
}

useGLTF.preload("/models/mountain.glb");
