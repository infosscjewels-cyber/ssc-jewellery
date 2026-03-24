const AbandonedCart = require('../models/AbandonedCart');
const { runDueAbandonedCartRecoveriesUntilClear, runAbandonedCartMaintenanceOnce } = require('../services/abandonedCartRecoveryService');
const { listCommunicationDeliveryLogs } = require('../services/communications/communicationRetryService');
const CompanyProfile = require('../models/CompanyProfile');

const parseIntegerArrayStrict = (value, field) => {
    if (value == null) return undefined;
    const raw = Array.isArray(value) ? value : String(value).split(',');
    const normalized = raw.map((entry) => String(entry).trim());
    if (!normalized.length || normalized.some((entry) => !entry.length)) {
        throw new Error(`${field} must be a comma-separated list of integers`);
    }
    return normalized.map((entry) => {
        if (!/^-?\d+$/.test(entry)) {
            throw new Error(`${field} contains invalid value "${entry}"`);
        }
        return Number(entry);
    });
};

const getAbandonedCartCampaign = async (_req, res) => {
    try {
        const campaign = await AbandonedCart.getCampaign();
        return res.json({ campaign });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load campaign' });
    }
};

const updateAbandonedCartCampaign = async (req, res) => {
    try {
        const body = req.body || {};
        const payload = {
            enabled: body.enabled != null ? Boolean(body.enabled) : undefined,
            inactivityMinutes: body.inactivityMinutes != null ? Number(body.inactivityMinutes) : undefined,
            maxAttempts: body.maxAttempts != null ? Number(body.maxAttempts) : undefined,
            attemptDelaysMinutes: parseIntegerArrayStrict(body.attemptDelaysMinutes, 'attemptDelaysMinutes'),
            discountLadderPercent: parseIntegerArrayStrict(body.discountLadderPercent, 'discountLadderPercent'),
            maxDiscountPercent: body.maxDiscountPercent != null ? Number(body.maxDiscountPercent) : undefined,
            minDiscountCartValue: body.minDiscountCartValue != null ? Number(body.minDiscountCartValue) : undefined,
            recoveryWindowHours: body.recoveryWindowHours != null ? Number(body.recoveryWindowHours) : undefined,
            sendEmail: body.sendEmail != null ? Boolean(body.sendEmail) : undefined,
            sendWhatsapp: body.sendWhatsapp != null ? Boolean(body.sendWhatsapp) : undefined,
            sendPaymentLink: body.sendPaymentLink != null ? Boolean(body.sendPaymentLink) : undefined,
            reminderEnable: body.reminderEnable != null ? Boolean(body.reminderEnable) : undefined
        };
        Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
        const campaign = await AbandonedCart.upsertCampaign(payload);
        return res.json({ campaign });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to update campaign' });
    }
};

const processAbandonedCartRecoveriesNow = async (req, res) => {
    try {
        const company = await CompanyProfile.get();
        if (company?.storefrontOpen === false) {
            return res.status(423).json({
                message: 'Storefront is closed for new orders. Abandoned-cart recovery is paused until the store reopens.'
            });
        }
        const limit = Number(req.body?.limit || req.query?.limit || 25);
        const io = req.app.get('io');
        const onJourneyUpdate = io
            ? (payload = {}) => {
                io.to('admin').emit('abandoned_cart:journey:update', {
                    ...payload,
                    ts: new Date().toISOString()
                });
            }
            : null;
        await runAbandonedCartMaintenanceOnce({ onJourneyUpdate });
        const result = await runDueAbandonedCartRecoveriesUntilClear({ limit, onJourneyUpdate });
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to process recoveries' });
    }
};

const listAbandonedCartJourneys = async (req, res) => {
    try {
        const status = req.query.status || 'all';
        const search = req.query.search || '';
        const sortBy = req.query.sortBy || 'newest';
        const limit = Number(req.query.limit || 50);
        const offset = Number(req.query.offset || 0);
        const rangeDays = Number(req.query.rangeDays || 90);
        const includePending = status === 'all' || status === 'pending';

        if (!includePending) {
            const result = await AbandonedCart.listJourneysAdvanced({ status, search, sortBy, limit, offset, rangeDays });
            return res.json({ journeys: result.journeys, total: result.total });
        }

        const [journeyResult, candidateResult] = await Promise.all([
            AbandonedCart.listJourneysAdvanced({ status: 'all', search, sortBy, limit: 500, offset: 0, rangeDays }),
            AbandonedCart.listPendingCandidatesAdvanced({ search, sortBy, limit: 500, offset: 0, rangeDays })
        ]);

        let merged = [
            ...(Array.isArray(journeyResult?.journeys) ? journeyResult.journeys : []),
            ...(Array.isArray(candidateResult?.candidates) ? candidateResult.candidates : [])
        ];

        if (status === 'pending') {
            merged = merged.filter((entry) => String(entry.status || '').toLowerCase() === 'pending');
        }

        const sortTime = (value) => {
            const ts = new Date(value || 0).getTime();
            return Number.isFinite(ts) ? ts : 0;
        };

        merged.sort((a, b) => {
            if (sortBy === 'oldest') {
                return sortTime(a.computed_last_activity_at || a.updated_at || a.created_at)
                    - sortTime(b.computed_last_activity_at || b.updated_at || b.created_at);
            }
            if (sortBy === 'highest_value') {
                return Number(b.cart_total_subunits || 0) - Number(a.cart_total_subunits || 0);
            }
            if (sortBy === 'lowest_value') {
                return Number(a.cart_total_subunits || 0) - Number(b.cart_total_subunits || 0);
            }
            if (sortBy === 'next_due') {
                return sortTime(a.next_attempt_at) - sortTime(b.next_attempt_at);
            }
            return sortTime(b.computed_last_activity_at || b.updated_at || b.created_at)
                - sortTime(a.computed_last_activity_at || a.updated_at || a.created_at);
        });

        const total = merged.length;
        const journeys = merged.slice(offset, offset + limit);
        return res.json({ journeys, total });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load journeys' });
    }
};

const getAbandonedCartJourneyTimeline = async (req, res) => {
    try {
        const journeyId = Number(req.params.id);
        if (!Number.isFinite(journeyId) || journeyId <= 0) {
            return res.status(400).json({ message: 'Invalid journey id' });
        }
        const timeline = await AbandonedCart.getJourneyTimeline(journeyId);
        if (!timeline) return res.status(404).json({ message: 'Journey not found' });
        return res.json(timeline);
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load journey timeline' });
    }
};

const getAbandonedCartInsights = async (req, res) => {
    try {
        const rangeDays = Math.max(1, Math.min(90, Number(req.query.rangeDays || 30)));
        const insights = await AbandonedCart.getInsights({ rangeDays });
        return res.json({ insights });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load insights' });
    }
};

const getCommunicationDeliveryLogs = async (req, res) => {
    try {
        const status = String(req.query.status || 'all').trim().toLowerCase();
        const limit = Number(req.query.limit || 50);
        const logs = await listCommunicationDeliveryLogs({ status, limit });
        return res.json({ logs });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load communication delivery logs' });
    }
};

module.exports = {
    getAbandonedCartCampaign,
    updateAbandonedCartCampaign,
    processAbandonedCartRecoveriesNow,
    listAbandonedCartJourneys,
    getAbandonedCartJourneyTimeline,
    getAbandonedCartInsights,
    getCommunicationDeliveryLogs
};
