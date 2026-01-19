const db = require('./db');

console.log('Running query...');
const query = 'SELECT id, login_id, nickname, role, color, photo_path, status FROM users WHERE approved != 2 AND status != 0 ORDER BY role, nickname';

db.all(query, [], (err, rows) => {
    if (err) {
        console.error('Query Failed:', err);
    } else {
        console.log('Query Success. Rows:', rows ? rows.length : 'null');
        if (rows && rows.length > 0) {
            console.log(rows[0]);
        }
    }
});
