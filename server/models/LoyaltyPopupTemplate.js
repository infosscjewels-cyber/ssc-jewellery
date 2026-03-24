const db = require('../config/db');

const normalizeDate = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parseJson = (value, fallback = {}) => {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const normalizePayload = (payload = {}) => {
    const src = payload && typeof payload === 'object' ? payload : {};
    return {
        isActive: Boolean(src.isActive),
        title: String(src.title || '').trim(),
        summary: String(src.summary || '').trim(),
        content: String(src.content || '').trim(),
        encouragement: String(src.encouragement || '').trim(),
        imageUrl: String(src.imageUrl || '').trim(),
        audioUrl: String(src.audioUrl || '').trim(),
        buttonLabel: String(src.buttonLabel || 'Shop Now').trim() || 'Shop Now',
        buttonLink: String(src.buttonLink || '/shop').trim() || '/shop',
        couponCode: src.couponCode ? String(src.couponCode).trim().toUpperCase() : '',
        endsAt: src.endsAt ? String(src.endsAt).trim() : ''
    };
};

const normalizeRow = (row = {}) => ({
    id: Number(row.id || 0),
    templateName: String(row.template_name || ''),
    payload: normalizePayload(parseJson(row.payload_json, {})),
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at)
});

class LoyaltyPopupTemplate {
    static async list() {
        const [rows] = await db.execute(
            `SELECT id, template_name, payload_json, created_at, updated_at
             FROM loyalty_popup_templates
             ORDER BY updated_at DESC, id DESC`
        );
        return rows.map(normalizeRow);
    }

    static async create({ templateName = '', payload = {} } = {}) {
        const cleanName = String(templateName || '').trim();
        if (!cleanName) throw new Error('Template name is required');
        const normalizedPayload = normalizePayload(payload);
        const [result] = await db.execute(
            `INSERT INTO loyalty_popup_templates (template_name, payload_json)
             VALUES (?, ?)`,
            [cleanName.slice(0, 120), JSON.stringify(normalizedPayload)]
        );
        return LoyaltyPopupTemplate.getById(result.insertId);
    }

    static async getById(templateId) {
        const id = Number(templateId || 0);
        if (!Number.isFinite(id) || id <= 0) return null;
        const [rows] = await db.execute(
            `SELECT id, template_name, payload_json, created_at, updated_at
             FROM loyalty_popup_templates
             WHERE id = ?
             LIMIT 1`,
            [id]
        );
        if (!rows.length) return null;
        return normalizeRow(rows[0]);
    }

    static async update(templateId, { templateName = '', payload = {} } = {}) {
        const id = Number(templateId || 0);
        if (!Number.isFinite(id) || id <= 0) throw new Error('Template id is invalid');
        const cleanName = String(templateName || '').trim();
        if (!cleanName) throw new Error('Template name is required');
        const normalizedPayload = normalizePayload(payload);
        const [result] = await db.execute(
            `UPDATE loyalty_popup_templates
             SET template_name = ?, payload_json = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [cleanName.slice(0, 120), JSON.stringify(normalizedPayload), id]
        );
        if (Number(result?.affectedRows || 0) === 0) throw new Error('Template not found');
        return LoyaltyPopupTemplate.getById(id);
    }

    static async remove(templateId) {
        const id = Number(templateId || 0);
        if (!Number.isFinite(id) || id <= 0) throw new Error('Template id is invalid');
        const [result] = await db.execute('DELETE FROM loyalty_popup_templates WHERE id = ?', [id]);
        return Number(result?.affectedRows || 0) > 0;
    }
}

module.exports = LoyaltyPopupTemplate;
