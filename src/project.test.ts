import { describe, expect, it } from 'vitest';
import { projectMetadata } from './project';

describe('project identity', () => {
  it('identifies FAULTLINE and labels NOVA-9 as synthetic', () => {
    expect(projectMetadata).toEqual({
      name: 'FAULTLINE — The Holographic Resilience Lab',
      city: 'NOVA-9',
      environment: 'Fictional city · synthetic simulation data',
    });
  });
});
