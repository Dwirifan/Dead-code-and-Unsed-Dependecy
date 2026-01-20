import * as Diff from 'diff';
import chalk from 'chalk';

/**
 * Generates a terminal-friendly unified diff.
 * @param {string} oldCode - Original source code.
 * @param {string} newCode - Modified source code.
 * @param {string} fileName - Name of the file being diffed.
 * @returns {string} Colored diff output.
 */
export function generateDiff(oldCode, newCode, fileName) {
    const patch = Diff.createTwoFilesPatch(fileName, fileName, oldCode, newCode, 'Original', 'Modified', { context: 3 });
    const lines = patch.split('\n');
    let output = '';

    // Colorize Output
    lines.forEach(line => {
        if (line.startsWith('Index:') || line.startsWith('===')) {
            // Skip header noise if desired, or keep it dimmed
            return; 
        }
        if (line.startsWith('---') || line.startsWith('+++')) {
             output += chalk.gray(line) + '\n';
        } else if (line.startsWith('@@')) {
             output += chalk.cyan(line) + '\n';
        } else if (line.startsWith('+')) {
             output += chalk.green(line) + '\n';
        } else if (line.startsWith('-')) {
             output += chalk.red(line) + '\n';
        } else {
             output += chalk.dim(line) + '\n';
        }
    });

    return output;
}
