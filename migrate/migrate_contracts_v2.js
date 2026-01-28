const db = require('./db');

async function migrate() {
    console.log('Starting migration...');

    try {
        // 1. Add room_id to contracts if not exists
        await new Promise((resolve, reject) => {
            db.run('ALTER TABLE contracts ADD COLUMN room_id INTEGER', (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.log('room_id column might already exist or error:', err.message);
                } else {
                    console.log('Added room_id column to contracts.');
                }
                resolve();
            });
        });

        // 2. Ensure all rooms exist for existing contracts
        console.log('Ensuring all rooms exist...');
        const contracts = await new Promise((resolve, reject) => {
            db.all('SELECT DISTINCT building, room_number FROM contracts WHERE building IS NOT NULL AND room_number IS NOT NULL', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        for (const c of contracts) {
            // Find building ID by name
            const building = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM buildings WHERE name = ?', [c.building], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (building) {
                // Check if room exists
                const room = await new Promise((resolve, reject) => {
                    db.get('SELECT id FROM rooms WHERE building_id = ? AND room_number = ?', [building.id, c.room_number], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!room) {
                    console.log(`Creating room ${c.room_number} for building ${c.building}`);
                    await new Promise((resolve, reject) => {
                        db.run('INSERT INTO rooms (building_id, room_number) VALUES (?, ?)', [building.id, c.room_number], function (err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        });
                    });
                }
            } else {
                console.log(`Warning: Building ${c.building} not found for contract. Can't ensure room.`);
            }
        }

        // 3. Populate room_id in contracts
        console.log('Populating room_id in contracts...');
        await new Promise((resolve, reject) => {
            const updateSql = `
                UPDATE contracts 
                SET room_id = (
                    SELECT r.id 
                    FROM rooms r 
                    JOIN buildings b ON r.building_id = b.id 
                    WHERE b.name = contracts.building AND r.room_number = contracts.room_number
                )
                WHERE room_id IS NULL
            `;
            db.run(updateSql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
