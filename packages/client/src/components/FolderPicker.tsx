import { useState, useEffect } from 'react';
import { X, Search, Folder, GitBranch, Globe, Code, ChevronRight } from 'lucide-react';
import styles from './FolderPicker.module.css';
import { systemApi } from '../api/system.api';

interface DirectoryEntry {
    name: string;
    path: string;
    isRepo: boolean;
    hasSrc: boolean;
    hasPublic: boolean;
    isDir: boolean;
}

interface FolderPickerProps {
    onSelect: (path: string) => void;
    onClose: () => void;
    initialPath?: string;
}

export function FolderPicker({ onSelect, onClose, initialPath }: FolderPickerProps) {
    const [path, setPath] = useState(initialPath || '');
    const [entries, setEntries] = useState<DirectoryEntry[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<DirectoryEntry[] | null>(null);
    const [globalSearchResults, setGlobalSearchResults] = useState<DirectoryEntry[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [recentProjects, setRecentProjects] = useState<string[]>([]);
    const [searchMode, setSearchMode] = useState<'local' | 'global'>('local');

    useEffect(() => {
        const saved = localStorage.getItem('recent_projects');
        if (saved) {
            setRecentProjects(JSON.parse(saved));
        }
    }, []);

    const fetchEntries = async (targetPath: string) => {
        setLoading(true);
        try {
            const data = await systemApi.browse(targetPath);
            setEntries(data.entries);
            setPath(data.currentPath);
            setSearchResults(null);
            setGlobalSearchResults(null);
            setSearchQuery('');
            setSearchMode('local');
        } catch (error) {
            console.error('Failed to fetch directories:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async (query: string) => {
        setSearchQuery(query);
        if (!query.trim()) {
            setSearchResults(null);
            setGlobalSearchResults(null);
            return;
        }

        try {
            if (searchMode === 'local') {
                const data = await systemApi.search(query, path);
                setSearchResults(data);
                
                // If local results are few, trigger global search automatically or show hint
                if (data.length < 3 && query.length >= 3) {
                    performGlobalSearch(query);
                }
            } else {
                performGlobalSearch(query);
            }
        } catch (error) {
            console.error('Search failed:', error);
        }
    };

    const performGlobalSearch = async (query: string) => {
        setLoading(true);
        try {
            const data = await systemApi.searchGlobal(query);
            setGlobalSearchResults(data);
        } catch (error) {
            console.error('Global search failed:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEntries(path);
    }, []);

    const navigateTo = (newPath: string) => {
        fetchEntries(newPath);
    };

    const handleSelect = (selectedPath: string) => {
        // Save to recent projects
        const updatedRecent = [selectedPath, ...recentProjects.filter(p => p !== selectedPath)].slice(0, 5);
        localStorage.setItem('recent_projects', JSON.stringify(updatedRecent));
        onSelect(selectedPath);
        onClose();
    };

    const getIcon = (entry: DirectoryEntry) => {
        if (entry.isRepo) return <GitBranch size={16} className={styles.gitIcon} />;
        if (entry.hasPublic) return <Globe size={16} className={styles.publicIcon} />;
        if (entry.hasSrc) return <Code size={16} className={styles.srcIcon} />;
        return <Folder size={16} className={styles.folderIcon} />;
    };

    const renderPath = (fullPath: string) => {
        const parts = fullPath.split(/[\\\/]/).filter(Boolean);
        const lastPart = parts.pop() || '';
        const base = parts.join('/') + (parts.length > 0 ? '/' : '');
        return (
            <span className={styles.itemPath}>
                {base}<strong>{lastPart}</strong>/
            </span>
        );
    };

    const displayEntries = searchResults || entries;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2>Open project</h2>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.content}>
                    <div className={styles.searchContainer}>
                        <div className={styles.searchWrapper}>
                            <Search size={18} className={styles.searchIcon} />
                            <input
                                type="text"
                                placeholder={searchMode === 'local' ? 'Search folders here...' : 'Global search...'}
                                className={styles.searchInput}
                                value={searchQuery}
                                onChange={(e) => handleSearch(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className={styles.searchModeSwitch}>
                            <button 
                                className={searchMode === 'local' ? styles.activeMode : ''} 
                                onClick={() => setSearchMode('local')}
                            >
                                Local
                            </button>
                            <button 
                                className={searchMode === 'global' ? styles.activeMode : ''} 
                                onClick={() => setSearchMode('global')}
                            >
                                Global
                            </button>
                        </div>
                    </div>

                    {!searchQuery && recentProjects.length > 0 && (
                        <div className={styles.section}>
                            <h3 className={styles.sectionTitle}>Recent projects</h3>
                            <div className={styles.list}>
                                {recentProjects.map((p) => (
                                    <div key={p} className={styles.item} onClick={() => handleSelect(p)}>
                                        <div className={styles.itemIcon}><Folder size={16} className={styles.folderIcon} /></div>
                                        {renderPath(p)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>
                            {searchQuery ? (searchMode === 'local' ? 'Search results' : 'Global search results') : 'Open project'}
                        </h3>
                        
                        {loading && <div className={styles.loading}>Searching...</div>}

                        {!loading && !searchQuery && path && (
                            <div className={styles.breadcrumb}>
                                {path.split(/[\\\/]/).filter(Boolean).map((part, i, arr) => (
                                    <div key={i} className={styles.breadcrumbUnit}>
                                        <span 
                                            className={styles.breadcrumbItem} 
                                            onClick={() => navigateTo(arr.slice(0, i + 1).join('/') + '/')}
                                        >
                                            {part}
                                        </span>
                                        {i < arr.length - 1 && <ChevronRight size={14} className={styles.breadcrumbSeparator} />}
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className={styles.list}>
                            {displayEntries.map((entry) => (
                                <div 
                                    key={entry.path} 
                                    className={styles.item} 
                                    onClick={() => navigateTo(entry.path)}
                                    onDoubleClick={() => handleSelect(entry.path)}
                                >
                                    <div className={styles.itemIcon}>{getIcon(entry)}</div>
                                    {renderPath(entry.path)}
                                </div>
                            ))}

                            {globalSearchResults && globalSearchResults.length > 0 && (
                                <>
                                    <div className={styles.divider}><span>Global Search Results</span></div>
                                    {globalSearchResults.map((entry) => (
                                        <div 
                                            key={entry.path} 
                                            className={styles.item} 
                                            onClick={() => navigateTo(entry.path)}
                                            onDoubleClick={() => handleSelect(entry.path)}
                                        >
                                            <div className={styles.itemIcon}>{getIcon(entry)}</div>
                                            {renderPath(entry.path)}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className={styles.footer}>
                    <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
                    <button 
                        className={styles.saveBtn} 
                        onClick={() => handleSelect(path)}
                        disabled={!path}
                    >
                        Select Folder
                    </button>
                </div>
            </div>
        </div>
    );
}
