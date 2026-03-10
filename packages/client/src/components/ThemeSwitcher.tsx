import { useEffect, useState } from 'react';
import { t } from '../i18n/i18n';
import styles from './ThemeSwitcher.module.css';
import { Sun, Moon } from 'lucide-react';

type Theme = 'dark' | 'light';

export function ThemeSwitcher() {
    const [theme, setTheme] = useState<Theme>(() => {
        return (localStorage.getItem('theme') as Theme) ?? 'dark';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    function toggle() {
        setTheme(t => t === 'dark' ? 'light' : 'dark');
    }

    return (
        <button className={styles.switcher} onClick={toggle} title={t(theme === 'dark' ? 'theme.light' : 'theme.dark')}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span>{t(theme === 'dark' ? 'theme.light' : 'theme.dark')}</span>
        </button>
    );
}
