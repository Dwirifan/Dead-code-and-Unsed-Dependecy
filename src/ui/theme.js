import chalk from 'chalk';

export const clearTerminal = () => {
    process.stdout.write(process.platform === 'win32' ? '\x1B[2J\x1B[0f' : '\x1B[2J\x1B[3J\x1B[H');
};

export const showBanner = () => {
    clearTerminal();
    console.log(chalk.bold.magenta('\n╔══════════════════════════════════════════════════╗'));
    console.log(chalk.bold.magenta('║') + chalk.bold.cyan('               DEADKILLER WIZARD                  ') + chalk.bold.magenta('║'));
    console.log(chalk.bold.magenta('╚══════════════════════════════════════════════════╝'));
    console.log(chalk.gray('   Advanced Dead Code & Unused Packages Eliminator\n'));
};

export const uiColors = {
    primary: chalk.cyan,
    success: chalk.green,
    warning: chalk.yellow,
    danger: chalk.red,
    muted: chalk.gray
};
