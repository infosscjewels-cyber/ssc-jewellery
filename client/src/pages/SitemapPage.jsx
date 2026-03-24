import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, FileText, Gem, HelpCircle, Info, Mail, Map, ShieldCheck, Store, Truck } from 'lucide-react';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCategories, usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { buildSitemapPageSeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';

const DEFAULT_COMPANY = {
    displayName: 'SSC Jewellery'
};

const ICONS = {
    shop: Store,
    about: Info,
    contact: Mail,
    faq: HelpCircle,
    terms: FileText,
    privacy: ShieldCheck,
    refund: BookOpen,
    shipping: Truck,
    copyright: FileText,
    category: Gem,
    sitemap: Map
};

const STATIC_SECTIONS = [
    { name: 'Shop', url: '/shop', key: 'shop' },
    { name: 'About', url: '/about', key: 'about' },
    { name: 'Contact', url: '/contact', key: 'contact' },
    { name: 'FAQs', url: '/faq', key: 'faq' },
    { name: 'Terms & Conditions', url: '/terms', key: 'terms' },
    { name: 'Privacy Policy', url: '/privacy', key: 'privacy' },
    { name: 'Refund Policy', url: '/refund', key: 'refund' },
    { name: 'Shipping Policy', url: '/shipping', key: 'shipping' },
    { name: 'Copyright & Legal', url: '/copyright', key: 'copyright' },
    { name: 'XML Sitemap', url: '/sitemap.xml', key: 'sitemap', external: true }
];

export default function SitemapPage() {
    const { categories, refreshCategories } = usePublicCategories();
    const { companyInfo, refreshCompanyInfo, applyCompanyInfo } = usePublicCompanyInfo();
    const company = useMemo(() => ({ ...DEFAULT_COMPANY, ...(companyInfo || {}) }), [companyInfo]);

    useEffect(() => {
        refreshCategories(true).catch(() => {});
        refreshCompanyInfo().catch(() => {});
    }, [refreshCategories, refreshCompanyInfo]);

    useAdminCrudSync({
        'refresh:categories': () => refreshCategories(true).catch(() => {}),
        'product:category_change': () => refreshCategories(true).catch(() => {}),
        'company:info_update': ({ company: nextCompany } = {}) => {
            if (!nextCompany || typeof nextCompany !== 'object') return;
            applyCompanyInfo(nextCompany);
        }
    });

    const categoryLinks = useMemo(() => (
        (Array.isArray(categories) ? categories : []).map((category) => ({
            name: category.name,
            url: `/shop/${encodeURIComponent(category.name)}`,
            key: 'category'
        }))
    ), [categories]);

    const seoConfig = useMemo(
        () => buildSitemapPageSeo({ company, links: [...STATIC_SECTIONS, ...categoryLinks] }),
        [company, categoryLinks]
    );
    useSeo(seoConfig);

    return (
        <div className="min-h-screen bg-secondary py-10">
            <div className="mx-auto max-w-6xl px-4 md:px-8">
                <div className="mb-4 text-sm text-gray-500">
                    <Link to="/" className="hover:text-primary">Home</Link>
                    <span className="mx-2 text-gray-300">{'>'}</span>
                    <span className="text-gray-700">Sitemap</span>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-400">Sitemap</p>
                    <h1 className="mt-3 text-3xl font-serif text-primary md:text-4xl">Browse The Site</h1>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-600">
                        Quick access to key pages, policies, collections, and category landing pages for {company.displayName || DEFAULT_COMPANY.displayName}.
                    </p>

                    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr,1.35fr]">
                        <section className="rounded-2xl border border-gray-100 bg-stone-50 p-5">
                            <h2 className="text-lg font-semibold text-gray-900">Main Pages</h2>
                            <div className="mt-4 space-y-3">
                                {STATIC_SECTIONS.map((item) => {
                                    const Icon = ICONS[item.key] || FileText;
                                    const content = (
                                        <>
                                            <span className="rounded-xl bg-white p-2 shadow-sm">
                                                <Icon size={16} className="text-primary" />
                                            </span>
                                            <span className="text-sm font-medium text-gray-800">{item.name}</span>
                                        </>
                                    );
                                    return item.external ? (
                                        <a key={item.url} href={item.url} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 hover:border-primary/30 hover:shadow-sm">
                                            {content}
                                        </a>
                                    ) : (
                                        <Link key={item.url} to={item.url} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 hover:border-primary/30 hover:shadow-sm">
                                            {content}
                                        </Link>
                                    );
                                })}
                            </div>
                        </section>

                        <section className="rounded-2xl border border-gray-100 bg-white p-5">
                            <h2 className="text-lg font-semibold text-gray-900">Collections & Categories</h2>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                {categoryLinks.map((item) => (
                                    <Link
                                        key={item.url}
                                        to={item.url}
                                        className="flex items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3 hover:border-primary/30 hover:bg-stone-50"
                                    >
                                        <span className="rounded-xl bg-stone-100 p-2">
                                            <Gem size={16} className="text-primary" />
                                        </span>
                                        <span className="text-sm font-medium text-gray-800">{item.name}</span>
                                    </Link>
                                ))}
                                {categoryLinks.length === 0 && (
                                    <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
                                        Category links will appear here once storefront categories are available.
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
