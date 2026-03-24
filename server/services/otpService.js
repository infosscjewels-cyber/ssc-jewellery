// server/services/otpService.js
const pool = require('../config/db'); 
const crypto = require('crypto');

// Keep your local store logic
const otpStore = {}; 

class OtpService {
    static buildStorageKey(identifier, scope = 'general') {
        const safeIdentifier = String(identifier || '').trim().toLowerCase();
        const safeScope = String(scope || 'general').trim().toLowerCase();
        const digest = crypto.createHash('sha1').update(`${safeScope}|${safeIdentifier}`).digest('hex').slice(0, 12);
        return `${safeScope[0] || 'g'}:${digest}`; // <= 14 chars, fits current schema
    }

    // --- 1. SAVE OTP (Environment Aware) ---
    static async saveOtp(storageKey, otp) {
        
        // CHECK: Are we in Production?
        if (process.env.NODE_ENV === 'production') {
            // --- PRODUCTION MODE: USE DATABASE ---
            // This allows us to test if the DB connection works!
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000); 
            
            // If DB is broken, this throws an error (which we want to see)
            await pool.query('DELETE FROM otps WHERE mobile = ?', [storageKey]);
            await pool.query('INSERT INTO otps (mobile, otp, expires_at) VALUES (?, ?, ?)', 
                [storageKey, otp, expiresAt]);

        } else {
            // --- LOCAL MODE: USE MEMORY ---
            // This keeps your local development fast and simple
            otpStore[storageKey] = { 
                code: otp, 
                expires: Date.now() + 5 * 60 * 1000 
            };
            console.log(`\n🔐 [LOCAL MEMORY] OTP for ${storageKey}: ${otp}\n`);
        }
    }

    // --- 2. VERIFY OTP (Environment Aware) ---
    static async verifyOtp(storageKey, inputOtp, shouldDelete = true) {
        
        if (process.env.NODE_ENV === 'production') {
            // --- PRODUCTION: CHECK DATABASE ---
            const [rows] = await pool.query(
                'SELECT * FROM otps WHERE mobile = ? AND otp = ? AND expires_at > NOW()', 
                [storageKey, inputOtp]
            );

            if (rows.length > 0) {
                if (shouldDelete) {
                    await pool.query('DELETE FROM otps WHERE mobile = ?', [storageKey]);
                }
                return true;
            }
            return false;

        } else {
            // --- LOCAL: CHECK MEMORY ---
            const record = otpStore[storageKey];
            if (!record) return false;
            
            if (Date.now() > record.expires) {
                delete otpStore[storageKey];
                return false;
            }
            
            if (record.code === inputOtp) {
                if (shouldDelete) delete otpStore[storageKey];
                return true;
            }
            return false;
        }
    }

    // Legacy support (optional)
    static async sendOtp(mobile) {
         const otp = Math.floor(100000 + Math.random() * 900000).toString();
         const storageKey = this.buildStorageKey(mobile, 'mobile');
         await this.saveOtp(storageKey, otp);
         return true;
    }
}

module.exports = OtpService;
