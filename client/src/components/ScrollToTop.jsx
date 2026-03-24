import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToTop() {
    const location = useLocation();

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const hash = String(location.hash || '').trim();
        if (hash) {
            const targetId = decodeURIComponent(hash.slice(1));
            const target = targetId ? document.getElementById(targetId) : null;
            if (target) {
                target.scrollIntoView({ block: 'start', behavior: 'auto' });
                return;
            }
        }
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, [location.pathname, location.search, location.hash]);

    return null;
}
