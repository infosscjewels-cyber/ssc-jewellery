const jwt = require('jsonwebtoken');
const User = require('../models/User'); 
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is required for authMiddleware');
}

// 1. PROTECT ROUTE (Authentication)
const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            // 1. Strict Token Check
            if (!token || token === 'undefined' || token === 'null') {
                throw new Error('Invalid token format');
            }

            const decoded = jwt.verify(token, JWT_SECRET);
            const userId = decoded?.id;

            if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
                return res.status(401).json({ message: 'Not authorized, invalid token payload' });
            }

            // 2. Fetch User (MySQL Style)
            // Assuming User.findById returns the user object directly
            const user = await User.findById(String(userId));

            if (!user) {
                return res.status(401).json({ message: 'Not authorized, user not found' });
            }

            if (user.isActive === false) {
                return res.status(403).json({ message: 'Account is deactivated. Please contact support.' });
            }

            // 3. Remove password from the object manually if needed
            delete user.password; 

            req.user = user;
            next();

        } catch (error) {
            console.error("Auth Middleware Error:", error.message);
            if (error.name === 'JsonWebTokenError' || error.message === 'Invalid token format') {
                return res.status(401).json({ message: 'Not authorized, invalid token' }); 
            }
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Session expired, please login again' });
            }
            res.status(500).json({ message: 'Server error during authentication' });
        }
    } else {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
};

const optionalProtect = async (req, _res, next) => {
    if (!(req.headers.authorization && req.headers.authorization.startsWith('Bearer'))) {
        return next();
    }

    try {
        const token = req.headers.authorization.split(' ')[1];
        if (!token || token === 'undefined' || token === 'null') {
            return next();
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded?.id;
        if (!userId || (typeof userId !== 'string' && typeof userId !== 'number')) {
            return next();
        }

        const user = await User.findById(String(userId));
        if (!user) return next();
        if (user.isActive === false) return next();

        delete user.password;
        req.user = user;
    } catch {
        // Ignore optional auth failures for public routes.
    }

    next();
};

// 2. ADMIN ONLY (Legacy Support)
const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Not authorized as an admin' });
    }
};

// 3. ROLE AUTHORIZATION (Flexible)
// Usage: authorize('admin', 'staff') -> Allows both
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ 
                message: `User role '${req.user?.role}' is not authorized to access this route` 
            });
        }
        next();
    };
};

module.exports = { protect, optionalProtect, admin, authorize };
