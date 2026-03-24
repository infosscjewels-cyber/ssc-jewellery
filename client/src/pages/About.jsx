import { useEffect, useMemo } from 'react';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { Link } from 'react-router-dom';
import { Gem, Sparkles } from 'lucide-react';
import { buildAboutSeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';
import { BRAND_LOGO_URL } from '../utils/branding.js';

const DEFAULT_COMPANY = {
    displayName: 'SSC Impon Jewellery',
    address: '',
    supportEmail: '',
    contactNumber: '',
    whatsappNumber: ''
};

const resolveCompanyAddress = (company = {}) => {
    const direct = String(company.address || '').trim();
    if (direct) return direct;
    const composed = [
        company.addressLine1,
        company.addressLine2,
        company.city,
        company.state,
        company.zip || company.pincode
    ]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(', ');
    return composed;
};

export default function About() {
    const { companyInfo, refreshCompanyInfo, applyCompanyInfo: patchPublicCompanyInfo } = usePublicCompanyInfo();
    const company = useMemo(() => ({
        ...DEFAULT_COMPANY,
        ...(companyInfo || {}),
        address: resolveCompanyAddress(companyInfo || {}) || DEFAULT_COMPANY.address
    }), [companyInfo]);
    const seoConfig = useMemo(() => buildAboutSeo({ company }), [company]);
    useSeo(seoConfig);

    useEffect(() => {
        if (companyInfo) return;
        refreshCompanyInfo().catch(() => {});
    }, [companyInfo, refreshCompanyInfo]);

    useAdminCrudSync({
        'company:info_update': ({ company: nextCompany } = {}) => {
            if (!nextCompany || typeof nextCompany !== 'object') return;
            patchPublicCompanyInfo(nextCompany);
        }
    });

    return (
        <div className="min-h-screen bg-secondary py-10">
            <div className="max-w-5xl mx-auto px-4 md:px-8">
                <div className="mb-4 text-sm text-gray-500">
                    <Link to="/" className="hover:text-primary">Home</Link>
                    <span className="mx-2 text-gray-300">{'>'}</span>
                    <span className="text-gray-700">About</span>
                </div>

                <div className="emboss-card relative overflow-hidden bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm">
                    <Gem size={160} className="bg-emboss-icon absolute top-3 right-3 text-amber-100" strokeWidth={1.4} />
                    <div className="flex justify-center mb-6">
                        <img
                            src={BRAND_LOGO_URL}
                            alt={`${company.displayName || 'SSC Impon Jewellery'} logo`}
                            className="w-52 md:w-64 lg:w-80 h-auto object-contain"
                        />
                    </div>
                    <h1 className="text-3xl md:text-4xl font-serif text-primary">About {company.displayName || 'SSC Impon Jewellery'}</h1>
                    <p className="mt-3 text-sm text-gray-600 leading-relaxed">
                        {company.displayName || 'SSC Impon Jewellery'} is focused on artificial and fashion jewellery designed for everyday elegance and festive occasions.
                        Our collections are curated for style, comfort, and affordability while maintaining quality standards in finishing.
                    </p>
                    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                            <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Our Promise</p>
                            <p className="text-sm text-gray-700 mt-2">Transparent policies, support-first communication, and responsible order processing.</p>
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                            <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Customer Care</p>
                            <p className="text-sm text-gray-700 mt-2">For order and product queries, contact us via email, phone, or WhatsApp from the contact page.</p>
                        </div>
                    </div>
                    <div className="mt-6 rounded-xl border border-amber-100 bg-amber-50 p-4">
                        <p className="text-sm text-amber-800 flex items-center gap-2">
                            <Sparkles size={16} />
                            Registered Address: {resolveCompanyAddress(company) || 'Address not set'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
