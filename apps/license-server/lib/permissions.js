'use strict';
// ============================================================
// RBAC — Owner (merkezi panel) rolleri ve yetkileri
// ============================================================
// Tek kaynak: hem backend (requirePerm) hem UI (security-status →
// effectivePermissions) bu haritayı kullanır.

// Yetki anahtarları (capability)
const PERMISSIONS = [
    'users:manage',     // owner kullanıcı CRUD (yalnız super-admin)
    'settings:write',   // panel şifresi vb. ayarlar
    'licenses:read',
    'licenses:write',   // üret / revoke / renew / label / grace
    'dealers:read',
    'dealers:write',
    'customers:read',
    'customers:write',
    'transfers:read',
    'transfers:write',  // onay / red
    'billing:read',     // fatura / finansal bilgi
    'audit:read'
];

// Rol → yetki listesi
const ROLE_PERMISSIONS = {
    'super-admin': [...PERMISSIONS],  // her şey
    'admin': [
        'settings:write',
        'licenses:read', 'licenses:write',
        'dealers:read',  'dealers:write',
        'customers:read','customers:write',
        'transfers:read','transfers:write',
        'billing:read',
        'audit:read'
        // users:manage YOK
    ],
    'muhasebe': [
        'customers:read',
        'licenses:read',
        'billing:read',
        'audit:read'
        // hepsi salt-okunur / finansal
    ],
    'support': [
        'customers:read',
        'licenses:read',
        'transfers:read', 'transfers:write',
        'audit:read'
    ]
};

const ROLES = Object.keys(ROLE_PERMISSIONS);

// İnsan-okunur rol etiketleri (UI için)
const ROLE_LABELS = {
    'super-admin': 'Süper Admin (Owner)',
    'admin':       'Admin',
    'muhasebe':    'Muhasebe',
    'support':     'Destek'
};

function isValidRole(role) {
    return ROLES.includes(role);
}

function permsForRole(role) {
    return ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];
}

function roleHasPerm(role, perm) {
    const list = ROLE_PERMISSIONS[role];
    return Array.isArray(list) && list.includes(perm);
}

module.exports = {
    PERMISSIONS,
    ROLES,
    ROLE_LABELS,
    ROLE_PERMISSIONS,
    isValidRole,
    permsForRole,
    roleHasPerm
};
