import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

// Simple, guaranteed-visible render of the snowy mountain GLB. The model is
// centered at the origin and scaled to a known size so the Director camera can
// frame it reliably.
const FIT_SIZE = 140;

export default function ProjectsModel() {
  const { scene } = useGLTF("/models/snowy_mountain.glb");

  const { object, offset, scale } = useMemo(() => {
    const object = scene.clone(true);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const scale = FIT_SIZE / Math.max(size.x, size.y, size.z);
    return { object, offset: center.clone().negate(), scale };
  }, [scene]);

  return (
    <group scale={scale}>
      <group position={[offset.x, offset.y, offset.z]}>
        <primitive object={object} />
      </group>
    </group>
  );
}

useGLTF.preload("/models/snowy_mountain.glb");
