const db = require('./db');

db.serialize(() => {
    console.log('--- Users 2 and 6 ---');
    db.all("SELECT * FROM users WHERE id IN (2, 6)", [], (err, rows) => {
        if (err) console.error(err);
        console.log(rows);
    });
});
