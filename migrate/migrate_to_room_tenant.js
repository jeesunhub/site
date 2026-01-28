const db = require('./db');

db.serialize(() => {
    console.log("Starting Migration: building_tenant -> room_tenant");

    // 1. Rename Table
    db.run("ALTER TABLE building_tenant RENAME TO room_tenant", (err) => {
        if (err) {
            console.warn("Table might already be renamed or not exist:", err.message);
        }

        // 2. Add temporary room_id column
        db.run("ALTER TABLE room_tenant ADD COLUMN room_id_new INTEGER", (err) => {
            // If already exists, ignore

            // 3. Populate room_id_new
            // Priority 1: Latest Contract Room
            // Priority 2: Any Room in the building (from old building_id)
            const updateSql = `
                UPDATE room_tenant 
                SET room_id_new = (
                    SELECT COALESCE(
                        (SELECT room_id FROM contracts WHERE tenant_id = room_tenant.tenant_id ORDER BY id DESC LIMIT 1),
                        (SELECT id FROM rooms WHERE building_id = room_tenant.building_id LIMIT 1)
                    )
                )
            `;

            db.run(updateSql, (err) => {
                if (err) console.error("Update failed:", err.message);
                else console.log("Data populated for room_id.");

                // SQLite doesn't support DROP COLUMN easily in older versions, 
                // but usually we recreate the table to clean up.
                // However, user just asked to rename building_id to room_id.

                // 4. Final Cleanup: In SQLite 3.35+, we can drop columns.
                // But safer way to perform renaming of column is to create new table and copy.
                recreateTable();
            });
        });
    });

    function recreateTable() {
        db.run("PRAGMA foreign_keys = OFF");
        db.run("BEGIN TRANSACTION");

        db.run(`CREATE TABLE room_tenant_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            tenant_id INTEGER NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE,
            FOREIGN KEY (room_id) REFERENCES rooms(id),
            FOREIGN KEY (tenant_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        db.run(`INSERT INTO room_tenant_new (id, room_id, tenant_id, start_date, end_date)
                SELECT id, COALESCE(room_id_new, 0), tenant_id, start_date, end_date FROM room_tenant`);

        db.run("DROP TABLE room_tenant");
        db.run("ALTER TABLE room_tenant_new RENAME TO room_tenant");

        db.run("COMMIT", (err) => {
            if (err) console.error("Commit failed:", err.message);
            else console.log("Migration completed successfully.");
            db.run("PRAGMA foreign_keys = ON");
            process.exit();
        });
    }
});
