#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';

import { registerScanCommand }     from '../src/commands/scanCommand.js';
import { registerFixCommand }      from '../src/commands/fixCommand.js';
import { registerShowDepsCommand } from '../src/commands/showDepsCommand.js';
import { registerVisualizeCommand } from '../src/commands/visualizeCommand.js';
import { registerHistoryCommand }  from '../src/commands/historyCommand.js';
import { registerTraceCommand }    from '../src/commands/traceCommand.js';
import { registerWatchCommand }    from '../src/commands/watchCommand.js';
import { registerReportCommand }   from '../src/commands/reportCommand.js';
import { registerInitCommand }     from '../src/commands/initCommand.js';

// ── Global Ctrl+C handler ──────────────────────────────────────────────────
// Inquirer v9+ melempar ExitPromptError saat user menekan Ctrl+C.
// Handler ini mencegat error tersebut agar tidak mencetak stack trace menakutkan.
const handleExit = (err) => {
    if (err?.name === 'ExitPromptError' || err?.constructor?.name === 'ExitPromptError') {
        process.stdout.write('\n');
        console.log(chalk.yellow('[.] Dibatalkan. Sampai jumpa!\n'));
        process.exit(0);
    }
    console.error(chalk.red('[ERROR]'), err?.message ?? err);
    process.exit(1);
};
process.on('uncaughtException',  handleExit);
process.on('unhandledRejection', handleExit);

// ── Program ───────────────────────────────────────────────────────────────
program
    .name('deadkiller')
    .description('Automated Dead Code and Unused Dependency Eliminator')
    .version('1.0.0');

// ── Daftarkan semua perintah ──────────────────────────────────────────────
registerScanCommand(program);
registerFixCommand(program);
registerShowDepsCommand(program);
registerVisualizeCommand(program);
registerHistoryCommand(program);
registerTraceCommand(program);
registerWatchCommand(program);
registerReportCommand(program);
registerInitCommand(program);

// ── Engine Startup Orchestrator ───────────────────────────────────────────
// Tanpa argumen → launch interactive wizard
if (process.argv.length === 2) {
    import('../src/ui/wizard.js')
        .then(({ launchWizard }) => launchWizard())
        .catch(err => console.error('Gagal meluncurkan Wizard UI:', err));
} else {
    program.parse(process.argv);
}
