import type { Priority } from '../types';

export interface PriorityOption {
    value: Priority;
    labelKey: string;
    colorVar: string;
}

export const PRIORITIES: PriorityOption[] = [
    { value: 'low', labelKey: 'priority.low', colorVar: 'var(--color-priority-low)' },
    { value: 'medium', labelKey: 'priority.medium', colorVar: 'var(--color-priority-medium)' },
    { value: 'high', labelKey: 'priority.high', colorVar: 'var(--color-priority-high)' },
    { value: 'urgent', labelKey: 'priority.urgent', colorVar: 'var(--color-priority-urgent)' },
];

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4199/api';
