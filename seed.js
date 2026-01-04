const db = require('./db');

db.serialize(() => {
    // 1. Create Users
    const insertUser = db.prepare(`INSERT INTO users (login_id, password, nickname, color, role) VALUES (?, ?, ?, ?, ?)`);
    insertUser.run('landlord1', 'pass123', 'Great Landlord', '#FF5733', 'landlord');
    insertUser.run('tenant1', 'pass456', 'Happy Tenant', '#33FF57', 'tenant');
    insertUser.run('tenant2', 'pass789', 'Sunny Tenant', '#3357FF', 'tenant');
    insertUser.finalize();

    // 2. Create Landlord-Tenant Relationships
    db.run(`INSERT INTO landlord_tenant (landlord_id, tenant_id, start_date) VALUES (1, 2, '2023-01-01')`);
    db.run(`INSERT INTO landlord_tenant (landlord_id, tenant_id, start_date) VALUES (1, 3, '2023-03-01')`);

    // 3. Create Contracts
    // Contract 1: Tenant1 with Landlord1 (Prepaid, Rent: 350,000, Management: 50,000)
    db.run(`INSERT INTO contracts (landlord_id, tenant_id, payment_type, contract_start_date, deposit, monthly_rent, management_fee) 
            VALUES (1, 2, 'prepaid', '2023-01-01', 5000000, 350000, 50000)`, function (err) {
        if (err) return console.error(err.message);
        const contract1Id = this.lastID;

        // Create monthly bills for contract 1 (Jan-Mar 2023)
        const insertBill = db.prepare(`INSERT INTO monthly_bills (contract_id, bill_month, rent, management_fee, total_amount) VALUES (?, ?, ?, ?, ?)`);
        insertBill.run(contract1Id, '2023-01', 350000, 50000, 400000);
        insertBill.run(contract1Id, '2023-02', 350000, 50000, 400000);
        insertBill.run(contract1Id, '2023-03', 350000, 50000, 400000);
        insertBill.finalize();
    });

    // Contract 2: Tenant2 with Landlord1 (Postpaid, Rent: 300,000, Management: 40,000)
    db.run(`INSERT INTO contracts (landlord_id, tenant_id, payment_type, contract_start_date, deposit, monthly_rent, management_fee) 
            VALUES (1, 3, 'postpaid', '2023-03-01', 3000000, 300000, 40000)`, function (err) {
        if (err) return console.error(err.message);
        const contract2Id = this.lastID;

        // Create monthly bills for contract 2 (Mar-Apr 2023)
        const insertBill = db.prepare(`INSERT INTO monthly_bills (contract_id, bill_month, rent, management_fee, total_amount) VALUES (?, ?, ?, ?, ?)`);
        insertBill.run(contract2Id, '2023-03', 300000, 40000, 340000);
        insertBill.run(contract2Id, '2023-04', 300000, 40000, 340000);
        insertBill.finalize();
    });

    // 4. Create Payments (Partial payments for tenant1's January bill)
    setTimeout(() => {
        // Tenant1 payments
        db.run(`INSERT INTO payments (tenant_id, amount, paid_at, memo) VALUES (2, 300000, '2023-01-05', 'January rent part 1')`, function (err) {
            if (err) return console.error(err.message);
            const payment1Id = this.lastID;
            // Match to January bill (bill_id = 1)
            db.run(`INSERT INTO bill_payment_match (bill_id, payment_id, matched_amount) VALUES (1, ?, 300000)`, [payment1Id]);
        });

        db.run(`INSERT INTO payments (tenant_id, amount, paid_at, memo) VALUES (2, 100000, '2023-01-10', 'January rent part 2')`, function (err) {
            if (err) return console.error(err.message);
            const payment2Id = this.lastID;
            // Match to January bill (bill_id = 1)
            db.run(`INSERT INTO bill_payment_match (bill_id, payment_id, matched_amount) VALUES (1, ?, 100000)`, [payment2Id]);
        });

        // Tenant2 full payment
        db.run(`INSERT INTO payments (tenant_id, amount, paid_at, memo) VALUES (3, 340000, '2023-03-05', 'March full payment')`, function (err) {
            if (err) return console.error(err.message);
            const payment3Id = this.lastID;
            // Match to March bill for tenant2 (bill_id = 4)
            db.run(`INSERT INTO bill_payment_match (bill_id, payment_id, matched_amount) VALUES (4, ?, 340000)`, [payment3Id]);
        });

        console.log('Seeding completed successfully.');
    }, 500);
});
