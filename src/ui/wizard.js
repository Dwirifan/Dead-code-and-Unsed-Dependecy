import inquirer from 'inquirer';
import fs from 'fs-extra';
import fg from 'fast-glob';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { showBanner, uiColors } from './theme.js';
import { collectDepCandidates } from '../commands/showDepsCommand.js';
import { removeUnusedDependencies } from '../eliminator/dependencyCleaner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../../bin/dce-cli.js');

export function buildPostScanMenu(scanSummary, isAdvanced) {
    const totalFindings = scanSummary
        ? (scanSummary.safeFixCount ?? scanSummary.safe ?? 0) +
          (scanSummary.review ?? 0) +
          (scanSummary.risky ?? 0) +
          (scanSummary.other ?? 0) +
          (scanSummary.dependencyFindings ?? 0)
        : null;
    if (totalFindings === 0) {
        return { clean: true, choices: [] };
    }

    const choices = [];
    if ((scanSummary?.safeFixCount ?? 1) > 0 || isAdvanced) {
        choices.push({
            name: `${choices.length + 1}. Ya, Eksekusi Fix Sekarang (Bersihkan dead code & dependensi)`,
            value: 'fix',
        });
    }
    if (!isAdvanced && (scanSummary?.review ?? 1) + (scanSummary?.risky ?? 1) + (scanSummary?.other ?? 1) > 0) {
        choices.push({
            name: `${choices.length + 1}. Pindai Ulang dengan Mode Advanced (Lihat item REVIEW & RISKY)`,
            value: 'advanced',
        });
    }
    choices.push({ name: `${choices.length + 1}. Tidak, Keluar`, value: 'exit' });
    return { clean: false, choices };
}

export async function launchWizard() {
    showBanner();

    // 1. Pilih Aksi — dikelompokkan sesuai 3 klasifikasi fitur
    let action;
    try {
        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Apa yang ingin Anda lakukan hari ini?',
                loop: false,
                choices: [
                    { name: '[>] Analisis & Eksekusi       (scan & fix)', value: 'scan' },
                    { name: '[+] Lihat Dependensi          (show-deps)', value: 'show-deps' },
                    { name: '[~] Buat Diagram Visualisasi  (visualize)', value: 'visualize' },
                    { name: '[T] Lacak Ketergantungan File (trace)', value: 'trace' },
                    { name: '[H] Riwayat & Restore Backup  (history)', value: 'history' },
                    { name: '[x] Keluar', value: 'exit' },
                ]
            }
        ]);
        action = answer.action;
    } catch (_err) {
        // Tangani Ctrl+C (ExitPromptError) agar tidak crash
        console.log(uiColors.muted('\n\n[.] Keluar. Sampai jumpa!\n'));
        process.exit(0);
    }

    if (action === 'exit') {
        console.log(uiColors.warning('\nSampai jumpa!\n'));
        process.exit(0);
    }

    // 2. Pilih Target Folder / File
    let targetDirectory;
    try {
        if (action === 'trace') {
            console.log(uiColors.muted('Memindai file yang tersedia...'));
            const files = await fg(['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'], {
                ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**'],
                cwd: process.cwd()
            });

            if (files.length === 0) {
                console.log(uiColors.warning('\n[!] Tidak ada file JS/TS yang ditemukan untuk di-trace.\n'));
                process.exit(0);
            }

            const answer = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'targetDirectory',
                    message: 'Pilih file yang ingin dilacak (gunakan panah, ketik untuk mencari):',
                    choices: files,
                    pageSize: 15
                }
            ]);
            targetDirectory = answer.targetDirectory;
        } else {
            const answer = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'targetDirectory',
                    message: 'Masukkan direktori target (contoh: ./ atau ./src):',
                    default: './',
                    validate: (input) => {
                        if (fs.existsSync(path.resolve(input))) return true;
                        return '[!] Direktori tidak ditemukan! Silakan masukkan path yang valid.';
                    }
                }
            ]);
            targetDirectory = answer.targetDirectory;
        }
    } catch (_err) {
        console.log(uiColors.muted('\n\n[.] Keluar. Sampai jumpa!\n'));
        process.exit(0);
    }

    console.log();

    // 3. Eksekusi Perintah dan Interaksi (Pass-through ke CLI)
    let keepScanning = true;
    let isAdvanced = false;

    while (keepScanning) {
        const summaryPath = path.join(os.tmpdir(), `deadkiller-scan-${randomUUID()}.json`);
        let scanSummary = null;
        try {
            // stdio: 'inherit' memastikan warna dan interaksi CLI tetap berjalan
            const advancedFlag = (action === 'scan' && isAdvanced) ? " --advanced" : "";
            const summaryFlag = action === 'scan' ? ` --summary-file "${summaryPath}"` : '';
            execSync(`node "${cliPath}" ${action} "${targetDirectory}"${advancedFlag}${summaryFlag}`, { stdio: 'inherit' });
            if (action === 'scan' && await fs.pathExists(summaryPath)) {
                scanSummary = await fs.readJson(summaryPath);
            }
        } catch (error) {
            // Kesalahan sudah ditangani dan di-print oleh proses anak (dce-cli.js)
            if (process.env.DEBUG) console.warn(error);
        } finally {
            if (await fs.pathExists(summaryPath)) {
                await fs.remove(summaryPath);
            }
        }

        // 4. Setelah scan selesai, tawarkan langsung fix atau scan ulang
        if (action === 'scan') {
            try {
                const postScanMenu = buildPostScanMenu(scanSummary, isAdvanced);
                if (postScanMenu.clean) {
                    console.log(uiColors.success('  ✔ Proyek bersih. Tidak ada tindakan fix yang diperlukan.\n'));
                    keepScanning = false;
                    continue;
                }

                const { nextAction } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'nextAction',
                        message: 'Apa langkah selanjutnya?',
                        choices: postScanMenu.choices
                    }
                ]);

                if (nextAction === 'advanced') {
                    isAdvanced = true;
                    console.log(uiColors.primary(`\n[>>] Memindai ulang dengan mode detail (--advanced)...\n`));
                    continue; // Loop kembali untuk eksekusi ulang
                } else if (nextAction === 'fix') {
                    keepScanning = false;

                    // Level 3 hanya tersedia jika pengguna sudah melihat item REVIEW & RISKY
                    // (yaitu setelah menjalankan scan --advanced). Konsisten dengan UX:
                    // "Jangan tawarkan penghapusan sesuatu yang belum pernah kamu lihat."
                    const elimChoices = [];
                    if (isAdvanced) {
                        elimChoices.push({ name: 'Level 3 - Aggressive Delete', value: '3' });
                    }
                    elimChoices.push({ name: 'Level 2 - Safe Refactor', value: '2' });
                    elimChoices.push({ name: 'Level 1 - Safe Skip', value: '1' });

                    if (!isAdvanced) {
                        console.log(uiColors.muted('  ℹ  Level 3 (Aggressive) tidak tersedia — gunakan --advanced terlebih dahulu untuk melihat item REVIEW & RISKY.\n'));
                    }

                    const { elimLevel } = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'elimLevel',
                            message: 'Pilih Tingkat Agresi Penghapusan (Elimination Level):',
                            choices: elimChoices
                        }
                    ]);

                    console.log(uiColors.primary(`\n[>>] Melanjutkan ke mode fix (Level ${elimLevel})...\n`));
                    try {
                        execSync(`node "${cliPath}" fix "${targetDirectory}" --level ${elimLevel}`, { stdio: 'inherit' });
                    } catch (error) {
                        if (process.env.DEBUG) console.warn(error);
                    }
                } else {
                    keepScanning = false;
                }
            } catch (err) {
                // Ctrl+C — abaikan saja
                if (process.env.DEBUG) console.warn(err);
                keepScanning = false;
            }
        } else if (action === 'show-deps') {
            // --- Tawarkan opsi fix khusus dependensi setelah tampilan show-deps ---
            keepScanning = false;
            try {
                const absTarget = path.resolve(targetDirectory);
                const { runtimeCandidates, devCandidates } = await collectDepCandidates(absTarget);
                const allCandidates = [...runtimeCandidates, ...devCandidates];

                if (allCandidates.length === 0) {
                    console.log(uiColors.success('\n  ✔ Tidak ada dependensi yang perlu dihapus.\n'));
                } else {
                    const { wantFix } = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'wantFix',
                        message: `Ditemukan ${allCandidates.length} kandidat dependensi yang tidak digunakan. Hapus sekarang?`,
                        default: false
                    }]);

                    if (wantFix) {
                        const { selected } = await inquirer.prompt([{
                            type: 'checkbox',
                            name: 'selected',
                            message: 'Pilih dependensi yang ingin dihapus dari package.json:',
                            choices: [
                                ...(runtimeCandidates.length > 0
                                    ? [new inquirer.Separator('── Runtime Dependencies ──'), ...runtimeCandidates]
                                    : []),
                                ...(devCandidates.length > 0
                                    ? [new inquirer.Separator('── devDependencies ──'), ...devCandidates]
                                    : [])
                            ]
                        }]);

                        if (selected.length === 0) {
                            console.log(uiColors.muted('\n  [.] Tidak ada yang dipilih. Dibatalkan.\n'));
                        } else {
                            try {
                                const result = await removeUnusedDependencies(absTarget, selected);
                                if (result?.removed?.length > 0) {
                                    console.log(uiColors.success(`\n  ✔ Berhasil menghapus: ${result.removed.join(', ')} dari package.json.`));
                                    console.log(uiColors.muted('  Jalankan `npm install` / `pnpm install` untuk memperbarui node_modules.\n'));
                                } else {
                                    console.log(uiColors.warning('\n  [!] Tidak ada perubahan yang diterapkan.\n'));
                                }
                            } catch (fixErr) {
                                console.error(uiColors.danger(`\n  [ERROR] Gagal menghapus dependensi: ${fixErr.message}\n`));
                            }
                        }
                    } else {
                        console.log(uiColors.muted('\n  [.] Dibatalkan. Tidak ada perubahan.\n'));
                    }
                }
            } catch (err) {
                // Ctrl+C atau error — abaikan saja
                if (process.env.DEBUG) console.warn(err);
            }
        } else {
            keepScanning = false;
        }
    }

    console.log();
}
