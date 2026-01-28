const db = require('./db');

async function migrate() {
    console.log('Starting migration v6 (rename noti to messages)...');

    db.serialize(() => {
        // Check if messages table already exists
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'", (err, row) => {
            if (row) {
                console.log("messages table already exists.");
                return;
            }

            // Check if noti table exists
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='noti'", (err, row) => {
                if (row) {
                    console.log("Renaming noti table to messages...");
                    db.run("ALTER TABLE noti RENAME TO messages", (err) => {
                        if (err) console.error("Error renaming table:", err.message);
                        else console.log("Table renamed successfully.");
                    });
                } else {
                    console.log("noti table does not exist. Creating messages table...");
                    db.run(`
                        CREATE TABLE IF NOT EXISTS messages (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            author_id INTEGER,
                            title TEXT,
                            content TEXT,
                            type TEXT,
                            confirmed INTEGER DEFAULT 0,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (author_id) REFERENCES users(id)
                        )
                    `, (err) => {
                        if (err) console.error("Error creating messages table:", err.message);
                        else console.log("messages table created.");
                    });
                }
            });
        });
    });
}

migrate();
