import { useEffect, useMemo, useRef, useState } from 'react';

const AFFORDABILITY_SCRIPT_ID = 'razorpay-affordability-js';
const AFFORDABILITY_SCRIPT_SRC = 'https://cdn.razorpay.com/widgets/affordability/affordability.js';
const DEFAULT_MIN_ELIGIBLE_RUPEES = 3000;
const DEFAULT_STARTING_TENURE_MONTHS = 12;
const CMS_API_URL = import.meta.env.PROD
    ? '/api/cms'
    : 'http://localhost:5000/api/cms';

let affordabilityScriptPromise = null;

const ensureAffordabilityScript = () => {
    if (typeof window === 'undefined') return Promise.resolve(false);
    if (window.RazorpayAffordabilitySuite) return Promise.resolve(true);
    if (affordabilityScriptPromise) return affordabilityScriptPromise;

    const existing = document.getElementById(AFFORDABILITY_SCRIPT_ID);
    if (existing) {
        affordabilityScriptPromise = new Promise((resolve) => {
            existing.addEventListener('load', () => resolve(true), { once: true });
            existing.addEventListener('error', () => resolve(false), { once: true });
        });
        return affordabilityScriptPromise;
    }

    affordabilityScriptPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.id = AFFORDABILITY_SCRIPT_ID;
        script.src = AFFORDABILITY_SCRIPT_SRC;
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });

    return affordabilityScriptPromise;
};

const asPositiveNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default function RazorpayAffordability({
    amountRupees = 0,
    className = '',
    showWidget = true
}) {
    const widgetContainerRef = useRef(null);
    const [widgetReady, setWidgetReady] = useState(false);
    const [razorpayConfig, setRazorpayConfig] = useState({
        keyId: String(import.meta.env.VITE_RAZORPAY_KEY_ID || '').trim(),
        minEligibleRupees: asPositiveNumber(import.meta.env.VITE_RAZORPAY_EMI_MIN_AMOUNT, DEFAULT_MIN_ELIGIBLE_RUPEES),
        startingTenureMonths: asPositiveNumber(import.meta.env.VITE_RAZORPAY_STARTING_TENURE_MONTHS, DEFAULT_STARTING_TENURE_MONTHS)
    });

    useEffect(() => {
        let cancelled = false;
        fetch(`${CMS_API_URL}/company-info`)
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.message || 'Failed to load Razorpay settings');
                return data;
            })
            .then((data) => {
                if (cancelled) return;
                const company = data?.company || {};
                setRazorpayConfig((prev) => ({
                    keyId: String(company.razorpayKeyId || prev.keyId || '').trim(),
                    minEligibleRupees: asPositiveNumber(company.razorpayEmiMinAmount, prev.minEligibleRupees || DEFAULT_MIN_ELIGIBLE_RUPEES),
                    startingTenureMonths: asPositiveNumber(company.razorpayStartingTenureMonths, prev.startingTenureMonths || DEFAULT_STARTING_TENURE_MONTHS)
                }));
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const keyId = useMemo(() => String(razorpayConfig.keyId || '').trim(), [razorpayConfig.keyId]);
    const minEligibleRupees = useMemo(
        () => asPositiveNumber(razorpayConfig.minEligibleRupees, DEFAULT_MIN_ELIGIBLE_RUPEES),
        [razorpayConfig.minEligibleRupees]
    );
    const startingTenureMonths = useMemo(
        () => asPositiveNumber(razorpayConfig.startingTenureMonths, DEFAULT_STARTING_TENURE_MONTHS),
        [razorpayConfig.startingTenureMonths]
    );

    const amount = Math.max(0, Number(amountRupees || 0));
    const amountSubunits = Math.round(amount * 100);
    const eligible = Boolean(keyId) && amount >= minEligibleRupees;
    const emiStartingFrom = eligible
        ? Math.ceil(amount / startingTenureMonths)
        : 0;

    useEffect(() => {
        let cancelled = false;
        if (!showWidget || !eligible || !widgetContainerRef.current) return undefined;

        ensureAffordabilityScript().then((ok) => {
            if (!ok || cancelled || !widgetContainerRef.current || !window.RazorpayAffordabilitySuite) return;
            try {
                widgetContainerRef.current.innerHTML = '';
                const suite = new window.RazorpayAffordabilitySuite({
                    key: keyId,
                    amount: amountSubunits
                });
                suite.render();
                if (!cancelled) setWidgetReady(true);
            } catch {
                if (!cancelled) setWidgetReady(false);
            }
        }).catch(() => {
            if (!cancelled) setWidgetReady(false);
        });

        return () => {
            cancelled = true;
        };
    }, [showWidget, eligible, keyId, amountSubunits]);

    if (!eligible) return null;

    return (
        <div className={`rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 ${className}`}>
            <p className="text-sm font-semibold text-emerald-800">
                EMI options available starting from Rs. {emiStartingFrom.toLocaleString('en-IN')}/month
            </p>
            <p className="text-[11px] text-emerald-700/80 mt-1">
                Available payment plans will be shown in Razorpay at checkout.
            </p>
            {showWidget && (
                <div className="mt-2">
                    <div id="razorpay-affordability-widget" ref={widgetContainerRef} />
                    {!widgetReady && (
                        <p className="text-[11px] text-emerald-700/70 mt-1">Loading EMI plans...</p>
                    )}
                </div>
            )}
        </div>
    );
}
