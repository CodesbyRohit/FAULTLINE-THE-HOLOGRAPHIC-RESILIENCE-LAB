import {
  assertValidGraph,
  generateNova9,
  type CityGraph,
  type CityNode,
  type Connection,
} from './graph';

export const NODE_STATES = ['healthy', 'degraded', 'critical', 'failed'] as const;
export type NodeState = (typeof NODE_STATES)[number];
export type FailureType =
  | 'power-loss'
  | 'capacity-overload'
  | 'route-blockage'
  | 'node-isolation';

export interface RuntimeNode extends CityNode {
  readonly state: NodeState;
  readonly isolated: boolean;
}

export interface RuntimeConnection extends Connection {
  readonly active: boolean;
}

export interface FailureAction {
  readonly sequence: number;
  readonly tick: number;
  readonly type: 'failure';
  readonly failureType: FailureType;
  readonly nodeId: string;
  readonly connectionId?: string;
}

export interface InterventionAction {
  readonly sequence: number;
  readonly tick: number;
  readonly type: 'intervention';
  readonly intervention: Intervention;
}

export type SimulationAction = FailureAction | InterventionAction;

export interface SimulationHistory {
  readonly actions: readonly SimulationAction[];
  readonly endTick: number;
}

export type Intervention =
  | { readonly kind: 'isolate'; readonly nodeId: string }
  | { readonly kind: 'restore'; readonly nodeId: string }
  | { readonly kind: 'reduce-load'; readonly nodeId: string; readonly amount: number }
  | { readonly kind: 'reroute'; readonly connectionId: string };

export interface SimulationEvent {
  readonly id: string;
  readonly tick: number;
  readonly time: number;
  readonly nodeId: string;
  readonly sourceNodeId?: string;
  readonly connectionId?: string;
  readonly previousState: NodeState;
  readonly nextState: NodeState;
  readonly cause: string;
}

export interface SimulationState {
  readonly seed: number;
  readonly graph: CityGraph;
  readonly tick: number;
  readonly nodes: readonly RuntimeNode[];
  readonly connections: readonly RuntimeConnection[];
  readonly events: readonly SimulationEvent[];
  readonly history: SimulationHistory;
}

export interface SerializedHistory {
  readonly actions: readonly SimulationAction[];
  readonly endTick: number;
}

const STATE_RANK: Record<NodeState, number> = {
  healthy: 0,
  degraded: 1,
  critical: 2,
  failed: 3,
};

const STATE_PRESSURE: Record<NodeState, number> = {
  healthy: 0,
  degraded: 0.25,
  critical: 0.6,
  failed: 1,
};

function cloneGraph(graph: CityGraph): CityGraph {
  return {
    seed: graph.seed,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: [...node.position] as [number, number, number],
    })),
    connections: graph.connections.map((connection) => ({ ...connection })),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nextStateForHealth(health: number): NodeState {
  if (health <= 0) return 'failed';
  if (health <= 35) return 'critical';
  if (health <= 65) return 'degraded';
  return 'healthy';
}

function appendEvent(
  state: SimulationState,
  nodeId: string,
  nextState: NodeState,
  cause: string,
  connectionId?: string,
  sourceNodeId?: string,
): readonly SimulationEvent[] {
  const node = state.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Cannot record event for unknown node ${nodeId}.`);
  }
  if (node.state === nextState) {
    return state.events;
  }

  const event: SimulationEvent = {
    id: `EVENT-${String(state.events.length + 1).padStart(4, '0')}`,
    tick: state.tick,
    time: state.tick,
    nodeId,
    ...(sourceNodeId === undefined ? {} : { sourceNodeId }),
    ...(connectionId === undefined ? {} : { connectionId }),
    previousState: node.state,
    nextState,
    cause,
  };
  return [...state.events, event];
}

function validateFailureTarget(state: SimulationState, nodeId: string): RuntimeNode {
  const node = state.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Cannot inject a failure into unknown node ${nodeId}.`);
  }
  return node;
}

function recordAction(
  state: SimulationState,
  action: Omit<FailureAction, 'sequence'> | Omit<InterventionAction, 'sequence'>,
): SimulationHistory {
  const sequence = state.history.actions.length;
  const sequencedAction: SimulationAction = action.type === 'failure'
    ? { ...action, sequence }
    : {
        ...action,
        sequence,
        intervention: { ...action.intervention },
      };
  return {
    actions: [...state.history.actions, sequencedAction],
    endTick: Math.max(state.history.endTick, state.tick),
  };
}

export function createSimulation(graph: CityGraph, seed: number): SimulationState {
  assertValidGraph(graph);
  if (graph.seed !== seed) {
    throw new Error(`Simulation seed ${seed} does not match graph seed ${graph.seed}.`);
  }
  const ownedGraph = cloneGraph(graph);

  return {
    seed,
    graph: ownedGraph,
    tick: 0,
    nodes: ownedGraph.nodes.map((node) => ({
      ...node,
      state: 'healthy',
      isolated: false,
    })),
    connections: ownedGraph.connections.map((connection) => ({
      ...connection,
      active: connection.active,
    })),
    events: [],
    history: { actions: [], endTick: 0 },
  };
}

export function injectFailure(
  state: SimulationState,
  nodeId: string,
  failureType: FailureType = 'power-loss',
): SimulationState {
  const node = validateFailureTarget(state, nodeId);
  if (state.history.actions.some(
    (action) => action.type === 'failure' && action.nodeId === nodeId,
  )) {
    throw new Error(`A failure has already been injected into ${nodeId}.`);
  }

  let nextHealth = node.health;
  let nextLoad = node.load;
  let nextIsolated = node.isolated;
  let nextNodeState = node.state;
  let connectionId: string | undefined;
  let connections = state.connections;
  let cause: string;

  switch (failureType) {
    case 'power-loss':
      nextHealth = 0;
      nextNodeState = 'failed';
      cause = `Synthetic power loss was injected at ${nodeId}.`;
      break;
    case 'capacity-overload':
      nextLoad = node.capacity * 1.5;
      nextHealth = Math.min(node.health, 65);
      nextNodeState = nextStateForHealth(nextHealth);
      cause = `Synthetic capacity overload raised the load at ${nodeId}.`;
      break;
    case 'route-blockage': {
      const blockedConnection = state.connections
        .filter((connection) =>
          connection.active && (connection.from === nodeId || connection.to === nodeId),
        )
        .sort((left, right) => compareText(left.id, right.id))[0];
      if (!blockedConnection) {
        throw new Error(`No active route is available to block at ${nodeId}.`);
      }
      connectionId = blockedConnection.id;
      connections = state.connections.map((connection) =>
        connection.id === connectionId ? { ...connection, active: false } : connection,
      );
      nextHealth = Math.min(node.health, 65);
      nextNodeState = nextStateForHealth(nextHealth);
      cause = `Synthetic route blockage disabled ${connectionId} at ${nodeId}.`;
      break;
    }
    case 'node-isolation':
      nextHealth = 0;
      nextNodeState = 'failed';
      nextIsolated = true;
      cause = `Synthetic node isolation removed ${nodeId} from service.`;
      break;
  }

  const updatedNode: RuntimeNode = {
    ...node,
    health: nextHealth,
    load: nextLoad,
    isolated: nextIsolated,
    state: nextNodeState,
  };
  const events = appendEvent(
    state,
    nodeId,
    nextNodeState,
    cause,
    connectionId,
  );
  const history = recordAction(state, {
    type: 'failure',
    tick: state.tick,
    failureType,
    nodeId,
    ...(connectionId === undefined ? {} : { connectionId }),
  });

  return {
    ...state,
    nodes: state.nodes.map((candidate) =>
      candidate.id === nodeId ? updatedNode : candidate,
    ),
    connections,
    events,
    history,
  };
}

interface PressureSource {
  readonly nodeId: string;
  readonly connectionId: string;
  readonly score: number;
}

function pressureFor(
  node: RuntimeNode,
  nodesById: ReadonlyMap<string, RuntimeNode>,
  connections: readonly RuntimeConnection[],
): { pressure: number; source?: PressureSource } {
  let totalDependency = 0;
  let totalPressure = 0;
  const sources: PressureSource[] = [];

  for (const connection of connections) {
    if (
      !connection.active ||
      (connection.from !== node.id && connection.to !== node.id)
    ) {
      continue;
    }
    const otherId = connection.from === node.id ? connection.to : connection.from;
    const other = nodesById.get(otherId);
    if (!other || other.isolated) {
      continue;
    }
    totalDependency += connection.dependency;
    const pressure = STATE_PRESSURE[other.state] * connection.dependency;
    totalPressure += pressure;
    if (pressure > 0) {
      sources.push({
        nodeId: other.id,
        connectionId: connection.id,
        score: pressure,
      });
    }
  }

  sources.sort((left, right) =>
    right.score - left.score ||
    compareText(left.nodeId, right.nodeId) ||
    compareText(left.connectionId, right.connectionId),
  );
  return {
    pressure: totalDependency === 0 ? 0 : totalPressure / totalDependency,
    ...(sources[0] === undefined ? {} : { source: sources[0] }),
  };
}

function advanceOneTick(state: SimulationState): SimulationState {
  const tick = state.tick + 1;
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
  const pendingChanges: Array<{
    node: RuntimeNode;
    health: number;
    nextState: NodeState;
    cause: string;
    connectionId: string;
    sourceNodeId: string;
  }> = [];

  for (const node of state.nodes) {
    if (node.state === 'failed' || node.isolated) {
      continue;
    }
    const { pressure, source } = pressureFor(node, nodesById, state.connections);
    if (pressure <= 0 || !source) {
      continue;
    }

    const utilization = node.load / node.capacity;
    const damage = Math.max(1, Math.ceil(pressure * 12 * (0.5 + utilization)));
    const health = Math.max(0, node.health - damage);
    const nextState = nextStateForHealth(health);
    if (STATE_RANK[nextState] > STATE_RANK[node.state]) {
      pendingChanges.push({
        node,
        health,
        nextState,
        cause: `Dependency pressure from ${source.nodeId} through ${source.connectionId} reduced available reserve.`,
        connectionId: source.connectionId,
        sourceNodeId: source.nodeId,
      });
    } else if (health !== node.health) {
      pendingChanges.push({
        node,
        health,
        nextState: node.state,
        cause: '',
        connectionId: source.connectionId,
        sourceNodeId: source.nodeId,
      });
    }
  }

  let nextState: SimulationState = {
    ...state,
    tick,
    nodes: state.nodes.map((node) => {
      const change = pendingChanges.find((candidate) => candidate.node.id === node.id);
      return change ? { ...node, health: change.health, state: change.nextState } : node;
    }),
    history: {
      actions: state.history.actions,
      endTick: Math.max(state.history.endTick, tick),
    },
  };

  for (const change of pendingChanges) {
    if (change.nextState !== change.node.state) {
      nextState = {
        ...nextState,
        events: appendEvent(
          { ...nextState, nodes: state.nodes },
          change.node.id,
          change.nextState,
          change.cause,
          change.connectionId,
          change.sourceNodeId,
        ),
      };
    }
  }
  return nextState;
}

export function advanceSimulation(
  state: SimulationState,
  ticks = 1,
): SimulationState {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError('Advance duration must be a non-negative integer.');
  }
  let nextState = state;
  for (let index = 0; index < ticks; index += 1) {
    nextState = advanceOneTick(nextState);
  }
  return nextState;
}

export function explainEvent(event: SimulationEvent, graph: CityGraph): string {
  if (!graph.nodes.some((node) => node.id === event.nodeId)) {
    throw new Error(`Event ${event.id} references unknown node ${event.nodeId}.`);
  }
  if (
    event.sourceNodeId !== undefined &&
    !graph.nodes.some((node) => node.id === event.sourceNodeId)
  ) {
    throw new Error(`Event ${event.id} references unknown source node ${event.sourceNodeId}.`);
  }
  if (
    event.connectionId !== undefined &&
    !graph.connections.some((connection) => connection.id === event.connectionId)
  ) {
    throw new Error(
      `Event ${event.id} references unknown connection ${event.connectionId}.`,
    );
  }
  if (
    event.connectionId !== undefined &&
    !graph.connections.some(
      (connection) =>
        connection.id === event.connectionId &&
        (connection.from === event.nodeId || connection.to === event.nodeId),
    )
  ) {
    throw new Error(
      `Event ${event.id} references a connection unrelated to ${event.nodeId}.`,
    );
  }
  if (event.cause.trim().length === 0) {
    throw new Error(`Event ${event.id} has no deterministic cause.`);
  }
  return event.cause;
}

export function createNova9Simulation(seed: number): SimulationState {
  return createSimulation(generateNova9(seed), seed);
}

export function getNodeState(
  state: SimulationState,
  nodeId: string,
): RuntimeNode {
  const node = state.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Unknown node ${nodeId}.`);
  }
  return node;
}

function assertIntervention(intervention: Intervention): void {
  if (!intervention || typeof intervention !== 'object') {
    throw new TypeError('Intervention must be an object.');
  }
  switch (intervention.kind) {
    case 'isolate':
    case 'restore':
      if (typeof intervention.nodeId !== 'string') {
        throw new TypeError(`${intervention.kind} requires a node ID.`);
      }
      return;
    case 'reduce-load':
      if (
        typeof intervention.nodeId !== 'string' ||
        !Number.isFinite(intervention.amount) ||
        intervention.amount <= 0
      ) {
        throw new TypeError('reduce-load requires a node ID and a positive amount.');
      }
      return;
    case 'reroute':
      if (typeof intervention.connectionId !== 'string') {
        throw new TypeError('reroute requires a connection ID.');
      }
      return;
    default:
      throw new TypeError('Unknown intervention kind.');
  }
}

export function applyIntervention(
  state: SimulationState,
  intervention: Intervention,
): SimulationState {
  assertIntervention(intervention);
  let nodes = state.nodes;
  let connections = state.connections;
  let events = state.events;

  switch (intervention.kind) {
    case 'isolate': {
      const node = validateFailureTarget(state, intervention.nodeId);
      if (node.isolated) {
        throw new Error(`${node.id} is already isolated.`);
      }
      const cause = `Operator intervention isolated ${node.id} from the synthetic network.`;
      events = appendEvent(state, node.id, 'failed', cause);
      nodes = state.nodes.map((candidate) =>
        candidate.id === node.id
          ? { ...candidate, health: 0, isolated: true, state: 'failed' }
          : candidate,
      );
      break;
    }
    case 'restore': {
      const node = validateFailureTarget(state, intervention.nodeId);
      if (node.state !== 'failed' && !node.isolated) {
        throw new Error(`${node.id} is not in a restorable state.`);
      }
      const baseNode = state.graph.nodes.find((candidate) => candidate.id === node.id);
      if (!baseNode) {
        throw new Error(`Cannot restore unknown graph node ${node.id}.`);
      }
      const cause = `Operator intervention restored ${node.id} to its synthetic baseline load.`;
      events = appendEvent(state, node.id, 'healthy', cause);
      nodes = state.nodes.map((candidate) =>
        candidate.id === node.id
          ? {
              ...candidate,
              health: 100,
              isolated: false,
              load: baseNode.load,
              state: 'healthy',
            }
          : candidate,
      );
      break;
    }
    case 'reduce-load': {
      const node = validateFailureTarget(state, intervention.nodeId);
      nodes = state.nodes.map((candidate) =>
        candidate.id === node.id
          ? { ...candidate, load: Math.max(0, candidate.load - intervention.amount) }
          : candidate,
      );
      break;
    }
    case 'reroute': {
      const connection = state.connections.find(
        (candidate) => candidate.id === intervention.connectionId,
      );
      if (!connection) {
        throw new Error(`Cannot reroute unknown connection ${intervention.connectionId}.`);
      }
      if (connection.active) {
        throw new Error(`Connection ${connection.id} is already active.`);
      }
      connections = state.connections.map((candidate) =>
        candidate.id === connection.id ? { ...candidate, active: true } : candidate,
      );
      break;
    }
  }

  return {
    ...state,
    nodes,
    connections,
    events,
    history: recordAction(state, {
      type: 'intervention',
      tick: state.tick,
      intervention,
    }),
  };
}

function copyAction(action: SimulationAction): SimulationAction {
  return action.type === 'failure'
    ? { ...action }
    : { ...action, intervention: { ...action.intervention } };
}

export function serializeHistory(state: SimulationState): SerializedHistory {
  return {
    actions: state.history.actions.map(copyAction),
    endTick: state.tick,
  };
}

export function snapshotSimulation(state: SimulationState): SimulationState {
  const graph = cloneGraph(state.graph);
  return {
    seed: state.seed,
    graph,
    tick: state.tick,
    nodes: state.nodes.map((node) => ({
      ...node,
      position: [node.position[0], node.position[1], node.position[2]],
    })),
    connections: state.connections.map((connection) => ({ ...connection })),
    events: state.events.map((event) => ({ ...event })),
    history: {
      actions: state.history.actions.map(copyAction),
      endTick: state.history.endTick,
    },
  };
}

function validateSerializedHistory(history: SerializedHistory): void {
  if (
    !history ||
    !Array.isArray(history.actions) ||
    !Number.isInteger(history.endTick) ||
    history.endTick < 0
  ) {
    throw new TypeError('Serialized history has an invalid shape.');
  }
  let lastTick = -1;
  for (let index = 0; index < history.actions.length; index += 1) {
    const action = history.actions[index];
    if (
      !action ||
      action.sequence !== index ||
      !Number.isInteger(action.tick) ||
      action.tick < lastTick ||
      action.tick > history.endTick
    ) {
      throw new TypeError(`Serialized history action ${index} is invalid or unordered.`);
    }
    lastTick = action.tick;

    if (action.type === 'failure') {
      if (
        typeof action.nodeId !== 'string' ||
        !['power-loss', 'capacity-overload', 'route-blockage', 'node-isolation'].includes(
          action.failureType,
        )
      ) {
        throw new TypeError(`Serialized failure action ${index} is invalid.`);
      }
    } else if (action.type === 'intervention') {
      assertIntervention(action.intervention);
    } else {
      throw new TypeError(`Serialized history action ${index} has an unknown type.`);
    }
  }
}

export function replaySimulation(
  seed: number,
  serializedHistory: SerializedHistory,
): SimulationState {
  validateSerializedHistory(serializedHistory);
  let state = createNova9Simulation(seed);

  for (const action of serializedHistory.actions) {
    if (action.tick < state.tick) {
      throw new Error(`History action ${action.sequence} predates the replay cursor.`);
    }
    state = advanceSimulation(state, action.tick - state.tick);
    if (action.type === 'failure') {
      const before = state.history.actions.length;
      state = injectFailure(state, action.nodeId, action.failureType);
      const replayedAction = state.history.actions[before];
      if (
        !replayedAction ||
        replayedAction.type !== 'failure' ||
        replayedAction.connectionId !== action.connectionId
      ) {
        throw new Error(`Failure action ${action.sequence} could not be reproduced.`);
      }
    } else {
      state = applyIntervention(state, action.intervention);
    }
  }

  return advanceSimulation(state, serializedHistory.endTick - state.tick);
}

export function rewindSimulation(
  state: SimulationState,
  tick: number,
): SimulationState {
  if (!Number.isInteger(tick) || tick < 0 || tick > state.tick) {
    throw new RangeError(`Cannot rewind to tick ${tick} from tick ${state.tick}.`);
  }
  return replaySimulation(state.seed, {
    actions: state.history.actions
      .filter((action) => action.tick <= tick)
      .map(copyAction),
    endTick: tick,
  });
}

export function branchCounterfactual(
  state: SimulationState,
  tick: number,
): SimulationState {
  if (!Number.isInteger(tick) || tick < 0 || tick > state.tick) {
    throw new RangeError(`Cannot branch at tick ${tick} from tick ${state.tick}.`);
  }
  return replaySimulation(state.seed, {
    actions: state.history.actions
      .filter((action) => action.tick < tick)
      .map(copyAction),
    endTick: tick,
  });
}
