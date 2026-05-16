'use strict';

const ALLOWED_FIELDS = [
    'customerId',
    'companyName',
    'dealerId',
    'licenseStatus',
    'plan',
    'tier',
    'expiresAt',
    'instanceId',
    'appVersion',
    'lastHeartbeatAt',
    'onlineStatus',
    'healthStatus',
    'monthlyScanCount',
    'enabledFeatures',
    'localPolicyVersion',
    'localWhitelistVersion',
    'localBlacklistVersion',
    'localApiConfigVersion'
];

function sanitizeCustomerStatusRow(row) {
    const out = {};
    for (const key of ALLOWED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(row || {}, key)) out[key] = row[key];
    }
    if (!out.enabledFeatures || typeof out.enabledFeatures !== 'object') out.enabledFeatures = {};
    return out;
}

function sanitizeCustomerStatusList(rows) {
    return (rows || []).map(sanitizeCustomerStatusRow);
}

module.exports = {
    ALLOWED_FIELDS,
    sanitizeCustomerStatusRow,
    sanitizeCustomerStatusList
};
