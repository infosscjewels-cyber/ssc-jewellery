const Shipping = require('../models/Shipping');

const emitUpdate = async (io) => {
    if (!io) return;
    const zones = await Shipping.getAll();
    io.except('admin').emit('shipping:update', { zones: Shipping.toPublicZones(zones) });
    io.to('admin').emit('shipping:update', { zones });
};

const sendShippingError = (res, error, fallbackMessage) => {
    const statusCode = Number(error?.statusCode || 500);
    if (statusCode >= 400 && statusCode < 500) {
        return res.status(statusCode).json({ message: error.message || fallbackMessage });
    }
    return res.status(500).json({ message: fallbackMessage });
};

const getZones = async (req, res) => {
    try {
        const zones = await Shipping.getAll();
        const isAdmin = ['admin', 'staff'].includes(String(req?.user?.role || '').toLowerCase());
        res.json({ zones: isAdmin ? zones : Shipping.toPublicZones(zones) });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch shipping zones' });
    }
};

const createZone = async (req, res) => {
    try {
        const { name, states, options } = req.body;
        if (!name) return res.status(400).json({ message: 'Zone name required' });
        const zoneId = await Shipping.createZone({ name, states, options });
        const zones = await Shipping.getAll();
        const io = req.app.get('io');
        await emitUpdate(io);
        res.status(201).json({ zoneId, zones });
    } catch (error) {
        sendShippingError(res, error, 'Failed to create zone');
    }
};

const updateZone = async (req, res) => {
    try {
        const { name, states, options } = req.body;
        const zoneId = req.params.id;
        await Shipping.updateZone(zoneId, { name, states, options });
        const zones = await Shipping.getAll();
        const io = req.app.get('io');
        await emitUpdate(io);
        res.json({ zones });
    } catch (error) {
        sendShippingError(res, error, 'Failed to update zone');
    }
};

const deleteZone = async (req, res) => {
    try {
        await Shipping.deleteZone(req.params.id);
        const zones = await Shipping.getAll();
        const io = req.app.get('io');
        await emitUpdate(io);
        res.json({ zones });
    } catch (error) {
        sendShippingError(res, error, 'Failed to delete zone');
    }
};

module.exports = { getZones, createZone, updateZone, deleteZone };
