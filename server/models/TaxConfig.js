const db = require('../config/db');

const normalizeRateRow = (row = {}) => ({
    id: Number(row.id || 0),
    name: String(row.name || '').trim(),
    code: String(row.code || '').trim().toUpperCase(),
    ratePercent: Number(row.rate_percent || 0),
    isDefault: Number(row.is_default || 0) === 1,
    isActive: Number(row.is_active || 0) === 1,
    displayOrder: Number(row.display_order || 0),
    updatedAt: row.updated_at || null
});

class TaxConfig {
    static async listAll() {
        const [rows] = await db.execute(
            `SELECT id, name, code, rate_percent, is_default, is_active, display_order, updated_at
             FROM tax_configs
             ORDER BY is_default DESC, display_order ASC, id ASC`
        );
        return rows.map(normalizeRateRow);
    }

    static async listActive() {
        const [rows] = await db.execute(
            `SELECT id, name, code, rate_percent, is_default, is_active, display_order, updated_at
             FROM tax_configs
             WHERE is_active = 1
             ORDER BY is_default DESC, display_order ASC, id ASC`
        );
        return rows.map(normalizeRateRow);
    }

    static async getById(id) {
        const [rows] = await db.execute(
            `SELECT id, name, code, rate_percent, is_default, is_active, display_order, updated_at
             FROM tax_configs
             WHERE id = ?
             LIMIT 1`,
            [id]
        );
        if (!rows.length) return null;
        return normalizeRateRow(rows[0]);
    }

    static async getDefaultActive() {
        const [rows] = await db.execute(
            `SELECT id, name, code, rate_percent, is_default, is_active, display_order, updated_at
             FROM tax_configs
             WHERE is_active = 1
             ORDER BY is_default DESC, display_order ASC, id ASC
             LIMIT 1`
        );
        if (!rows.length) return null;
        return normalizeRateRow(rows[0]);
    }

    static async create(payload = {}) {
        const name = String(payload.name || '').trim();
        const code = String(payload.code || '').trim().toUpperCase();
        const ratePercent = Number(payload.ratePercent || 0);
        const isDefault = payload.isDefault === true || payload.isDefault === 1 ? 1 : 0;
        const isActive = payload.isActive === false || payload.isActive === 0 ? 0 : 1;
        const displayOrder = Number.isFinite(Number(payload.displayOrder))
            ? Math.max(0, Math.floor(Number(payload.displayOrder)))
            : 0;

        if (!name) throw new Error('Tax name is required');
        if (!code) throw new Error('Tax code is required');
        if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
            throw new Error('Tax rate must be between 0 and 100');
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            if (isDefault === 1) {
                await connection.execute('UPDATE tax_configs SET is_default = 0');
            }
            const [result] = await connection.execute(
                `INSERT INTO tax_configs (name, code, rate_percent, is_default, is_active, display_order)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [name, code, ratePercent, isDefault, isActive, displayOrder]
            );
            if (isDefault !== 1) {
                const [defaultRows] = await connection.execute(
                    'SELECT id FROM tax_configs WHERE is_default = 1 LIMIT 1'
                );
                if (!defaultRows.length) {
                    await connection.execute('UPDATE tax_configs SET is_default = 1 WHERE id = ?', [result.insertId]);
                }
            }
            await connection.commit();
            return TaxConfig.getById(result.insertId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async update(id, payload = {}) {
        const existing = await TaxConfig.getById(id);
        if (!existing) throw new Error('Tax rate not found');

        const name = payload.name !== undefined ? String(payload.name || '').trim() : existing.name;
        const code = payload.code !== undefined ? String(payload.code || '').trim().toUpperCase() : existing.code;
        const ratePercent = payload.ratePercent !== undefined ? Number(payload.ratePercent) : existing.ratePercent;
        const isDefault = payload.isDefault !== undefined
            ? (payload.isDefault === true || payload.isDefault === 1 ? 1 : 0)
            : (existing.isDefault ? 1 : 0);
        const isActive = payload.isActive !== undefined
            ? (payload.isActive === false || payload.isActive === 0 ? 0 : 1)
            : (existing.isActive ? 1 : 0);
        const displayOrder = payload.displayOrder !== undefined
            ? Math.max(0, Math.floor(Number(payload.displayOrder || 0)))
            : existing.displayOrder;

        if (!name) throw new Error('Tax name is required');
        if (!code) throw new Error('Tax code is required');
        if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
            throw new Error('Tax rate must be between 0 and 100');
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            if (isDefault === 1) {
                await connection.execute('UPDATE tax_configs SET is_default = 0');
            }
            await connection.execute(
                `UPDATE tax_configs
                 SET name = ?, code = ?, rate_percent = ?, is_default = ?, is_active = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [name, code, ratePercent, isDefault, isActive, displayOrder, id]
            );
            if (isDefault !== 1) {
                const [defaultRows] = await connection.execute(
                    'SELECT id FROM tax_configs WHERE is_default = 1 LIMIT 1'
                );
                if (!defaultRows.length) {
                    await connection.execute('UPDATE tax_configs SET is_default = 1 WHERE id = ?', [id]);
                }
            }
            await connection.commit();
            return TaxConfig.getById(id);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async remove(id) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute(
                'SELECT id, is_default FROM tax_configs WHERE id = ? LIMIT 1',
                [id]
            );
            if (!rows.length) throw new Error('Tax rate not found');

            await connection.execute('DELETE FROM tax_configs WHERE id = ?', [id]);
            await connection.execute('UPDATE products SET tax_config_id = NULL WHERE tax_config_id = ?', [id]);

            const wasDefault = Number(rows[0].is_default || 0) === 1;
            if (wasDefault) {
                const [fallbackRows] = await connection.execute(
                    `SELECT id
                     FROM tax_configs
                     ORDER BY is_active DESC, display_order ASC, id ASC
                     LIMIT 1`
                );
                if (fallbackRows.length) {
                    await connection.execute('UPDATE tax_configs SET is_default = 1 WHERE id = ?', [fallbackRows[0].id]);
                }
            }
            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

module.exports = TaxConfig;
