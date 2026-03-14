import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, FileCode, GitBranch, RotateCcw } from 'lucide-react';
import { parseDiff, Diff, Hunk } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import styles from './DiffPanel.module.css';

interface DiffPanelProps {
    isOpen: boolean;
    onClose: () => void;
    boardId: string;
    ticket: any; // Using any for simplicity in props mapping
}

export function DiffPanel({ isOpen, onClose, boardId, ticket }: DiffPanelProps) {
    const [diffText, setDiffText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const worktreeSession = [...(ticket?.agent_sessions ?? [])].reverse().find((s: any) => s.worktree_path);

    const files = useMemo(() => {
        if (!diffText) return [];
        return parseDiff(diffText);
    }, [diffText]);

    useEffect(() => {
        if (isOpen && ticket) {
            fetchDiff();
        } else {
            setDiffText(null);
            setError(null);
        }
    }, [isOpen, boardId, ticket?.id]);

    const handleMerge = async () => {
        if (isMerging || worktreeSession?.merged) return;

        setIsMerging(true);
        try {
            const response = await fetch(`/api/boards/${boardId}/tickets/${ticket.id}/merge`, {
                method: 'POST',
            });
            if (!response.ok) {
                const data = await response.json();
                alert(`Failed to merge: ${data.error}`);
            }
        } catch (err) {
            console.error('Merge error:', err);
            alert('Failed to send merge request');
        } finally {
            setIsMerging(false);
        }
    };

    const fetchDiff = async () => {
        if (!ticket) return;
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/boards/${boardId}/tickets/${ticket.id}/diff`);
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to fetch diff');
            }
            const data = await response.json();
            setDiffText(data.diff);
        } catch (err: any) {
            console.error('Diff fetch error:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <>
            {isOpen && <div className={styles.backdrop} onClick={onClose} />}
            <div 
                className={`${styles.panel} ${isOpen ? styles.open : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <h3>Diff: {ticket.title}</h3>
                </div>
                <div className={styles.headerActions}>
                    {worktreeSession && (
                        <button
                            className={styles.mergeBtn}
                            onClick={handleMerge}
                            disabled={isMerging || worktreeSession.merged}
                            style={(isMerging || worktreeSession.merged) ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                        >
                            {isMerging ? (
                                <RotateCcw size={14} className={styles.processingIcon} />
                            ) : (
                                <GitBranch size={14} />
                            )}
                            <span>{worktreeSession.merged ? 'Already merged' : isMerging ? 'Merging...' : 'Merge into master'}</span>
                        </button>
                    )}
                    <button 
                        className={styles.closeBtn} 
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>
            <div className={styles.content}>
                {loading && (
                    <div className={styles.status}>
                        <Loader2 className={styles.spinner} />
                        <span>Loading diff...</span>
                    </div>
                )}
                {error && (
                    <div className={`${styles.status} ${styles.error}`}>
                        <span>Error: {error}</span>
                        <button onClick={fetchDiff} className={styles.retryBtn}>Retry</button>
                    </div>
                )}
                {!loading && !error && diffText !== null && (
                    <div className={styles.diffList}>
                        {files.length === 0 ? (
                            <div className={styles.empty}>No changes detected compared to master.</div>
                        ) : (
                                files.map((file: any, index) => {
                                    const additions = file.hunks.reduce((acc: number, hunk: any) => 
                                        acc + hunk.changes.filter((c: any) => c.type === 'insert').length, 0);
                                    const deletions = file.hunks.reduce((acc: number, hunk: any) => 
                                        acc + hunk.changes.filter((c: any) => c.type === 'delete').length, 0);
                                    
                                    return (
                                        <div key={index} className={styles.fileContainer}>
                                            <div className={styles.fileHeader}>
                                                <FileCode size={14} className={styles.fileIcon} />
                                                <span className={styles.fileName}>{file.newPath || file.oldPath}</span>
                                                <div className={styles.fileStats}>
                                                    {additions > 0 && <span className={styles.additions}>+{additions}</span>}
                                                    {deletions > 0 && <span className={styles.deletions}>-{deletions}</span>}
                                                </div>
                                            </div>
                                            <div className={styles.diffContainer}>
                                                <Diff 
                                                    viewType="unified" 
                                                    diffType={file.type} 
                                                    hunks={file.hunks}
                                                >
                                                    {hunks => hunks.map((hunk) => (
                                                        <Hunk 
                                                            key={hunk.content} 
                                                            hunk={hunk} 
                                                        />
                                                    ))}
                                                </Diff>
                                            </div>
                                        </div>
                                    );
                                })
                        )}
                    </div>
                )}
            </div>
            </div>
        </>,
        document.body
    );
}
