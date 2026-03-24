import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CircleHelp, Mail, Phone } from 'lucide-react';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { FAQ_ITEMS } from '../seo/faqContent';
import { buildFaqSeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';

const DEFAULT_COMPANY = {
    displayName: 'SSC Impon Jewellery',
    supportEmail: '',
    contactNumber: ''
};

export default function Faq() {
    const { companyInfo, applyCompanyInfo } = usePublicCompanyInfo();
    const company = useMemo(() => ({ ...DEFAULT_COMPANY, ...(companyInfo || {}) }), [companyInfo]);

    const faqs = useMemo(() => FAQ_ITEMS.map((item) => ({ q: item.question, a: item.answer })), []);
    const seoConfig = useMemo(() => buildFaqSeo({ company }), [company]);
    useSeo(seoConfig);

    useAdminCrudSync({
        'company:info_update': ({ company: nextCompany } = {}) => {
            if (!nextCompany || typeof nextCompany !== 'object') return;
            applyCompanyInfo(nextCompany);
        }
    });

    return (
        <div className="min-h-screen bg-secondary py-10">
            <div className="max-w-5xl mx-auto px-4 md:px-8">
                <div className="mb-4 text-sm text-gray-500">
                    <Link to="/" className="hover:text-primary">Home</Link>
                    <span className="mx-2 text-gray-300">{'>'}</span>
                    <span className="text-gray-700">FAQs</span>
                </div>

                <div className="emboss-card relative overflow-hidden bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm">
                    <CircleHelp size={160} className="bg-emboss-icon absolute top-3 right-3 text-sky-100" strokeWidth={1.4} />
                    <h1 className="text-3xl md:text-4xl font-serif text-primary">Frequently Asked Questions</h1>
                    <div className="mt-6 space-y-4">
                        {faqs.map((item) => (
                            <div key={item.q} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                                <p className="text-sm font-semibold text-gray-900">{item.q}</p>
                                <p className="text-sm text-gray-700 mt-1">{item.a}</p>
                            </div>
                        ))}
                    </div>
                    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-700 flex items-center gap-2">
                            <Mail size={16} className="text-primary" />
                            {company.supportEmail || 'Support email not configured'}
                        </div>
                        <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-700 flex items-center gap-2">
                            <Phone size={16} className="text-primary" />
                            {company.contactNumber || 'Support phone not configured'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
