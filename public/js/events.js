// ============================================================
// EVENT DELEGATION — inline onclick azaltma (M1 fix)
// data-fn="funcName" data-arg="optionalArg" ile kullanilir.
// CSP script-src-attr unsafe-inline gereksinimini ortadan kaldirir.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // Compound (çok-adımlı) aksiyonlar için named action'lar
    const compoundActions = {
        'showHome_closeMenu':           () => { showPage('home');         closeMobileMenu(); },
        'showScan_closeMenu':           () => { showPage('scan');         closeMobileMenu(); },
        'showStats_closeMenu':          () => { showPage('stats');        closeMobileMenu(); },
        'showScanList_closeMenu':       () => { showPage('scan-list');    closeMobileMenu(); },
        'showOtxApproval_closeMenu':    () => { showPage('otx-approval');closeMobileMenu(); },
        'showLicense_closeMenu':        () => { showLicenseModal();        closeMobileMenu(); },
        'showSettings_closeMenu':       () => { showSettings();            closeMobileMenu(); },
        'showLang_closeMenu':           () => { toggleLang();              closeMobileMenu(); },
        'showScan_imap':                () => { showPage('scan');          selectMode('imap'); },
        'showScan_upload':              () => { showPage('scan');          selectMode('upload'); },
    };

    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-fn]');
        if (!el) return;
        const fn = el.dataset.fn;
        const arg = el.dataset.arg;
        // Compound action
        if (compoundActions[fn]) { compoundActions[fn](); return; }
        // Global function lookup
        const func = window[fn];
        if (typeof func === 'function') {
            arg !== undefined ? func(arg) : func();
        } else {
            console.warn('[events.js] Unknown data-fn:', fn);
        }
    });
});
