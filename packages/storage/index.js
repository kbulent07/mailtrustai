'use strict';
// Customer-side store'lar mevcut src/storage/ altında kalmaya devam eder.
// Bu paket re-export sağlar; gelecekte taşıma için sabit bir API yüzeyi.
const path = require('path');
const SRC = path.resolve(__dirname, '..', '..', 'src', 'storage');

module.exports = {
    db:                require(path.join(SRC, 'db')),
    settingsStore:     require(path.join(SRC, 'settingsStore')),
    monitorState:      require(path.join(SRC, 'monitorState')),
    autoMonitorState:  require(path.join(SRC, 'autoMonitorState')),
    scanHistory:       require(path.join(SRC, 'scanHistory')),
    auditLog:          require(path.join(SRC, 'auditLog')),
    allowlistStore:    require(path.join(SRC, 'allowlistStore')),
    customerUserStore: require(path.join(SRC, 'customerUserStore')),
    dailyScansStore:   require(path.join(SRC, 'dailyScansStore')),
    fpSuggestionStore: require(path.join(SRC, 'fpSuggestionStore')),
    llmUsageStore:     require(path.join(SRC, 'llmUsageStore')),
    monthlyCounter:    require(path.join(SRC, 'monthlyCounter')),
    otxCacheStore:     require(path.join(SRC, 'otxCacheStore')),
    patternStore:      require(path.join(SRC, 'patternStore')),
    trustedDomainStore:require(path.join(SRC, 'trustedDomainStore')),
    vtCacheStore:      require(path.join(SRC, 'vtCacheStore'))
};
