const express = require('express');
const router = express.Router();
const { getZones } = require('../controllers/shippingController');

router.get('/zones', getZones);

module.exports = router;
