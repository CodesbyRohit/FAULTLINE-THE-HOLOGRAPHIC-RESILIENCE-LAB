import { describe, expect, it } from 'vitest';
import { generateNova9 } from './graph';
import {
  advanceSimulation,
  applyIntervention,
  branchCounterfactual,
  createSimulation,
  createNova9Simulation,
  getNodeState,
  injectFailure,
  replaySimulation,
  rewindSimulation,
  serializeHistory,
  snapshotSimulation,
  type SerializedHistory,
  type SimulationState,
} from './simulation';

const SEED = 184729;

function runInterventionScenario(): SimulationState {
  let state = createNova9Simulation(SEED);
  state = injectFailure(state, 'NODE-07');
  state = advanceSimulation(state, 12);
  state = applyIntervention(state, {
    kind: 'reduce-load',
    nodeId: 'NODE-02',
    amount: 10,
  });
  return advanceSimulation(state, 12);
}

function canonicalSnapshot(state: SimulationState): string {
  return JSON.stringify(snapshotSimulation(state));
}

describe('interventions and deterministic replay', () => {
  it('tick 12 intervention replays deterministically', () => {
    const first = runInterventionScenario();
    const second = runInterventionScenario();

    expect(first.tick).toBe(24);
    expect(first.history.actions).toHaveLength(2);
    expect(first.history.actions[1].tick).toBe(12);
    expect(canonicalSnapshot(first)).toBe(canonicalSnapshot(second));
  });

  it('counterfactual branching does not mutate original history', () => {
    const original = runInterventionScenario();
    const originalBeforeBranch = canonicalSnapshot(original);
    const branch = branchCounterfactual(original, 12);
    const changedBranch = advanceSimulation(
      applyIntervention(branch, { kind: 'isolate', nodeId: 'NODE-08' }),
      12,
    );

    expect(changedBranch).not.toBe(original);
    expect(changedBranch.nodes).not.toBe(original.nodes);
    expect(changedBranch.events).not.toBe(original.events);
    expect(getNodeState(changedBranch, 'NODE-08').isolated).toBe(true);
    expect(canonicalSnapshot(changedBranch)).not.toBe(originalBeforeBranch);
    expect(canonicalSnapshot(original)).toBe(originalBeforeBranch);
  });

  it('replaying recorded history reproduces final state', () => {
    const recordedRun = (() => {
      const state = runInterventionScenario();
      return {
        canonicalOriginal: canonicalSnapshot(state),
        serializedHistory: JSON.stringify(serializeHistory(state)),
      };
    })();
    const history = JSON.parse(recordedRun.serializedHistory) as SerializedHistory;
    const reconstructed = replaySimulation(SEED, history);

    expect(canonicalSnapshot(reconstructed)).toBe(recordedRun.canonicalOriginal);
  });

  it('rewinding reconstructs the timeline at the requested tick', () => {
    const original = runInterventionScenario();
    const rewound = rewindSimulation(original, 12);
    const branch = branchCounterfactual(original, 12);

    expect(rewound.tick).toBe(12);
    expect(rewound.history.actions.at(-1)?.tick).toBe(12);
    expect(branch.tick).toBe(12);
    expect(branch.history.actions.every((action) => action.tick < 12)).toBe(true);
    expect(original.tick).toBe(24);
  });

  it('isolation, restoration, route blocking, and rerouting are recorded', () => {
    const graph = generateNova9(SEED);
    let state = createSimulation(graph, SEED);
    state = applyIntervention(state, { kind: 'isolate', nodeId: 'NODE-08' });
    expect(getNodeState(state, 'NODE-08')).toMatchObject({
      isolated: true,
      state: 'failed',
    });
    state = applyIntervention(state, { kind: 'restore', nodeId: 'NODE-08' });
    expect(getNodeState(state, 'NODE-08')).toMatchObject({
      isolated: false,
      state: 'healthy',
      health: 100,
    });
    state = injectFailure(state, 'NODE-07', 'route-blockage');
    const routeBlock = state.history.actions.at(-1);
    expect(routeBlock?.type).toBe('failure');
    if (!routeBlock || routeBlock.type !== 'failure' || !routeBlock.connectionId) {
      throw new Error('Route blockage did not record its selected connection.');
    }
    expect(state.connections.find((connection) => connection.id === routeBlock.connectionId)?.active)
      .toBe(false);
    state = applyIntervention(state, {
      kind: 'reroute',
      connectionId: routeBlock.connectionId,
    });
    expect(state.connections.find((connection) => connection.id === routeBlock.connectionId)?.active)
      .toBe(true);
  });
});
