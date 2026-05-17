'use strict';
// ============================================================
// Geriye uyumluluk katmanı: adminAuth → customerAuth
//
// Eski monolith server.js silindiğinde bu referanslar customer
// rotalarında kaldı. Buradaki "admin" = müşteri admin kullanıcısı
// (MailTrustAI merkezi yönetim admin'i DEĞİL).
// ============================================================
const customerAuth = require('./customerAuth');

/**
 * Middleware: customer admin token gerektirir (role === 'admin').
 */
function requireAdminAuth(req, res, next) {
    return customerAuth.requireCustomerAdmin(req, res, next);
}

/**
 * Token'ı doğrular; geçerliyse payload döner, değilse null/false.
 * @param {string} token
 * @returns {object|null}
 */
function verifyAdminToken(token) {
    return customerAuth.parseCustomerToken(token);
}

module.exports = { requireAdminAuth, verifyAdminToken };
