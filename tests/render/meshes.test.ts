import { describe, expect, it } from "vitest";
import { pushHalfTorus, pushQuad, type MeshData } from "../../src/render/meshes.ts";

const empty = (): MeshData => ({ positions: [], normals: [], uvs: [], indices: [] });

function vertex(m: MeshData, index: number): [number, number, number] {
  return [m.positions[index * 3], m.positions[index * 3 + 1], m.positions[index * 3 + 2]];
}

describe("pushQuad", () => {
  it("emits four corners, their normal and two triangles", () => {
    const m = empty();
    pushQuad(m, [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.5, 0.5, [0, 0, 1], 0, 1, 0, 1);

    expect(m.positions).toHaveLength(12);
    expect(m.normals).toHaveLength(12);
    expect(m.uvs).toHaveLength(8);
    expect(m.indices).toEqual([0, 1, 2, 0, 2, 3]);
    expect(vertex(m, 0)).toEqual([-0.5, -0.5, 0]);
    expect(vertex(m, 1)).toEqual([0.5, -0.5, 0]);
    expect(vertex(m, 2)).toEqual([0.5, 0.5, 0]);
    expect(vertex(m, 3)).toEqual([-0.5, 0.5, 0]);
    expect(m.normals).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(m.uvs).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it("offsets indices when appending to an existing mesh", () => {
    const m = empty();
    pushQuad(m, [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.5, 0.5, [0, 0, 1], 0, 1, 0, 1);
    pushQuad(m, [1, 2, 3], [0, 1, 0], [1, 0, 0], 0.25, 0.5, [0, 0, -1], 0.2, 0.8, 0.1, 0.9);
    expect(m.indices).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    expect(vertex(m, 4)).toEqual([0.5, 1.75, 3]);
    expect(m.normals.slice(12)).toEqual([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]);
  });
});

describe("pushHalfTorus", () => {
  it("sweeps a semicircular tube from pA to pB", () => {
    const m = empty();
    pushHalfTorus(m, [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.1);

    const vertices = m.positions.length / 3;
    expect(vertices).toBe(15 * 9);
    expect(m.normals).toHaveLength(vertices * 3);
    expect(m.uvs).toHaveLength(vertices * 2);
    expect(m.indices).toHaveLength(14 * 8 * 6);

    const centre = [0.5, 0, 0];
    const major = 0.5;
    for (let i = 0; i < vertices; i++) {
      const [x, y, z] = vertex(m, i);
      const dx = x - centre[0];
      const dy = y - centre[1];
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle = dx < 0 ? Math.PI : 0;
      // Nearest point on the half circle, clamped at the two open ends.
      const arc = [centre[0] + major * Math.cos(angle), centre[1] + major * Math.sin(angle), 0];
      const distance = Math.hypot(x - arc[0], y - arc[1], z - arc[2]);
      expect(distance).toBeCloseTo(0.1, 9);

      const nx = m.normals[i * 3];
      const ny = m.normals[i * 3 + 1];
      const nz = m.normals[i * 3 + 2];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 9);
    }

    const maxIndex = Math.max(...m.indices);
    expect(maxIndex).toBeLessThan(vertices);
    expect(Math.min(...m.indices)).toBeGreaterThanOrEqual(0);
  });

  it("offsets indices when appending to an existing mesh", () => {
    const m = empty();
    pushHalfTorus(m, [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.1);
    const firstVertices = m.positions.length / 3;
    const firstIndices = m.indices.length;
    pushHalfTorus(m, [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.1);
    expect(m.indices.slice(firstIndices).every((index) => index >= firstVertices)).toBe(true);
  });

  it("ignores degenerate chords and flat bulges", () => {
    const samePoint = empty();
    pushHalfTorus(samePoint, [1, 2, 3], [1, 2, 3], [0, 1, 0], 0.1);
    expect(samePoint.positions).toEqual([]);
    expect(samePoint.indices).toEqual([]);

    const flat = empty();
    pushHalfTorus(flat, [0, 0, 0], [1, 0, 0], [1, 0, 0], 0.1);
    expect(flat.positions).toEqual([]);
    expect(flat.indices).toEqual([]);
  });
});

describe("winding", () => {
  it("orders every triangle counter-clockwise around its vertex normals", () => {
    const m = empty();
    pushHalfTorus(m, [0, 0, 0], [1, 0, 0], [0, 1, 0], 0.1);
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = vertex(m, m.indices[i]);
      const b = vertex(m, m.indices[i + 1]);
      const c = vertex(m, m.indices[i + 2]);
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0]
      ];
      const avg = [
        m.normals[m.indices[i] * 3] + m.normals[m.indices[i + 1] * 3] + m.normals[m.indices[i + 2] * 3],
        m.normals[m.indices[i] * 3 + 1] + m.normals[m.indices[i + 1] * 3 + 1] + m.normals[m.indices[i + 2] * 3 + 1],
        m.normals[m.indices[i] * 3 + 2] + m.normals[m.indices[i + 1] * 3 + 2] + m.normals[m.indices[i + 2] * 3 + 2]
      ];
      expect(normal[0] * avg[0] + normal[1] * avg[1] + normal[2] * avg[2]).toBeGreaterThan(0);
      expect(Math.hypot(normal[0], normal[1], normal[2])).toBeGreaterThan(1e-12);
    }
  });
});
