// ============================================================
// BROWSER NAVIGATION SUPPORT
// Keeps result view in sync with browser back/forward navigation.
// ============================================================

(function () {
    let suspendHistorySync = false;

    document.addEventListener('DOMContentLoaded', () => {
        if (typeof selectMode !== 'function' || typeof showResults !== 'function' || typeof resetView !== 'function') {
            return;
        }

        const originalSelectMode = selectMode;
        const originalShowResults = showResults;
        const originalResetView = resetView;

        window.selectMode = function patchedSelectMode(mode) {
            originalSelectMode(mode);

            if (!suspendHistorySync && (!history.state || history.state.view !== 'results')) {
                history.replaceState({ view: 'main', mode }, '', location.pathname);
            }
        };

        window.showResults = function patchedShowResults(data, options = {}) {
            const pushHistory = options.pushHistory !== false;
            originalShowResults(data);

            if (!suspendHistorySync && pushHistory && data?.id) {
                sessionStorage.setItem(`msa_result_${data.id}`, JSON.stringify(data));
                history.pushState({ view: 'results', mode: currentMode, resultId: data.id }, '', `${location.pathname}#result-${data.id}`);
            }
        };

        window.resetView = function patchedResetView() {
            if (!suspendHistorySync && history.state?.view === 'results') {
                history.back();
                return;
            }

            originalResetView();
        };

        if (!history.state || !history.state.view) {
            history.replaceState({ view: 'main', mode: currentMode }, '', location.pathname);
        }

        window.addEventListener('popstate', (event) => {
            const state = event.state || { view: 'main', mode: currentMode };
            suspendHistorySync = true;

            try {
                if (state.view === 'results' && state.resultId) {
                    const cached = sessionStorage.getItem(`msa_result_${state.resultId}`);
                    if (cached) {
                        window.showResults(JSON.parse(cached), { pushHistory: false });
                        return;
                    }
                }

                originalResetView();
                originalSelectMode(state.mode || currentMode);
            } finally {
                suspendHistorySync = false;
            }
        });
    });
})();
