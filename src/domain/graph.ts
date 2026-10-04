export const NODE_TYPES = [
  'power',
  'water',
  'data',
  'transit',
  'medical',
  'emergency',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type Vector3 = readonly [number, number, number];

export interface CityNode {
  readonly id: string;
  readonly type: NodeType;
  readonly position: Vector3;
  readonly capacity: number;
  readonly health: number;
  readonly criticality: number;
  readonly load: number;
}

export interface Connection {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly capacity: number;
  readonly dependency: number;
  readonly latency: number;
  readonly active: boolean;
}

export interface CityGraph {
  readonly seed: number;
  readonly nodes: readonly CityNode[];
  readonly connections: readonly Connection[];
}

export interface GraphValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const NODE_COUNT = 48;
const CONNECTION_COUNT = 84;
const MAX_UINT32 = 0xffff_ffff;

function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_UINT32) {
    throw new RangeError('Seed must be an unsigned 32-bit integer.');
  }
}

function edgeKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

export function generateNova9(seed: number): CityGraph {
  assertSeed(seed);
  const random = createRandom(seed);
  const nodes: CityNode[] = Array.from({ length: NODE_COUNT }, (_, index) => ({
    id: `NODE-${String(index + 1).padStart(2, '0')}`,
    type: NODE_TYPES[index % NODE_TYPES.length],
    position: [
      Number(((random() - 0.5) * 100).toFixed(3)),
      0,
      Number(((random() - 0.5) * 100).toFixed(3)),
    ],
    capacity: 70 + Math.floor(random() * 61),
    health: 100,
    criticality: 1 + Math.floor(random() * 5),
    load: 30 + Math.floor(random() * 41),
  }));

  const edgePairs: Array<readonly [string, string]> = [];
  const existingPairs = new Set<string>();
  const addPair = (from: string, to: string) => {
    const key = edgeKey(from, to);
    if (from !== to && !existingPairs.has(key)) {
      existingPairs.add(key);
      edgePairs.push([from, to]);
    }
  };

  for (let index = 0; index < NODE_COUNT; index += 1) {
    addPair(nodes[index].id, nodes[(index + 1) % NODE_COUNT].id);
  }

  while (edgePairs.length < CONNECTION_COUNT) {
    const from = nodes[Math.floor(random() * NODE_COUNT)].id;
    const to = nodes[Math.floor(random() * NODE_COUNT)].id;
    addPair(from, to);
  }

  const connections: Connection[] = edgePairs.map(([from, to], index) => ({
    id: `EDGE-${String(index + 1).padStart(3, '0')}`,
    from,
    to,
    capacity: 55 + Math.floor(random() * 96),
    dependency: Number((0.2 + random() * 0.7).toFixed(3)),
    latency: 1 + Math.floor(random() * 8),
    active: true,
  }));

  return { seed, nodes, connections };
}

export function validateGraph(graph: CityGraph): GraphValidationResult {
  const errors: string[] = [];
  const nodeById = new Map<string, CityNode>();
  const connectionIds = new Set<string>();
  const pairKeys = new Set<string>();
  const neighbors = new Map<string, Set<string>>();

  if (!Number.isInteger(graph.seed) || graph.seed < 0 || graph.seed > MAX_UINT32) {
    errors.push('Graph seed must be an unsigned 32-bit integer.');
  }

  for (const node of graph.nodes) {
    if (nodeById.has(node.id)) {
      errors.push(`Duplicate node ID: ${node.id}`);
    } else {
      nodeById.set(node.id, node);
    }
    neighbors.set(node.id, new Set());
    if (!NODE_TYPES.includes(node.type)) {
      errors.push(`Invalid node type for ${node.id}: ${node.type}`);
    }
    if (
      node.position.length !== 3 ||
      !node.position.every(Number.isFinite) ||
      !Number.isFinite(node.capacity) ||
      node.capacity <= 0 ||
      !Number.isFinite(node.health) ||
      node.health < 0 ||
      node.health > 100 ||
      !Number.isFinite(node.criticality) ||
      node.criticality < 1 ||
      node.criticality > 5 ||
      !Number.isFinite(node.load) ||
      node.load < 0
    ) {
      errors.push(`Invalid node values for ${node.id}.`);
    }
  }

  for (const connection of graph.connections) {
    if (connectionIds.has(connection.id)) {
      errors.push(`Duplicate connection ID: ${connection.id}`);
    }
    connectionIds.add(connection.id);

    if (!nodeById.has(connection.from) || !nodeById.has(connection.to)) {
      errors.push(`Connection ${connection.id} references a missing node.`);
      continue;
    }
    if (connection.from === connection.to) {
      errors.push(`Connection ${connection.id} is self-referential.`);
    }

    const pair = edgeKey(connection.from, connection.to);
    if (pairKeys.has(pair)) {
      errors.push(`Duplicate connection between ${connection.from} and ${connection.to}.`);
    }
    pairKeys.add(pair);

    neighbors.get(connection.from)?.add(connection.to);
    neighbors.get(connection.to)?.add(connection.from);

    if (
      !Number.isFinite(connection.capacity) ||
      connection.capacity <= 0 ||
      !Number.isFinite(connection.dependency) ||
      connection.dependency < 0 ||
      connection.dependency > 1 ||
      !Number.isFinite(connection.latency) ||
      connection.latency < 0
    ) {
      errors.push(`Invalid connection values for ${connection.id}.`);
    }
  }

  if (graph.nodes.length === 0) {
    errors.push('Graph must contain at least one node.');
  } else {
    const firstNode = graph.nodes[0];
    const visited = new Set<string>([firstNode.id]);
    const pending = [firstNode.id];

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) {
        continue;
      }
      for (const neighbor of neighbors.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }
    if (visited.size !== nodeById.size) {
      errors.push(`Graph is disconnected: reached ${visited.size} of ${nodeById.size} nodes.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidGraph(graph: CityGraph): void {
  const result = validateGraph(graph);
  if (!result.valid) {
    throw new Error(`Invalid NOVA-9 graph:\n${result.errors.join('\n')}`);
  }
}
