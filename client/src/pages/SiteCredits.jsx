import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Code2, Globe, Instagram } from 'lucide-react';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { buildCreditsSeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';

const DEFAULT_COMPANY = {
    displayName: 'SSC Jewellery'
};

const DEVELOPER = {
    name: 'Creativecodz',
    website: 'https://creativecodz.com/',
    instagram: 'https://www.instagram.com/creativecodz'
};

export default function SiteCredits() {
    const { companyInfo, refreshCompanyInfo, applyCompanyInfo } = usePublicCompanyInfo();
    const company = useMemo(() => ({
        ...DEFAULT_COMPANY,
        ...(companyInfo || {})
    }), [companyInfo]);
    const seoConfig = useMemo(() => buildCreditsSeo({ company }), [company]);
    useSeo(seoConfig);

    useEffect(() => {
        if (companyInfo) return;
        refreshCompanyInfo().catch(() => {});
    }, [companyInfo, refreshCompanyInfo]);

    useAdminCrudSync({
        'company:info_update': ({ company: nextCompany } = {}) => {
            if (!nextCompany || typeof nextCompany !== 'object') return;
            applyCompanyInfo(nextCompany);
        }
    });

    return (
        <div className="min-h-screen bg-secondary py-10">
            <div className="mx-auto max-w-3xl px-4 md:px-8">
                <div className="mb-4 text-sm text-gray-500">
                    <Link to="/" className="hover:text-primary">Home</Link>
                    <span className="mx-2 text-gray-300">{'>'}</span>
                    <span className="text-gray-700">Site Credits</span>
                </div>

                <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-100 bg-gradient-to-r from-stone-50 via-white to-amber-50 px-6 py-8 md:px-8">
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-400">Site Credits</p>
                        <h1 className="mt-3 text-3xl font-serif text-primary md:text-4xl">Development Credits</h1>
                        <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-600">
                            This page records the web design and development attribution for {company.displayName || DEFAULT_COMPANY.displayName}.
                        </p>
                    </div>

                    <div className="space-y-4 px-6 py-8 md:px-8">
                        <div className="rounded-2xl border border-gray-100 bg-stone-50 p-5">
                            <div className="flex items-start gap-3">
                                <div className="rounded-2xl bg-white p-3 shadow-sm">
                                    <Code2 size={20} className="text-primary" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-400">Development Partner</p>
                                    <h2 className="mt-2 text-2xl font-semibold text-gray-900">{DEVELOPER.name}</h2>
                                    <p className="mt-2 text-sm leading-7 text-gray-600">
                                        Creativecodz contributed website development and implementation support for this storefront.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <a
                                href={DEVELOPER.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-primary/30 hover:shadow-sm"
                            >
                                <div className="flex items-center gap-3">
                                    <Globe size={18} className="text-primary" />
                                    <span className="text-sm font-semibold text-gray-900">Website</span>
                                </div>
                                <p className="mt-3 text-sm text-gray-600">{DEVELOPER.website}</p>
                            </a>

                            <a
                                href={DEVELOPER.instagram}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-primary/30 hover:shadow-sm"
                            >
                                <div className="flex items-center gap-3">
                                    <Instagram size={18} className="text-primary" />
                                    <span className="text-sm font-semibold text-gray-900">Instagram</span>
                                </div>
                                <p className="mt-3 text-sm text-gray-600">@creativecodz</p>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
