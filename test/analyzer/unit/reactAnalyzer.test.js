import { describe, expect, it } from 'vitest';
import { parseCode } from '../../../src/parser/astParser.js';
import { analyzeReactSmells } from '../../../src/analyzer/deadcode/react/reactAnalyzer.js';

describe('reactAnalyzer', () => {
    it('mendeteksi state, props, wrapper, dan key yang melewati batas aman', async () => {
        const ast = await parseCode(`
            function ManyStates() {
                useState(0); useState(1); useState(2);
                React.useState(3); React.useState(4); React.useState(5);
                return <div><Child /></div>;
            }

            const ManyProps = ({ a, b, c, d, e, f, g, h }) => <Widget />;

            export function List({ items }) {
                return items.map(item => <span>{item}</span>);
            }
        `, 'components.jsx');

        const findings = analyzeReactSmells(ast);
        const rules = findings.map(finding => finding.rule);

        expect(rules).toContain('too-many-states');
        expect(rules).toContain('too-many-props');
        expect(rules).toContain('unnecessary-wrapper');
        expect(rules).toContain('missing-key');
    });

    it('tidak melaporkan pola yang berada pada batas atau memiliki perlindungan React', async () => {
        const ast = await parseCode(`
            export default function Healthy({ a, b, c, d, e, f, g }) {
                useState(0); useState(1); useState(2); useState(3); useState(4);
                return <div className="layout"><Child /></div>;
            }

            const List = ({ items }) => items.map(item => <span key={item.id}>{item.name}</span>);
        `, 'healthy.tsx');

        expect(analyzeReactSmells(ast)).toEqual([]);
    });

    it('mendeteksi missing key pada callback dengan explicit return', async () => {
        const ast = await parseCode(`
            const List = ({ items }) => items.map(function render(item) {
                return <Row value={item} />;
            });
        `, 'list.jsx');

        expect(analyzeReactSmells(ast)).toContainEqual(expect.objectContaining({
            rule: 'missing-key',
        }));
    });
});
