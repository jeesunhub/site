const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('sugar.db');

db.all(`SELECT id, login_id, nickname FROM users`, [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        const counts = {};
        rows.forEach(r => {
            counts[r.login_id] = (counts[r.login_id] || 0) + 1;
        });
        const dups = Object.entries(counts).filter(([id, count]) => count > 1);
        console.log('Duplicates:', dups);
        console.log('All users:', JSON.stringify(rows, null, 2));
    }
    db.close();
});
