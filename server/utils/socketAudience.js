const getSocketRoomsForUser = ({ userId = null, role = '' } = {}) => {
    const rooms = [];
    const normalizedUserId = String(userId || '').trim();
    const normalizedRole = String(role || '').trim().toLowerCase();
    if (normalizedUserId) {
        rooms.push(`user:${normalizedUserId}`);
    }
    if (normalizedRole === 'admin' || normalizedRole === 'staff') {
        rooms.push('admin');
    }
    return rooms;
};

const canAuthenticateSocketUser = (user = null) => {
    if (!user) return false;
    if (user.isActive === false) return false;
    const userId = String(user.id || '').trim();
    return Boolean(userId);
};

const emitToOrderAudiences = (io, order = null, eventName = '', payload = {}) => {
    if (!io || !order || !eventName) return;
    io.to('admin').emit(eventName, payload);
    if (order?.user_id) {
        io.to(`user:${order.user_id}`).emit(eventName, payload);
    }
};

const emitToUserAudiences = (io, user = null, eventName = '', payload = {}) => {
    if (!io || !eventName) return;
    io.to('admin').emit(eventName, payload);
    const userId = String(
        user?.id
        || user?.userId
        || payload?.id
        || payload?.userId
        || ''
    ).trim();
    if (userId) {
        io.to(`user:${userId}`).emit(eventName, payload);
    }
};

module.exports = {
    canAuthenticateSocketUser,
    getSocketRoomsForUser,
    emitToOrderAudiences,
    emitToUserAudiences
};
