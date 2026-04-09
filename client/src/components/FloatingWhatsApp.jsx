import { useMemo } from 'react';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { buildWhatsAppChatLink } from '../utils/publicContact';
import WhatsAppIcon from './WhatsAppIcon';

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
            className="fixed right-6 z-50 p-3 rounded-full bg-[#25D366] text-white shadow-lg transition-all hover:scale-105 hover:bg-[#20BA5A] bottom-28 md:bottom-20"
            aria-label="Chat on WhatsApp"
        >
            <WhatsAppIcon size={20} className="h-5 w-5" aria-hidden="true" />
        </a>
    );
};

export default FloatingWhatsApp;
