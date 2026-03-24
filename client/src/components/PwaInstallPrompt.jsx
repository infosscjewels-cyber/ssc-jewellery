import { useEffect, useMemo, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';

const DISMISS_KEY = 'pwa_install_dismissed_v1';

const isStandaloneMode = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
};

export default function PwaInstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [dismissed, setDismissed] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(DISMISS_KEY) === '1';
    });
    const [isInstalled, setIsInstalled] = useState(isStandaloneMode());
    const [isPrompting, setIsPrompting] = useState(false);

    const isIos = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        const ua = String(navigator.userAgent || '').toLowerCase();
        return /iphone|ipad|ipod/.test(ua);
    }, []);
    const isSafari = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        const ua = String(navigator.userAgent || '').toLowerCase();
        return ua.includes('safari') && !ua.includes('crios') && !ua.includes('fxios');
    }, []);
    const canShowIosHint = isIos && isSafari && !isInstalled;
    const canShowPrompt = Boolean(deferredPrompt) || canShowIosHint;

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const handleBeforeInstallPrompt = (event) => {
            if (dismissed || isInstalled) {
                setDeferredPrompt(null);
                return;
            }
            event.preventDefault();
            setDeferredPrompt(event);
        };
        const handleAppInstalled = () => {
            setIsInstalled(true);
            setDeferredPrompt(null);
            localStorage.removeItem(DISMISS_KEY);
            setDismissed(false);
        };
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, [dismissed, isInstalled]);

    const dismiss = () => {
        localStorage.setItem(DISMISS_KEY, '1');
        setDismissed(true);
    };

    const install = async () => {
        if (!deferredPrompt) return;
        setIsPrompting(true);
        try {
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
        } finally {
            setDeferredPrompt(null);
            setIsPrompting(false);
        }
    };

    if (dismissed || isInstalled || !canShowPrompt) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[70] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-gray-200 bg-white/95 backdrop-blur p-4 shadow-xl">
            <button
                type="button"
                onClick={dismiss}
                className="absolute right-2 top-2 p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Dismiss install prompt"
            >
                <X size={14} />
            </button>
            <div className="flex items-start gap-3 pr-6">
                <div className="mt-0.5 rounded-xl bg-primary/10 text-primary p-2">
                    <Smartphone size={16} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">Install SSC Web App</p>
                    <p className="text-xs text-gray-500 mt-1">
                        {deferredPrompt
                            ? 'Install this app for faster access and a full-screen experience.'
                            : 'Use Share menu and tap "Add to Home Screen" to install this app.'}
                    </p>
                    {deferredPrompt && (
                        <button
                            type="button"
                            onClick={install}
                            disabled={isPrompting}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-60"
                        >
                            <Download size={13} />
                            {isPrompting ? 'Preparing...' : 'Install App'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
