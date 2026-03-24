let NodemailerLib = null;
let transporter = null;
const fs = require('fs');
const path = require('path');

const toBoolean = (value, fallback = false) => {
    if (value == null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const normalizeAddressList = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const resolveInlineImageAttachments = (html = '') => {
    const source = String(html || '');
    if (!source) return { html: source, attachments: [] };

    const seen = new Map();
    let counter = 0;
    const rewritten = source.replace(
        /(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi,
        (full, prefix, src, suffix) => {
            const rawSrc = String(src || '').trim();
            if (!rawSrc || /^https?:\/\//i.test(rawSrc) || rawSrc.startsWith('cid:') || rawSrc.startsWith('data:')) {
                return full;
            }
            if (!rawSrc.startsWith('/uploads/')) return full;
            const normalized = rawSrc.replace(/^\/+/, '');
            const absolutePath = path.join(__dirname, '../../../../client/public', normalized);
            if (!fs.existsSync(absolutePath)) return full;

            let cid = seen.get(rawSrc);
            if (!cid) {
                counter += 1;
                cid = `inline-upload-${Date.now()}-${counter}@ssc`;
                seen.set(rawSrc, cid);
            }
            return `${prefix}cid:${cid}${suffix}`;
        }
    );

    const attachments = Array.from(seen.entries()).map(([src, cid]) => ({
        filename: path.basename(src),
        path: path.join(__dirname, '../../../../client/public', src.replace(/^\/+/, '')),
        cid
    }));

    return { html: rewritten, attachments };
};

const getEmailConfig = () => {
    const host = String(process.env.SMTP_HOST || '').trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const user = String(process.env.SMTP_USER || '').trim();
    const pass = String(process.env.SMTP_PASS || '').trim();
    const secure = toBoolean(process.env.SMTP_SECURE, port === 465);
    const fromEmail = String(process.env.MAIL_FROM_EMAIL || user || '').trim();
    const fromName = String(process.env.MAIL_FROM_NAME || 'SSC Jewellery').trim();

    return {
        host,
        port,
        user,
        pass,
        secure,
        fromEmail,
        fromName
    };
};

const getDefaultFrom = ({ fromEmail, fromName }) => {
    if (!fromEmail) return '';
    if (!fromName) return fromEmail;
    return `${fromName} <${fromEmail}>`;
};

const getTransporter = () => {
    if (transporter) return transporter;

    if (!NodemailerLib) {
        // Lazy import keeps server booting even if package is not yet installed.
        // eslint-disable-next-line global-require
        NodemailerLib = require('nodemailer');
    }

    const config = getEmailConfig();
    if (!config.host || !config.port || !config.user || !config.pass) {
        throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS.');
    }

    transporter = NodemailerLib.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass
        }
    });

    return transporter;
};

const verifyEmailTransport = async () => {
    const mailer = getTransporter();
    await mailer.verify();
    return { ok: true };
};

const sendEmail = async ({
    to,
    subject,
    text = '',
    html = '',
    from = null,
    replyTo = null,
    cc = null,
    bcc = null,
    attachments = []
}) => {
    const recipients = normalizeAddressList(to);
    if (!recipients.length) {
        throw new Error('Email recipient is required');
    }
    if (!subject || !String(subject).trim()) {
        throw new Error('Email subject is required');
    }

    const config = getEmailConfig();
    const mailer = getTransporter();
    const finalFrom = from || getDefaultFrom(config);
    if (!finalFrom) {
        throw new Error('MAIL_FROM_EMAIL is not configured');
    }

    const inline = resolveInlineImageAttachments(html);
    const payload = {
        from: finalFrom,
        to: recipients.join(', '),
        subject: String(subject),
        text: String(text || ''),
        html: inline.html ? String(inline.html) : undefined,
        replyTo: replyTo || undefined,
        cc: normalizeAddressList(cc).join(', ') || undefined,
        bcc: normalizeAddressList(bcc).join(', ') || undefined,
        attachments: [...inline.attachments, ...(Array.isArray(attachments) ? attachments : [])].length
            ? [...inline.attachments, ...(Array.isArray(attachments) ? attachments : [])]
            : undefined
    };

    const result = await mailer.sendMail(payload);
    return {
        ok: true,
        messageId: result?.messageId || null,
        accepted: result?.accepted || [],
        rejected: result?.rejected || [],
        response: result?.response || null
    };
};

module.exports = {
    sendEmail,
    verifyEmailTransport
};
