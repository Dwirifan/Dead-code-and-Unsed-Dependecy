import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { findCircularDependencies } from '../../../src/analyzer/graph/projectGraph.js';

describe('Circular Dependency Analysis', () => {
    it('Should deduplicate identical cycles (A -> B -> A and B -> A -> B)', () => {
        const edges = [
            { from: 'a.js', to: 'b.js', isTypeOnly: false },
            { from: 'b.js', to: 'a.js', isTypeOnly: false }
        ];

        const cycles = findCircularDependencies(edges);
        assert.equal(cycles.length, 1, 'Should only report 1 unique cycle between a.js and b.js');
        assert.equal(cycles[0].isTypeOnly, false, 'Cycle is not type-only');
    });

    it('Should flag cycles consisting entirely of type-only imports as isTypeOnly: true', () => {
        const edgesTypeOnly = [
            { from: 'types1.ts', to: 'types2.ts', isTypeOnly: true },
            { from: 'types2.ts', to: 'types3.ts', isTypeOnly: true },
            { from: 'types3.ts', to: 'types1.ts', isTypeOnly: true }
        ];

        const cyclesTypeOnly = findCircularDependencies(edgesTypeOnly);
        assert.equal(cyclesTypeOnly.length, 1);
        assert.equal(cyclesTypeOnly[0].isTypeOnly, true, 'Should mark cycle as type-only');

        const edgesMixed = [
            { from: 'modA.ts', to: 'modB.ts', isTypeOnly: true },
            { from: 'modB.ts', to: 'modA.ts', isTypeOnly: false } // runtime dependency
        ];

        const cyclesMixed = findCircularDependencies(edgesMixed);
        assert.equal(cyclesMixed.length, 1);
        assert.equal(cyclesMixed[0].isTypeOnly, false, 'Mixed cycle is not entirely type-only');
        assert.equal(cyclesMixed[0].isRuntimeCycle, false, 'A type-only edge breaks the cycle at runtime');
    });
});
