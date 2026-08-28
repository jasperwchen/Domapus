// RBush spatial index for efficient ZIP code lookups
import RBush from 'rbush';
import { ZipData } from '@/components/dashboard/map/types';

interface ZipBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  zipCode: string;
}

// Singleton spatial index instance
let spatialIndex: RBush<ZipBBox> | null = null;

/**
 * Build or update the spatial index from ZIP data with coordinates
 */
export function buildSpatialIndex(zipData: Record<string, ZipData>): RBush<ZipBBox> {
  const items: ZipBBox[] = [];
  
  for (const [zipCode, data] of Object.entries(zipData)) {
    if (data.latitude && data.longitude) {
      // Create a small bounding box around the centroid (point + small buffer)
      const buffer = 0.01; // ~1km buffer
      items.push({
        minX: data.longitude - buffer,
        minY: data.latitude - buffer,
        maxX: data.longitude + buffer,
        maxY: data.latitude + buffer,
        zipCode,
      });
    }
  }
  
  // Create new index or clear existing
  if (!spatialIndex) {
    spatialIndex = new RBush<ZipBBox>();
  } else {
    spatialIndex.clear();
  }
  
  spatialIndex.load(items);
  return spatialIndex;
}

/**
 * Query ZIP codes within a bounding box
 */
export function queryZipsInBounds(
  bounds: { west: number; south: number; east: number; north: number }
): string[] {
  if (!spatialIndex) {
    console.warn('[SpatialIndex] Index not built yet');
    return [];
  }
  
  const results = spatialIndex.search({
    minX: bounds.west,
    minY: bounds.south,
    maxX: bounds.east,
    maxY: bounds.north,
  });
  
  return results.map(r => r.zipCode);
}
