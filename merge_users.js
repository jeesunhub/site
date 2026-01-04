const db = require('./db');

async function runSQL(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

async function getAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function mergeUsers() {
    try {
        const duplicates = await getAll("SELECT nickname, COUNT(*) as count FROM users GROUP BY nickname HAVING count > 1");

        for (const row of duplicates) {
            const nickname = row.nickname;
            if (!nickname) continue;

            const users = await getAll("SELECT id FROM users WHERE nickname = ? ORDER BY id DESC", [nickname]);
            const primaryId = users[0].id;
            const otherIds = users.slice(1).map(u => u.id);

            if (otherIds.length === 0) continue;

            console.log(`Merging ${nickname}: Keeping ${primaryId}, Merging from ${otherIds.join(', ')}`);

            const placeholders = otherIds.map(() => '?').join(',');

            // Update contracts
            await runSQL(`UPDATE contracts SET tenant_id = ? WHERE tenant_id IN (${placeholders})`, [primaryId, ...otherIds]);
            await runSQL(`UPDATE contracts SET landlord_id = ? WHERE landlord_id IN (${placeholders})`, [primaryId, ...otherIds]);

            // Update payments
            await runSQL(`UPDATE payments SET tenant_id = ? WHERE tenant_id IN (${placeholders})`, [primaryId, ...otherIds]);

            // Update landlord_tenant
            await runSQL(`UPDATE landlord_tenant SET tenant_id = ? WHERE tenant_id IN (${placeholders})`, [primaryId, ...otherIds]);
            await runSQL(`UPDATE landlord_tenant SET landlord_id = ? WHERE landlord_id IN (${placeholders})`, [primaryId, ...otherIds]);

            // Update landlord_buildings
            await runSQL(`UPDATE landlord_buildings SET landlord_id = ? WHERE landlord_id IN (${placeholders})`, [primaryId, ...otherIds]);

            // Delete old users
            await runSQL(`DELETE FROM users WHERE id IN (${placeholders})`, otherIds);
        }

        console.log('User merge complete.');
    } catch (err) {
        console.error('Error during merge:', err);
    }
}

mergeUsers();
