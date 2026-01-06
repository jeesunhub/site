const db = require('./db');
db.all(`SELECT c.id, c.building, c.room_number, c.keyword, u.nickname 
        FROM contracts c JOIN users u ON c.tenant_id = u.id ORDER BY c.id ASC`, [], (err, rows) => {
    console.log(rows);
});
