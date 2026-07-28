import { describe, it, expect } from 'vitest';
import { generateMermaidGraph } from '../../src/ui/graphVisualizer.js';

describe('Graph Visualizer (HTML Generator)', () => {
    it('TC-R3: Should generate valid HTML containing Cytoscape and Dagre dependencies', () => {
        const mockGraph = {
            liveFiles: new Set(['/src/index.js']),
            usedPackages: new Set(['lodash']),
            edges: []
        };
        const html = generateMermaidGraph(mockGraph, '/src');
        
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('cytoscape.min.js');
        expect(html).toContain('dagre.min.js');
    });

    it('TC-R3: Should accurately inject graph nodes (liveFiles) into the JSON payload', () => {
        const mockGraph = {
            liveFiles: new Set(['/src/index.js', '/src/utils.js']),
            usedPackages: new Set([]),
            edges: []
        };
        const html = generateMermaidGraph(mockGraph, '/src');
        
        // Assert that the file names are embedded in the cytoscape elements configuration
        expect(html).toContain('"label":"index.js"');
        expect(html).toContain('"label":"utils.js"');
    });

    it('TC-R3: Should accurately inject graph edges (imports) into the JSON payload', () => {
        const mockGraph = {
            liveFiles: new Set(['/src/index.js', '/src/utils.js']),
            usedPackages: new Set([]),
            edges: [{ from: '/src/index.js', to: '/src/utils.js' }]
        };
        const html = generateMermaidGraph(mockGraph, '/src');
        
        // cytoscape uses nodes array index, so "source":"0", "target":"1"
        expect(html).toContain('"source":"0"');
        expect(html).toContain('"target":"1"');
    });

    it('TC-R3: Should inject Dead Code report data accurately into the HTML structure', () => {
        const mockGraph = { liveFiles: new Set(['/src/app.js']), usedPackages: new Set(), edges: [] };
        const mockReport = {
            safeNodes: [
                { file: '/src/app.js', type: 'Unused Variable', name: 'unusedVar', status: 'safe', line: 10 }
            ],
            reviewNodes: [],
            riskyNodes: [],
            deadFiles: [],
            unsafeFiles: []
        };
        const html = generateMermaidGraph(mockGraph, '/src', undefined, mockReport);
        
        // Assert that report data is rendered in the UI
        expect(html).toContain('app.js');
        expect(html).toContain('Unused Variable');
        expect(html).toContain('unusedVar');
    });

    it('TC-R3: Should inject unused packages into the HTML sidebar', () => {
        const mockGraph = { liveFiles: new Set(), usedPackages: new Set(['react']), edges: [] };
        const mockPkg = {
            dependencies: { 'react': '^18.0.0', 'lodash': '^4.17.21' }, // lodash is unused
            devDependencies: {}
        };
        
        const mockReport = {
            dependencyReport: {
                unused: ['lodash'],
                deadDevDeps: [],
                uncertain: [],
                uncertainDevDeps: []
            }
        };
        const html = generateMermaidGraph(mockGraph, '/src', mockPkg, mockReport);
        
        // Ensure unused dependency "lodash" is identified and injected
        expect(html).toContain('lodash');
        expect(html).toContain('react');
        expect(html).toContain('Unused Candidates');
    });

    it('Should classify incomplete evidence as UNKNOWN instead of dead', () => {
        const mockGraph = { liveFiles: new Set(), usedPackages: new Set(), edges: [] };
        const mockPkg = {
            dependencies: { axios: '^1.0.0' },
            devDependencies: {}
        };
        const mockReport = {
            dependencyReport: {
                unused: [],
                deadDevDeps: [],
                uncertain: ['axios'],
                uncertainDevDeps: []
            }
        };

        const html = generateMermaidGraph(mockGraph, '/src', mockPkg, mockReport);

        expect(html).toContain('Unknown Status');
        expect(html).toContain('axios');
        expect(html).toContain('Unknown Status</span> (1)');
    });

    it('Should classify peerDependencies and optionalDependencies under UNKNOWN when not in usedPackages', () => {
        const mockGraph = { liveFiles: new Set(), usedPackages: new Set(), edges: [] };
        const mockPkg = {
            dependencies: {},
            peerDependencies: { 'peer-pkg': '^1.0.0' },
            optionalDependencies: { 'opt-pkg': '^2.0.0' }
        };
        const mockReport = {
            dependencyReport: {
                unused: [],
                deadDevDeps: [],
                uncertain: [],
                uncertainDevDeps: []
            }
        };

        const html = generateMermaidGraph(mockGraph, '/src', mockPkg, mockReport);

        expect(html).toContain('Unknown Status');
        expect(html).toContain('peer-pkg');
        expect(html).toContain('opt-pkg');
        expect(html).toContain('Unknown Status</span> (2)');
    });

    it('Should default all unused dependencies to UNKNOWN when dependencyReport is absent', () => {
        const mockGraph = { liveFiles: new Set(), usedPackages: new Set(), edges: [] };
        const mockPkg = {
            dependencies: { 'unverified-pkg': '^1.0.0' },
            devDependencies: {}
        };

        const html = generateMermaidGraph(mockGraph, '/src', mockPkg, null);

        expect(html).toContain('Unknown Status');
        expect(html).toContain('unverified-pkg');
        expect(html).toContain('Unknown Status</span> (1)');
    });
});
