import { describe, it, expect, vi } from 'vitest';
import { buildGraphWithInteractiveFallback } from '../../src/commands/commandHelpers.js';
import * as projectGraph from '../../src/analyzer/graph/projectGraph.js';
import inquirer from 'inquirer';

vi.mock('inquirer');
vi.mock('../../src/analyzer/graph/projectGraph.js');

describe('CLI Commands & Router', () => {
    it('TC-R1: Should build graph directly if no error occurs', async () => {
        vi.spyOn(projectGraph, 'buildProjectGraph').mockResolvedValue({ edges: [] });
        
        const mockRuleEngine = {};
        const graph = await buildGraphWithInteractiveFallback('/src', mockRuleEngine, null);
        
        expect(projectGraph.buildProjectGraph).toHaveBeenCalled();
        expect(graph).toBeDefined();
    });

    it('TC-R1: Should prompt for entry point if auto-detect fails', async () => {
        // Mock it to throw the auto-detect error first, then succeed the second time
        vi.spyOn(projectGraph, 'buildProjectGraph')
            .mockRejectedValueOnce(new Error('Could not auto-detect entry point'))
            .mockResolvedValueOnce({ edges: [] });
        
        inquirer.prompt.mockResolvedValueOnce({ entryPointsInput: 'src/index.js' });
        
        const mockRuleEngine = { rules: {}, saveConfig: vi.fn() };
        const spinner = { stop: vi.fn(), start: vi.fn() };
        
        const graph = await buildGraphWithInteractiveFallback('/src', mockRuleEngine, spinner);
        
        expect(inquirer.prompt).toHaveBeenCalled();
        expect(mockRuleEngine.saveConfig).toHaveBeenCalled();
        expect(spinner.stop).toHaveBeenCalled();
        expect(spinner.start).toHaveBeenCalled();
        expect(graph).toBeDefined();
    });
});
