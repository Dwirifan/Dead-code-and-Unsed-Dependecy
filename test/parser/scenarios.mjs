export const kasusUji = [
    // ─── KELOMPOK A: Berhasil di Kedua Engine (Baseline) ───────────────
    {
        no: 1,
        label: 'JavaScript & TypeScript Dasar',
        file: 'tc01.ts',
        kode: `
import { format } from 'date-fns';

export function formatDate<T extends Date>(date: T, pattern: string): string {
    return format(date, pattern);
}
`.trim()
    },
    {
        no: 2,
        label: 'JSX — React Components',
        file: 'tc02.jsx',
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
        no: 3,
        label: 'TSX — React Component dengan Generic Props',
        file: 'tc03.tsx',
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
        no: 4,
        label: 'TypeScript 4.1 — Template Literal Types',
        file: 'tc04.ts',
        kode: `
type Color = 'red' | 'blue' | 'green';
type Shade = 100 | 200 | 300 | 400 | 500;
type ColorPalette = \`\${Color}-\${Shade}\`;

export function applyColor(palette: ColorPalette) {
    document.body.style.backgroundColor = palette;
}
`.trim()
    },

    // ─── KELOMPOK B: Pengujian Sintaks Tingkat Lanjut (Stress Test) ───────────────
    {
        no: 5,
        label: 'Type-Only Export (TS 3.8+)',
        file: 'tc05.ts',
        kode: `
/**
 * Mengekspor definisi tipe abstrak dari modul inti.
 * Sering digunakan dalam arsitektur clean code.
 */
export type { UserProfile, AuthCredentials, SessionInfo };
`.trim()
    },
    {
        no: 6,
        label: 'Inline Type Export (TS 4.5+)',
        file: 'tc06.ts',
        kode: `
import { createStore } from 'redux';

export const store = createStore(() => ({}));
export { type RootState, type AppDispatch };
`.trim()
    },
    {
        no: 7,
        label: 'Export Type Star (TS 3.8+)',
        file: 'tc07.ts',
        kode: `
/**
 * Re-exporting seluruh definisi tipe tanpa mengekspos logic.
 */
export type * from './auth/types.d.ts';
export type * as AuthUtils from './auth/utils.d.ts';
`.trim()
    },
    {
        no: 8,
        label: 'Override keyword pada Polymorphism',
        file: 'tc08.ts',
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
        no: 9,
        label: 'Operator satisfies (TS 4.9+)',
        file: 'tc09.ts',
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
        no: 10,
        label: 'Assignment ke Non-Null Assertion',
        file: 'tc10.ts',
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
    }
];
