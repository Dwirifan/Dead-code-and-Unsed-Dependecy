import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseCode } from '../../../src/parser/astParser.js';
import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';

describe('Framework-Specific Behavior & TypeScript Advanced Syntax', () => {
    it('preserves Next.js exports only in the matching route conventions', async () => {
        const pagesCode = `
            export async function getServerSideProps() {
                return { props: {} };
            }
            export function unusedFunction() {}
        `;
        const appCode = `
            export const metadata = { title: 'App' };
            export const viewport = { themeColor: 'black' };
            export const dynamic = 'force-static';
            export const dynamicParams = false;
            export async function GET() { return null; }
            export default function Page() { return null; }
        `;
        const routeCode = `
            export async function GET() { return null; }
        `;
        const globalRegistry = { usedExports: new Map(), projectExports: new Map() };
        globalRegistry.usedExports.set('pages/index.js', new Set());
        globalRegistry.usedExports.set('app/page.js', new Set());
        globalRegistry.usedExports.set('app/api/users/route.js', new Set());

        const ruleEngine = new RuleEngine();
        ruleEngine.rules.mode = 'next';
        ruleEngine.rules.framework = 'next';
        ruleEngine.rules.preserveExports = 'strict';

        const pagesResults = await findDeadCode(
            await parseCode(pagesCode),
            'pages/index.js',
            globalRegistry,
            ruleEngine,
        );
        const appResults = await findDeadCode(
            await parseCode(appCode),
            'app/page.js',
            globalRegistry,
            ruleEngine,
        );
        const routeResults = await findDeadCode(
            await parseCode(routeCode),
            'app/api/users/route.js',
            globalRegistry,
            ruleEngine,
        );

        const pagesUnused = pagesResults.map(result => result.name);
        const appUnused = appResults.map(result => result.name);
        const routeUnused = routeResults.map(result => result.name);

        assert.ok(!pagesUnused.includes('getServerSideProps'), 'Pages Router export should be preserved');
        assert.ok(pagesUnused.includes('unusedFunction'), 'ordinary Pages Router export should still be checked');
        assert.ok(!appUnused.includes('metadata'), 'App Router metadata should be preserved');
        assert.ok(!appUnused.includes('viewport'), 'App Router viewport should be preserved');
        assert.ok(!appUnused.includes('dynamic'), 'App Router route config should be preserved');
        assert.ok(!appUnused.includes('dynamicParams'), 'dynamicParams should be preserved');
        assert.ok(!appUnused.includes('Page'), 'App Router default component should be preserved');
        assert.ok(appUnused.includes('GET'), 'HTTP method should not be preserved in page.js');
        assert.ok(!routeUnused.includes('GET'), 'HTTP method should be preserved in route.js');
    });

    it('preserves Next.js metadata file contracts', async () => {
        const registry = { usedExports: new Map(), projectExports: new Map() };
        const ruleEngine = new RuleEngine();
        ruleEngine.rules.mode = 'next';
        ruleEngine.rules.framework = 'next';
        ruleEngine.rules.preserveExports = 'strict';
        const iconFile = 'app/products/icon.tsx';
        const sitemapFile = 'app/products/sitemap.ts';
        registry.usedExports.set(iconFile, new Set());
        registry.usedExports.set(sitemapFile, new Set());

        const iconResults = findDeadCode(
            await parseCode(`
                export function generateImageMetadata() { return []; }
                export default function Icon() { return null; }
            `),
            iconFile,
            registry,
            ruleEngine,
        );
        const sitemapResults = findDeadCode(
            await parseCode(`
                export function generateSitemaps() { return []; }
                export default function sitemap() { return []; }
            `),
            sitemapFile,
            registry,
            ruleEngine,
        );

        assert.ok(!iconResults.some(result => ['generateImageMetadata', 'Icon'].includes(result.name)));
        assert.ok(!sitemapResults.some(result => ['generateSitemaps', 'sitemap'].includes(result.name)));
    });

    it('preserves Next.js instrumentation and proxy contracts', async () => {
        const registry = { usedExports: new Map(), projectExports: new Map() };
        const ruleEngine = new RuleEngine();
        ruleEngine.rules.mode = 'next';
        ruleEngine.rules.framework = 'next';
        ruleEngine.rules.preserveExports = 'strict';

        const instrumentationResults = findDeadCode(
            await parseCode(`
                export function register() {}
                export function onRequestError() {}
                export function unusedHelper() {}
            `),
            'instrumentation.ts',
            registry,
            ruleEngine,
        );
        const proxyResults = findDeadCode(
            await parseCode(`
                export const config = { matcher: '/api/:path*' };
                export default function proxy() {}
            `),
            'src/proxy.ts',
            registry,
            ruleEngine,
        );
        const mdxResults = findDeadCode(
            await parseCode('export function useMDXComponents() { return {}; }'),
            'src/mdx-components.tsx',
            registry,
            ruleEngine,
        );
        const nestedLookalikeResults = findDeadCode(
            await parseCode('export function register() {}'),
            'src/lib/instrumentation.ts',
            registry,
            ruleEngine,
        );

        assert.ok(!instrumentationResults.some(result => ['register', 'onRequestError'].includes(result.name)));
        assert.ok(instrumentationResults.some(result => result.name === 'unusedHelper'));
        assert.ok(!proxyResults.some(result => ['config', 'proxy'].includes(result.name)));
        assert.ok(!mdxResults.some(result => result.name === 'useMDXComponents'));
        assert.ok(nestedLookalikeResults.some(result => result.name === 'register'));
    });

    it('preserves Remix exports only in route modules', async () => {
        const routeCode = `
            export async function loader() { return null; }
            export async function action() { return null; }
            export async function clientLoader() { return null; }
            export function ErrorBoundary() { return null; }
            export function unusedFunction() {}
            export default function Route() { return null; }
        `;
        const globalRegistry = { usedExports: new Map(), projectExports: new Map() };
        globalRegistry.usedExports.set('app/routes/products.jsx', new Set());

        const ruleEngine = new RuleEngine();
        ruleEngine.rules.mode = 'react';
        ruleEngine.rules.framework = 'remix';
        ruleEngine.rules.preserveExports = 'strict';

        const results = await findDeadCode(
            await parseCode(routeCode),
            'app/routes/products.jsx',
            globalRegistry,
            ruleEngine,
        );
        const unusedNames = results.map(r => r.name);

        assert.ok(!unusedNames.includes('loader'), 'loader should be preserved');
        assert.ok(!unusedNames.includes('action'), 'action should be preserved');
        assert.ok(!unusedNames.includes('clientLoader'), 'clientLoader should be preserved');
        assert.ok(!unusedNames.includes('ErrorBoundary'), 'ErrorBoundary should be preserved');
        assert.ok(!unusedNames.includes('Route'), 'default route component should be preserved');
        assert.ok(unusedNames.includes('unusedFunction'), 'unusedFunction should still be detected as unused');
    });

    it('does not preserve generic framework-like names in vanilla files', async () => {
        const code = `
            export const size = 42;
            export async function action() { return null; }
            export async function GET() { return null; }
        `;
        const fileName = 'src/domain/commands.js';
        const globalRegistry = { usedExports: new Map(), projectExports: new Map() };
        globalRegistry.usedExports.set(fileName, new Set());
        const ruleEngine = new RuleEngine();
        ruleEngine.rules.mode = 'vanilla';
        ruleEngine.rules.preserveExports = 'strict';

        const results = await findDeadCode(
            await parseCode(code),
            fileName,
            globalRegistry,
            ruleEngine,
        );
        const unusedNames = results.map(result => result.name);

        assert.ok(unusedNames.includes('size'));
        assert.ok(unusedNames.includes('action'));
        assert.ok(unusedNames.includes('GET'));
    });

    it('uses effective per-file rules and honors preserveUnsafeFiles', async () => {
        const code = `export function unusedExport() {}`;
        const fileName = 'src/unsafe.js';
        const globalRegistry = {
            usedExports: new Map([[fileName, new Set()]]),
            projectExports: new Map(),
            unsafeFiles: new Set([fileName]),
        };
        let effectiveRulesCalls = 0;
        const ruleEngine = {
            rules: { preserveExports: true, preserveUnsafeFiles: true, mode: 'next' },
            effectiveRulesFor(receivedFileName) {
                effectiveRulesCalls += 1;
                assert.equal(receivedFileName, fileName);
                return {
                    preserveExports: 'strict',
                    preserveUnsafeFiles: false,
                    mode: 'vanilla',
                };
            },
            isIgnoredVariable: () => false,
        };

        const results = await findDeadCode(
            await parseCode(code),
            fileName,
            globalRegistry,
            ruleEngine,
        );

        assert.ok(effectiveRulesCalls >= 2, 'seluruh analyzer harus meminta aturan efektif file');
        assert.ok(results.some(result => result.name === 'unusedExport'));
    });

    it('applies preserveExports from a real RuleEngine file override', async () => {
        const projectRoot = path.resolve('virtual-deadkiller-project');
        const testFile = path.join(projectRoot, 'test', 'public-api.js');
        const sourceFile = path.join(projectRoot, 'src', 'internal.js');
        const code = 'export const unusedExport = 1;';
        const registry = {
            usedExports: new Map([
                [testFile, new Set()],
                [sourceFile, new Set()],
            ]),
            projectExports: new Map(),
            unsafeFiles: new Set(),
        };
        const ruleEngine = new RuleEngine();
        ruleEngine.projectRoot = projectRoot;
        ruleEngine.rules.preserveExports = 'strict';
        ruleEngine.rules.overrides = [{ files: ['test/**'], preserveExports: true }];

        const testFindings = findDeadCode(
            await parseCode(code),
            testFile,
            registry,
            ruleEngine,
        );
        const sourceFindings = findDeadCode(
            await parseCode(code),
            sourceFile,
            registry,
            ruleEngine,
        );

        assert.ok(!testFindings.some(result => result.name === 'unusedExport'));
        assert.ok(sourceFindings.some(result => result.name === 'unusedExport'));
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
