// ============================================================
// HISTORY STATE HELPER
// Defines global navigation state handling used by app.js.
// ============================================================

window.initializeNavigationState = function initializeNavigationState() {
    if (!history.state || !history.state.view) {
        history.replaceState({ view: 'main', mode: currentMode }, '', location.pathname);
    }

    window.addEventListener('popstate', (event) => {
        const state = event.state || { view: 'main', mode: currentMode };

        if (state.view === 'results' && state.resultId) {
            const cached = sessionStorage.getItem(`msa_result_${state.resultId}`);
            if (cached) {
                showResults(JSON.parse(cached), { pushHistory: false });
                return;
            }
        }

        if (typeof restoreMainView === 'function') {
            restoreMainView(state.mode || currentMode, false);
            return;
        }

        currentResult = null;
        document.getElementById('resultsPanel').classList.add('hidden');
        document.getElementById('scanModes').classList.remove('hidden');
        document.getElementById('vtResults').classList.add('hidden');
        document.getElementById('claudeResults').classList.add('hidden');
        selectMode(state.mode || currentMode, false);
    });
};
