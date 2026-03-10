import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles/global.css';
import { AppProvider, useApp } from './store/AppContext';
import { Sidebar } from './components/Sidebar';
import { BoardView } from './components/BoardView';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import styles from './App.module.css';

function AppShell() {
    const { loadBoards } = useApp();

    useEffect(() => {
        // Apply saved theme
        const saved = localStorage.getItem('theme') ?? 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        // Load boards
        loadBoards();
    }, [loadBoards]);

    return (
        <div className={styles.shell}>
            <Sidebar />
            <main className={styles.main}>
                <header className={styles.topBar}>
                    <div className={styles.spacer} />
                    <ThemeSwitcher />
                </header>
                <div className={styles.content}>
                    <Routes>
                        <Route path="/" element={<BoardView />} />
                        <Route path="/boards/:boardId" element={<BoardView />} />
                        <Route path="/boards/:boardId/tickets/:ticketId" element={<BoardView />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </div>
            </main>
        </div>
    );
}

export default function App() {
    return (
        <AppProvider>
            <BrowserRouter>
                <AppShell />
            </BrowserRouter>
        </AppProvider>
    );
}
