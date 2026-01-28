const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, "sugar.db");
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    // 1. users 테이블에 approved 컬럼 추가 (이미 있으면 무시)
    db.run(`ALTER TABLE users ADD COLUMN approved INTEGER DEFAULT 0`, (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log('Column "approved" already exists in "users" table.');
            } else {
                console.error('Error adding column "approved":', err.message);
            }
        } else {
            console.log('Column "approved" added to "users" table.');
        }
    });

    // 2. noti 테이블 생성
    db.run(`
        CREATE TABLE IF NOT EXISTS noti (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author_id INTEGER,
            title TEXT,
            content TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            type TEXT,
            confirmed INTEGER DEFAULT 0,
            FOREIGN KEY (author_id) REFERENCES users(id)
        )
    `, (err) => {
        if (err) {
            console.error('Error creating table "noti":', err.message);
        } else {
            console.log('Table "noti" created successfully.');
        }
    });

    // 3. Admin 계정 추가 (이미 있으면 무시)
    db.get(`SELECT id FROM users WHERE login_id = 'admin'`, (err, row) => {
        if (err) {
            console.error('Error checking for admin user:', err.message);
        } else if (!row) {
            db.run(`
                INSERT INTO users (login_id, password, nickname, role, approved)
                VALUES ('admin', 'adminQQQ', 'Jeesun', 'admin', 1)
            `, (err) => {
                if (err) {
                    console.error('Error inserting admin user:', err.message);
                } else {
                    console.log('Admin user "admin" created successfully.');
                }
            });
        } else {
            console.log('Admin user "admin" already exists.');
        }
    });
});

db.close();
