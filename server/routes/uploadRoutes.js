const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
    createUploader,
    DEFAULT_IMAGE_MIME_TYPES,
    DEFAULT_AUDIO_MIME_TYPES
} = require('../utils/upload');

const router = express.Router();
const uploadProfile = createUploader('profile', {
    allowedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    maxFileSizeBytes: 5 * 1024 * 1024
});
const uploadPopupImage = createUploader('popup', {
    allowedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    maxFileSizeBytes: 5 * 1024 * 1024
});
const uploadPopupAudio = createUploader('popup', {
    allowedMimeTypes: DEFAULT_AUDIO_MIME_TYPES,
    allowedExtensions: ['.mp3', '.wav', '.ogg', '.webm'],
    maxFileSizeBytes: 10 * 1024 * 1024
});
const uploadContact = createUploader('contact', {
    allowedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    maxFileSizeBytes: 5 * 1024 * 1024
});
const uploadUsageAudience = createUploader('categories', {
    allowedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    maxFileSizeBytes: 5 * 1024 * 1024
});
const brandingImageMimeTypes = [
    ...DEFAULT_IMAGE_MIME_TYPES,
    'image/x-icon',
    'image/vnd.microsoft.icon'
];
const uploadBrandingLogo = createUploader('branding', {
    allowedMimeTypes: brandingImageMimeTypes,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.ico'],
    maxFileSizeBytes: 5 * 1024 * 1024
});
const uploadBrandingFavicon = createUploader('branding', {
    allowedMimeTypes: brandingImageMimeTypes,
    allowedExtensions: ['.png', '.webp', '.jpg', '.jpeg', '.ico'],
    maxFileSizeBytes: 2 * 1024 * 1024
});
const uploadBrandingAppleTouch = createUploader('branding', {
    allowedMimeTypes: brandingImageMimeTypes,
    allowedExtensions: ['.png', '.webp', '.jpg', '.jpeg', '.ico'],
    maxFileSizeBytes: 2 * 1024 * 1024
});
const uploadCarousel = createUploader('carousel', {
    allowedMimeTypes: DEFAULT_IMAGE_MIME_TYPES,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    maxFileSizeBytes: 5 * 1024 * 1024
});

router.post('/profile-image', protect, uploadProfile.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No image uploaded' });
    }
    const url = `/uploads/profile/${req.file.filename}`;
    res.json({ url });
});

router.post('/popup-image', protect, authorize('admin', 'staff'), uploadPopupImage.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No image uploaded' });
    }
    const url = `/uploads/popup/${req.file.filename}`;
    return res.json({ url });
});

router.post('/popup-audio', protect, authorize('admin', 'staff'), uploadPopupAudio.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No audio uploaded' });
    }
    const url = `/uploads/popup/${req.file.filename}`;
    return res.json({ url });
});

router.post('/contact-jumbotron-image', protect, authorize('admin', 'staff'), uploadContact.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No image uploaded' });
    }
    const url = `/uploads/contact/${req.file.filename}`;
    return res.json({ url });
});

router.post('/usage-audience-image', protect, authorize('admin', 'staff'), uploadUsageAudience.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No image uploaded' });
    }
    return res.json({ url: `/uploads/categories/${req.file.filename}` });
});

router.post('/company-logo', protect, authorize('admin', 'staff'), uploadBrandingLogo.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No logo uploaded' });
    }
    return res.json({ url: `/uploads/branding/${req.file.filename}` });
});

router.post('/company-favicon', protect, authorize('admin', 'staff'), uploadBrandingFavicon.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No favicon uploaded' });
    }
    return res.json({ url: `/uploads/branding/${req.file.filename}` });
});

router.post('/company-apple-touch-icon', protect, authorize('admin', 'staff'), uploadBrandingAppleTouch.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No apple touch icon uploaded' });
    }
    return res.json({ url: `/uploads/branding/${req.file.filename}` });
});

router.post('/carousel-card-image', protect, authorize('admin', 'staff'), uploadCarousel.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No image uploaded' });
    }
    const url = `/uploads/carousel/${req.file.filename}`;
    return res.json({ url });
});

module.exports = router;
