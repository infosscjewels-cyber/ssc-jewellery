const getOrdinalSuffix = (day) => {
    const tens = day % 100;
    if (tens >= 11 && tens <= 13) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
};

const parseAdminDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

    const raw = String(value).trim();
    if (!raw) return null;

    // Handle MySQL DATETIME strings as UTC and render in browser local timezone.
    const mysqlMatch = raw.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (mysqlMatch) {
        const [, y, m, d, hh = '00', mm = '00', ss = '00'] = mysqlMatch;
        const parsed = new Date(Date.UTC(
            Number(y),
            Number(m) - 1,
            Number(d),
            Number(hh),
            Number(mm),
            Number(ss)
        ));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatAdminDate = (value) => {
    if (!value) return '—';
    const date = parseAdminDate(value);
    if (!date) return '—';
    const day = date.getDate();
    const month = date.toLocaleString('en-IN', { month: 'short' });
    const year = date.getFullYear();
    return `${day}${getOrdinalSuffix(day)} ${month} ${year}`;
};

export const formatAdminDateTime = (value) => {
    if (!value) return '—';
    const date = parseAdminDate(value);
    if (!date) return '—';
    const datePart = formatAdminDate(date);
    const timePart = date.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit'
    });
    return `${datePart}, ${timePart}`;
};
