const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect, optionalProtect, admin } = require('../middleware/authMiddleware');
const { getProducts, searchProducts, getSingleProduct, createProduct, deleteProduct, updateProduct, getCategories, getCategoryStats, getCategoryDetails, updateCategory, reorderCategory, manageCategoryProduct, manageCategoryProductsBulk, createCategory, deleteCategory, updateCategoryAutopilot } = require('../controllers/productController');
const { ensureUploadsSubdir } = require('../utils/uploadsRoot');

// --- MULTER CONFIGURATION (Image Uploads) ---
const storage = multer.diskStorage({
    destination(req, file, cb) {
        const uploadPath = ensureUploadsSubdir('products');
        cb(null, uploadPath);
    },
    filename(req, file, cb) {
        // Unique filename: product-timestamp.ext
        cb(null, `prod-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const categoryStorage = multer.diskStorage({
    destination(req, file, cb) {
        const uploadPath = ensureUploadsSubdir('categories');
        cb(null, uploadPath);
    },
    filename(req, file, cb) {
        cb(null, `cat-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 8 * 1024 * 1024 } // 5MB Limit per file
});

const uploadCategoryImage = multer({ 
    storage: categoryStorage,
    limits: { fileSize: 8 * 1024 * 1024 } // 5MB Limit per file
});

// --- ROUTES ---

// 1. Get Products (Public/Protected depending on need - usually Protected)
router.get('/', optionalProtect, getProducts);
router.get('/search', optionalProtect, searchProducts);

// 2. Create Product (Admin Only, supports max 10 images at once)
router.post('/', protect, admin, upload.array('images', 10), createProduct);

// --- CATEGORY MANAGEMENT ROUTES (NEW) ---
// 1. Get Stats (List with counts)
router.get('/categories/stats', optionalProtect, getCategoryStats);

// 2. Get Single Category Details (with ordered products)
router.get('/categories/:id', protect, admin, getCategoryDetails);

// 3. Update Category Name
router.put('/categories/:id', protect, admin, uploadCategoryImage.single('image'), updateCategory);

// 4. Reorder Products in Category
router.put('/categories/:id/reorder', protect, admin, reorderCategory);
router.put('/categories/:id/autopilot', protect, admin, updateCategoryAutopilot);

// 5. Add/Remove Product from Category
router.post('/categories/:id/products', protect, admin, manageCategoryProduct);
router.post('/categories/:id/products/bulk', protect, admin, manageCategoryProductsBulk);

// 3. Delete Product (Admin Only)
router.delete('/:id', protect, admin, deleteProduct);

//4. Update Product (Admin Only) - Can be added similarly
router.put('/:id', protect, admin, upload.array('images', 10), updateProduct);



router.get('/categories', optionalProtect, getCategories);
// 6. Create Category
router.post('/categories', protect, admin, uploadCategoryImage.single('image'), createCategory);

// 7. Delete Category
router.delete('/categories/:id', protect, admin, deleteCategory);

// 8. Get Single Product (Public)
// [IMPORTANT] Place this AFTER all '/categories' routes to avoid id collisions
router.get('/:id', optionalProtect, getSingleProduct);

module.exports = router;
