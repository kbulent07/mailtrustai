'use strict';
// =============================================================
// @mailtrustai/customer-core — Customer-only kod için barrel paketi.
//
// Şu an dosyalar repo-root `src/` altında yaşıyor. Bu paket onları named
// export'lar üzerinden expose eder ki `apps/customer/server.js` artık
// path.join(REPO_ROOT, ...) gibi yol hack'leri yapmasın.
//
// Sonraki refactor adımı: `src/` → `packages/customer-core/src/` fiziksel
// taşıma. O zaman `_req`'i direct relative require'a çevir ve `src/` boşalt.
// =============================================================
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const _req = (p) => require(path.join(REPO_ROOT, p));

// Lazy + cached barrel — modül yüklenmesini ilk erişime kadar erteler.
// Bazı alt modüller (analysis, integrations) ağır; her server boot'unda
// hepsini eager yüklemek istemiyoruz.
function lazy(loader) {
    let cached;
    return () => (cached === undefined ? (cached = loader()) : cached);
}

const middleware = {
    adminAuth:    lazy(() => _req('src/middleware/adminAuth')),
    customerAuth: lazy(() => _req('src/middleware/customerAuth'))
};

const storage = {
    settingsStore:     lazy(() => _req('src/storage/settingsStore')),
    customerUserStore: lazy(() => _req('src/storage/customerUserStore')),
    monthlyCounter:    lazy(() => _req('src/storage/monthlyCounter')),
    dailyScansStore:   lazy(() => _req('src/storage/dailyScansStore')),
    autoMonitorState:  lazy(() => _req('src/storage/autoMonitorState')),
    scanHistory:       lazy(() => _req('src/storage/scanHistory'))
};

const services = {
    initialSetup: lazy(() => _req('src/services/initialSetupService')),
    setupToken:   lazy(() => _req('src/services/setupTokenService')),
    // scanMailbox: server.js boot sonrası resumeScanMailboxMonitors() çağırır
    // (anlık rapor monitörleri persistent ayarlardan yeniden başlatılır).
    scanMailbox:  lazy(() => _req('src/services/scanMailboxService'))
};

const license = {
    remoteValidator: lazy(() => _req('src/license/remoteValidator')),
    license:         lazy(() => _req('src/license/license'))
};

const websocketModule = lazy(() => _req('src/routes/websocket'));

const routes = {
    meta:           lazy(() => _req('src/interfaces/http/routes/meta.routes')),
    analyze:        lazy(() => _req('src/interfaces/http/routes/analyze.routes')),
    imap:           lazy(() => _req('src/interfaces/http/routes/imap.routes')),
    monitor:        lazy(() => _req('src/interfaces/http/routes/monitor.routes')),
    reports:        lazy(() => _req('src/interfaces/http/routes/reports.routes')),
    lists:          lazy(() => _req('src/interfaces/http/routes/lists.routes')),
    stats:          lazy(() => _req('src/interfaces/http/routes/stats.routes')),
    customer:       lazy(() => _req('src/interfaces/http/routes/customer.routes')),
    customerUsers:  lazy(() => _req('src/interfaces/http/routes/customerUsers.routes')),
    fpSuggestions:  lazy(() => _req('src/interfaces/http/routes/fpSuggestions.routes')),
    settings:       lazy(() => _req('src/interfaces/http/routes/settings.routes')),
    // licenseCustomer: customer-side endpoint'ler (fingerprint, lic-status, usage).
    // Admin endpoint'ler (generate/trial/revoke/...) license.routes.js'de — o dosya
    // yasak pattern icerdigi icin customer image build'inde Dockerfile silmiyor ama
    // check-customer-package fail etmesin diye mount ETMIYORUZ. Sadece bu split kaynak
    // mount edilir.
    licenseCustomer: lazy(() => _req('src/interfaces/http/routes/licenseCustomer.routes'))
};

// Sözleşme: tüketiciler ya direkt çağırır (`core.middleware.adminAuth()`) ya da
// destructure eder (`const adminAuth = core.middleware.adminAuth();`).
// Lazy proxy'leri normal modül davranışıyla aynı yapıyoruz: her isim ilk
// kullanımda çözümlenir.
module.exports = {
    middleware,
    storage,
    services,
    license,
    routes,
    websocket: websocketModule,
    // İstemciler için statik public klasör yolu — apps/customer artık bunu
    // kendi path.join(__dirname, ...) ile bulmaktan kurtulur.
    PUBLIC_DIR: path.join(REPO_ROOT, 'public')
};
