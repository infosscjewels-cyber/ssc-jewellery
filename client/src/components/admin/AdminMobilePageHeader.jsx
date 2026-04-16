import { useEffect, useState } from 'react';
import { ArrowLeft, LogOut } from 'lucide-react';

export default function AdminMobilePageHeader({
    title = '',
    storefrontOpen = true,
    onBack = () => {},
    onLogout = () => {},
    showBack = true
}) {
    const [isScrolled, setIsScrolled] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const updateScrolled = () => {
            setIsScrolled(window.scrollY > 16);
        };
        updateScrolled();
        window.addEventListener('scroll', updateScrolled, { passive: true });
        return () => window.removeEventListener('scroll', updateScrolled);
    }, []);

    return (
        <div className="fixed inset-x-0 top-0 z-40 px-4 py-3 bg-white/68 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 md:hidden">
            <div className="grid grid-cols-[40px_minmax(0,1fr)_40px] items-start gap-3">
                <div className="flex justify-start">
                    {showBack ? (
                        <button
                            type="button"
                            onClick={onBack}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
                                isScrolled
                                    ? 'border-slate-900/70 bg-slate-950/85 text-white backdrop-blur-md'
                                    : 'border-white/70 bg-white/85 text-slate-800 shadow-sm'
                            }`}
                            aria-label="Go back"
                        >
                            <ArrowLeft size={18} />
                        </button>
                    ) : (
                        <div className="h-10 w-10" aria-hidden="true" />
                    )}
                </div>

                <div className="min-w-0 text-center">
                    <h1 className="m-0 truncate text-base font-semibold leading-tight text-gray-900">{title}</h1>
                    <div className="mt-1.5 flex justify-center">
                        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold ${
                            storefrontOpen
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : 'border-gray-300 bg-gray-100 text-gray-800'
                        }`}>
                            <span className={`h-2 w-2 rounded-full ${storefrontOpen ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                            {storefrontOpen ? 'Store Open' : 'Store Closed'}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={onLogout}
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
                            isScrolled
                                ? 'border-slate-900/70 bg-slate-950/85 text-white backdrop-blur-md'
                                : 'border-white/70 bg-white/85 text-slate-700 shadow-sm'
                        }`}
                        aria-label="Logout"
                    >
                        <LogOut size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
}
