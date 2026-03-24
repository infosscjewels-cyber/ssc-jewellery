const admin = require('../config/firebase'); // Import the admin SDK
const crypto = require('crypto'); // Built-in Node module for random passwords
const User = require('../models/User');
const OtpService = require('../services/otpService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getUserLoyaltyStatus, issueBirthdayCouponForUser } = require('../services/loyaltyService');
const { sendEmailCommunication, sendWhatsapp } = require('../services/communications/communicationService');
const { emitToUserAudiences } = require('../utils/socketAudience');

const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is required for authController');
}

const generateToken = (user) => {
    return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
};

const rejectIfInactiveUser = (user, res) => {
    if (user && user.isActive === false) {
        res.status(403).json({ message: 'Account is deactivated. Please contact support.' });
        return true;
    }
    return false;
};

// --- SECURITY HELPER FUNCTIONS ---

// 1. Sanitize String (Basic HTML/SQL escape)
const sanitize = (str) => {
    if (typeof str !== 'string') return '';
    // Removes characters often used in SQL injection or XSS
    return str.replace(/['";=<>]/g, '').trim();
};

const isEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const maskEmail = (value = '') => {
    const email = String(value || '').trim();
    const [local, domain] = email.split('@');
    if (!local || !domain) return '';
    const safeLocal = local.length <= 2
        ? `${local[0] || ''}*`
        : `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 3))}${local.slice(-1)}`;
    return `${safeLocal}@${domain}`;
};
const maskMobile = (value = '') => {
    const mobile = String(value || '').replace(/\D/g, '');
    if (mobile.length < 4) return '';
    if (mobile.length <= 6) return `${mobile.slice(0, 2)}${'*'.repeat(Math.max(0, mobile.length - 2))}`;
    return `${mobile.slice(0, 2)}${'*'.repeat(mobile.length - 4)}${mobile.slice(-2)}`;
};

const normalizeOtpPurpose = (value = '') => {
    const purpose = String(value || '').trim().toLowerCase();
    if (purpose === 'login') return 'login';
    if (['password_reset', 'reset_password', 'reset', 'forgot_password', 'forgot-password'].includes(purpose)) {
        return 'password_reset';
    }
    return 'general';
};

const resolveUserByIdentifier = async (identifier = '') => {
    const normalized = String(identifier || '').trim().toLowerCase();
    if (!normalized) return null;
    if (isEmail(normalized)) return User.findByEmail(normalized);
    const mobile = normalized.replace(/\D/g, '');
    if (/^[0-9]{10,12}$/.test(mobile)) return User.findByMobile(mobile);
    return null;
};

const pickBySeed = (variants = [], seed = '') => {
    const list = Array.isArray(variants) ? variants : [];
    if (!list.length) return '';
    let hash = 0;
    const str = String(seed || '');
    for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    const idx = Math.abs(hash) % list.length;
    return list[idx];
};

const buildLoginOtpEmailTemplate = ({ user = {}, otp = '', maskedWhatsapp = '' } = {}) => {
    const customerName = String(user?.name || 'Customer').trim() || 'Customer';
    const email = String(user?.email || '').trim().toLowerCase();
    const seed = `${email}|${otp}|login-otp`;

    const subjects = [
        'Your Secure Login OTP for SSC Jewellery',
        'SSC Jewellery Login Code: Action Required',
        'Confirm Your Sign-In: One-Time Passcode Inside',
        'Your OTP Is Ready: Complete Login Securely',
        'SSC Jewellery Security Check: Enter Your OTP',
        'Login Verification Code for Your SSC Account',
        'Finish Sign-In: Your One-Time OTP',
        'Account Access OTP from SSC Jewellery',
        'Your Time-Sensitive Login OTP (Valid 5 Minutes)',
        'Security Confirmation Needed: Use This OTP'
    ];
    const openings = [
        `Dear ${customerName},`,
        `Hello ${customerName},`,
        `Hi ${customerName},`,
        `Greetings ${customerName},`,
        `${customerName}, welcome back,`,
        `Dear Valued Customer ${customerName},`,
        `Hello and thank you for choosing SSC Jewellery, ${customerName},`,
        `Hi ${customerName}, this is your account verification mail,`,
        `Dear ${customerName}, your login request was received,`,
        `Hello ${customerName}, we are sharing your secure login passcode below.`
    ];
    const assurances = [
        'If this request was not made by you, please ignore this email. Our team will continue to protect your account.',
        'If you did not request this OTP, no action is required. The code expires automatically in 5 minutes.',
        'For your safety, this OTP is valid only once and only for a short period.',
        'Please do not share this code with anyone, including support staff.',
        'Our administration team monitors suspicious login attempts and safeguards your account continuously.',
        'If this was not you, we recommend resetting your password after this expires.',
        'Your account security remains our priority; unauthorized attempts are automatically restricted.',
        'This OTP can be used only for this login attempt and cannot be reused.',
        'No payment or profile change can be made with this OTP alone.',
        'You are receiving this because a login request was initiated for your account.'
    ];
    const closings = [
        'Regards,\nSSC Jewellery Support Team',
        'Warm regards,\nSSC Jewellery Administration',
        'Sincerely,\nSSC Jewellery Customer Care',
        'Best regards,\nSSC Jewellery Security Desk',
        'Thank you,\nSSC Jewellery Team',
        'Kind regards,\nSSC Jewellery Service Team',
        'Respectfully,\nSSC Jewellery Account Protection Team',
        'With care,\nSSC Jewellery Support',
        'Thank you for trusting SSC Jewellery,\nCustomer Experience Team',
        'Yours faithfully,\nSSC Jewellery Help Desk'
    ];

    const subject = pickBySeed(subjects, `${seed}|subject`);
    const opening = pickBySeed(openings, `${seed}|opening`);
    const assurance = pickBySeed(assurances, `${seed}|assurance`);
    const closing = pickBySeed(closings, `${seed}|closing`);
    const whatsappLine = maskedWhatsapp
        ? `We also sent this OTP to your WhatsApp number ${maskedWhatsapp}.`
        : 'No WhatsApp number is linked to this account, so OTP was delivered by email only.';

    const text = [
        opening,
        '',
        `Your One-Time Password (OTP) is: ${otp}`,
        'This code is valid for 5 minutes.',
        whatsappLine,
        '',
        'Next steps:',
        '1. Enter this OTP on the login screen.',
        '2. Complete sign-in before the code expires.',
        '3. Request a new OTP if the timer runs out.',
        '',
        assurance,
        '',
        closing
    ].join('\n');

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:20px;color:#111827;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                <tr>
                    <td style="padding:24px 24px 12px;font-size:15px;line-height:1.6;">
                        <p style="margin:0 0 12px;">${opening}</p>
                        <p style="margin:0 0 12px;">Please use the following One-Time Password to complete your login:</p>
                        <div style="margin:14px 0;padding:14px 16px;border-radius:10px;background:#111827;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:4px;text-align:center;">${otp}</div>
                        <p style="margin:0 0 12px;">This code is valid for <strong>5 minutes</strong>.</p>
                        <p style="margin:0 0 12px;">${whatsappLine}</p>
                        <p style="margin:0 0 8px;"><strong>Next steps:</strong></p>
                        <ol style="margin:0 0 12px 18px;padding:0;">
                            <li>Enter this OTP on the login screen.</li>
                            <li>Complete sign-in before the code expires.</li>
                            <li>Request a new OTP if needed.</li>
                        </ol>
                        <p style="margin:0 0 12px;">${assurance}</p>
                        <p style="margin:0;white-space:pre-line;">${closing}</p>
                    </td>
                </tr>
            </table>
        </div>
    `;

    return { subject, text, html };
};

const buildWelcomeEmailTemplate = ({ user = {} } = {}) => {
    const customerName = String(user?.name || 'Customer').trim() || 'Customer';
    const shopUrl = String(
        process.env.APP_BASE_URL
        || process.env.CLIENT_BASE_URL
        || process.env.FRONTEND_URL
        || process.env.APP_URL
        || (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ? '' : 'http://localhost:5173')
    ).trim();
    const subject = `Welcome to SSC Impon Jewellery, ${customerName}`;
    const text = [
        `Hello ${customerName},`,
        '',
        'Your account has been successfully created.',
        'You can now explore products, track orders, and enjoy exclusive offers.',
        '',
        `Shop now: ${shopUrl}`,
        '',
        'Happy shopping!',
        'Team SSC Impon Jewellery'
    ].join('\n');
    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:20px;color:#111827;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                <tr>
                    <td style="padding:24px;font-size:15px;line-height:1.6;">
                        <p style="margin:0 0 12px;">Hello ${customerName} 👋</p>
                        <p style="margin:0 0 12px;">Your account has been successfully created.</p>
                        <p style="margin:0 0 12px;">You can now explore products, track orders, and enjoy exclusive offers.</p>
                        <p style="margin:0 0 16px;">We are happy to have you with us.</p>
                        ${shopUrl ? `<a href="${shopUrl}" target="_blank" rel="noreferrer" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;">Shop Now</a>` : ''}
                        <p style="margin:16px 0 0;">Happy shopping!<br/>Team SSC Impon Jewellery</p>
                    </td>
                </tr>
            </table>
        </div>
    `;
    return { subject, text, html };
};

const recordDeliveryAttempt = async (promiseFactory, channel, delivery) => {
    delivery.attempted.push(channel);
    try {
        const result = await promiseFactory();
        if (result?.ok || result?.queued) {
            delivery.sent.push(channel);
            return;
        }
        delivery.failed.push({
            channel,
            reason: result?.reason || result?.message || 'delivery_failed'
        });
    } catch (error) {
        delivery.failed.push({
            channel,
            reason: error?.message || 'delivery_failed'
        });
    }
};

const dispatchWelcomeCommunication = (user = {}) => {
    const email = String(user?.email || '').trim().toLowerCase();
    const mobile = String(user?.mobile || '').trim();
    const payloadUser = { name: user?.name || 'Customer', email, mobile };
    setImmediate(async () => {
        const template = email && isEmail(email)
            ? buildWelcomeEmailTemplate({ user: payloadUser })
            : null;
        const [emailResult, whatsappResult] = await Promise.allSettled([
            template
                ? sendEmailCommunication({
                    to: email,
                    subject: template.subject,
                    text: template.text,
                    html: template.html
                })
                : Promise.resolve({ ok: false, skipped: true, reason: 'missing_email' }),
            mobile
                ? sendWhatsapp({
                    type: 'welcome',
                    template: 'welcome',
                    mobile,
                    name: payloadUser.name,
                    params: [payloadUser.name]
                })
                : Promise.resolve({ ok: false, skipped: true, reason: 'missing_mobile' })
        ]);

        if (emailResult.status === 'rejected') {
            console.error('Welcome email delivery failed:', emailResult.reason?.message || emailResult.reason);
        }
        if (whatsappResult.status === 'rejected') {
            console.error('Welcome WhatsApp delivery failed:', whatsappResult.reason?.message || whatsappResult.reason);
        }
    });
};

// 2. Validate Input Format
const validateRegistration = (data) => {
    const { name, email, mobile, password, dob } = data;
    const errors = [];

    // Name: Letters and spaces only, 3-50 chars
    if (!/^[a-zA-Z\s]{3,50}$/.test(name)) errors.push("Name must contain only alphabets and be 3+ characters.");

    // Email: Standard regex
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format.");

    // Mobile: 10 digits only
    if (!/^[0-9]{10}$/.test(mobile)) errors.push("Mobile must be 10 digits.");

    // Password: Min 6 chars
    if (!password || password.length < 6) errors.push("Password too short (min 6 chars).");
    // DOB: Optional, must be YYYY-MM-DD if provided
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) errors.push("DOB must be in YYYY-MM-DD format.");

    return errors;
};

// --- CONTROLLERS ---

exports.sendOtp = async (req, res) => {
    try {
        const mobile = sanitize(req.body.mobile);
        const identifier = sanitize(req.body.identifier).toLowerCase();
        const purpose = normalizeOtpPurpose(req.body.purpose);

        let user = null;
        let otpIdentity = mobile;
        if (purpose === 'login' || purpose === 'password_reset') {
            const lookupIdentifier = purpose === 'login' ? identifier : (identifier || mobile);
            if (!lookupIdentifier) {
                return res.status(400).json({
                    message: purpose === 'password_reset'
                        ? 'Enter your registered email or mobile number.'
                        : 'Enter a valid registered email.'
                });
            }

            if (purpose === 'login' && !isEmail(lookupIdentifier)) {
                return res.status(400).json({ message: 'Enter a valid registered email.' });
            }

            user = await resolveUserByIdentifier(lookupIdentifier);
            if (!user) {
                return res.status(400).json({
                    message: purpose === 'password_reset'
                        ? 'No account found for that email or mobile number.'
                        : 'Email not registered'
                });
            }

            const hasEmail = Boolean(user.email && isEmail(user.email));
            const hasWhatsapp = /^[0-9]{10,12}$/.test(String(user.whatsapp || user.mobile || '').trim());
            if (!hasEmail && !hasWhatsapp) {
                return res.status(400).json({
                    message: 'OTP not sent. No active delivery channel found for this account.',
                    delivery: { purpose, attempted: [], sent: [], missing: ['email', 'whatsapp'], failed: [] }
                });
            }

            otpIdentity = hasEmail
                ? String(user.email).trim().toLowerCase()
                : String(user.whatsapp || user.mobile || '').trim();
        } else if (!/^[0-9]{10,12}$/.test(mobile)) {
            return res.status(400).json({ message: "Invalid mobile number." });
        }

        // 1. Generate OTP Here
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpStorageKey = OtpService.buildStorageKey(
            otpIdentity,
            purpose === 'login' ? 'login' : purpose === 'password_reset' ? 'password_reset' : 'mobile'
        );

        // 2. Save using our new Hybrid Service
        // - Local: Saves to RAM
        // - Prod: Saves to DB (Tests connection!)
        await OtpService.saveOtp(otpStorageKey, otp);

        const delivery = {
            purpose: purpose || 'general',
            attempted: [],
            sent: [],
            missing: [],
            failed: []
        };

        if ((purpose === 'login' || purpose === 'password_reset') && user) {
            const userEmail = String(user.email || '').trim();
            const whatsappMobile = String(user.whatsapp || user.mobile || '').trim();
            const isWhatsappMobileValid = /^[0-9]{10,12}$/.test(whatsappMobile);
            const canSendEmail = Boolean(userEmail && isEmail(userEmail));

            if (!canSendEmail) {
                delivery.missing.push('email');
            }

            if (!isWhatsappMobileValid) {
                delivery.missing.push('whatsapp');
            }

            if (!canSendEmail && !isWhatsappMobileValid) {
                return res.status(400).json({
                    message: 'OTP not sent. No active delivery channel found for this account.',
                    delivery
                });
            }

            delivery.contacts = {
                email: userEmail ? maskEmail(userEmail) : '',
                whatsapp: isWhatsappMobileValid ? maskMobile(whatsappMobile) : ''
            };

            if (canSendEmail) {
                const template = buildLoginOtpEmailTemplate({
                    user,
                    otp,
                    maskedWhatsapp: isWhatsappMobileValid ? maskMobile(whatsappMobile) : ''
                });
                await recordDeliveryAttempt(() => sendEmailCommunication({
                    to: userEmail,
                    subject: template.subject,
                    text: template.text,
                    html: template.html
                }), 'email', delivery);
            }
            if (isWhatsappMobileValid) {
                await recordDeliveryAttempt(() => sendWhatsapp({
                    to: whatsappMobile,
                    message: `Your SSC Jewellery OTP is ${otp}. Valid for 5 minutes.`,
                    template: 'login_otp',
                    data: { otp }
                }), 'whatsapp', delivery);
            }
        } else {
            if (!/^[0-9]{10,12}$/.test(mobile)) {
                delivery.missing.push('whatsapp');
            } else {
                delivery.contacts = {
                    whatsapp: maskMobile(mobile)
                };
                await recordDeliveryAttempt(() => sendWhatsapp({
                    to: mobile,
                    message: `Your SSC Jewellery OTP is ${otp}. Valid for 5 minutes.`,
                    template: 'login_otp',
                    data: { otp }
                }), 'whatsapp', delivery);
            }
        }

        if (!delivery.sent.length) {
            return res.status(502).json({
                message: 'OTP could not be delivered right now. Please retry.',
                delivery
            });
        }

        const payload = {
            message: purpose === 'password_reset' ? 'Password reset OTP generated' : 'OTP generated',
            delivery
        };
        if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'test') {
            payload.debug_otp = otp;
        }

        res.json(payload);

    } catch (error) {
        console.error("❌ OTP Error:", error);
        // Returns the specific DB error if in Prod
        res.status(500).json({ 
            message: "Error: " + error.message 
        });
    }
};
exports.register = async (req, res) => {
    try {
        // ... sanitize logic ...
        const safeData = {
            name: sanitize(req.body.name),
            email: sanitize(req.body.email).toLowerCase(),
            mobile: sanitize(req.body.mobile),
            password: req.body.password,
            otp: sanitize(req.body.otp),
            address: req.body.address,
            billingAddress: req.body.billingAddress,
            dob: req.body.dob || null
        };

        // ... validation logic ...
        const validationErrors = validateRegistration(safeData);
        if (validationErrors.length > 0) {
            return res.status(400).json({ message: validationErrors[0] });
        }

        // Check user existence
       
        const existingEmail = await User.findByEmail(safeData.email);
        const existingMobile = await User.findByMobile(safeData.mobile);

        if (existingEmail || existingMobile) {
            return res.status(409).json({ message: 'User already exists' });
        }

        // Verify OTP (Consume/Delete it here using 'true')
        const registerOtpKey = OtpService.buildStorageKey(safeData.mobile, 'mobile');
        const isValidOtp = await OtpService.verifyOtp(registerOtpKey, safeData.otp, true);
        if (!isValidOtp) return res.status(400).json({ message: 'Invalid or Expired OTP' });

        // Hash & Create
        const hashedPassword = await bcrypt.hash(safeData.password, 10);
        const user = await User.create({ 
            name: safeData.name, 
            email: safeData.email, 
            mobile: safeData.mobile, 
            password: hashedPassword, 
            address: safeData.address,
            billingAddress: safeData.billingAddress,
            dob: safeData.dob
        });

        const io = req.app.get('io');
        if (io) {
            emitToUserAudiences(io, user, 'user:create', User.toSafePayload(user));
        }
        const token = generateToken(user);
        dispatchWelcomeCommunication(user);
        res.status(201).json({ message: 'Registered successfully', token, user: User.toSafePayload(user) });

    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
exports.login = async (req, res) => {
    try {
        const { type, identifier, password, mobile, otp } = req.body;
        
        // Sanitize inputs
        const safeIdentifier = sanitize(identifier);
        const safeMobile = sanitize(mobile);

        let user;

        if (type === 'password') {
            const userByEmail = await User.findByEmail(identifier);
            const userByMobile = await User.findByMobile(identifier);
            user = userByEmail || userByMobile;
            if (!user) return res.status(400).json({ message: 'User not found' });
            if (rejectIfInactiveUser(user, res)) return;

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });
        } 
        else if (type === 'otp') {
            const otpIdentifier = String(safeIdentifier || safeMobile || '').trim().toLowerCase();
            if (!otpIdentifier) return res.status(400).json({ message: 'Email is required' });
            user = isEmail(otpIdentifier)
                ? await User.findByEmail(otpIdentifier)
                : await User.findByMobile(otpIdentifier);
            if (!user) return res.status(400).json({ message: 'User not found' });
            if (rejectIfInactiveUser(user, res)) return;

            const emailIdentity = String(user.email || '').trim().toLowerCase();
            if (!emailIdentity || !isEmail(emailIdentity)) {
                return res.status(400).json({ message: 'No email is registered for this account' });
            }
            const otpStorageKey = OtpService.buildStorageKey(emailIdentity, 'login');
            const isValidOtp = await OtpService.verifyOtp(otpStorageKey, sanitize(otp));
            if (!isValidOtp) return res.status(400).json({ message: 'Invalid OTP' });
        }

        try {
            const loyalty = await getUserLoyaltyStatus(user.id);
            if (loyalty?.tier) user.loyaltyTier = String(loyalty.tier).toLowerCase();
            if (loyalty?.profile) user.loyaltyProfile = loyalty.profile;
        } catch {}

        const token = generateToken(user);
        res.json({ message: 'Login successful', token, user: User.toSafePayload(user) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.socialLogin = async (req, res) => {
    try {
        const { idToken } = req.body;
        
        // 1. Verify Token
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const { email, name, picture } = decodedToken;

        // 2. Find or Create User
        let user = await User.findByEmail(email);
        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            const randomPassword = crypto.randomBytes(16).toString('hex');
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            const dummyMobile = null; // Or use a dummy number if your DB requires it

            // Create returns insertId usually, so we must construct the object manually
            const result = await User.create({
                name: name || 'Google User',
                email: email,
                mobile: dummyMobile,
                password: hashedPassword,
                address: null,
                role: 'customer'
            });

            // MANUALLY CONSTRUCT THE USER OBJECT FOR NEW USERS.
            // User.create() returns an object with `id` (string), not insertId.
            const createdUserId = (result && typeof result === 'object' && result.id)
                ? result.id
                : (result?.insertId || result);
            user = {
                id: createdUserId,
                name: name || 'Google User',
                email: email,
                role: 'customer',
                picture: picture
            };
        }
        if (rejectIfInactiveUser(user, res)) return;

        // 3. Trigger welcome communication for first-time Google users
        if (isNewUser) {
            dispatchWelcomeCommunication(user);
        }

        // 4. Generate Token
        const token = generateToken(user);
        
        // 5. Send Response
        res.json({ 
            message: 'Social Login successful', 
            token, 
            user: User.toSafePayload({ ...user, picture }) // Ensure 'role' is present in this object
        });

    } catch (error) {
        console.error("Social Auth Error:", error);
        error: error.message,
        res.status(401).json({ message: 'Invalid social auth token' });
    }
};

exports.getProfile = async (req, res) => {
    try {
        // `protect` middleware already resolves the latest user from DB.
        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: 'Not authorized' });
        }
        delete user.password;
        try {
            const loyalty = await getUserLoyaltyStatus(user.id);
            user.loyaltyTier = loyalty.tier;
            user.loyaltyProfile = loyalty.profile;
        } catch {}
        await issueBirthdayCouponForUser(user.id, { sendEmail: true }).catch(() => {});
        res.json({ user: User.toSafePayload(user) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getLoyaltyStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        const status = await getUserLoyaltyStatus(userId);
        return res.json({ status });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to fetch loyalty status' });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id; // From the JWT token
        const { name, email, mobile, password, address, billingAddress, profileImage, dob, birthdayOfferClaimedYear } = req.body;
        const safeName = sanitize(name);
        const safeEmail = email ? sanitize(email).toLowerCase() : '';
        const normalizeAddress = (value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
            return {
                line1: String(value.line1 || '').trim(),
                city: String(value.city || '').trim(),
                state: String(value.state || '').trim(),
                zip: String(value.zip || '').trim()
            };
        };

        if (name !== undefined && typeof name !== 'string') {
            return res.status(400).json({ message: 'Name must be a string' });
        }
        if (email !== undefined && typeof email !== 'string') {
            return res.status(400).json({ message: 'Email must be a string' });
        }
        if (mobile !== undefined && typeof mobile !== 'string') {
            return res.status(400).json({ message: 'Mobile must be a string' });
        }
        if (password !== undefined && typeof password !== 'string') {
            return res.status(400).json({ message: 'Password must be a string' });
        }
        if (profileImage !== undefined && typeof profileImage !== 'string' && profileImage !== null) {
            return res.status(400).json({ message: 'Profile image must be a string URL or null' });
        }
        if (birthdayOfferClaimedYear !== undefined && !Number.isInteger(Number(birthdayOfferClaimedYear))) {
            return res.status(400).json({ message: 'Birthday claim year must be a number' });
        }
        if (safeEmail && !isEmail(safeEmail)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }
        if (mobile && !/^\d{10,14}$/.test(String(mobile).trim())) {
            return res.status(400).json({ message: 'Mobile must contain 10-14 digits' });
        }
        if (password && String(password).length < 6) {
            return res.status(400).json({ message: 'Password too short (min 6 chars).' });
        }

        const normalizedAddress = address === undefined ? undefined : normalizeAddress(address);
        if (address !== undefined && normalizedAddress === null) {
            return res.status(400).json({ message: 'Address must be an object' });
        }
        const normalizedBillingAddress = billingAddress === undefined ? undefined : normalizeAddress(billingAddress);
        if (billingAddress !== undefined && normalizedBillingAddress === null) {
            return res.status(400).json({ message: 'Billing address must be an object' });
        }

        // 1. Check if mobile is already taken by ANOTHER user
        if (mobile) {
            const existingUser = await User.findByMobile(mobile);
            if (existingUser && existingUser.id !== userId) {
                return res.status(400).json({ message: 'Mobile number already in use' });
            }
        }
        if (safeEmail) {
            const existingEmail = await User.findByEmail(safeEmail);
            if (existingEmail && existingEmail.id !== userId) {
                return res.status(400).json({ message: 'Email already in use' });
            }
        }

        if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
            return res.status(400).json({ message: 'DOB must be in YYYY-MM-DD format' });
        }

        const existingUser = await User.findById(userId);
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        let dobLockedUpdate;
        if (dob !== undefined) {
            const incomingDob = dob === '' ? null : dob;
            const currentDob = existingUser.dob || null;
            const hasDobChanged = incomingDob !== currentDob;
            if (hasDobChanged && existingUser.dobLocked) {
                return res.status(400).json({ message: 'DOB can only be changed once after registration' });
            }
            if (hasDobChanged) {
                dobLockedUpdate = true;
            }
        }

        if (birthdayOfferClaimedYear !== undefined) {
            const yearNow = new Date().getFullYear();
            if (Number(birthdayOfferClaimedYear) !== yearNow) {
                return res.status(400).json({ message: 'Invalid birthday claim year' });
            }
            if (existingUser.birthdayOfferClaimedYear === yearNow) {
                return res.status(409).json({ message: 'Birthday offer already claimed this year' });
            }
            const dobValue = existingUser.dob;
            const [_, month, day] = String(dobValue || '').split('T')[0].split('-');
            const now = new Date();
            const isBirthdayToday = !!month && !!day && Number(month) === now.getMonth() + 1 && Number(day) === now.getDate();
            if (!isBirthdayToday) {
                return res.status(400).json({ message: 'Birthday offer can only be claimed on your birthday' });
            }
        }

        // 2. Hash Password if provided
        let hashedPassword = null;
        if (password) {
            hashedPassword = await bcrypt.hash(password, 10);
        }

        // 3. Update Database (You need to add this method to your User model)
        await User.updateProfile(userId, {
            name: safeName || undefined,
            email: safeEmail || undefined,
            mobile,
            address: normalizedAddress,
            billingAddress: normalizedBillingAddress,
            profileImage,
            dob: dob === '' ? null : dob,
            dobLocked: dobLockedUpdate,
            birthdayOfferClaimedYear: birthdayOfferClaimedYear === undefined ? undefined : birthdayOfferClaimedYear,
            password: hashedPassword
        });

        const updatedUser = await User.findById(userId);
        const io = req.app.get('io');
        if (io) {
            emitToUserAudiences(io, updatedUser, 'user:update', User.toSafePayload(updatedUser));
        }

        res.json({ message: 'Profile updated successfully', user: User.toSafePayload(updatedUser) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ... resetPassword logic (similar sanitization should apply) ...
exports.resetPassword = async (req, res) => {
    try {
        const identifier = sanitize(req.body.identifier || req.body.mobile).toLowerCase();
        const otp = sanitize(req.body.otp);
        const newPassword = req.body.newPassword;
        if (!identifier) return res.status(400).json({ message: 'Email or mobile number is required' });
        if (!newPassword || String(newPassword).length < 6) {
            return res.status(400).json({ message: 'Password too short (min 6 chars).' });
        }

        const user = await resolveUserByIdentifier(identifier);
        if (!user) return res.status(400).json({ message: 'User not found' });

        const otpIdentity = user.email && isEmail(user.email)
            ? String(user.email).trim().toLowerCase()
            : String(user.mobile || '').trim();
        if (!otpIdentity) {
            return res.status(400).json({ message: 'No reset channel is registered for this account' });
        }

        const resetOtpKey = OtpService.buildStorageKey(otpIdentity, 'password_reset');
        const isValidOtp = await OtpService.verifyOtp(resetOtpKey, otp);
        if (!isValidOtp) return res.status(400).json({ message: 'Invalid OTP' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.updatePasswordById(user.id, hashedPassword);

        res.json({ message: 'Password reset successful' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


exports.verifyOtpOnly = async (req, res) => {
    try {
        const identifier = sanitize(req.body.identifier || req.body.mobile).toLowerCase();
        const otp = sanitize(req.body.otp);
        const purpose = normalizeOtpPurpose(req.body.purpose);
        if (!identifier) {
            return res.status(400).json({ message: "Identifier is required", valid: false });
        }
        const verifyOtpKey = OtpService.buildStorageKey(
            identifier,
            purpose === 'login' ? 'login' : purpose === 'password_reset' ? 'password_reset' : 'mobile'
        );
        // Pass 'false' to NOT delete the OTP yet
        const isValid = await OtpService.verifyOtp(verifyOtpKey, otp, false);
        
        if (isValid) {
            res.json({ message: "OTP Verified", valid: true });
        } else {
            res.status(400).json({ message: "Invalid OTP", valid: false });
        }
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

exports.__test = {
    dispatchWelcomeCommunication
};
