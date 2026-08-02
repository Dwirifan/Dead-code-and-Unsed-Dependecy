import { describe, expect, it } from 'vitest';

import { buildCliInvocation, buildPostScanMenu } from '../../src/ui/wizard.js';

describe('wizard post-scan menu', () => {
    it('meneruskan path sebagai argumen proses tanpa shell interpolation', () => {
        const hostilePath = 'project & echo injected';
        const invocation = buildCliInvocation(['scan', hostilePath, '--advanced']);

        expect(invocation.executable).toBe(process.execPath);
        expect(invocation.options.shell).toBe(false);
        expect(invocation.args.slice(1)).toEqual(['scan', hostilePath, '--advanced']);
    });

    it('tidak menawarkan advanced atau fix ketika proyek bersih', () => {
        const menu = buildPostScanMenu({
            codeFindings: 0,
            dependencyFindings: 0,
            safeFixCount: 0,
            review: 0,
            risky: 0,
            other: 0,
        }, false);

        expect(menu).toEqual({ clean: true, choices: [] });
    });

    it('menawarkan advanced tanpa fix ketika hanya ada review tersembunyi', () => {
        const menu = buildPostScanMenu({
            // Mode basic dapat menyembunyikan review sehingga codeFindings yang
            // ditampilkan bernilai 0. Counter kategori internal tetap authoritative.
            codeFindings: 0,
            dependencyFindings: 0,
            safeFixCount: 0,
            review: 1,
            risky: 0,
            other: 0,
        }, false);

        expect(menu.clean).toBe(false);
        expect(menu.choices.map(choice => choice.value)).toEqual(['advanced', 'exit']);
    });

    it('menawarkan fix ketika ada temuan safe', () => {
        const menu = buildPostScanMenu({
            codeFindings: 1,
            dependencyFindings: 0,
            safeFixCount: 1,
            review: 0,
            risky: 0,
            other: 0,
        }, false);

        expect(menu.choices.map(choice => choice.value)).toEqual(['fix', 'exit']);
    });
});
