export const kasusUji = [
    // ─── KELOMPOK A: Berhasil di Kedua Engine (Baseline) ───────────────
    {
        no: 1,
        label: 'Konstruksi JavaScript Dasar - Import',
        file: 'tc01.js',
        kode: `import { x } from 'y';`
    },
    {
        no: 2,
        label: 'Konstruksi JavaScript Dasar - Variabel Global',
        file: 'tc02.js',
        kode: `globalVar = 10;`
    },
    {
        no: 3,
        label: 'Konstruksi JavaScript Dasar - Deklarasi Var',
        file: 'tc03.js',
        kode: `var a = 1;`
    },
    {
        no: 4,
        label: 'Konstruksi JavaScript Dasar - Deklarasi Let',
        file: 'tc04.js',
        kode: `let b = 2;`
    },
    {
        no: 5,
        label: 'Konstruksi JavaScript Dasar - Fungsi dengan Parameter',
        file: 'tc05.js',
        kode: `function add(x, y) { return x + y; }`
    },
    {
        no: 6,
        label: 'Konstruksi JavaScript Dasar - Arrow Function',
        file: 'tc06.js',
        kode: `const multiply = (x, y) => x * y;`
    },
    {
        no: 7,
        label: 'Konstruksi JavaScript Dasar - Object Destructuring',
        file: 'tc07.js',
        kode: `const { name, age } = user;`
    },
    {
        no: 8,
        label: 'Konstruksi JavaScript Dasar - Array Destructuring',
        file: 'tc08.js',
        kode: `const [first, second] = array;`
    },
    {
        no: 9,
        label: 'JavaScript & TypeScript Dasar',
        file: 'tc09.ts',
        kode: `
import { format } from 'date-fns';

export function formatDate<T extends Date>(date: T, pattern: string): string {
    return format(date, pattern);
}
`.trim()
    },
    {
        no: 10,
        label: 'JSX — React Components',
        file: 'tc10.jsx',
        kode: `
import React, { useState } from 'react';

const Card = ({ title, content }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="card" onClick={() => setOpen(!open)}>
            <h2>{title}</h2>
            {open && <p>{content}</p>}
        </div>
    );
};

export default Card;
`.trim()
    },
    {
        no: 11,
        label: 'TSX — React Component dengan Generic Props',
        file: 'tc11.tsx',
        kode: `
import React from 'react';

interface Props<T> {
    data: T[];
    renderItem: (item: T) => React.ReactNode;
}

export const List = <T,>({ data, renderItem }: Props<T>) => (
    <ul>
        {data.map((item, index) => (
            <li key={index}>{renderItem(item)}</li>
        ))}
    </ul>
);
`.trim()
    },
    {
        no: 12,
        label: 'TypeScript 4.1 — Template Literal Types',
        file: 'tc12.ts',
        kode: `
type Color = 'red' | 'blue' | 'green';
type Shade = 100 | 200 | 300 | 400 | 500;
type ColorPalette = \`\${Color}-\${Shade}\`;

export function applyColor(palette: ColorPalette) {
    document.body.style.backgroundColor = palette;
}
`.trim()
    },

    // ─── KELOMPOK B: Uji Kompatibilitas Sintaks (Compatibility Test) ───────────────
    {
        no: 13,
        label: 'Type-Only Export (TS 3.8+)',
        file: 'tc13.ts',
        kode: `
/**
 * Mengekspor definisi tipe abstrak dari modul inti.
 * Sering digunakan dalam arsitektur clean code.
 */
export type { UserProfile, AuthCredentials, SessionInfo };
`.trim()
    },
    {
        no: 14,
        label: 'Inline Type Export (TS 4.5+)',
        file: 'tc14.ts',
        kode: `
import { createStore } from 'redux';

export const store = createStore(() => ({}));
export { type RootState, type AppDispatch };
`.trim()
    },
    {
        no: 15,
        label: 'Export Type Star (TS 3.8+)',
        file: 'tc15.ts',
        kode: `
/**
 * Re-exporting seluruh definisi tipe tanpa mengekspos logic.
 */
export type * from './auth/types.d.ts';
export type * as AuthUtils from './auth/utils.d.ts';
`.trim()
    },
    {
        no: 16,
        label: 'Override keyword pada Polymorphism',
        file: 'tc16.ts',
        kode: `
abstract class BaseController {
    abstract handleRequest(req: Request, res: Response): void;
    
    protected sendResponse(res: Response, data: any) {
        res.json({ success: true, data });
    }
}

export class UserController extends BaseController {
    public override handleRequest(req: Request, res: Response): void {
        this.sendResponse(res, { user: 'admin' });
    }
}
`.trim()
    },
    {
        no: 17,
        label: 'Operator satisfies (TS 4.9+)',
        file: 'tc17.ts',
        kode: `
type ThemeConfig = { 
    colors: Record<string, string>; 
    spacing: Record<string, number>; 
};

export const defaultTheme = {
    colors: { primary: '#007bff', secondary: '#6c757d' },
    spacing: { small: 8, medium: 16, large: 24 }
} satisfies ThemeConfig;
`.trim()
    },
    {
        no: 18,
        label: 'Assignment ke Non-Null Assertion',
        file: 'tc18.ts',
        kode: `
interface RequestMetrics {
    totalRequests?: number;
    failedRequests?: number;
}

export function incrementMetrics(metrics: RequestMetrics) {
    if (metrics.totalRequests !== undefined) {
        metrics.totalRequests!++;
    }
}
`.trim()
    },
    // ─── KELOMPOK C: Pengujian Kompatibilitas Traversal AST ───────────────
    {
        no: 19,
        label: 'TSInterfaceDeclaration dapat ditelusuri',
        file: 'tc19.ts',
        kode: `export interface User { id: number; }`,
        expectedNodeType: 'TSInterfaceDeclaration'
    },
    {
        no: 20,
        label: 'TSTypeAliasDeclaration dapat ditelusuri',
        file: 'tc20.ts',
        kode: `export type ID = number | string;`,
        expectedNodeType: 'TSTypeAliasDeclaration'
    },
    {
        no: 21,
        label: 'TSEnumDeclaration dapat ditelusuri',
        file: 'tc21.ts',
        kode: `export enum Status { Active, Inactive }`,
        expectedNodeType: 'TSEnumDeclaration'
    },
    {
        no: 22,
        label: 'TSModuleDeclaration dapat ditelusuri',
        file: 'tc22.ts',
        kode: `export namespace Utils { export const a = 1; }`,
        expectedNodeType: 'TSModuleDeclaration'
    }
];
