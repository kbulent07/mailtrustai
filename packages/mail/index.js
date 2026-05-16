'use strict';
const path = require('path');
const IM = path.resolve(__dirname, '..', '..', 'src', 'imap');
const SM = path.resolve(__dirname, '..', '..', 'src', 'smtp');

module.exports = {
    imap: {
        connection:          require(path.join(IM, 'connection')),
        connectionPool:      require(path.join(IM, 'connectionPool')),
        monitor:             require(path.join(IM, 'monitor')),
        scanner:             require(path.join(IM, 'scanner')),
        scanMailboxMonitor:  require(path.join(IM, 'scanMailboxMonitor')),
        scanExclusions:      require(path.join(IM, 'scanExclusions')),
        quarantineService:   require(path.join(IM, 'quarantineService'))
    },
    smtp: {
        sender:                require(path.join(SM, 'sender')),
        reportBuilder:         require(path.join(SM, 'reportBuilder')),
        periodicReportBuilder: require(path.join(SM, 'periodicReportBuilder'))
    }
};
