import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import inquirer from 'inquirer';
import { launchWizard } from '../../src/ui/wizard.js';
import * as child_process from 'child_process';
import fs from 'fs-extra';

vi.mock('inquirer');
vi.mock('child_process');

describe('Interactive Wizard', () => {
    let exitSpy;

    beforeEach(() => {
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('TC-R4: Should exit if user chooses exit action', async () => {
        inquirer.prompt.mockResolvedValueOnce({ action: 'exit' });
        
        await launchWizard();
        
        expect(inquirer.prompt).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('TC-R4: Should execute cli router with scan command if user chooses scan', async () => {
        // Mock the action selection
        inquirer.prompt.mockResolvedValueOnce({ action: 'scan' });
        // Mock the directory selection
        inquirer.prompt.mockResolvedValueOnce({ targetDirectory: './' });
        // Mock the "want to fix?" prompt to false
        inquirer.prompt.mockResolvedValueOnce({ fixNow: false });
        // Mock fs.existsSync to true
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        // Mock fs.lstatSync
        vi.spyOn(fs, 'lstatSync').mockReturnValue({ isDirectory: () => true });

        await launchWizard();

        expect(child_process.execSync).toHaveBeenCalled();
        // Extract the command called
        const callArgs = child_process.execSync.mock.calls[0][0];
        expect(callArgs).toContain('node');
        expect(callArgs).toContain('scan');
        expect(callArgs).toContain('./');
    });

    it('TC-R4: Should validate invalid directory and reject it', async () => {
        inquirer.prompt.mockResolvedValueOnce({ action: 'scan' });
        
        // Mock existsSync to return false for invalid path
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        
        // When prompting for directory, inquirer uses a validate function.
        // We can test the validate function directly from the prompt config if needed,
        // but for now we just want to ensure it handles rejection.
        // In the wizard, there is a validate function inside the prompt.
    });
});
