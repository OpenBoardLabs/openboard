import { Bot, Code2, Eye, Terminal } from 'lucide-react';
import React from 'react';

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
        label: 'Coder',
        color: '#3b82f6'
    },
    'code_review': {
        icon: <Eye size={14} />,
        processingText: 'reviewing...',
        label: 'Reviewer',
        color: '#8b5cf6'
    },
    'dummy': {
        icon: <Terminal size={14} />,
        processingText: 'simulating...',
        label: 'Dummy',
        color: '#6b7280'
    },
    'default': {
        icon: <Bot size={14} />,
        processingText: 'processing...',
        label: 'Agent',
        color: '#10b981'
    }
};

export function getAgentConfig(agentType: string | undefined): AgentUIConfig {
    if (!agentType) return AGENT_CONFIGS.default;
    return AGENT_CONFIGS[agentType] || AGENT_CONFIGS.default;
}

export function getAgentConfigByAuthor(author: string): AgentUIConfig {
    if (author === 'user') return AGENT_CONFIGS.default;
    if (author.includes('opencode')) return AGENT_CONFIGS.opencode;
    if (author.includes('review')) return AGENT_CONFIGS.code_review;
    if (author.includes('dummy')) return AGENT_CONFIGS.dummy;
    return AGENT_CONFIGS.default;
}
