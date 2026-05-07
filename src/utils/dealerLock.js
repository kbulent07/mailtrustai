// Per-dealer mutex — prevents concurrent credit deductions from the same dealer.
// Works even if file I/O is later converted to async: the lock serialises
// the critical section (read balance → check → deduct) for each dealer code.
const pending = new Map();

async function withDealerLock(code, fn) {
    while (pending.has(code)) {
        await pending.get(code);
    }
    let release;
    const lock = new Promise(r => { release = r; });
    pending.set(code, lock);
    try {
        return await Promise.resolve(fn());
    } finally {
        pending.delete(code);
        release();
    }
}

module.exports = { withDealerLock };
