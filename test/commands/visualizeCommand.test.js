import { describe, expect, it, vi } from 'vitest';
import {
    createBrowserOpenInvocation,
    openReportInBrowser,
} from '../../src/commands/visualizeCommand.js';

describe('visualize browser opener', () => {
    it('menggunakan executable dan array argumen tanpa shell pada setiap platform', () => {
        const dangerousPath = '/tmp/report $(touch injected).html';
        expect(createBrowserOpenInvocation(dangerousPath, 'darwin')).toEqual({
            executable: 'open',
            args: [dangerousPath],
        });
        expect(createBrowserOpenInvocation(dangerousPath, 'linux')).toEqual({
            executable: 'xdg-open',
            args: [dangerousPath],
        });
        expect(createBrowserOpenInvocation(dangerousPath, 'win32')).toEqual({
            executable: 'explorer.exe',
            args: [dangerousPath],
        });
    });

    it('tidak meneruskan path melalui command string atau shell', () => {
        const child = { once: vi.fn(), unref: vi.fn() };
        const spawnImpl = vi.fn(() => child);
        const dangerousPath = 'C:\\report & calc.exe.html';

        openReportInBrowser(dangerousPath, spawnImpl);

        expect(spawnImpl).toHaveBeenCalledWith(
            expect.any(String),
            [dangerousPath],
            expect.objectContaining({ shell: false }),
        );
        expect(child.unref).toHaveBeenCalledOnce();
    });
});
