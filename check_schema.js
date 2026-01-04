const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'sugar.db'));

db.all("PRAGMA table_info(rooms)", (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log(rows);
});
