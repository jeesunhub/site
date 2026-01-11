const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'sugar.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Add status column to users table
    db.run("ALTER TABLE users ADD COLUMN status INTEGER DEFAULT 1", (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log('Column status already exists in users table.');
            } else {
                console.error('Error adding status column:', err.message);
            }
        } else {
            console.log('Added status column to users table with default 1 (Active).');
        }
    });

    db.close();
});
