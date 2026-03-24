const db = require('../config/db');

const VALID_CONDITION_TYPES = new Set(['price', 'weight']);
const normalizeStateKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const buildShippingError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};
const toNullableNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizeZone = (row) => {
    if (!row) return row;
    let states = [];
    try {
        states = row.states ? JSON.parse(row.states) : [];
    } catch {
        states = [];
    }
    return {
        id: row.id,
        name: row.name,
        states
    };
};

const serializeOption = (opt) => ({
    id: opt.id,
    name: opt.name,
    rate: Number(opt.rate),
    conditionType: opt.condition_type,
    min: opt.min_value,
    max: opt.max_value
});

const serializePublicZone = (zone) => ({
    states: Array.isArray(zone?.states) ? zone.states : [],
    options: Array.isArray(zone?.options)
        ? zone.options.map((option) => ({
            rate: Number(option.rate || 0),
            conditionType: option.conditionType || 'price',
            min: option.min ?? null,
            max: option.max ?? null
        }))
        : []
});

const assertNoOverlappingOptions = (options = []) => {
    const grouped = new Map();
    options.forEach((option, index) => {
        const key = option.conditionType || 'price';
        const start = option.min === null ? Number.NEGATIVE_INFINITY : option.min;
        const end = option.max === null ? Number.POSITIVE_INFINITY : option.max;
        const group = grouped.get(key) || [];
        group.push({ index, start, end });
        grouped.set(key, group);
    });

    grouped.forEach((entries, key) => {
        const sorted = [...entries].sort((a, b) => a.start - b.start);
        for (let i = 1; i < sorted.length; i += 1) {
            const prev = sorted[i - 1];
            const current = sorted[i];
            if (current.start <= prev.end) {
                throw buildShippingError(`Overlapping ${key} shipping ranges are not allowed`);
            }
        }
    });
};

const validateZonePayload = async (connection, { zoneId = null, name, states = [], options = [] }) => {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) throw buildShippingError('Zone name required');

    const normalizedStates = Array.isArray(states)
        ? states.map((state) => String(state || '').trim()).filter(Boolean)
        : [];
    const seenStates = new Set();
    normalizedStates.forEach((state) => {
        const key = normalizeStateKey(state);
        if (!key) throw buildShippingError('Invalid state name');
        if (seenStates.has(key)) throw buildShippingError('Duplicate states are not allowed in the same zone');
        seenStates.add(key);
    });

    const [otherZones] = await connection.execute(
        'SELECT id, states FROM shipping_zones WHERE (? IS NULL OR id <> ?)',
        [zoneId, zoneId]
    );
    for (const row of otherZones) {
        let existingStates = [];
        try {
            existingStates = JSON.parse(row.states || '[]');
        } catch {
            existingStates = [];
        }
        const conflict = existingStates.find((state) => seenStates.has(normalizeStateKey(state)));
        if (conflict) {
            throw buildShippingError(`State "${conflict}" is already assigned to another zone`);
        }
    }

    const normalizedOptions = Array.isArray(options)
        ? options.map((option) => {
            const optionName = String(option?.name || '').trim();
            if (!optionName) throw buildShippingError('Shipping option name required');
            const rate = Number(option?.rate);
            if (!Number.isFinite(rate) || rate < 0) throw buildShippingError('Shipping rate must be a non-negative number');
            const conditionType = String(option?.conditionType || 'price').trim().toLowerCase();
            if (!VALID_CONDITION_TYPES.has(conditionType)) throw buildShippingError('Invalid shipping condition type');
            const min = toNullableNumber(option?.min);
            const max = toNullableNumber(option?.max);
            if ((option?.min !== null && option?.min !== undefined && option?.min !== '') && min === null) {
                throw buildShippingError('Shipping rule minimum must be a valid number');
            }
            if ((option?.max !== null && option?.max !== undefined && option?.max !== '') && max === null) {
                throw buildShippingError('Shipping rule maximum must be a valid number');
            }
            if (min !== null && min < 0) throw buildShippingError('Shipping rule minimum cannot be negative');
            if (max !== null && max < 0) throw buildShippingError('Shipping rule maximum cannot be negative');
            if (min !== null && max !== null && min > max) throw buildShippingError('Shipping rule minimum cannot be greater than maximum');
            return { name: optionName, rate, conditionType, min, max };
        })
        : [];

    assertNoOverlappingOptions(normalizedOptions);

    return {
        name: trimmedName,
        states: normalizedStates,
        options: normalizedOptions
    };
};

class Shipping {
    static async getAll() {
        const [zones] = await db.execute('SELECT * FROM shipping_zones ORDER BY created_at DESC');
        const [options] = await db.execute('SELECT * FROM shipping_options ORDER BY created_at ASC');
        const mappedZones = zones.map(normalizeZone);
        const optionsByZone = options.reduce((acc, opt) => {
            acc[opt.zone_id] = acc[opt.zone_id] || [];
            acc[opt.zone_id].push(serializeOption(opt));
            return acc;
        }, {});
        return mappedZones.map(zone => ({
            ...zone,
            options: optionsByZone[zone.id] || []
        }));
    }

    static toPublicZones(zones = []) {
        return (Array.isArray(zones) ? zones : []).map(serializePublicZone);
    }

    static async createZone({ name, states = [], options = [] }) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const payload = await validateZonePayload(connection, { name, states, options });
            const [result] = await connection.execute(
                'INSERT INTO shipping_zones (name, states) VALUES (?, ?)',
                [payload.name, JSON.stringify(payload.states)]
            );
            const zoneId = result.insertId;

            if (payload.options.length) {
                const values = payload.options.map(opt => ([
                    zoneId,
                    opt.name,
                    opt.rate,
                    opt.conditionType,
                    opt.min,
                    opt.max
                ]));
                await connection.query(
                    'INSERT INTO shipping_options (zone_id, name, rate, condition_type, min_value, max_value) VALUES ?',
                    [values]
                );
            }
            await connection.commit();
            return zoneId;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async updateZone(zoneId, { name, states = [], options = [] }) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [existingRows] = await connection.execute('SELECT id FROM shipping_zones WHERE id = ? LIMIT 1', [zoneId]);
            if (!existingRows.length) {
                throw buildShippingError('Shipping zone not found', 404);
            }
            const payload = await validateZonePayload(connection, { zoneId, name, states, options });
            await connection.execute(
                'UPDATE shipping_zones SET name = ?, states = ? WHERE id = ?',
                [payload.name, JSON.stringify(payload.states), zoneId]
            );
            await connection.execute('DELETE FROM shipping_options WHERE zone_id = ?', [zoneId]);
            if (payload.options.length) {
                const values = payload.options.map(opt => ([
                    zoneId,
                    opt.name,
                    opt.rate,
                    opt.conditionType,
                    opt.min,
                    opt.max
                ]));
                await connection.query(
                    'INSERT INTO shipping_options (zone_id, name, rate, condition_type, min_value, max_value) VALUES ?',
                    [values]
                );
            }
            await connection.commit();
            return zoneId;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async deleteZone(zoneId) {
        const [result] = await db.execute('DELETE FROM shipping_zones WHERE id = ?', [zoneId]);
        if (!result?.affectedRows) {
            throw buildShippingError('Shipping zone not found', 404);
        }
        return true;
    }
}

module.exports = Shipping;
