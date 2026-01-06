const db = require('./db');

db.all("SELECT id, building, room_number, tenant_id, keyword FROM contracts ORDER BY id ASC", [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        rows.forEach((r, i) => {
            console.log(`Index ${i + 1} : ID=${r.id} | ${r.building} ${r.room_number} | Keyword: ${r.keyword}`);
        });
    }
});
