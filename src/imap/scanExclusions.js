const { loadSettings } = require('../storage/settingsStore');

function normalizeEmailAddress(value) {
    return String(value || '').trim().toLowerCase();
}

function extractEmailAddress(value) {
    if (!value) return '';
    const first = Array.isArray(value) ? value[0] : value;
    if (!first) return '';

    if (typeof first === 'string') {
        const match = first.match(/<([^>]+)>/);
        return normalizeEmailAddress(match ? match[1] : first);
    }

    return normalizeEmailAddress(first.address || first.email || '');
}

function buildImapSenderExclusionSet(account, settings = loadSettings()) {
    const excluded = new Set();
    const ownEmail = normalizeEmailAddress(account?.email);
    if (ownEmail) excluded.add(ownEmail);

    for (const mailbox of settings.scanMailboxes || []) {
        const imapEmail = normalizeEmailAddress(mailbox?.imapEmail);
        const senderEmail = normalizeEmailAddress(mailbox?.senderSmtpEmail);
        if (imapEmail) excluded.add(imapEmail);
        if (senderEmail) excluded.add(senderEmail);
    }

    return excluded;
}

function getImapSenderSkipInfo({ account, from, settings }) {
    const fromEmail = extractEmailAddress(from);
    if (!fromEmail) return { skip: false, fromEmail: '' };

    const ownEmail = normalizeEmailAddress(account?.email);
    if (fromEmail === ownEmail) {
        return { skip: true, fromEmail, reason: 'self-sender' };
    }

    const excluded = buildImapSenderExclusionSet(account, settings);
    if (excluded.has(fromEmail)) {
        return { skip: true, fromEmail, reason: 'central-mailbox-sender' };
    }

    return { skip: false, fromEmail };
}

function isExcludedImapSender({ account, from, settings }) {
    return getImapSenderSkipInfo({ account, from, settings }).skip;
}

module.exports = {
    normalizeEmailAddress,
    extractEmailAddress,
    buildImapSenderExclusionSet,
    getImapSenderSkipInfo,
    isExcludedImapSender
};
