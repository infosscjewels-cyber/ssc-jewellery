const buildMissingHandlerError = (handlerName = '') => {
    const error = new Error(`Razorpay gateway handler "${String(handlerName || '').trim()}" is not configured.`);
    error.code = 'RAZORPAY_GATEWAY_HANDLER_MISSING';
    error.statusCode = 500;
    return error;
};

const invoke = (handlers, handlerName, req, res) => {
    const handler = handlers?.[handlerName];
    if (typeof handler !== 'function') {
        throw buildMissingHandlerError(handlerName);
    }
    return handler(req, res);
};

const createRazorpayGatewayAdapter = (handlers = {}) => ({
    createSession: (req, res) => invoke(handlers, 'createSession', req, res),
    createPublicSession: (req, res) => invoke(handlers, 'createPublicSession', req, res),
    verifyPayment: (req, res) => invoke(handlers, 'verifyPayment', req, res),
    verifyPublicPayment: (req, res) => invoke(handlers, 'verifyPublicPayment', req, res),
    getAttemptStatus: (req, res) => invoke(handlers, 'getAttemptStatus', req, res),
    getPublicAttemptStatus: (req, res) => invoke(handlers, 'getPublicAttemptStatus', req, res),
    retryPayment: (req, res) => invoke(handlers, 'retryPayment', req, res),
    handleWebhook: (req, res) => invoke(handlers, 'handleWebhook', req, res)
});

module.exports = {
    createRazorpayGatewayAdapter
};
