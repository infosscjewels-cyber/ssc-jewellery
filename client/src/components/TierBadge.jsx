import { formatTierLabel, normalizeTierKey } from '../utils/tierFormat';

const TIER_BADGE_THEME = {
    regular: {
        badge: 'border border-slate-200 bg-slate-50 text-slate-600',
        iconClass: '',
        iconSrc: ''
    },
    bronze: {
        badge: 'border border-amber-200 bg-amber-100 text-amber-800',
        iconClass: 'opacity-95 saturate-[0.92] contrast-125',
        iconSrc: '/assets/bronze-medal.png'
    },
    silver: {
        badge: 'border border-zinc-200 bg-zinc-100 text-zinc-700',
        iconClass: 'opacity-95 saturate-[0.92] contrast-125',
        iconSrc: '/assets/silver-medal.png'
    },
    gold: {
        badge: 'border border-yellow-200 bg-yellow-100 text-yellow-800',
        iconClass: 'opacity-95 saturate-[0.94] contrast-125',
        iconSrc: '/assets/gold-medal.png'
    },
    platinum: {
        badge: 'border border-sky-200 bg-sky-100 text-sky-800',
        iconClass: 'opacity-95 saturate-[0.94] contrast-125',
        iconSrc: '/assets/platinum.png'
    }
};

export default function TierBadge({
    tier = 'regular',
    label = '',
    className = '',
    iconSize = 12,
    hideRegular = false
}) {
    const tierKey = normalizeTierKey(tier);
    if (hideRegular && tierKey === 'regular') return null;
    const theme = TIER_BADGE_THEME[tierKey] || TIER_BADGE_THEME.regular;
    const displayLabel = String(label || formatTierLabel(tierKey));
    const showIcon = Boolean(theme.iconSrc && tierKey !== 'regular');

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${theme.badge} ${className}`.trim()}>
            {showIcon && (
                <img
                    src={theme.iconSrc}
                    alt=""
                    aria-hidden="true"
                    className={`shrink-0 object-contain drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)] ${theme.iconClass}`.trim()}
                    style={{ width: iconSize, height: iconSize }}
                />
            )}
            <span>{displayLabel}</span>
        </span>
    );
}
