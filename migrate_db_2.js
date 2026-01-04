const db = require('./db');

db.serialize(() => {
    console.log('Starting migration part 2...');

    const safeRun = (query) => {
        db.run(query, (err) => {
            if (err && !err.message.includes('duplicate column') && !err.message.includes('already exists')) {
                console.log('Info/Error:', err.message);
            }
        });
    };

    safeRun("ALTER TABLE users ADD COLUMN birth_date TEXT");
    safeRun("ALTER TABLE users ADD COLUMN phone_number TEXT");

    safeRun(`CREATE TABLE IF NOT EXISTS buildings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address1 TEXT,
        address2 TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    safeRun(`CREATE TABLE IF NOT EXISTS landlord_buildings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        landlord_id INTEGER NOT NULL,
        building_id INTEGER NOT NULL,
        FOREIGN KEY (landlord_id) REFERENCES users(id),
        FOREIGN KEY (building_id) REFERENCES buildings(id)
    )`);

    safeRun(`CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        building_id INTEGER NOT NULL,
        room_number TEXT NOT NULL,
        memo TEXT,
        FOREIGN KEY (building_id) REFERENCES buildings(id)
    )`);

    setTimeout(() => {
        console.log('Migration part 2 complete.');
    }, 1000);
});
