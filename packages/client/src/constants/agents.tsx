import { Bot, Code2, Eye, MousePointer } from 'lucide-react';
import React from 'react';
import type { CoderType } from '../types';

export interface AgentUIConfig {
    icon: React.ReactNode;
    processingText: string;
    label: string;
    color: string;
}

export const AGENT_CONFIGS: Record<string, AgentUIConfig> = {
    'opencode': {
        icon: <Code2 size={14} />,
        processingText: 'coding...',
        label: 'OpenCode',
        color: '#3b82f6'
    },
    'cursor': {
        icon: <MousePointer size={14} />,
        processingText: 'coding...',
        label: 'Cursor',
        color: '#7c3aed'
    },
    'code_review': {
        icon: <Eye size={14} />,
        processingText: 'reviewing...',
        label: 'Reviewer',
        color: '#8b5cf6'
    },
    'default': {
        icon: <Bot size={14} />,
        processingText: 'processing...',
        label: 'Agent',
        color: '#10b981'
    }
};

/** Coder implementations shown in column config. Add new entries here to support more coders (e.g. cursor, claude_code). */
export const CODER_TYPES: { value: CoderType; label: string }[] = [
    { value: 'opencode', label: 'OpenCode' },
];

export function getAgentConfig(agentType: string | undefined): AgentUIConfig {
    if (!agentType) return AGENT_CONFIGS.default;
    return AGENT_CONFIGS[agentType] || AGENT_CONFIGS.default;
}

export function getAgentConfigByAuthor(author: string): AgentUIConfig {
    if (author === 'user') return AGENT_CONFIGS.default;
    if (author.includes('opencode')) return AGENT_CONFIGS.opencode;
    if (author.includes('cursor')) return AGENT_CONFIGS.cursor;
    if (author.includes('review')) return AGENT_CONFIGS.code_review;
    return AGENT_CONFIGS.default;
}
