const db = require('./db');
const { v4: uuidv4 } = require('uuid');

function rowToTx(row) {
    return {
        id:           row.id,
        dealerCode:   row.dealer_code,
        type:         row.type,
        amount:       row.amount,
        note:         row.note,
        balanceAfter: row.balance_after,
        createdAt:    row.created_at
    };
}

function recordTransaction({ dealerCode, type, amount, note, balanceAfter }) {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO credit_transactions
        (id, dealer_code, type, amount, note, balance_after, created_at)
        VALUES (?,?,?,?,?,?,?)`)
        .run(id, dealerCode||'', type||'load', Number(amount)||0, note||'', Number(balanceAfter)||0, createdAt);
    return { id, dealerCode, type, amount: Number(amount), note: note||'', balanceAfter: Number(balanceAfter), createdAt };
}

function getTransactionsByDealer(code, limit = 100) {
    return db.prepare('SELECT * FROM credit_transactions WHERE dealer_code=? ORDER BY created_at DESC LIMIT ?')
        .all(code, Math.min(limit, 500)).map(rowToTx);
}

function getAllTransactions(limit = 1000) {
    return db.prepare('SELECT * FROM credit_transactions ORDER BY created_at DESC LIMIT ?')
        .all(Math.min(limit, 5000)).map(rowToTx);
}

module.exports = { recordTransaction, getTransactionsByDealer, getAllTransactions };
