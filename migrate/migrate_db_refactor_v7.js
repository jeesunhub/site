const db = require('./db');

async function migrate() {
    console.log('Starting migration v7 (add message_recipient)...');

    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS message_recipient (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                recipient_id INTEGER NOT NULL,
                read_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES messages(id),
                FOREIGN KEY (recipient_id) REFERENCES users(id)
            )
        `, (err) => {
            if (err) console.error("Error creating message_recipient table:", err.message);
            else console.log("message_recipient table created (if not exists).");
            console.log("Migration v7 complete.");
        });
    });
}

migrate();
