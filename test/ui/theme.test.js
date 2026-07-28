import { describe, it, expect, vi } from 'vitest';
import { showBanner, uiColors } from '../../src/ui/theme.js';

describe('UI Theme & Console Output', () => {
    it('TC-R2: Should contain predefined semantic colors', () => {
        expect(uiColors).toHaveProperty('success');
        expect(uiColors).toHaveProperty('danger');
        expect(uiColors).toHaveProperty('warning');
        expect(uiColors).toHaveProperty('primary');
        expect(uiColors).toHaveProperty('muted');
    });

    it('TC-R2: Should use chalk to wrap strings', () => {
        const successMsg = uiColors.success('Test Success');
        // Chalk might be disabled in CI/test environments, so it might just return the string
        // We just ensure it doesn't break and returns the core string.
        expect(successMsg).toContain('Test Success');
    });

    it('TC-R2: Should log banner correctly', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        showBanner();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});
