const db = require('./db');

async function migrate() {
    console.log('Migrating notification types...');
    try {
        await new Promise((resolve, reject) => {
            db.run("UPDATE noti SET type = '공지' WHERE type = '공지사항'", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('Migration completed.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
