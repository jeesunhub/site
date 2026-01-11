const db = require('./db');

const query = `
        SELECT 
            l.nickname as landlord_name,
            l.id as landlord_id,
            t.nickname as tenant_name,
            t.id as tenant_id,
            COALESCE(b.name, c.building) as building_name,
            b.id as building_id,
            c.id as contract_id,
            c.contract_start_date,
            c.payment_type,
            c.room_number,
            mb.bill_month,
            mb.total_amount as due_amount,
            COALESCE(SUM(bpm.matched_amount), 0) as paid_amount,
            MAX(p.paid_at) as last_paid_date
        FROM monthly_bills mb
        JOIN contracts c ON mb.contract_id = c.id
        JOIN users t ON c.tenant_id = t.id
        JOIN users l ON c.landlord_id = l.id
        LEFT JOIN buildings b ON c.building = b.name
        LEFT JOIN bill_payment_match bpm ON mb.id = bpm.bill_id
        LEFT JOIN payments p ON bpm.payment_id = p.id
        WHERE 1=1 AND t.approved != 2
        GROUP BY 
            l.nickname, l.id, 
            t.nickname, t.id, 
            COALESCE(b.name, c.building), b.id, 
            c.id, c.contract_start_date, c.payment_type, c.room_number,
            mb.id, mb.bill_month, mb.total_amount
        ORDER BY mb.bill_month DESC
`;

db.all(query, [], (err, rows) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(JSON.stringify(rows[0], null, 2));
    process.exit(0);
});
