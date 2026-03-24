export const isAdminUser = (user = null) => String(user?.role || '').toLowerCase() === 'admin';

export const canAccessAdminDashboard = (user = null) => {
    const role = String(user?.role || '').toLowerCase();
    return role === 'admin' || role === 'staff';
};

export const shouldRedirectAdminToDashboard = (user = null) => isAdminUser(user);
