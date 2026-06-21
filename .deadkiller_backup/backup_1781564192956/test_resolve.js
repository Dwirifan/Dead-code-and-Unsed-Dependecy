import resolvePkg from 'enhanced-resolve';
import path from 'path';

const { create } = resolvePkg;

const resolver = create({
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    alias: {
        '@': path.resolve(process.cwd(), 'src')
    }
});

resolver({}, process.cwd(), 'chalk', {}, (err, result) => {
    console.log('chalk ->', result, err ? err.message : '');
});

resolver({}, process.cwd(), '@/analyzer/graph/projectGraph.js', {}, (err, result) => {
    console.log('@/ analyzer ->', result, err ? err.message : '');
});
