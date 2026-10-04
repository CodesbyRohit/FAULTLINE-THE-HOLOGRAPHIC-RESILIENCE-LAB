import { describe, expect, it } from 'vitest';
import { generateNova9, validateGraph } from './graph';

describe('NOVA-9 graph', () => {
  it('nova9 generation is deterministic for seed 184729', () => {
    const first = generateNova9(184729);
    const second = generateNova9(184729);

    expect(first).toEqual(second);
    expect(first.nodes.map(({ id, type, position, capacity }) => ({
      id,
      type,
      position,
      capacity,
    }))).toEqual(second.nodes.map(({ id, type, position, capacity }) => ({
      id,
      type,
      position,
      capacity,
    })));
    expect(first.connections).toEqual(second.connections);
  });

  it('nova9 graph contains only valid, unique, non-self connections', () => {
    const graph = generateNova9(184729);
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const connectionIds = graph.connections.map((connection) => connection.id);

    expect(nodeIds.size).toBe(graph.nodes.length);
    expect(new Set(connectionIds).size).toBe(connectionIds.length);
    expect(graph.connections.length).toBeGreaterThanOrEqual(60);
    expect(graph.connections.length).toBeLessThanOrEqual(100);
    for (const connection of graph.connections) {
      expect(nodeIds.has(connection.from)).toBe(true);
      expect(nodeIds.has(connection.to)).toBe(true);
      expect(connection.from).not.toBe(connection.to);
    }
    expect(validateGraph(graph)).toEqual({ valid: true, errors: [] });
  });

  it('nova9 graph satisfies the connectivity invariant', () => {
    const graph = generateNova9(184729);
    const neighbors = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
    for (const connection of graph.connections) {
      neighbors.get(connection.from)?.add(connection.to);
      neighbors.get(connection.to)?.add(connection.from);
    }
    const visited = new Set<string>();
    const pending = [graph.nodes[0].id];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const neighbor of neighbors.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          pending.push(neighbor);
        }
      }
    }

    expect(visited.size).toBe(graph.nodes.length);
    expect(validateGraph({ ...graph, connections: [] }).errors).toContain(
      `Graph is disconnected: reached 1 of ${graph.nodes.length} nodes.`,
    );
    expect(graph.nodes).toHaveLength(48);
    expect(graph.nodes.map((node) => node.id)).toContain('NODE-07');
  });
});
