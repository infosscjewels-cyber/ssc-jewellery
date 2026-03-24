export const formatMissingProfileFields = (missingFields = []) => {
    const list = Array.isArray(missingFields)
        ? missingFields.map((field) => String(field || '').trim()).filter(Boolean)
        : [];

    if (!list.length) {
        return {
            count: 0,
            summary: 'Complete the remaining profile details to unlock membership.',
            title: 'Pending requirements',
            items: []
        };
    }

    const title = list.length === 1 ? 'Pending requirement' : `Pending requirements (${list.length})`;
    const summary = list.length === 1
        ? `Complete ${list[0]} to unlock membership benefits.`
        : `Complete these ${list.length} items to unlock membership benefits.`;

    return {
        count: list.length,
        title,
        summary,
        items: list
    };
};
