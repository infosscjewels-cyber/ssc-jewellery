import { useMemo } from 'react';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { buildAssignedWhatsAppLink } from '../utils/whatsappRouter';
import WhatsAppIcon from './WhatsAppIcon';

const FloatingWhatsApp = () => {
    const { companyInfo } = usePublicCompanyInfo();
    const message = 'I am interested in your products in your website.';
    const href = useMemo(() => buildAssignedWhatsAppLink({
        companyInfo,
        text: message
    }), [companyInfo]);

    if (!href) return null;

    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="fixed bottom-24 right-4 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-all hover:scale-105 hover:bg-[#20BA5A] sm:right-6 md:bottom-20"
            style={{
                right: 'max(1rem, calc(env(safe-area-inset-right, 0px) + 1rem))',
                bottom: 'max(6rem, calc(env(safe-area-inset-bottom, 0px) + 6rem))'
            }}
            aria-label="Chat on WhatsApp"
        >
            <WhatsAppIcon size={20} className="h-5 w-5" aria-hidden="true" />
        </a>
    );
};

export default FloatingWhatsApp;
