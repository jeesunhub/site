const db = require('./db');

console.log('Attempting to add status column to users table...');

const query = "ALTER TABLE users ADD COLUMN status INTEGER DEFAULT 1";

// Wait a bit for connection
setTimeout(() => {
    db.run(query, [], function (err) {
        if (err) {
            // Check for duplicate column error
            // Postgres error code 42701 is duplicate_column
            // Message usually contains "already exists"
            if (err.code === '42701' || (err.message && err.message.includes('already exists'))) {
                console.log("Column 'status' already exists. No action needed.");
            } else {
                console.error("Error adding column:", err);
            }
        } else {
            console.log("Success: Added 'status' column to users table.");
        }

        // Clean up connection if using PG pool
        if (db.pool) {
            console.log('Closing PG pool...');
            db.pool.end();
        }
    });
}, 1000);
