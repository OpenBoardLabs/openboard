import en from './en.json';

type TranslationKey = keyof typeof en;

let currentLocale: Record<string, string> = en;

export function t(key: TranslationKey, placeholders?: Record<string, string>): string {
    let value = currentLocale[key] ?? key;
    if (placeholders) {
        Object.entries(placeholders).forEach(([k, v]) => {
            value = value.replace(`{${k}}`, v);
        });
    }
    return value;
}

// Future: call this to swap locale at runtime
export function setLocale(locale: Record<string, string>): void {
    currentLocale = locale;
}
