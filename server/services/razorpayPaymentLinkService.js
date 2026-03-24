const { createRazorpayClient } = require('./razorpayService');

const toUnixSeconds = (date) => Math.floor(new Date(date).getTime() / 1000);

const createStandardPaymentLink = async ({
    amountSubunits,
    currency = 'INR',
    description = '',
    referenceId = null,
    customer = null,
    expireBy = null,
    callbackUrl = null,
    reminderEnable = true,
    notes = {}
}) => {
    const amount = Number(amountSubunits || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Valid amountSubunits is required');
    }

    const razorpay = await createRazorpayClient();
    const payload = {
        amount,
        currency: String(currency || 'INR').toUpperCase(),
        description: String(description || '').slice(0, 2048) || undefined,
        reference_id: referenceId ? String(referenceId).slice(0, 40) : undefined,
        customer: customer && (customer.name || customer.email || customer.contact)
            ? {
                name: customer.name ? String(customer.name).slice(0, 120) : undefined,
                email: customer.email ? String(customer.email).slice(0, 120) : undefined,
                contact: customer.contact ? String(customer.contact).slice(0, 20) : undefined
            }
            : undefined,
        notify: {
            sms: false,
            email: false
        },
        notes: notes && typeof notes === 'object' ? notes : undefined,
        reminder_enable: Boolean(reminderEnable)
    };

    if (expireBy) payload.expire_by = toUnixSeconds(expireBy);
    if (callbackUrl) {
        payload.callback_url = callbackUrl;
        payload.callback_method = 'get';
    }

    const result = await razorpay.paymentLink.create(payload);
    return {
        id: result?.id || null,
        shortUrl: result?.short_url || null,
        status: result?.status || null,
        raw: result
    };
};

module.exports = {
    createStandardPaymentLink
};
