const db = require('./db');
const fs = require('fs');
const path = require('path');

async function migrate() {
    console.log('Starting migration v3...');

    // Backup
    try {
        const dbPath = path.join(__dirname, 'sugar.db');
        const backupPath = path.join(__dirname, 'sugar_backup_v3.db');
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, backupPath);
            console.log('Backed up database to sugar_backup_v3.db');
        }
    } catch (e) {
        console.log('Backup warn:', e.message);
    }

    const run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    const get = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    const all = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    try {
        await run("PRAGMA foreign_keys = OFF");

        // 1. Contracts Refactor
        console.log('Refactoring Contracts...');

        // Rename column (check if management_fee exists)
        try {
            await run("ALTER TABLE contracts RENAME COLUMN management_fee TO maintenance_fee");
            console.log("Renamed management_fee to maintenance_fee");
        } catch (e) {
            console.log('Column rename skipped (maybe already renamed):', e.message);
        }

        // Create contract_keywords
        await run(`
            CREATE TABLE IF NOT EXISTS contract_keywords (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contract_id INTEGER NOT NULL,
                keyword TEXT,
                FOREIGN KEY (contract_id) REFERENCES contracts(id)
            )
        `);

        // Migrate keywords
        // Check if keyword column exists before trying to select/drop
        try {
            const contractsWithKeywords = await all("SELECT id, keyword FROM contracts WHERE keyword IS NOT NULL AND keyword != ''");
            for (const c of contractsWithKeywords) {
                const arr = JSON.stringify([c.keyword]);
                await run("INSERT INTO contract_keywords (contract_id, keyword) VALUES (?, ?)", [c.id, arr]);
            }
            await run("ALTER TABLE contracts DROP COLUMN keyword");
            console.log("Migrated and dropped keyword column");
        } catch (e) {
            console.log('Keyword migration skipped (maybe column missing):', e.message);
        }


        // 2. Invoices (from Monthly Bills)
        console.log('Migrating invoices...');
        await run(`
            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contract_id INTEGER NOT NULL,
                type INTEGER NOT NULL,
                billing_month TEXT,
                due_date DATE,
                amount INTEGER NOT NULL,
                status TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (contract_id) REFERENCES contracts(id)
            )
        `);

        // Check if monthly_bills exists
        const hasMonthlyBills = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='monthly_bills'");
        if (hasMonthlyBills) {
            const bills = await all("SELECT * FROM monthly_bills");
            console.log(`Found ${bills.length} monthly bills to migrate.`);
            for (const b of bills) {
                // Check if invoice already exists with this ID to avoid duplicate key error if re-running
                const exists = await get("SELECT 1 FROM invoices WHERE id = ?", [b.id]);
                if (!exists) {
                    // Type 6: Rent(2) + Maintenance(4)
                    await run(`
                        INSERT INTO invoices (id, contract_id, type, billing_month, amount, status, created_at)
                        VALUES (?, ?, 6, ?, ?, 'unpaid', ?)
                    `, [b.id, b.contract_id, b.bill_month, b.total_amount, b.created_at]);
                }
            }
        }

        // 3. Payments
        console.log('Refactoring Payments...');
        const hasPayments = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='payments'");
        if (hasPayments) {
            // Check if it's already the new schema (has contract_id)
            const checkCol = await new Promise(r => db.all("PRAGMA table_info(payments)", (err, rows) => r(rows)));
            const hasContractId = checkCol.some(c => c.name === 'contract_id');

            if (!hasContractId) {
                console.log("Renaming old payments table...");
                await run("ALTER TABLE payments RENAME TO payments_old");

                console.log("Creating new payments table...");
                await run(`
                    CREATE TABLE IF NOT EXISTS payments (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        contract_id INTEGER NOT NULL,
                        amount INTEGER NOT NULL,
                        paid_at DATETIME NOT NULL,
                        type INTEGER NOT NULL, 
                        raw_text TEXT,
                        memo TEXT,
                        FOREIGN KEY (contract_id) REFERENCES contracts(id)
                    )
                `);

                const oldPayments = await all("SELECT * FROM payments_old");
                console.log(`Migrating ${oldPayments.length} payments...`);
                for (const p of oldPayments) {
                    let contract;
                    // Try to find contract covering the payment date
                    if (p.paid_at) {
                        contract = await get(`
                            SELECT id FROM contracts 
                            WHERE tenant_id = ? 
                            AND date(contract_start_date) <= date(?)
                            ORDER BY contract_start_date DESC LIMIT 1
                        `, [p.tenant_id, p.paid_at]);
                    }

                    if (!contract) {
                        contract = await get("SELECT id FROM contracts WHERE tenant_id = ? ORDER BY id DESC LIMIT 1", [p.tenant_id]);
                    }

                    if (contract) {
                        // Map Type
                        let newType = 2; // Default Rent
                        if (p.type === 2) newType = 1; // Deposit
                        else if (p.type === 4) newType = 32; // Credit/Other

                        await run(`
                            INSERT INTO payments (id, contract_id, amount, paid_at, type, memo)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `, [p.id, contract.id, p.amount, p.paid_at, newType, p.memo]);
                    } else {
                        console.log(`Skipping payment ${p.id} (no contract found for tenant ${p.tenant_id})`);
                    }
                }
            } else {
                console.log("Payments table seems to be already updated.");
            }
        }

        // 4. Allocations
        console.log('Migrating Allocations...');
        await run(`
            CREATE TABLE IF NOT EXISTS payment_allocation (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_id INTEGER NOT NULL,
                invoice_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                FOREIGN KEY (payment_id) REFERENCES payments(id),
                FOREIGN KEY (invoice_id) REFERENCES invoices(id)
            )
        `);

        // Migrate bill_payment_match
        const hasMatches = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='bill_payment_match'");
        if (hasMatches) {
            const matches = await all("SELECT * FROM bill_payment_match");
            console.log(`Migrating ${matches.length} allocations...`);
            for (const m of matches) {
                // Check if invoice and payment exist
                const exists = await get("SELECT 1 FROM invoices WHERE id = ? INTERSECT SELECT 1 FROM payments WHERE id = ?", [m.bill_id, m.payment_id]);
                if (exists) {
                    const allocExists = await get("SELECT 1 FROM payment_allocation WHERE payment_id = ? AND invoice_id = ?", [m.payment_id, m.bill_id]);
                    if (!allocExists) {
                        await run(`
                            INSERT INTO payment_allocation (payment_id, invoice_id, amount)
                            VALUES (?, ?, ?)
                        `, [m.payment_id, m.bill_id, m.matched_amount]);
                    }
                }
            }
        }

        // Cleanup
        // Confirm migration success before dropping? 
        // We'll just drop for now as requested by user intent (clean switch)
        if (hasMonthlyBills) await run("DROP TABLE monthly_bills");
        if (hasMatches) await run("DROP TABLE bill_payment_match");
        const hasPaymentsOld = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='payments_old'");
        if (hasPaymentsOld) await run("DROP TABLE payments_old");

        await run("PRAGMA foreign_keys = ON");
        console.log('Migration v3 complete.');

    } catch (err) {
        console.error('Migration failed:', err);
    }
}

migrate();
