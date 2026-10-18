import { test } from 'node:test';
import assert from 'node:assert/strict';

// The geometry is deterministic, dependency-free, and importable without a DOM.
test('studio model projects finite, bounded faces for every selection', async () => {
  const { buildStudioScene, projectStudioScene } = await import('../../assets/js/studio-3d.js');
  for (const kind of ['core', 'inventory', 'network']) {
    const scene = buildStudioScene(kind);
    assert.ok(scene.length > 5, `${kind} has solid geometry`);
    for (const view of [{ yaw: 0.6, pitch: -0.35 }, { yaw: 2.2, pitch: 0.7 }]) {
      const faces = projectStudioScene(scene, { ...view, width: 600, height: 520 });
      assert.ok(faces.length > 10, `${kind} projects visible faces`);
      for (const face of faces) {
        assert.ok(Number.isFinite(face.depth));
        assert.equal(face.points.length, 4);
        for (const [x, y] of face.points) {
          assert.ok(Number.isFinite(x) && Number.isFinite(y));
          assert.ok(x >= 0 && x <= 600 && y >= 0 && y <= 520, 'geometry stays in its viewport');
        }
      }
    }
  }
});
