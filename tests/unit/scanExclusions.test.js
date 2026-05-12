const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildImapSenderExclusionSet,
    extractEmailAddress,
    getImapSenderSkipInfo,
    isExcludedImapSender
} = require('../../src/imap/scanExclusions');

const settings = {
    scanMailboxes: [
        { imapEmail: 'central@example.com' },
        { imapEmail: 'forwarder@example.com', senderSmtpEmail: 'reports@example.com' }
    ]
};

test('extractEmailAddress normalizes string and object sender values', () => {
    assert.equal(extractEmailAddress('"Sender" <User@Example.COM>'), 'user@example.com');
    assert.equal(extractEmailAddress([{ address: 'Admin@Example.COM' }]), 'admin@example.com');
});

test('buildImapSenderExclusionSet includes own and central mailbox addresses', () => {
    const excluded = buildImapSenderExclusionSet({ email: 'owner@example.com' }, settings);

    assert.equal(excluded.has('owner@example.com'), true);
    assert.equal(excluded.has('central@example.com'), true);
    assert.equal(excluded.has('forwarder@example.com'), true);
    assert.equal(excluded.has('reports@example.com'), true);
});

test('getImapSenderSkipInfo skips self sender before central sender', () => {
    const info = getImapSenderSkipInfo({
        account: { email: 'Owner@Example.COM' },
        from: [{ address: 'owner@example.com' }],
        settings
    });

    assert.equal(info.skip, true);
    assert.equal(info.reason, 'self-sender');
    assert.equal(info.fromEmail, 'owner@example.com');
});

test('isExcludedImapSender skips configured central mailbox senders', () => {
    assert.equal(isExcludedImapSender({
        account: { email: 'owner@example.com' },
        from: { address: 'central@example.com' },
        settings
    }), true);

    assert.equal(isExcludedImapSender({
        account: { email: 'owner@example.com' },
        from: { address: 'external@example.com' },
        settings
    }), false);
});
