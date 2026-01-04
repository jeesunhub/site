const db = require('./db');

db.serialize(() => {
    db.all("SELECT nickname, COUNT(*) as count FROM users GROUP BY nickname HAVING count > 1", [], (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log('Duplicate Nicknames:', rows);

        if (rows.length > 0) {
            const nicknames = rows.map(r => r.nickname);
            const placeholders = nicknames.map(() => '?').join(',');
            db.all(`SELECT id, login_id, nickname, role, created_at FROM users WHERE nickname IN (${placeholders}) ORDER BY nickname, created_at DESC`, nicknames, (err, users) => {
                if (err) console.error(err);
                console.log('Users to merge:', users);
            });
        }
    });
});
