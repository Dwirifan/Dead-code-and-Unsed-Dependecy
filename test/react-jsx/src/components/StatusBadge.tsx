// StatusBadge.tsx — DEAD FILE (tidak di-import oleh siapapun)
// Test: apakah dead file detection bekerja untuk .tsx

import React from 'react';

interface StatusBadgeProps {
    status: 'online' | 'offline' | 'away';
    size?: 'sm' | 'md' | 'lg';
}

// Dead code: konstanta tidak terpakai
const STATUS_COLORS: Record<string, string> = {
    online: '#22c55e',
    offline: '#ef4444',
    away: '#f59e0b',
};

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps): JSX.Element {
    return (
        <span className={`badge badge-${status} badge-${size}`}>
            {status}
        </span>
    );
}
