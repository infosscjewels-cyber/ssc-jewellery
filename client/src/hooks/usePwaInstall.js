import { useCallback, useEffect, useMemo, useState } from 'react';

const isStandaloneMode = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
};

const isIosSafari = () => {
    if (typeof navigator === 'undefined') return false;
    const ua = String(navigator.userAgent || '').toLowerCase();
    return /iphone|ipad|ipod/.test(ua) && ua.includes('safari') && !ua.includes('crios') && !ua.includes('fxios');
};

export function usePwaInstall() {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [isInstalled, setIsInstalled] = useState(isStandaloneMode());
    const [isPrompting, setIsPrompting] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const handleBeforeInstallPrompt = (event) => {
            event.preventDefault();
            setDeferredPrompt(event);
        };
        const handleAppInstalled = () => {
            setIsInstalled(true);
            setDeferredPrompt(null);
        };
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const showIosHint = useMemo(() => isIosSafari() && !isInstalled, [isInstalled]);
    const canInstall = useMemo(() => {
        if (isInstalled) return false;
        if (showIosHint) return true;
        return true;
    }, [isInstalled, showIosHint]);
    const isInstallReady = Boolean(deferredPrompt) || showIosHint;

    const install = useCallback(async () => {
        if (showIosHint && !deferredPrompt) return;
        if (!deferredPrompt) return false;
        setIsPrompting(true);
        try {
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            return true;
        } finally {
            setDeferredPrompt(null);
            setIsPrompting(false);
        }
    }, [deferredPrompt, showIosHint]);

    return {
        canInstall,
        install,
        isInstalled,
        isPrompting,
        showIosHint,
        isInstallReady
    };
}
