import { describe, expect, it } from 'vitest';
import { generateNova9 } from './graph';
import {
  advanceSimulation,
  createSimulation,
  explainEvent,
  injectFailure,
  type SimulationEvent,
} from './simulation';

function runNode07Cascade() {
  const graph = generateNova9(184729);
  const initial = createSimulation(graph, 184729);
  return advanceSimulation(injectFailure(initial, 'NODE-07'), 36);
}

function canonicalEvents(events: readonly SimulationEvent[]): string {
  return JSON.stringify(events);
}

describe('deterministic NOVA-9 cascade', () => {
  it('NODE-07 failure produces a deterministic cascade', () => {
    const first = runNode07Cascade();
    const second = runNode07Cascade();

    expect(first.events.length).toBeGreaterThan(1);
    expect(canonicalEvents(first.events)).toBe(canonicalEvents(second.events));
    expect(first.nodes).toEqual(second.nodes);
  });

  it('cascade events are chronological and causally explainable', () => {
    const state = runNode07Cascade();
    const graphNodeIds = new Set(state.graph.nodes.map((node) => node.id));
    const connectionIds = new Set(
      state.graph.connections.map((connection) => connection.id),
    );

    expect(state.events.length).toBeGreaterThan(0);
    for (let index = 0; index < state.events.length; index += 1) {
      const event = state.events[index];
      expect(Number.isInteger(event.tick)).toBe(true);
      expect(event.tick).toBeGreaterThanOrEqual(0);
      if (index > 0) {
        expect(event.tick).toBeGreaterThanOrEqual(state.events[index - 1].tick);
      }
      expect(event.time).toBe(event.tick);
      expect(graphNodeIds.has(event.nodeId)).toBe(true);
      if (event.sourceNodeId !== undefined) {
        expect(graphNodeIds.has(event.sourceNodeId)).toBe(true);
      }
      if (event.connectionId !== undefined) {
        expect(connectionIds.has(event.connectionId)).toBe(true);
        const connection = state.graph.connections.find(
          (candidate) => candidate.id === event.connectionId,
        );
        expect(connection).toBeDefined();
        expect([connection?.from, connection?.to]).toContain(event.nodeId);
        if (event.sourceNodeId !== undefined) {
          expect([connection?.from, connection?.to]).toContain(event.sourceNodeId);
        }
      }
      expect(event.previousState).not.toBe(event.nextState);
      expect(explainEvent(event, state.graph).trim().length).toBeGreaterThan(0);
    }
  });

  it('domain tests construct and advance without renderer or browser modules', () => {
    const state = runNode07Cascade();

    expect(state.graph.nodes).toHaveLength(48);
    expect(state.tick).toBe(36);
  });
});
