const db = require('./db');

async function runMigration() {
    const columns = [
        { table: 'rooms', name: 'status', type: 'INTEGER DEFAULT 0' },
        { table: 'rooms', name: 'deposit', type: 'INTEGER' },
        { table: 'rooms', name: 'rent', type: 'INTEGER' },
        { table: 'rooms', name: 'management_fee', type: 'INTEGER' },
        { table: 'rooms', name: 'available_date', type: 'TEXT' }
    ];

    for (const col of columns) {
        await new Promise((resolve) => {
            db.run(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.type}`, (err) => {
                if (err) {
                    if (err.message.includes('duplicate column name')) {
                        console.log(`Column '${col.name}' in '${col.table}' already exists.`);
                    } else {
                        console.error(`Error adding column '${col.name}' to '${col.table}':`, err.message);
                    }
                } else {
                    console.log(`Column '${col.name}' added to '${col.table}' successfully.`);
                }
                resolve();
            });
        });
    }
    process.exit(0);
}

runMigration();
