import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';

/**
 * Mendaftarkan perintah `show-deps` ke instance Commander yang diberikan.
 * @param {import('commander').Command} program
 */
export function registerShowDepsCommand(program) {
    program
        .command('show-deps')
        .argument('<path>', 'Path to project directory')
        .description('Tampilkan daftar dependencies dan devDependencies dari package.json')
        .action(async (targetPath) => {
            const absolutePath = path.resolve(targetPath);
            const pkgPath      = path.join(absolutePath, 'package.json');

            if (!fs.existsSync(pkgPath)) {
                console.error(`[ERROR] 'package.json' tidak ditemukan di '${absolutePath}'.`);
                process.exit(1);
            }

            try {
                const pkg = await fs.readJson(pkgPath);

                console.log(`\n[+] Dependencies mapped for: ${chalk.cyan(pkg.name || path.basename(absolutePath))}\n`);

                if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
                    console.log(chalk.bold.green('=== Dependencies ==='));
                    for (const [dep, ver] of Object.entries(pkg.dependencies)) {
                        console.log(`  ${chalk.white(dep)}: ${chalk.gray(ver)}`);
                    }
                    console.log();
                } else {
                    console.log(chalk.gray('No standard dependencies found.\n'));
                }

                if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
                    console.log(chalk.bold.yellow('=== devDependencies ==='));
                    for (const [dep, ver] of Object.entries(pkg.devDependencies)) {
                        console.log(`  ${chalk.white(dep)}: ${chalk.gray(ver)}`);
                    }
                    console.log();
                } else {
                    console.log(chalk.gray('No devDependencies found.\n'));
                }
            } catch (err) {
                console.error(`[ERROR] Gagal membaca package.json: ${err.message}`);
                process.exit(1);
            }
        });
}
