import fs from 'fs-extra';
import path from 'path';

/**
 * Removes unused dependencies from package.json
 * @param {string} projectRoot 
 * @param {string[]} unusedDeps - List of dependency names to remove
 */
export async function removeUnusedDependencies(projectRoot, unusedDeps) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('package.json not found');
    }

    const pkg = await fs.readJson(packageJsonPath);
    let removedCount = 0;

    if (pkg.dependencies) {
        unusedDeps.forEach(dep => {
            if (pkg.dependencies[dep]) {
                delete pkg.dependencies[dep];
                removedCount++;
            }
        });
    }

    if (pkg.devDependencies) {
        unusedDeps.forEach(dep => {
            if (pkg.devDependencies[dep]) {
                delete pkg.devDependencies[dep];
                removedCount++;
            }
        });
    }

    if (removedCount > 0) {
        await fs.writeJson(packageJsonPath, pkg, { spaces: 2 });
    }

    return removedCount;
}
