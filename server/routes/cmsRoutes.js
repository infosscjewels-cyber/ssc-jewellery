const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
    createUploader,
    DEFAULT_IMAGE_MIME_TYPES
} = require('../utils/upload');
const {
    getSlides,
    getHeroTexts,
    getBanner,
    getSecondaryBanner,
    getTertiaryBanner,
    getFeaturedCategory,
    getCarouselCards,
    getAutopilotConfig,
    submitContactForm,
    getCompanyInfo,
    createSlide,
    updateBanner,
    updateSecondaryBanner,
    updateTertiaryBanner,
    updateFeaturedCategory,
    createCarouselCard,
    updateCarouselCard,
    deleteCarouselCard,
    updateAutopilotConfig,
    createHeroText,
    updateHeroText,
    deleteHeroText,
    reorderHeroTexts,
    deleteSlide,
    reorderSlides,
    updateSlide
} = require('../controllers/cmsController');

const uploadHero = createUploader('hero', {
    allowedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    maxFileSizeBytes: 5 * 1024 * 1024
});
const uploadBanner = createUploader('banner', {
    allowedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    maxFileSizeBytes: 5 * 1024 * 1024
});

// --- ROUTES ---

// Public: Get Slides
router.get('/hero', getSlides);
router.get('/hero-texts', getHeroTexts);
router.get('/banner', getBanner);
router.get('/banner-secondary', getSecondaryBanner);
router.get('/banner-tertiary', getTertiaryBanner);
router.get('/featured-category', getFeaturedCategory);
router.get('/carousel-cards', getCarouselCards);
router.get('/autopilot', getAutopilotConfig);
router.get('/company-info', getCompanyInfo);
router.post('/contact', submitContactForm);

// Admin: Manage Slides
router.post('/hero', protect, admin, uploadHero.single('image'), createSlide);
router.post('/hero-texts', protect, admin, createHeroText);
router.put('/hero-texts/reorder', protect, admin, reorderHeroTexts);
router.put('/hero-texts/:id', protect, admin, updateHeroText);
router.delete('/hero-texts/:id', protect, admin, deleteHeroText);
router.put('/banner', protect, admin, uploadBanner.single('image'), updateBanner);
router.put('/banner-secondary', protect, admin, uploadBanner.single('image'), updateSecondaryBanner);
router.put('/banner-tertiary', protect, admin, uploadBanner.single('image'), updateTertiaryBanner);
router.put('/featured-category', protect, admin, updateFeaturedCategory);
router.post('/carousel-cards', protect, admin, createCarouselCard);
router.put('/carousel-cards/:id', protect, admin, updateCarouselCard);
router.delete('/carousel-cards/:id', protect, admin, deleteCarouselCard);
router.put('/autopilot', protect, admin, updateAutopilotConfig);
router.put('/hero/reorder', protect, admin, reorderSlides);
router.put('/hero/:id', protect, admin, updateSlide);
router.delete('/hero/:id', protect, admin, deleteSlide);

module.exports = router;
