const db = require('./db');

db.serialize(() => {
    console.log('--- Searching in buildings table ---');
    db.all("SELECT * FROM buildings WHERE name LIKE '%슈슈하우스%'", [], (err, rows) => {
        if (err) console.error(err);
        console.log(rows);
    });

    console.log('--- Searching in contracts table ---');
    db.all("SELECT * FROM contracts WHERE building LIKE '%슈슈하우스%'", [], (err, rows) => {
        if (err) console.error(err);
        console.log(rows);
    });
});
