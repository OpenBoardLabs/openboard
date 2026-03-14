import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './TicketCard.module.css';

interface DropdownPortalProps {
    isOpen: boolean;
    onClose: () => void;
    triggerRef: React.RefObject<HTMLElement>;
    children: React.ReactNode;
}

export function DropdownPortal({ isOpen, onClose, triggerRef, children }: DropdownPortalProps) {
    const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const dropdownHeight = 150;
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            
            const showAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
            
            setCoords({
                top: showAbove 
                    ? rect.top + window.scrollY - dropdownHeight - 4
                    : rect.bottom + window.scrollY,
                left: rect.left + window.scrollX,
                width: rect.width
            });
        }
    }, [isOpen, triggerRef]);

    useEffect(() => {
        if (!isOpen) return;

        function handleScroll() {
            if (triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                const dropdownHeight = 150;
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                
                const showAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
                
                setCoords({
                    top: showAbove 
                        ? rect.top + window.scrollY - dropdownHeight - 4
                        : rect.bottom + window.scrollY,
                    left: rect.left + window.scrollX,
                    width: rect.width
                });
            }
        }

        function handleClickOutside(event: MouseEvent) {
            if (
                dropdownRef.current && 
                !dropdownRef.current.contains(event.target as Node) &&
                triggerRef.current &&
                !triggerRef.current.contains(event.target as Node)
            ) {
                onClose();
            }
        }

        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', handleScroll);
        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', handleScroll);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose, triggerRef]);

    if (!isOpen) return null;

    return createPortal(
        <div
            ref={dropdownRef}
            className={styles.dropdownMenu}
            style={{
                position: 'absolute',
                top: `${coords.top + 4}px`,
                right: 'auto',
                left: `${coords.left + coords.width - 160}px`, // Align right edge with trigger right edge
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {children}
        </div>,
        document.body
    );
}
