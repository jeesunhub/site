const db = require('./db');

async function migrate() {
    console.log('Starting migration v5 (add items)...');

    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                title TEXT,
                description TEXT,
                status TEXT, -- 'open', 'closed', 'completed'
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id)
            )
        `, (err) => {
            if (err) console.error("Error creating items table:", err.message);
            else console.log("items table created (if not exists).");

            // Optional: ensure images comment reflects new type support (logic only, no schema change needed)
            console.log("Migration v5 complete.");
        });
    });
}

migrate();
