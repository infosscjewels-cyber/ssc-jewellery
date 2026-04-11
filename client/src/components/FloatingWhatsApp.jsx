import { useEffect, useMemo, useState } from 'react';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { buildWhatsAppChatLink } from '../utils/publicContact';
import WhatsAppIcon from './WhatsAppIcon';

const BUTTON_SIZE = 44;
const EDGE_GAP = 16;

const getVisualViewportPosition = () => {
    if (typeof window === 'undefined' || !window.visualViewport) return null;

    const { visualViewport } = window;
    const layoutWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    if (!layoutWidth || !visualViewport.width) return null;

    const visibleRight = visualViewport.offsetLeft + visualViewport.width;
    const maxLeft = layoutWidth - BUTTON_SIZE - EDGE_GAP;
    const left = Math.max(EDGE_GAP, Math.min(visibleRight - BUTTON_SIZE - EDGE_GAP, maxLeft));

    return { left: `${Math.round(left)}px`, right: 'auto' };
};

const FloatingWhatsApp = () => {
    const { companyInfo } = usePublicCompanyInfo();
    const [viewportPosition, setViewportPosition] = useState(null);
    const message = 'I am interested in your products in your website.';
    const href = useMemo(() => buildWhatsAppChatLink({
        number: companyInfo?.whatsappNumber,
        text: message
    }), [companyInfo?.whatsappNumber]);

    useEffect(() => {
        const updatePosition = () => setViewportPosition(getVisualViewportPosition());
        updatePosition();

        const { visualViewport } = window;
        window.addEventListener('resize', updatePosition);
        visualViewport?.addEventListener('resize', updatePosition);
        visualViewport?.addEventListener('scroll', updatePosition);

        return () => {
            window.removeEventListener('resize', updatePosition);
            visualViewport?.removeEventListener('resize', updatePosition);
            visualViewport?.removeEventListener('scroll', updatePosition);
        };
    }, []);

    if (!href) return null;

    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="fixed bottom-24 right-4 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-all hover:scale-105 hover:bg-[#20BA5A] sm:right-6 md:bottom-20"
            style={viewportPosition || undefined}
            aria-label="Chat on WhatsApp"
        >
            <WhatsAppIcon size={20} className="h-5 w-5" aria-hidden="true" />
        </a>
    );
};

export default FloatingWhatsApp;
