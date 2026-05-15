// ============================================================
// IMAP MONITÖR TANILAMA SCRIPTI
//   • IMAP hesapları (credentials.enc)
//   • Scan mailbox kayıtları (settings.json)
//   • Persisted auto-monitor entries (auto-monitor-state.json)
//   • Tarama geçmişinin son zamanları
//   • Her hesap için IMAP bağlantı testi
//
// Calistir:  node scripts/diagnose-imap-monitors.js
// ============================================================
'use strict';

const path = require('path');
const fs   = require('fs');
process.chdir(path.join(__dirname, '..'));

const { loadCredentials, testConnection } = require('../src/imap/connection');
const { loadSettings }   = require('../src/storage/settingsStore');
const db                 = require('../src/storage/db');

function hr() { console.log('─'.repeat(64)); }
function ok(s)   { console.log(`  \x1b[32m✓\x1b[0m  ${s}`); }
function warn(s) { console.log(`  \x1b[33m⚠\x1b[0m  ${s}`); }
function bad(s)  { console.log(`  \x1b[31m✗\x1b[0m  ${s}`); }
function info(s) { console.log(`  •  ${s}`); }
function section(t) { console.log(`\n\x1b[1;36m${t}\x1b[0m`); hr(); }

(async () => {
    console.log('\x1b[1mMailTrustAI — IMAP Monitör Tanılama\x1b[0m');
    console.log(`Tarih: ${new Date().toISOString()}`);
    hr();

    // ─── 1) IMAP hesapları ───────────────────────────────────────────────
    section('1) Kayıtlı IMAP hesapları (credentials.enc)');
    let credentials = [];
    try {
        credentials = loadCredentials();
        if (!credentials.length) {
            warn('Hiç kayıtlı IMAP hesabı yok.');
        } else {
            credentials.forEach(c => {
                const q = c.moveHighRiskToQuarantine === true ? '🚨 quarantine=AÇIK' : '   quarantine=kapalı';
                info(`${c.email}  →  ${c.host}:${c.port || 993}  | ${q}`);
            });
        }
    } catch (e) {
        bad('Credentials okunamadi: ' + e.message);
    }

    // ─── 2) Scan mailbox kayıtları ───────────────────────────────────────
    section('2) Tarama posta kutusu kayıtları (scanMailboxes)');
    let scanMailboxes = [];
    try {
        const settings = loadSettings();
        scanMailboxes = settings.scanMailboxes || [];
        if (!scanMailboxes.length) {
            warn('Hiç scan-mailbox kaydı yok.');
        } else {
            scanMailboxes.forEach(smb => {
                const en = smb.enabled !== false ? '\x1b[32mENABLED\x1b[0m' : '\x1b[31mDISABLED\x1b[0m';
                info(`${smb.imapEmail}  [${en}]  purpose=${smb.purpose || 'forwarder'}  mode=${smb.reportMode || 'risky'}`);
            });
        }
    } catch (e) {
        bad('Settings okunamadi: ' + e.message);
    }

    // ─── 3) Persisted auto-monitor entries ───────────────────────────────
    section('3) Persisted auto-monitor (websocket WS monitor)');
    try {
        const stateFile = path.join('data', 'auto-monitors.json');
        if (fs.existsSync(stateFile)) {
            const entries = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            if (!entries.length) {
                warn('Persisted WS monitor yok.');
            } else {
                entries.forEach(e => info(`${e.email}  (license=${(e.licenseKey || '').slice(0,8)}...)`));
            }
        } else {
            warn('data/auto-monitors.json yok — WS monitor kaydı yok.');
        }
    } catch (e) {
        bad('Auto-monitor state okunamadi: ' + e.message);
    }

    // ─── 4) Son taramaların zamanı (her hesap için) ──────────────────────
    section('4) Son tarama kayıtları (scan_history)');
    try {
        const rows = db.prepare(`
            SELECT
                COALESCE(imap_email, user_key) AS key,
                COUNT(*)            AS total,
                MAX(timestamp)      AS last_at,
                MIN(timestamp)      AS first_at
            FROM scan_history
            WHERE timestamp >= datetime('now', '-7 days')
            GROUP BY key
            ORDER BY last_at DESC
            LIMIT 20
        `).all();
        if (!rows.length) {
            bad('Son 7 günde HİÇ tarama kaydedilmedi.');
        } else {
            rows.forEach(r => {
                const last = new Date(r.last_at);
                const ageMin = Math.round((Date.now() - last.getTime()) / 60000);
                const ageStr = ageMin < 60 ? `${ageMin}dk önce` :
                               ageMin < 1440 ? `${Math.round(ageMin/60)}saat önce` :
                                              `${Math.round(ageMin/1440)}gün önce`;
                const tag = ageMin < 60 ? '\x1b[32m' : ageMin < 1440 ? '\x1b[33m' : '\x1b[31m';
                info(`${tag}${r.key || '(yok)'}\x1b[0m  son=${ageStr}  toplam=${r.total}`);
            });
        }
    } catch (e) {
        bad('scan_history sorgulanamadi: ' + e.message);
    }

    // ─── 5) IMAP bağlantı testleri ───────────────────────────────────────
    section('5) IMAP bağlantı testleri (her hesap)');
    if (!credentials.length) {
        warn('Test edilecek hesap yok.');
    } else {
        for (const acc of credentials) {
            process.stdout.write(`  →  ${acc.email} ... `);
            const t0 = Date.now();
            try {
                const r = await testConnection(acc);
                const dt = Date.now() - t0;
                if (r.success) console.log(`\x1b[32m✓ OK\x1b[0m (${dt}ms)`);
                else           console.log(`\x1b[31m✗ HATA\x1b[0m (${dt}ms): ${r.message}`);
            } catch (e) {
                console.log(`\x1b[31m✗ EXCEPTION\x1b[0m: ${e.message}`);
            }
        }
    }

    // ─── 6) Sunucu süreç bilgisi ─────────────────────────────────────────
    section('6) Süreç ipuçları');
    info(`Node: ${process.version}`);
    info(`Working dir: ${process.cwd()}`);
    info(`MSA_ENC_PASSWORD tanımlı mı? ${process.env.MSA_ENC_PASSWORD ? 'EVET' : 'HAYIR'}`);
    info(`MSA_LICENSE_SECRET tanımlı mı? ${process.env.MSA_LICENSE_SECRET ? 'EVET' : 'HAYIR'}`);

    hr();
    console.log('\nNot: Bu script yalnızca diski okur ve IMAP\'a TCP testi yapar.');
    console.log('Çalışan sunucu süreciyle (RAM\'deki monitor Map\'i) bağlantısı yoktur.');
    console.log('Eğer disk durumu sağlıklı görünüyor ama tarama yapılmıyorsa,');
    console.log('sunucuyu yeniden başlatın ve console loglarını izleyin:');
    console.log('  pm2 logs --lines 200       (pm2 kullanıyorsanız)');
    console.log('  journalctl -u mailtrustai  (systemd kullanıyorsanız)');
})().catch(e => {
    console.error('\x1b[31mTanılama hatası:\x1b[0m', e);
    process.exit(1);
});
