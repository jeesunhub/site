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

async function cleanupContracts() {
    try {
        // Find distinct building/room/tenant combinations
        const duplicates = await getAll(`
            SELECT tenant_id, building, room_number, COUNT(*) as count 
            FROM contracts 
            WHERE building IS NOT NULL 
            GROUP BY tenant_id, building, room_number 
            HAVING count > 1
        `);

        for (const row of duplicates) {
            const { tenant_id, building, room_number } = row;
            const contracts = await getAll(`
                SELECT id FROM contracts 
                WHERE tenant_id = ? AND building = ? AND room_number = ? 
                ORDER BY id DESC
            `, [tenant_id, building, room_number]);

            const targetId = contracts[0].id;
            const sourceIds = contracts.slice(1).map(c => c.id);

            for (const sourceId of sourceIds) {
                console.log(`Merging contract ${sourceId} into ${targetId} (${building} ${room_number})`);
                // Move bills
                await runSQL(`UPDATE OR IGNORE monthly_bills SET contract_id = ? WHERE contract_id = ?`, [targetId, sourceId]);
                // If there were conflicts, we might still have bills on sourceId. For simplicity, we delete them (they are duplicates).
                await runSQL(`DELETE FROM monthly_bills WHERE contract_id = ?`, [sourceId]);
                // Delete contract
                await runSQL(`DELETE FROM contracts WHERE id = ?`, [sourceId]);
            }
        }

        // Also handle contracts with null building for those tenants
        const allTenants = await getAll("SELECT DISTINCT tenant_id FROM contracts");
        for (const t of allTenants) {
            const valid = await getAll("SELECT id FROM contracts WHERE tenant_id = ? AND building IS NOT NULL ORDER BY id DESC LIMIT 1", [t.tenant_id]);
            if (valid.length > 0) {
                const targetId = valid[0].id;
                const ghosts = await getAll("SELECT id FROM contracts WHERE tenant_id = ? AND building IS NULL", [t.tenant_id]);
                for (const g of ghosts) {
                    console.log(`Moving bills from ghost contract ${g.id} to valid contract ${targetId}`);
                    await runSQL(`UPDATE OR IGNORE monthly_bills SET contract_id = ? WHERE contract_id = ?`, [targetId, g.id]);
                    await runSQL(`DELETE FROM monthly_bills WHERE contract_id = ?`, [g.id]);
                    await runSQL(`DELETE FROM contracts WHERE id = ?`, [g.id]);
                }
            }
        }

        console.log('Contract cleanup complete.');
    } catch (err) {
        console.error('Error during contract cleanup:', err);
    }
}

cleanupContracts();
