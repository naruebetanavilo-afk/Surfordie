import type * as THREE from "three";

/**
 * Flag a dynamic (instance) attribute for upload, but only its first `items`
 * elements. Without an update range three re-uploads the WHOLE array
 * (bufferSubData of the full capacity) every time `needsUpdate` is set.
 * Does nothing when `items` is 0 (nothing will be drawn from it).
 */
export function uploadItems(attr: THREE.BufferAttribute, items: number): void {
  if (items <= 0) return;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.min(items, attr.count) * attr.itemSize);
  attr.needsUpdate = true;
}

/** upload the first `count` instance matrices (+ instance colours, if any) of an InstancedMesh */
export function uploadInstances(mesh: THREE.InstancedMesh, count: number = mesh.count): void {
  uploadItems(mesh.instanceMatrix, count);
  if (mesh.instanceColor) uploadItems(mesh.instanceColor, count);
}
