export const vibrateTap = (pattern = 18) => {
    try {
        if (typeof window === 'undefined') return;
        if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
        const isMobile = window.matchMedia?.('(max-width: 768px)')?.matches;
        if (!isMobile) return;
        navigator.vibrate(pattern);
    } catch {
        // ignore vibration errors
    }
};
