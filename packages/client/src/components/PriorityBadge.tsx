import React from 'react';
import { t } from '../i18n/i18n';
import { PRIORITIES } from '../constants';
import type { Priority } from '../types';
import styles from './PriorityBadge.module.css';

interface PriorityBadgeProps {
    priority: Priority;
    size?: 'sm' | 'md';
}

export function PriorityBadge({ priority, size = 'sm' }: PriorityBadgeProps) {
    const opt = PRIORITIES.find(p => p.value === priority);
    if (!opt) return null;
    return (
        <span
            className={`${styles.badge} ${styles[size]}`}
            style={{ '--priority-color': opt.colorVar } as React.CSSProperties}
        >
            {t(opt.labelKey as Parameters<typeof t>[0])}
        </span>
    );
}
