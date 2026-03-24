import { useMemo } from 'react';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { buildWhatsAppChatLink } from '../utils/publicContact';

const FloatingWhatsApp = () => {
    const { companyInfo } = usePublicCompanyInfo();
    const message = 'I am interested in your products in your website.';
    const href = useMemo(() => buildWhatsAppChatLink({
        number: companyInfo?.whatsappNumber,
        text: message
    }), [companyInfo?.whatsappNumber]);

    if (!href) return null;

    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="fixed right-6 z-50 p-3 rounded-full bg-[#25D366] text-white shadow-lg transition-all hover:scale-105 hover:bg-[#20BA5A] bottom-24 md:bottom-20"
            aria-label="Chat on WhatsApp"
        >
            <svg viewBox="0 0 32 32" className="w-5 h-5 fill-current" aria-hidden="true">
                <path d="M19.11 17.26c-.27-.13-1.58-.78-1.83-.87-.24-.09-.42-.13-.6.13-.18.27-.69.87-.84 1.05-.16.18-.31.2-.58.07-.27-.13-1.13-.41-2.15-1.31-.79-.7-1.32-1.56-1.48-1.83-.16-.27-.02-.42.11-.55.11-.11.27-.29.4-.44.13-.16.18-.27.27-.44.09-.18.04-.33-.02-.47-.07-.13-.6-1.45-.82-1.98-.22-.53-.44-.45-.6-.45l-.51-.01c-.18 0-.47.07-.71.33-.24.27-.93.91-.93 2.22s.96 2.58 1.09 2.76c.13.18 1.89 2.88 4.58 4.04.64.28 1.14.45 1.53.57.64.2 1.22.17 1.68.1.51-.08 1.58-.64 1.8-1.26.22-.62.22-1.15.16-1.26-.07-.11-.24-.18-.51-.31zM16 2.67c-7.35 0-13.33 5.98-13.33 13.33 0 2.35.62 4.64 1.8 6.66L2.67 29.33l6.83-1.78c1.94 1.06 4.13 1.62 6.5 1.62 7.35 0 13.33-5.98 13.33-13.33S23.35 2.67 16 2.67zm0 24.66c-2.2 0-4.24-.6-5.99-1.65l-.43-.25-4.06 1.06 1.09-3.95-.28-.45A10.94 10.94 0 0 1 5.06 16C5.06 10.11 10.11 5.06 16 5.06S26.94 10.11 26.94 16 21.89 27.33 16 27.33z" />
            </svg>
        </a>
    );
};

export default FloatingWhatsApp;
