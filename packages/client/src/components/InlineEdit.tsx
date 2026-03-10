import React, { useRef, useEffect } from 'react';

interface InlineEditProps {
    defaultValue: string;
    placeholder?: string;
    onSave: (value: string) => void;
    onCancel: () => void;
    autoFocus?: boolean;
    className?: string;
}

export function InlineEdit({ defaultValue, placeholder, onSave, onCancel, autoFocus = true, className }: InlineEditProps) {
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus) ref.current?.focus();
        ref.current?.select();
    }, [autoFocus]);

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') { e.preventDefault(); onSave(ref.current?.value ?? ''); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    }

    return (
        <input
            ref={ref}
            className={className}
            defaultValue={defaultValue}
            placeholder={placeholder}
            onKeyDown={handleKeyDown}
            onBlur={() => onSave(ref.current?.value ?? '')}
        />
    );
}
