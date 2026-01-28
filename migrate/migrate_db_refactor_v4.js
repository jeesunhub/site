const db = require('./db');
const fs = require('fs');
const path = require('path');

async function migrate() {
    console.log('Starting migration v4...');

    // Backup
    try {
        const dbPath = path.join(__dirname, 'sugar.db');
        const backupPath = path.join(__dirname, 'sugar_backup_v4.db');
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, backupPath);
            console.log('Backed up database to sugar_backup_v4.db');
        }
    } catch (e) {
        console.log('Backup warn:', e.message);
    }

    const run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    const get = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    const all = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    try {
        await run("PRAGMA foreign_keys = OFF");

        // 1. Create new tables
        console.log('Creating advertisements and applicants tables...');

        await run(`
            CREATE TABLE IF NOT EXISTS advertisements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                related_id INTEGER,
                type TEXT, 
                title TEXT,
                description TEXT,
                price INTEGER,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT 
            )
        `);

        await run(`
            CREATE TABLE IF NOT EXISTS applicants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                advertisement_id INTEGER NOT NULL,
                status TEXT, 
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (advertisement_id) REFERENCES advertisements(id)
            )
        `);

        // 2. Migrate Room Advs
        const hasRoomAdvs = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='room_advs'");
        if (hasRoomAdvs) {
            console.log("Migrating room listings...");
            const rooms = await all("SELECT * FROM room_advs");
            for (const r of rooms) {
                // Map status: 0 (Selling) -> 'advertising'
                const status = (r.status === 0 || r.status === '0') ? 'advertising' : 'completed';

                await run(`
                    INSERT INTO advertisements (related_id, type, title, description, price, created_by, created_at, status)
                    VALUES (?, 'room', ?, ?, ?, ?, ?, ?)
                `, [
                    r.room_id,
                    r.title || ('Room ' + r.room_id),
                    r.description,
                    r.rent, // Assuming rent is the main price
                    r.created_by,
                    r.created_at,
                    status
                ]);
            }
        }

        // 3. Migrate Item Advs
        const hasItemAdvs = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='item_advs'");
        if (hasItemAdvs) {
            console.log("Migrating item listings...");
            const items = await all("SELECT * FROM item_advs");
            for (const i of items) {
                const status = 'advertising'; // Default
                await run(`
                    INSERT INTO advertisements (related_id, type, title, description, price, created_by, created_at, status)
                    VALUES (?, 'item', ?, ?, ?, ?, ?, ?)
                `, [
                    i.id, // Using existing ID as related_id (referrencing itself implicitly as legacy item)
                    i.name,
                    i.description,
                    i.price,
                    i.owner_id,
                    i.created_at,
                    status
                ]);
            }
        }

        // 4. Drop old tables
        if (hasRoomAdvs) await run("DROP TABLE room_advs");
        if (hasItemAdvs) await run("DROP TABLE item_advs");

        await run("PRAGMA foreign_keys = ON");
        console.log('Migration v4 complete.');

    } catch (err) {
        console.error('Migration failed:', err);
    }
}

migrate();
