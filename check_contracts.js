const db = require('./db');

db.serialize(() => {
    db.all(`
        SELECT c.*, u.nickname 
        FROM contracts c 
        JOIN users u ON c.tenant_id = u.id 
        ORDER BY building, room_number, c.id DESC
    `, [], (err, rows) => {
        if (err) console.error(err);
        console.log('Current Contracts:', rows);
    });
});
