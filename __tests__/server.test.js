const { lineSegmentIntersectsAABB, xor } = require('../server');

describe('xor function', () => {
  test('should return true when first value is true and second is false', () => {
    expect(xor(true, false)).toBe(true);
  });

  test('should return true when first value is false and second is true', () => {
    expect(xor(false, true)).toBe(true);
  });

  test('should return false when both values are true', () => {
    expect(xor(true, true)).toBe(false);
  });

  test('should return false when both values are false', () => {
    expect(xor(false, false)).toBe(false);
  });
});

describe('lineSegmentIntersectsAABB function', () => {
  test('should return true when point is already inside AABB', () => {
    const p1 = { x: 2, y: 2, z: 2 };
    const p2 = { x: 3, y: 3, z: 3 };
    const aabbMin = { x: 1, y: 1, z: 1 };
    const aabbMax = { x: 5, y: 5, z: 5 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });

  test('should return false when segment does not intersect AABB', () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 1, y: 1, z: 1 };
    const aabbMin = { x: 5, y: 5, z: 5 };
    const aabbMax = { x: 10, y: 10, z: 10 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(false);
  });

  test('should return true when segment intersects AABB from outside', () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 3, y: 3, z: 3 };
    const aabbMin = { x: 2, y: 2, z: 2 };
    const aabbMax = { x: 5, y: 5, z: 5 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });

  test('should return false when segment moves away from AABB', () => {
    const p1 = { x: 3, y: 3, z: 3 };
    const p2 = { x: 0, y: 0, z: 0 };
    const aabbMin = { x: 5, y: 5, z: 5 };
    const aabbMax = { x: 10, y: 10, z: 10 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(false);
  });

  test('should handle edge case when point is exactly on AABB boundary 1', () => {
    const p1 = { x: 1, y: 1, z: 1 };
    const p2 = { x: 0, y: 0, z: 0 };
    const aabbMin = { x: 1, y: 1, z: 1 };
    const aabbMax = { x: 5, y: 5, z: 5 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });

  test('should handle edge case when point is exactly on AABB boundary 2', () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 1, y: 1, z: 1 };
    const aabbMin = { x: 1, y: 1, z: 1 };
    const aabbMax = { x: 5, y: 5, z: 5 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });

  test('should handle negative coordinates', () => {
    const p1 = { x: -5, y: -5, z: -5 };
    const p2 = { x: 0, y: 0, z: 0 };
    const aabbMin = { x: -2, y: -2, z: -2 };
    const aabbMax = { x: 2, y: 2, z: 2 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });

  test('should handle mixed positive and negative coordinates', () => {
    const p1 = { x: -3, y: -3, z: -3 };
    const p2 = { x: 3, y: 3, z: 3 };
    const aabbMin = { x: -1, y: -1, z: -1 };
    const aabbMax = { x: 1, y: 1, z: 1 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });

  test('should return false for parallel segments that do not intersect', () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 0, y: 10, z: 0 };
    const aabbMin = { x: 5, y: 0, z: -1 };
    const aabbMax = { x: 10, y: 10, z: 1 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(false);
  });

  test('should return true if intersects in between positions 1', () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 0, y: 10, z: 0 };
    const aabbMin = { x: -1, y: 2, z: -1 };
    const aabbMax = { x: 1, y: 3, z: 1 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });

  test('should return true if intersects in between positions 2', () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 0, y: 10, z: 0 };
    const aabbMin = { x: -5, y: 2, z: -1 };
    const aabbMax = { x: 5, y: 3, z: 1 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });

  test('should return true if intersects in between positions 3', () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 0, y: 10, z: 0 };
    const aabbMin = { x: -5, y: 2, z: -1 };
    const aabbMax = { x: 5, y: 7, z: 1 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });

  test('should return true if intersects in between positions diagonal', () => {
    const p1 = { x: 0, y: 0, z: 0 };
    const p2 = { x: 10, y: 10, z: 10 };
    const aabbMin = { x: 5, y: 5, z: 5 };
    const aabbMax = { x: 6, y: 6, z: 6 };
    
    expect(lineSegmentIntersectsAABB(p1, p2, aabbMin, aabbMax)).toBe(true);
  });
});