const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'sugar.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    // Check if the 'building' column exists in 'rooms' table
    // (Note: The user asked for building, floor, unit columns. 
    // Assuming 'unit' is similar to 'room_number' or a new column.
    // 'building_id' already exists, but user asked for 'building'. 
    // This might be redundant or they mean 'building_name' string? 
    // Given the context of existing 'building_id' foreign key, 
    // maybe they want the denormalized name or just a new structural column.
    // I will add 'building' (TEXT), 'floor' (INTEGER), 'unit' (TEXT) as requested.
    // However, since 'building_id' exists, 'building' column might be for something else or legacy.
    // I will strictly follow the request: add building, floor, unit columns.)

    const columnsToAdd = [
        { name: 'building', type: 'TEXT' },
        { name: 'floor', type: 'INTEGER' },
        { name: 'unit', type: 'TEXT' }
    ];

    columnsToAdd.forEach(col => {
        db.run(`ALTER TABLE rooms ADD COLUMN ${col.name} ${col.type}`, (err) => {
            if (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log(`Column '${col.name}' already exists.`);
                } else {
                    console.error(`Error adding column '${col.name}':`, err.message);
                }
            } else {
                console.log(`Column '${col.name}' added successfully.`);
            }
        });
    });
});
