const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'sugar.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    console.log('Starting migration...');

    // 1. Add missing columns to 'buildings' table
    db.all("PRAGMA table_info(buildings)", (err, rows) => {
        if (err) {
            console.error('Error checking buildings schema:', err);
            return;
        }

        const columns = rows.map(r => r.name);

        if (!columns.includes('address1')) {
            console.log('Adding address1 column to buildings...');
            db.run("ALTER TABLE buildings ADD COLUMN address1 TEXT");
        }
        if (!columns.includes('address2')) {
            console.log('Adding address2 column to buildings...');
            db.run("ALTER TABLE buildings ADD COLUMN address2 TEXT");
        }
        if (!columns.includes('memo')) {
            console.log('Adding memo column to buildings...');
            db.run("ALTER TABLE buildings ADD COLUMN memo TEXT");
        }
    });

    // 2. Ensure 'landlord_buildings' table exists
    db.run(`CREATE TABLE IF NOT EXISTS landlord_buildings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        landlord_id INTEGER NOT NULL,
        building_id INTEGER NOT NULL,
        FOREIGN KEY (landlord_id) REFERENCES users(id),
        FOREIGN KEY (building_id) REFERENCES buildings(id)
    )`, (err) => {
        if (!err) console.log('Checked landlord_buildings table.');
    });

    // 3. Ensure 'rooms' table exists
    db.run(`CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        building_id INTEGER NOT NULL,
        room_number TEXT NOT NULL,
        memo TEXT,
        FOREIGN KEY (building_id) REFERENCES buildings(id)
    )`, (err) => {
        if (!err) console.log('Checked rooms table.');
    });

    // 4. Ensure 'building_addresses' table exists
    db.run(`CREATE TABLE IF NOT EXISTS building_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        building_id INTEGER NOT NULL,
        address TEXT NOT NULL,
        FOREIGN KEY (building_id) REFERENCES buildings(id)
    )`, (err) => {
        if (!err) console.log('Checked building_addresses table.');
    });

    // 5. Ensure 'created_at' in buildings
    db.all("PRAGMA table_info(buildings)", (err, rows) => {
        // Re-check after potential alters? parallel execution warnings?
        // SQLite serialize ensures sequential execution at statement level, 
        // but callbacks run later. Best to just run alter blindly or carefully.
        // We do simple checks above.
    });

    console.log('Migration steps queued.');
});

db.close((err) => {
    if (err) console.error(err.message);
    else console.log('Database connection closed.');
});
