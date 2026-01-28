const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'sugar.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // 1. Rename items table to item_advs
    db.run("ALTER TABLE items RENAME TO item_advs", (err) => {
        if (err) {
            if (err.message.includes('no such table')) {
                console.log('items table not found, possibly already renamed.');
            } else {
                console.error('Error renaming items table:', err.message);
            }
        } else {
            console.log('Renamed items table to item_advs');
        }
    });

    // 2. Create room_advs table
    const createRoomAdvs = `
        CREATE TABLE IF NOT EXISTS room_advs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            title TEXT,
            description TEXT,
            deposit INTEGER,
            rent INTEGER,
            management_fee INTEGER,
            cleaning_fee INTEGER,
            available_date TEXT,
            status INTEGER DEFAULT 0,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES rooms(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `;

    db.run(createRoomAdvs, (err) => {
        if (err) {
            console.error('Error creating room_advs table:', err.message);
        } else {
            console.log('Created room_advs table');
        }
    });

    db.close();
});
