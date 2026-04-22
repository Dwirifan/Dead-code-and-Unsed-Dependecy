// Dashboard.tsx — Komponen TSX dengan TypeScript type annotations
// Test: apakah parser & dead code analyzer bisa handle .tsx

import React, { useState, useEffect } from 'react';
import axios from 'axios';

// ── Type Definitions ──────────────────────────────
interface User {
    id: number;
    name: string;
    email: string;
    role: 'admin' | 'user' | 'guest';
}

interface DashboardProps {
    title: string;
    maxUsers?: number;
}

type SortOrder = 'asc' | 'desc';

// ── Dead Code: variabel tidak terpakai ──────────────
const API_VERSION: string = 'v2';
const MAX_RETRIES: number = 3;

// ── Dead Code: fungsi tidak terpakai ────────────────
function formatUserEmail(user: User): string {
    return `<${user.email}>`;
}

// ── Dead Code: type alias tidak terpakai ────────────
type FilterMode = 'all' | 'active' | 'inactive';

// ── Live Code: komponen utama ───────────────────────
export default function Dashboard({ title, maxUsers = 10 }: DashboardProps): JSX.Element {
    const [users, setUsers] = useState<User[]>([]);
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        async function loadUsers(): Promise<void> {
            setLoading(true);
            try {
                const res = await axios.get<User[]>('/api/users');
                setUsers(res.data.slice(0, maxUsers));
            } catch (err) {
                console.error('Failed to load users:', err);
            }
            setLoading(false);
        }
        loadUsers();
    }, [maxUsers]);

    const sortedUsers: User[] = [...users].sort((a, b) =>
        sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
    );

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    return (
        <section className="dashboard">
            <h2>{title}</h2>
            <button onClick={() => setSortOrder(s => s === 'asc' ? 'desc' : 'asc')}>
                Sort: {sortOrder.toUpperCase()}
            </button>
            <ul>
                {sortedUsers.map((user: User) => (
                    <li key={user.id}>
                        <strong>{user.name}</strong> — {user.email}
                        <span className={`role role-${user.role}`}>{user.role}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
