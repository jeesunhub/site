const db = require('./db');
db.all("PRAGMA table_info(advertisements)", [], (err, rows) => {
    if (err) console.error(err);
    else {
        console.log('--- Advertisements table ---');
        rows.forEach(r => console.log(r.name));
    }
    process.exit();
});
