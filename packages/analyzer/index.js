'use strict';
// Mevcut analiz motorunu paketleyen yüzey. src/analysis ve src/integrations
// fiziksel olarak yerinde kalır; bu paket import yüzeyi sağlar.
const path = require('path');
const A = path.resolve(__dirname, '..', '..', 'src', 'analysis');
const I = path.resolve(__dirname, '..', '..', 'src', 'integrations');

module.exports = {
    parser:              require(path.join(A, 'parser')),
    emailAnalyzer:       require(path.join(A, 'emailAnalyzer')),
    contentAnalyzer:     require(path.join(A, 'contentAnalyzer')),
    linkAnalyzer:        require(path.join(A, 'linkAnalyzer')),
    headerAnalyzer:      require(path.join(A, 'headerAnalyzer')),
    attachmentAnalyzer:  require(path.join(A, 'attachmentAnalyzer')),
    msgParser:           require(path.join(A, 'msgParser')),
    evidencePack:        require(path.join(A, 'evidencePack')),
    scorer:              require(path.join(A, 'scorer')),
    triage:              require(path.join(A, 'triage')),
    integrations: {
        openai:       require(path.join(I, 'openai')),
        claude:       require(path.join(I, 'claude')),
        virustotal:   require(path.join(I, 'virustotal')),
        otx:          require(path.join(I, 'otx')),
        threatIntel:  require(path.join(I, 'threatIntel')),
        webhook:      require(path.join(I, 'webhook'))
    }
};
