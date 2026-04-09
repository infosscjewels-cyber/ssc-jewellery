import { Crown, Gem, Medal } from 'lucide-react';
import { formatTierLabel, normalizeTierKey } from '../utils/tierFormat';

const TIER_BADGE_THEME = {
    regular: {
        badge: 'border border-slate-200 bg-slate-50 text-slate-600',
        iconClass: 'text-slate-600',
        Icon: null
    },
    bronze: {
        badge: 'border border-amber-200 bg-amber-100 text-amber-800',
        iconClass: 'text-amber-700',
        Icon: Medal
    },
    silver: {
        badge: 'border border-zinc-200 bg-zinc-100 text-zinc-700',
        iconClass: 'text-zinc-600',
        Icon: Medal
    },
    gold: {
        badge: 'border border-yellow-200 bg-yellow-100 text-yellow-800',
        iconClass: 'text-yellow-700',
        Icon: Crown
    },
    platinum: {
        badge: 'border border-sky-200 bg-sky-100 text-sky-800',
        iconClass: 'text-sky-700',
        Icon: Gem
    }
};

export default function TierBadge({
    tier = 'regular',
    label = '',
    className = '',
    iconSize = 12
}) {
    const tierKey = normalizeTierKey(tier);
    const theme = TIER_BADGE_THEME[tierKey] || TIER_BADGE_THEME.regular;
    const displayLabel = String(label || formatTierLabel(tierKey));
    const Icon = theme.Icon;
    const showIcon = Boolean(Icon && tierKey !== 'regular');

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${theme.badge} ${className}`.trim()}>
            {showIcon && <Icon size={iconSize} className={theme.iconClass} />}
            <span>{displayLabel}</span>
        </span>
    );
}
