const db = require('./db');

db.serialize(() => {
    db.all("SELECT * FROM monthly_bills", [], (err, rows) => {
        if (err) console.error(err);
        console.log('Bills:', rows);
    });
});
