const db = require('./db');

db.serialize(() => {
    console.log('Starting migration...');

    // Helper to run query safely (ignore if column exists)
    const safeRun = (query) => {
        db.run(query, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.log('Info/Error:', err.message);
            }
        });
    };

    safeRun("ALTER TABLE contracts ADD COLUMN keyword TEXT");
    safeRun("ALTER TABLE contracts ADD COLUMN building TEXT");
    safeRun("ALTER TABLE contracts ADD COLUMN room_number TEXT");

    // Give a moment for ALTERs to process
    setTimeout(() => {
        console.log('Backfilling keywords...');
        db.all("SELECT c.id, u.nickname FROM contracts c JOIN users u ON c.tenant_id = u.id", (err, rows) => {
            if (err) {
                console.error('Error fetching contracts:', err);
                return;
            }
            let count = 0;
            rows.forEach(row => {
                // Initialize keyword with nickname if empty
                db.run("UPDATE contracts SET keyword = ? WHERE id = ? AND (keyword IS NULL OR keyword = '')",
                    [row.nickname, row.id],
                    (err) => {
                        if (!err) count++;
                    }
                );
            });
            // Wait a bit to ensure updates finish before exiting (simple script approach)
            setTimeout(() => {
                console.log(`Updated ${count} contracts.`);
                console.log('Migration complete.');
            }, 1000);
        });
    }, 1000);
});
