const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('sugar.db');

db.all(`SELECT c.id, c.tenant_id, u.nickname FROM contracts c JOIN users u ON c.tenant_id = u.id`, [], (err, rows) => {
    if (err) console.error(err);
    else console.log(JSON.stringify(rows, null, 2));
    db.close();
});
