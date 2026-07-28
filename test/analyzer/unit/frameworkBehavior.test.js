import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseCode } from '../../../src/parser/astParser.js';
import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';

describe('Framework-Specific Behavior & TypeScript Advanced Syntax', () => {
    it('Should preserve Next.js / Remix framework exports (getServerSideProps, metadata, loader, action)', async () => {
        const code = `
            export async function getServerSideProps() {
                return { props: {} };
            }
            export const metadata = { title: 'App' };
            export async function loader() { return null; }
            export async function action() { return null; }
            export function unusedFunction() {}
        `;
        const ast = await parseCode(code, 'page.js');
        const globalRegistry = { usedExports: new Map(), projectExports: new Map() };
        globalRegistry.usedExports.set('page.js', new Set()); // file di-import oleh sistem (misal routing)

        const ruleEngine = new RuleEngine();
        ruleEngine.rules.preserveExports = 'strict';

        const results = await findDeadCode(ast, 'page.js', globalRegistry, ruleEngine);
        const unusedNames = results.map(r => r.name);

        assert.ok(!unusedNames.includes('getServerSideProps'), 'getServerSideProps should be preserved');
        assert.ok(!unusedNames.includes('metadata'), 'metadata should be preserved');
        assert.ok(!unusedNames.includes('loader'), 'loader should be preserved');
        assert.ok(!unusedNames.includes('action'), 'action should be preserved');
        assert.ok(unusedNames.includes('unusedFunction'), 'unusedFunction should still be detected as unused');
    });

    it('Should preserve exports in files or functions with "use server" or "use client" directives', async () => {
        const codeServer = `
            'use server';
            export async function createPost(data) {
                return { success: true };
            }
        `;
        const astServer = await parseCode(codeServer, 'actions.js');
        const regServer = { usedExports: new Map(), projectExports: new Map() };
        regServer.usedExports.set('actions.js', new Set());

        const ruleEngine = new RuleEngine();
        ruleEngine.rules.preserveExports = 'strict';

        const resultsServer = await findDeadCode(astServer, 'actions.js', regServer, ruleEngine);
        const unusedServer = resultsServer.map(r => r.name);
        assert.ok(!unusedServer.includes('createPost'), 'createPost should be preserved due to "use server" directive');

        const codeClient = `
            export function ClientButton() {
                'use client';
                return null;
            }
        `;
        const astClient = await parseCode(codeClient, 'button.js');
        const regClient = { usedExports: new Map(), projectExports: new Map() };
        regClient.usedExports.set('button.js', new Set());

        const resultsClient = await findDeadCode(astClient, 'button.js', regClient, ruleEngine);
        const unusedClient = resultsClient.map(r => r.name);
        assert.ok(!unusedClient.includes('ClientButton'), 'ClientButton should be preserved due to function-level "use client" directive');
    });

    it('Should correctly analyze TypeScript namespaces (TSModuleDeclaration) and TSDeclareFunction', async () => {
        const codeTS = `
            export namespace MyNamespace {
                export const VAL = 42;
            }
            export declare function myDeclaredFunc(a: number): string;
            export namespace UnusedNamespace {
                export const SECRET = 'no';
            }
        `;
        const astTS = await parseCode(codeTS, 'types.ts');
        const regTS = { usedExports: new Map(), projectExports: new Map() };
        // Simulasi bahwa MyNamespace dan myDeclaredFunc di-import di file lain
        regTS.usedExports.set('types.ts', new Set(['MyNamespace', 'myDeclaredFunc']));

        const ruleEngine = new RuleEngine();
        ruleEngine.rules.preserveExports = 'strict';

        const resultsTS = await findDeadCode(astTS, 'types.ts', regTS, ruleEngine);
        const unusedTS = resultsTS.map(r => r.name);

        assert.ok(!unusedTS.includes('MyNamespace'), 'MyNamespace should be marked as used');
        assert.ok(!unusedTS.includes('VAL'), 'VAL inside used namespace should be preserved');
        assert.ok(!unusedTS.includes('myDeclaredFunc'), 'myDeclaredFunc should be preserved');
        assert.ok(unusedTS.includes('UnusedNamespace'), 'UnusedNamespace should be detected as unused');
    });
});
