const db = require('./db');

db.serialize(() => {
    db.run("PRAGMA foreign_keys = OFF");

    // Rename old if exist
    db.run("ALTER TABLE building_tenant RENAME TO room_tenant", (err) => {
        // ignore err if already renamed
    });

    db.run("DROP TABLE IF EXISTS room_tenant_new");

    db.run(`CREATE TABLE room_tenant_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        tenant_id INTEGER NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE,
        FOREIGN KEY (room_id) REFERENCES rooms(id),
        FOREIGN KEY (tenant_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Migration logic
    const migrateSql = `
        INSERT INTO room_tenant_new (id, room_id, tenant_id, start_date, end_date)
        SELECT id, 
               COALESCE(
                   (SELECT room_id FROM contracts WHERE tenant_id = rt.tenant_id ORDER BY id DESC LIMIT 1),
                   (SELECT id FROM rooms WHERE building_id = rt.building_id LIMIT 1),
                   1 -- default fallback
               ),
               tenant_id, start_date, end_date
        FROM room_tenant rt
    `;

    db.run(migrateSql, (err) => {
        if (err) console.error("Migration data error:", err.message);
        else console.log("Data migrated.");

        db.run("DROP TABLE room_tenant");
        db.run("ALTER TABLE room_tenant_new RENAME TO room_tenant");
        db.run("PRAGMA foreign_keys = ON");
        console.log("Cleanup done.");
        process.exit();
    });
});
