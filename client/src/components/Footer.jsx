import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Instagram, Youtube, Facebook, Mail, MapPin, MessageCircle, Home, Store, Info, PhoneCall, HelpCircle, User, Package, LogIn, FileText, ShieldCheck, Truck, RefreshCw, Copyright, Search as SearchIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCategories, usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { BRAND_LOGO_URL } from '../utils/branding.js';
import { isCategoryVisibleInStorefront } from '../utils/categoryVisibility';

export default function Footer() {
    const { user } = useAuth();
    const { categories, refreshCategories } = usePublicCategories();
    const { companyInfo, refreshCompanyInfo, applyCompanyInfo } = usePublicCompanyInfo();
    const company = {
        displayName: 'SSC Jewellery',
        contactNumber: '',
        supportEmail: '',
        address: '',
        instagramUrl: '',
        youtubeUrl: '',
        facebookUrl: '',
        whatsappNumber: '',
        gstNumber: '',
        taxEnabled: false,
        ...(companyInfo || {})
    };

    useEffect(() => {
        refreshCategories().catch(() => {});
        refreshCompanyInfo().catch(() => {});
    }, [refreshCategories, refreshCompanyInfo]);

    useAdminCrudSync({
        'refresh:categories': () => refreshCategories(true).catch(() => {}),
        'product:category_change': () => refreshCategories(true).catch(() => {}),
        'product:create': () => refreshCategories(true).catch(() => {}),
        'product:update': () => refreshCategories(true).catch(() => {}),
        'product:delete': () => refreshCategories(true).catch(() => {}),
        'company:info_update': ({ company: nextCompany } = {}) => {
            if (nextCompany && typeof nextCompany === 'object') {
                applyCompanyInfo(nextCompany);
            } else {
                refreshCompanyInfo(true).catch(() => {});
            }
        }
    });

    const categoryLinks = [...categories]
        .filter((c) => isCategoryVisibleInStorefront(c))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const categoryColumns = useMemo(() => {
        const chunkSize = 10;
        const columns = [];
        for (let i = 0; i < categoryLinks.length; i += chunkSize) {
            columns.push(categoryLinks.slice(i, i + chunkSize));
        }
        return columns;
    }, [categoryLinks]);
    const whatsappLink = company.whatsappNumber
        ? `https://wa.me/${String(company.whatsappNumber).replace(/\D/g, '')}`
        : '';
    const footerWhatsappNumbers = [
        String(company.contactNumber || '').trim(),
        '83001 28100'
    ].filter(Boolean);
    const hasSocial = Boolean(company.instagramUrl || company.youtubeUrl || company.facebookUrl || whatsappLink);

    return (
        <footer className="bg-primary text-white mt-0">
            <div className="container mx-auto px-4 py-12">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
                    <div className="space-y-4">
                        <img src={BRAND_LOGO_URL} alt="SSC Jewellery" className="h-14 w-auto" loading="lazy" decoding="async" fetchPriority="low" />
                        <p className="text-sm text-white/70">
                            Premium Impon jewellery crafted with care. Discover timeless designs and elegant collections.
                        </p>
                        {hasSocial && (
                            <div className="flex items-center gap-3">
                                {company.instagramUrl && (
                                    <a href={company.instagramUrl} target="_blank" rel="noreferrer" className="p-2 rounded-full bg-white/10 text-white/60 hover:text-[#E1306C] hover:bg-white/20 transition-colors">
                                        <Instagram size={18} />
                                    </a>
                                )}
                                {company.youtubeUrl && (
                                    <a href={company.youtubeUrl} target="_blank" rel="noreferrer" className="p-2 rounded-full bg-white/10 text-white/60 hover:text-[#FF0000] hover:bg-white/20 transition-colors">
                                        <Youtube size={18} />
                                    </a>
                                )}
                                {company.facebookUrl && (
                                    <a href={company.facebookUrl} target="_blank" rel="noreferrer" className="p-2 rounded-full bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
                                        <Facebook size={18} />
                                    </a>
                                )}
                                {whatsappLink && (
                                    <a href={whatsappLink} target="_blank" rel="noreferrer" className="p-2 rounded-full bg-white/10 text-white/60 hover:text-[#25D366] hover:bg-white/20 transition-colors">
                                        <MessageCircle size={18} />
                                    </a>
                                )}
                            </div>
                        )}
                    </div>

                    <div>
                        <h4 className="text-sm font-bold uppercase tracking-widest text-white/70 mb-2 inline-block border-b-2 border-accent pb-1">Categories</h4>
                        <div
                            className="grid gap-x-6 gap-y-2"
                            style={{ gridTemplateColumns: `repeat(${Math.max(1, categoryColumns.length)}, minmax(0, 1fr))` }}
                        >
                            {categoryColumns.map((column, columnIndex) => (
                                <div key={`category-column-${columnIndex}`} className="space-y-2">
                                    {column.map((cat) => (
                                        <Link key={cat.id || cat.name} to={`/shop/${encodeURIComponent(cat.name)}`} className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors">
                                            <SearchIcon size={14} className="text-white/40" />
                                            {cat.name}
                                        </Link>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-sm font-bold uppercase tracking-widest text-white/70 mb-2 inline-block border-b-2 border-accent pb-1">Shop</h4>
                        <div className="space-y-2">
                            <Link to="/" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><Home size={14} className="text-white/40" />Home</Link>
                            <Link to="/shop" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><Store size={14} className="text-white/40" />Shop</Link>
                            <Link to="/about" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><Info size={14} className="text-white/40" />About</Link>
                            <Link to="/contact" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><PhoneCall size={14} className="text-white/40" />Contact</Link>
                            <Link to="/faq" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><HelpCircle size={14} className="text-white/40" />FAQs</Link>
                            <Link to="/sitemap" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><SearchIcon size={14} className="text-white/40" />Sitemap</Link>
                            <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><FileText size={14} className="text-white/40" />XML Sitemap</a>
                        </div>
                    </div>

                    <div>
                        <h4 className="text-sm font-bold uppercase tracking-widest text-white/70 mb-2 inline-block border-b-2 border-accent pb-1">Account</h4>
                        <div className="space-y-2">
                            {user ? (
                                <>
                                    <Link to="/profile" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><User size={14} className="text-white/40" />My Profile</Link>
                                    <Link to="/orders" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><Package size={14} className="text-white/40" />My Orders</Link>
                                    <Link to="/track-order" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><Package size={14} className="text-white/40" />Track Order</Link>
                                </>
                            ) : (
                                <>
                                    <Link to="/login" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><LogIn size={14} className="text-white/40" />Login</Link>
                                    <Link to="/register" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><User size={14} className="text-white/40" />Create Account</Link>
                                </>
                            )}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-sm font-bold uppercase tracking-widest text-white/70 mb-2 inline-block border-b-2 border-accent pb-1">Policies</h4>
                        <div className="space-y-2">
                            <Link to="/terms" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><FileText size={14} className="text-white/40" />Terms & Conditions</Link>
                            <Link to="/privacy" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><ShieldCheck size={14} className="text-white/40" />Privacy Policy</Link>
                            <Link to="/refund" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><RefreshCw size={14} className="text-white/40" />Refund Policy</Link>
                            <Link to="/shipping" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><Truck size={14} className="text-white/40" />Shipping Policy</Link>
                            <Link to="/copyright" className="flex items-center gap-2 text-sm text-white/80 hover:text-accent transition-colors"><Copyright size={14} className="text-white/40" />Copyright & Legal</Link>
                        </div>
                    </div>
                </div>

                <div className="mt-10 border-t border-white/10 pt-8 grid grid-cols-1 md:grid-cols-4 gap-6 text-sm text-white/70">
                    <div className="flex items-start gap-2">
                        <MapPin size={16} className="text-accent mt-0.5" />
                        <span>Registered Address: {company.address || 'Address not set'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Mail size={16} className="text-accent" />
                        {company.supportEmail ? (
                            <a href={`mailto:${company.supportEmail}`} className="text-white/60 hover:text-accent">{company.supportEmail}</a>
                        ) : (
                            <span className="text-white/40">Email not set</span>
                        )}
                    </div>
                    <div className="flex items-start gap-2">
                        <MessageCircle size={16} className="text-[#25D366] mt-0.5" />
                        {footerWhatsappNumbers.length ? (
                            <div className="flex flex-col">
                                {footerWhatsappNumbers.map((number) => (
                                    <a
                                        key={number}
                                        href={`https://wa.me/${String(number).replace(/\D/g, '')}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-white/60 hover:text-[#25D366]"
                                    >
                                        {number}
                                    </a>
                                ))}
                            </div>
                        ) : (
                            <span className="text-white/40">WhatsApp not set</span>
                        )}
                    </div>
                    {Boolean(String(company.gstNumber || '').trim()) && (
                        <div className="flex items-center gap-2">
                            <FileText size={16} className="text-accent" />
                            <span className="text-white/60">
                                GSTIN: <span className="font-semibold text-white/80">{String(company.gstNumber || '').trim()}</span>
                            </span>
                        </div>
                    )}
                </div>
            </div>
            <div className="bg-black/30 text-center text-xs text-white/60 py-4">
                © {new Date().getFullYear()} {company.displayName || 'SSC Jewellery'}. All rights reserved.
            </div>
        </footer>
    );
}
