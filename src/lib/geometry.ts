import type { BoundingBox } from '../types/index.js';

interface Triangle {
  normal: [number, number, number];
  v1: [number, number, number];
  v2: [number, number, number];
  v3: [number, number, number];
}

interface StlResult {
  volume_cm3: number;
  bounding_box: BoundingBox;
}

/**
 * Parse a binary STL file and extract volume and bounding box.
 *
 * Binary STL format:
 *   80 bytes header
 *   4 bytes uint32 triangle count
 *   For each triangle:
 *     12 bytes normal (3x float32)
 *     12 bytes vertex 1 (3x float32)
 *     12 bytes vertex 2 (3x float32)
 *     12 bytes vertex 3 (3x float32)
 *     2 bytes attribute byte count
 */
export function parseStl(buffer: Buffer): StlResult {
  if (buffer.length < 84) {
    throw new Error('Invalid STL file: too small');
  }

  // Check if this is ASCII STL (starts with "solid")
  const header = buffer.subarray(0, 5).toString('ascii');
  if (header === 'solid') {
    // Could be ASCII STL — check if the triangle count from binary interpretation makes sense
    const binaryTriCount = buffer.readUInt32LE(80);
    const expectedSize = 84 + binaryTriCount * 50;
    if (expectedSize !== buffer.length) {
      throw new Error('ASCII STL files are not supported. Please convert to binary STL.');
    }
  }

  const triangleCount = buffer.readUInt32LE(80);
  const expectedSize = 84 + triangleCount * 50;
  if (buffer.length < expectedSize) {
    throw new Error(`Invalid STL file: expected ${expectedSize} bytes, got ${buffer.length}`);
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let totalVolume = 0;

  for (let i = 0; i < triangleCount; i++) {
    const offset = 84 + i * 50;

    // Skip normal (12 bytes), read 3 vertices
    const v1: [number, number, number] = [
      buffer.readFloatLE(offset + 12),
      buffer.readFloatLE(offset + 16),
      buffer.readFloatLE(offset + 20),
    ];
    const v2: [number, number, number] = [
      buffer.readFloatLE(offset + 24),
      buffer.readFloatLE(offset + 28),
      buffer.readFloatLE(offset + 32),
    ];
    const v3: [number, number, number] = [
      buffer.readFloatLE(offset + 36),
      buffer.readFloatLE(offset + 40),
      buffer.readFloatLE(offset + 44),
    ];

    // Update bounding box
    for (const v of [v1, v2, v3]) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }

    // Signed volume using divergence theorem
    // V = (1/6) * |sum of v1 . (v2 x v3)| for each triangle
    totalVolume += signedVolumeOfTriangle(v1, v2, v3);
  }

  // Volume in mm3, convert to cm3
  const volumeMm3 = Math.abs(totalVolume);
  const volumeCm3 = volumeMm3 / 1000;

  return {
    volume_cm3: Math.round(volumeCm3 * 100) / 100,
    bounding_box: {
      x: Math.round((maxX - minX) * 100) / 100,
      y: Math.round((maxY - minY) * 100) / 100,
      z: Math.round((maxZ - minZ) * 100) / 100,
    },
  };
}

/**
 * Compute the signed volume contribution of a triangle using the divergence theorem.
 * For a closed mesh, the sum of these gives 6x the total volume.
 */
function signedVolumeOfTriangle(
  v1: [number, number, number],
  v2: [number, number, number],
  v3: [number, number, number]
): number {
  const v321 = v3[0] * v2[1] * v1[2];
  const v231 = v2[0] * v3[1] * v1[2];
  const v312 = v3[0] * v1[1] * v2[2];
  const v132 = v1[0] * v3[1] * v2[2];
  const v213 = v2[0] * v1[1] * v3[2];
  const v123 = v1[0] * v2[1] * v3[2];
  return (1.0 / 6.0) * (-v321 + v231 + v312 - v132 - v213 + v123);
}
