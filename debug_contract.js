const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('sugar.db');

db.get(`SELECT * FROM contracts WHERE id = 7`, [], (err, row) => {
    if (err) console.error(err);
    else console.log('Contract 7:', JSON.stringify(row, null, 2));
    db.close();
});
