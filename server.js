const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./db');
const morgan = require('morgan');
const cors = require('cors');

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(morgan('dev'));
app.use(cors());
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

// Multer setup for photo uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Create uploads directory if not exists
const fs = require('fs');
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// --- API ROUTES ---

// 0. Test API
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'API is working' });
});

// 25. Search Building by Address Snippet (Moved up for priority)
app.get('/api/buildings/search-by-address', (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'Address required' });

    const searchTerm = `%${address.replace(/\s+/g, '').split('').join('%')}%`;
    const query = `
        SELECT DISTINCT b.* 
        FROM buildings b
        LEFT JOIN building_addresses ba ON b.id = ba.building_id
        WHERE REPLACE(b.address1, ' ', '') LIKE ? 
           OR REPLACE(b.address2, ' ', '') LIKE ? 
           OR REPLACE(ba.address, ' ', '') LIKE ?
        LIMIT 1
    `;
    db.get(query, [searchTerm, searchTerm, searchTerm], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || null);
    });
});

// 1. Login API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE login_id = ? AND password = ?`, [username, password], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        res.json({ message: 'Login successful', user });
    });
});

// 2. Profile API
app.put('/api/profile/:id', upload.single('photo'), (req, res) => {
    const { login_id, password, nickname, color } = req.body;
    const photo_path = req.file ? `/uploads/${req.file.filename}` : null;
    const userId = req.params.id;

    // First check if login_id is changing and if it is available
    db.get('SELECT id FROM users WHERE login_id = ? AND id != ?', [login_id, userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: 'Login ID already taken' });

        let query = `UPDATE users SET login_id = ?, nickname = ?, color = ?`;
        let params = [login_id, nickname, color];

        if (password) {
            query += `, password = ?`;
            params.push(password);
        }

        if (photo_path) {
            query += `, photo_path = ?`;
            params.push(photo_path);
        }
        query += ` WHERE id = ?`;
        params.push(userId);

        db.run(query, params, function (err) {
            if (err) return res.status(500).json({ error: err.message });
            // Return updated user object so frontend can update local storage
            db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Profile updated', user });
            });
        });
    });
});


// 2a. Admin Get All Users
app.get('/api/admin/users', (req, res) => {
    db.all('SELECT id, login_id, nickname, role, color, photo_path FROM users ORDER BY role, nickname', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2b. Change Password (Self)
app.post('/api/auth/change-password', (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;
    db.get('SELECT password FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'User not found' });

        if (String(row.password) !== String(currentPassword)) {
            return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
        }

        db.run('UPDATE users SET password = ? WHERE id = ?', [newPassword, userId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Password changed successfully' });
        });
    });
});

// 2c. Reset Password (Admin/Landlord)
app.post('/api/auth/reset-password', (req, res) => {
    const { targetUserId, newPassword } = req.body;
    db.run('UPDATE users SET password = ? WHERE id = ?', [newPassword, targetUserId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Password reset successfully' });
    });
});

// 3. Get Landlord's Tenants
app.get('/api/landlord/:id/tenants', (req, res) => {
    const landlordId = req.params.id;
    const query = `
        SELECT DISTINCT u.id, u.login_id, u.nickname, u.photo_path, u.color
        FROM users u
        JOIN landlord_tenant lt ON u.id = lt.tenant_id
        WHERE lt.landlord_id = ?
    `;
    db.all(query, [landlordId], (err, tenants) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(tenants);
    });
});

// 4. Get Tenant's Bills and Payments
app.get('/api/tenant/:id/billing', (req, res) => {
    const tenantId = req.params.id;
    const query = `
        SELECT 
            mb.id as bill_id,
            mb.bill_month,
            mb.total_amount,
            c.contract_start_date,
            c.payment_type,
            p.id as payment_id,
            p.amount as payment_amount,
            p.paid_at,
            p.memo,
            bpm.matched_amount
        FROM monthly_bills mb
        JOIN contracts c ON mb.contract_id = c.id
        LEFT JOIN bill_payment_match bpm ON mb.id = bpm.bill_id
        LEFT JOIN payments p ON bpm.payment_id = p.id
        WHERE c.tenant_id = ?
        ORDER BY mb.bill_month DESC, p.paid_at ASC
    `;

    db.all(query, [tenantId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Group by bill
        const billsMap = {};
        rows.forEach(row => {
            if (!billsMap[row.bill_id]) {
                billsMap[row.bill_id] = {
                    id: row.bill_id,
                    bill_month: row.bill_month,
                    total_amount: row.total_amount,
                    contract_start_date: row.contract_start_date,
                    payment_type: row.payment_type,
                    payments: []
                };
            }
            if (row.payment_id) {
                billsMap[row.bill_id].payments.push({
                    id: row.payment_id,
                    amount: row.payment_amount,
                    matched_amount: row.matched_amount,
                    paid_at: row.paid_at,
                    memo: row.memo
                });
            }
        });

        res.json(Object.values(billsMap));
    });
});

// 5. Add Payment
app.post('/api/payments', (req, res) => {
    const { tenant_id, amount, memo } = req.body;
    const paid_at = new Date().toISOString();

    db.run(`INSERT INTO payments (tenant_id, amount, paid_at, memo) VALUES (?, ?, ?, ?)`,
        [tenant_id, amount, paid_at, memo],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Payment recorded', paymentId: this.lastID });
        }
    );
});

// 6. Match Payment to Bill
app.post('/api/match-payment', (req, res) => {
    const { bill_id, payment_id, matched_amount } = req.body;

    db.run(`INSERT INTO bill_payment_match (bill_id, payment_id, matched_amount) VALUES (?, ?, ?)`,
        [bill_id, payment_id, matched_amount],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Payment matched to bill', matchId: this.lastID });
        }
    );
});

// 7. Get Unmatched Payments for a Tenant
app.get('/api/tenant/:id/unmatched-payments', (req, res) => {
    const tenantId = req.params.id;
    const query = `
        SELECT p.*, 
            COALESCE(SUM(bpm.matched_amount), 0) as total_matched,
            (p.amount - COALESCE(SUM(bpm.matched_amount), 0)) as remaining_amount
        FROM payments p
        LEFT JOIN bill_payment_match bpm ON p.id = bpm.payment_id
        WHERE p.tenant_id = ?
        GROUP BY p.id
        HAVING remaining_amount > 0
        ORDER BY p.paid_at ASC
    `;

    db.all(query, [tenantId], (err, payments) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(payments);
    });
});

// 8. Get Contract Details
app.get('/api/contracts/:id', (req, res) => {
    const contractId = req.params.id;
    const query = `
        SELECT c.*, 
            u1.nickname as tenant_nickname, u1.color as tenant_color,
            u2.nickname as landlord_nickname
        FROM contracts c
        JOIN users u1 ON c.tenant_id = u1.id
        JOIN users u2 ON c.landlord_id = u2.id
        WHERE c.id = ?
    `;

    db.get(query, [contractId], (err, contract) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!contract) return res.status(404).json({ error: 'Contract not found' });
        res.json(contract);
    });
});

// 9. Get Calendar Data for Tenant
app.get('/api/tenant/:id/calendar-data', (req, res) => {
    const tenantId = req.params.id;
    const query = `
        SELECT 
            c.contract_start_date,
            c.contract_end_date,
            c.payment_type,
            mb.bill_month,
            mb.total_amount,
            COALESCE(SUM(bpm.matched_amount), 0) as paid_amount
        FROM contracts c
        LEFT JOIN monthly_bills mb ON c.id = mb.contract_id
        LEFT JOIN bill_payment_match bpm ON mb.id = bpm.bill_id
        WHERE c.tenant_id = ?
        GROUP BY mb.id
        ORDER BY mb.bill_month ASC
    `;

    db.all(query, [tenantId], (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(data);
    });
});

// 10. Get Calendar Data for Landlord (All Tenants)
app.get('/api/landlord/:id/calendar-data', (req, res) => {
    const landlordId = req.params.id;
    const query = `
        SELECT 
            c.id as contract_id,
            c.tenant_id,
            c.contract_start_date,
            c.contract_end_date,
            c.payment_type,
            u.nickname as tenant_nickname,
            u.color as tenant_color,
            mb.id as bill_id,
            mb.bill_month,
            mb.total_amount,
            COALESCE(SUM(bpm.matched_amount), 0) as paid_amount
        FROM contracts c
        JOIN users u ON c.tenant_id = u.id
        LEFT JOIN monthly_bills mb ON c.id = mb.contract_id
        LEFT JOIN bill_payment_match bpm ON mb.id = bpm.bill_id
        WHERE c.landlord_id = ?
        GROUP BY mb.id
        ORDER BY mb.bill_month ASC
    `;

    db.all(query, [landlordId], (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(data);
    });
});

// 10a. Global Payment Ledger (For Admin & filtered views)
app.get('/api/payments/ledger', (req, res) => {
    const { landlord_id, building_id, tenant_id, role, user_id } = req.query;

    let query = `
        SELECT 
            l.nickname as landlord_name,
            l.id as landlord_id,
            t.nickname as tenant_name,
            t.id as tenant_id,
            b.name as building_name,
            b.id as building_id,
            c.id as contract_id,
            c.contract_start_date,
            c.payment_type,
            mb.bill_month,
            mb.total_amount as due_amount,
            COALESCE(SUM(bpm.matched_amount), 0) as paid_amount,
            MAX(p.paid_at) as last_paid_date
        FROM monthly_bills mb
        JOIN contracts c ON mb.contract_id = c.id
        JOIN users t ON c.tenant_id = t.id
        JOIN users l ON c.landlord_id = l.id
        LEFT JOIN buildings b ON c.building = b.name -- approximate join by name as contract stores name
        LEFT JOIN bill_payment_match bpm ON mb.id = bpm.bill_id
        LEFT JOIN payments p ON bpm.payment_id = p.id
        WHERE 1=1
    `;

    const params = [];

    if (role === 'landlord') {
        query += ` AND c.landlord_id = ?`;
        params.push(user_id);
    } else if (role === 'tenant') {
        query += ` AND c.tenant_id = ?`;
        params.push(user_id);
    }

    // specific filters (overriding role if needed, or refining)
    if (landlord_id && landlord_id !== 'all') {
        query += ` AND c.landlord_id = ?`;
        params.push(landlord_id);
    }
    if (building_id && building_id !== 'all') {
        // Contracts store building NAME, but let's try to match if we have ID. 
        // Ideally contracts should store building_id, but schema uses name. 
        // We can join buildings to filter by ID or just filter by name if passed.
        // Let's assume we pass building NAME or ID. If ID passed:
        query += ` AND b.id = ?`;
        params.push(building_id);
    }
    if (tenant_id && tenant_id !== 'all') {
        query += ` AND c.tenant_id = ?`;
        params.push(tenant_id);
    }

    query += ` GROUP BY mb.id ORDER BY mb.bill_month DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 11. Adjust Bill Date
app.post('/api/bills/adjust-date', (req, res) => {
    const { bill_id, new_month, adjustment_type } = req.body;
    // adjustment_type: 'single', 'shift_forward', 'shift_backward'

    if (adjustment_type === 'single') {
        db.run(`UPDATE monthly_bills SET bill_month = ? WHERE id = ?`,
            [new_month, bill_id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Bill date updated' });
            }
        );
    } else {
        // For shift operations, we need to get the contract and update all future bills
        db.get(`SELECT contract_id, bill_month FROM monthly_bills WHERE id = ?`, [bill_id], (err, bill) => {
            if (err) return res.status(500).json({ error: err.message });

            const direction = adjustment_type === 'shift_forward' ? -1 : 1;
            const query = `
                UPDATE monthly_bills 
                SET bill_month = date(bill_month || '-01', '${direction} month')
                WHERE contract_id = ? AND bill_month >= ?
            `;

            db.run(query, [bill.contract_id, bill.bill_month], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: `${this.changes} bills adjusted` });
            });
        });
    }
});

// 12. Get Active Contracts (for Import Matching)
app.get('/api/landlord/:id/contracts/active', (req, res) => {
    const landlordId = req.params.id;
    const query = `
        SELECT c.*, u.nickname, u.color 
        FROM contracts c
        JOIN users u ON c.tenant_id = u.id
        WHERE c.landlord_id = ?
    `;
    db.all(query, [landlordId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 13. Update Contract Keyword
app.post('/api/contracts/:id/keyword', (req, res) => {
    const contractId = req.params.id;
    const { keyword } = req.body;

    db.get("SELECT keyword FROM contracts WHERE id = ?", [contractId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Contract not found' });

        // Append comma separated
        let currentKeywords = row.keyword ? row.keyword.split(',') : [];
        if (!currentKeywords.includes(keyword)) {
            currentKeywords.push(keyword);
        }
        const newKeywordStr = currentKeywords.join(',');

        db.run("UPDATE contracts SET keyword = ? WHERE id = ?", [newKeywordStr, contractId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Keyword updated', keyword: newKeywordStr });
        });
    });
});

// 14. Batch Insert Payments
app.post('/api/payments/batch', (req, res) => {
    const { payments } = req.body; // Array of { tenant_id, amount, paid_at, memo }

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
        return res.status(400).json({ error: 'No payments provided' });
    }

    const placeholder = payments.map(() => '(?, ?, ?, ?)').join(',');
    const flatParams = [];
    payments.forEach(p => {
        flatParams.push(p.tenant_id, p.amount, p.paid_at, p.memo);
    });

    const query = `INSERT INTO payments (tenant_id, amount, paid_at, memo) VALUES ${placeholder}`;

    db.run(query, flatParams, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `${this.changes} payments imported` });
    });
});

// 15. Get Landlord's Buildings
app.get('/api/landlord/:id/buildings', (req, res) => {
    const landlordId = req.params.id;
    const query = `
        SELECT b.* 
        FROM buildings b
        JOIN landlord_buildings lb ON b.id = lb.building_id
        WHERE lb.landlord_id = ?
    `;
    db.all(query, [landlordId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 16. Create Building
app.post('/api/buildings', (req, res) => {
    const { landlord_id, name, address1, address2, memo } = req.body;

    if (!landlord_id || !name) {
        return res.status(400).json({ error: 'landlord_id and name are required' });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const insertQuery = `INSERT INTO buildings (name, address1, address2, memo) VALUES (?, ?, ?, ?)`;
        db.run(insertQuery, [name, address1 || '', address2 || '', memo || ''], function (err) {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
            const buildingId = this.lastID;

            db.run(`INSERT INTO landlord_buildings (landlord_id, building_id) VALUES (?, ?)`,
                [landlord_id, buildingId],
                function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }
                    db.run('COMMIT');
                    res.json({ message: 'Building created', buildingId });
                }
            );
        });
    });
});

// 16a. Update Building
app.put('/api/buildings/:id', (req, res) => {
    const buildingId = req.params.id;
    const { name, address1, address2, memo } = req.body;
    db.run(
        `UPDATE buildings SET name = ?, address1 = ?, address2 = ?, memo = ? WHERE id = ?`,
        [name, address1, address2, memo, buildingId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Building updated' });
        }
    );
});

// 16b. Delete Building
app.delete('/api/buildings/:id', (req, res) => {
    const buildingId = req.params.id;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run('DELETE FROM landlord_buildings WHERE building_id = ?', [buildingId], err => {
            if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
            db.run('DELETE FROM rooms WHERE building_id = ?', [buildingId], err => {
                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                db.run('DELETE FROM building_addresses WHERE building_id = ?', [buildingId], err => {
                    if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                    db.run('DELETE FROM buildings WHERE id = ?', [buildingId], err => {
                        if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                        db.run('COMMIT');
                        res.json({ message: 'Building deleted' });
                    });
                });
            });
        });
    });
});

// 17. Get Building's Rooms with Tenant info
app.get('/api/buildings/:id/rooms', (req, res) => {
    const buildingId = req.params.id;
    const query = `
        SELECT r.*, 
        (SELECT u.nickname 
         FROM contracts c 
         JOIN users u ON c.tenant_id = u.id 
         JOIN buildings b2 ON b2.id = ?
         WHERE c.building = b2.name AND c.room_number = r.room_number
         ORDER BY c.contract_start_date DESC LIMIT 1) as tenant_name
        FROM rooms r
        WHERE r.building_id = ?
    `;
    db.all(query, [buildingId, buildingId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 17a. Get Building's Addresses
app.get('/api/buildings/:id/addresses', (req, res) => {
    const buildingId = req.params.id;
    db.all(`SELECT * FROM building_addresses WHERE building_id = ?`, [buildingId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});



// 17b. Add Building Address
app.post('/api/buildings/:id/addresses', (req, res) => {
    const buildingId = req.params.id;
    const { address } = req.body;
    db.run(`INSERT INTO building_addresses (building_id, address) VALUES (?, ?)`,
        [buildingId, address],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Address added', addressId: this.lastID });
        }
    );
});

// 17c. Delete Building Address
app.delete('/api/addresses/:id', (req, res) => {
    const addressId = req.params.id;
    db.run(`DELETE FROM building_addresses WHERE id = ?`, [addressId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Address deleted' });
    });
});

// 17d. Delete All Addresses for Building
app.delete('/api/buildings/:id/addresses', (req, res) => {
    const buildingId = req.params.id;
    db.run(`DELETE FROM building_addresses WHERE building_id = ?`, [buildingId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'All addresses deleted for building' });
    });
});

// 18. Create Room
app.post('/api/rooms', (req, res) => {
    const { building_id, room_number, memo, building, floor, unit } = req.body;
    db.run(`INSERT INTO rooms (building_id, room_number, memo, building, floor, unit) VALUES (?, ?, ?, ?, ?, ?)`,
        [building_id, room_number, memo, building, floor, unit],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Room created', roomId: this.lastID });
        }
    );
});

// 18a. Update Room
// 18a. Update Room
app.put('/api/rooms/:id', (req, res) => {
    console.log(`PUT /api/rooms/${req.params.id} called with body:`, req.body);
    const roomId = req.params.id;
    const { room_number, memo, building, floor, unit } = req.body;
    db.run(`UPDATE rooms SET room_number = ?, memo = ?, building = ?, floor = ?, unit = ? WHERE id = ?`,
        [room_number, memo, building, floor, unit, roomId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Room not found or no changes made' });
            res.json({ message: 'Room updated' });
        }
    );
});

// 19. Find User by Profile
app.post('/api/users/find', (req, res) => {
    const { birth_date, name, role } = req.body;
    let query = `SELECT * FROM users WHERE role = ? AND nickname = ? AND birth_date = ?`;
    db.all(query, [role, name, birth_date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 20. Create or Update User (Quick Add/Save)
// 20. Create or Update User (Quick Add/Save)
app.post('/api/users/quick', (req, res) => {
    const { id, login_id, password, nickname, role, birth_date, phone_number } = req.body;

    // Check for existing user with this login_id to prevent UNIQUE constraint errors
    db.get('SELECT id FROM users WHERE login_id = ?', [login_id], (err, existingUser) => {
        if (err) return res.status(500).json({ error: err.message });

        let targetId = id;

        if (existingUser) {
            // Collision detected (or self-match).
            // If we were trying to modify User A (id) to have a login_id that belongs to User B (existingUser.id),
            // we implicitly switch specifically to User B.
            // This effectively "merges" the contract into the existing identity rather than crashing or duplicating.
            targetId = existingUser.id;
        }

        if (targetId) {
            // Update the identified target user
            // Note: We do NOT update the role to prevent accidental demotion of admins/landlords.
            db.run(`UPDATE users SET login_id = ?, nickname = ?, birth_date = ?, phone_number = ? WHERE id = ?`,
                [login_id, nickname, birth_date, phone_number, targetId],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'User updated', userId: targetId });
                }
            );
        } else {
            // Create new user
            db.run(`INSERT INTO users (login_id, password, nickname, role, birth_date, phone_number) VALUES (?, ?, ?, ?, ?, ?)`,
                [login_id, password, nickname, role, birth_date, phone_number],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'User created', userId: this.lastID });
                }
            );
        }
    });
});

// 21. Create Contract (Full Package)
app.post('/api/contracts/full', (req, res) => {
    const {
        landlord_id, tenant_id,
        payment_type, contract_start_date, contract_end_date,
        deposit, monthly_rent, management_fee, cleaning_fee,
        building_name, room_number
    } = req.body;

    const query = `
        INSERT INTO contracts (
            landlord_id, tenant_id, payment_type, 
            contract_start_date, contract_end_date,
            deposit, monthly_rent, management_fee, cleaning_fee,
            building, room_number, keyword
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.get("SELECT nickname FROM users WHERE id = ?", [tenant_id], (err, user) => {
        if (err || !user) return res.status(500).json({ error: 'Tenant not found' });
        const keyword = user.nickname;
        db.run(query, [
            landlord_id, tenant_id, payment_type,
            contract_start_date, contract_end_date,
            deposit, monthly_rent, management_fee, cleaning_fee,
            building_name, room_number, keyword
        ], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            const contractId = this.lastID;

            // Updated: Save or Update landlord_tenant relationship
            db.get('SELECT id FROM landlord_tenant WHERE landlord_id = ? AND tenant_id = ?', [landlord_id, tenant_id], (err, row) => {
                if (err) {
                    console.error('Error checking landlord_tenant:', err);
                    return res.json({ message: 'Contract created but failed to link landlord-tenant', contractId });
                }
                if (row) {
                    db.run('UPDATE landlord_tenant SET start_date = ?, end_date = ? WHERE id = ?', [contract_start_date, contract_end_date, row.id], (err) => {
                        if (err) console.error('Error updating landlord_tenant:', err);
                        res.json({ message: 'Contract created and relationship updated', contractId });
                    });
                } else {
                    db.run('INSERT INTO landlord_tenant (landlord_id, tenant_id, start_date, end_date) VALUES (?, ?, ?, ?)', [landlord_id, tenant_id, contract_start_date, contract_end_date], (err) => {
                        if (err) console.error('Error inserting landlord_tenant:', err);
                        res.json({ message: 'Contract created and relationship saved', contractId });
                    });
                }
            });
        });
    });
});

// 21a. Update Contract
app.put('/api/contracts/:id', (req, res) => {
    const contractId = req.params.id;
    const {
        landlord_id, tenant_id, // Added landlord_id and tenant_id to destructuring
        payment_type, contract_start_date, contract_end_date,
        deposit, monthly_rent, management_fee, cleaning_fee,
        building_name, room_number, keyword
    } = req.body;

    const query = `
        UPDATE contracts 
        SET payment_type = ?, contract_start_date = ?, contract_end_date = ?,
            deposit = ?, monthly_rent = ?, management_fee = ?, cleaning_fee = ?,
            building = ?, room_number = ?, keyword = ?
        WHERE id = ?
    `;

    db.run(query, [
        payment_type, contract_start_date, contract_end_date,
        deposit, monthly_rent, management_fee, cleaning_fee,
        building_name, room_number, keyword, contractId
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });

        // Updated: Save or Update landlord_tenant relationship if IDs are provided
        if (landlord_id && tenant_id) {
            db.get('SELECT id FROM landlord_tenant WHERE landlord_id = ? AND tenant_id = ?', [landlord_id, tenant_id], (err, row) => {
                if (err) {
                    console.error('Error checking landlord_tenant:', err);
                    return res.json({ message: 'Contract updated' });
                }
                if (row) {
                    db.run('UPDATE landlord_tenant SET start_date = ?, end_date = ? WHERE id = ?', [contract_start_date, contract_end_date, row.id], (err) => {
                        if (err) console.error('Error updating landlord_tenant:', err);
                        res.json({ message: 'Contract and relationship updated' });
                    });
                } else {
                    db.run('INSERT INTO landlord_tenant (landlord_id, tenant_id, start_date, end_date) VALUES (?, ?, ?, ?)', [landlord_id, tenant_id, contract_start_date, contract_end_date], (err) => {
                        if (err) console.error('Error inserting landlord_tenant:', err);
                        res.json({ message: 'Contract updated and relationship saved' });
                    });
                }
            });
        } else {
            res.json({ message: 'Contract updated' });
        }
    });
});

// 22. Get Comprehensive Tenant Info (Building + Landlords + Contract)
app.get('/api/tenant/:id/details', (req, res) => {
    const tenantId = req.params.id;
    const contractQuery = `
        SELECT c.*, u.nickname as tenant_name, u.birth_date, u.phone_number,
               b.id as building_id, b.name as b_name, b.address1 as b_addr1, b.address2 as b_addr2
        FROM contracts c
        JOIN users u ON c.tenant_id = u.id
        LEFT JOIN buildings b ON c.building = b.name
        WHERE c.tenant_id = ?
        ORDER BY c.contract_start_date DESC LIMIT 1
    `;

    db.get(contractQuery, [tenantId], (err, contract) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!contract) return res.status(404).json({ error: 'Contract not found' });

        // Get additional addresses from building_addresses if found
        const addrQuery = `SELECT address FROM building_addresses WHERE building_id = ?`;
        db.all(addrQuery, [contract.building_id], (err, addresses) => {
            const allAddresses = [contract.b_addr1, contract.b_addr2, ...(addresses || []).map(a => a.address)].filter(a => a);

            // Get all landlords for this building
            const landlordsQuery = `
                SELECT u.nickname 
                FROM users u
                JOIN landlord_buildings lb ON u.id = lb.landlord_id
                WHERE lb.building_id = ?
            `;
            db.all(landlordsQuery, [contract.building_id], (err, landlords) => {
                res.json({
                    contract,
                    building: {
                        id: contract.building_id,
                        name: contract.b_name || contract.building,
                        addresses: allAddresses
                    },
                    landlords: landlords || []
                });
            });
        });
    });
});

// 23. Get Contract Details by ID (for Landlord)
app.get('/api/contract/:id/full-details', (req, res) => {
    const contractId = req.params.id;
    const contractQuery = `
        SELECT c.*, u.nickname as tenant_name, u.birth_date, u.phone_number,
               b.id as building_id, b.name as b_name, b.address1 as b_addr1, b.address2 as b_addr2
        FROM contracts c
        JOIN users u ON c.tenant_id = u.id
        LEFT JOIN buildings b ON c.building = b.name
        WHERE c.id = ?
    `;

    db.get(contractQuery, [contractId], (err, contract) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!contract) return res.status(404).json({ error: 'Contract not found' });

        const addrQuery = `SELECT address FROM building_addresses WHERE building_id = ?`;
        db.all(addrQuery, [contract.building_id], (err, addresses) => {
            const allAddresses = [contract.b_addr1, contract.b_addr2, ...(addresses || []).map(a => a.address)].filter(a => a);
            const landlordsQuery = `
                SELECT u.nickname 
                FROM users u
                JOIN landlord_buildings lb ON u.id = lb.landlord_id
                WHERE lb.building_id = ?
            `;
            db.all(landlordsQuery, [contract.building_id], (err, landlords) => {
                res.json({
                    contract,
                    building: {
                        id: contract.building_id,
                        name: contract.b_name || contract.building,
                        addresses: allAddresses
                    },
                    landlords: landlords || []
                });
            });
        });
    });
});

// 24. Terminate Contract (Set End Date)
app.post('/api/contracts/:id/terminate', (req, res) => {
    const contractId = req.params.id;
    const { end_date } = req.body;
    db.run(`UPDATE contracts SET move_out_date = ?, contract_end_date = ? WHERE id = ?`, [end_date, end_date, contractId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Contract termination date set' });
    });
});

// 26. Get Building's Rooms with Latest Event
app.get('/api/buildings/:id/rooms-with-events', (req, res) => {
    const buildingId = req.params.id;
    const search = req.query.q || '';

    let query = `
        SELECT r.*, 
        (SELECT re.memo 
         FROM room_events re 
         WHERE re.room_id = r.id 
         AND (re.memo LIKE ? OR ? = '')
         ORDER BY re.event_date DESC, re.id DESC LIMIT 1) as latest_event,
        (SELECT re.event_date 
         FROM room_events re 
         WHERE re.room_id = r.id 
         AND (re.memo LIKE ? OR ? = '')
         ORDER BY re.event_date DESC, re.id DESC LIMIT 1) as latest_event_date
        FROM rooms r
        WHERE r.building_id = ?
    `;

    const searchQuery = `%${search}%`;
    db.all(query, [searchQuery, search, searchQuery, search, buildingId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 27. Get All Events for a Room
app.get('/api/rooms/:id/events', (req, res) => {
    const roomId = req.params.id;
    const query = `
        SELECT * FROM room_events 
        WHERE room_id = ? 
        ORDER BY event_date DESC, id DESC
    `;
    db.all(query, [roomId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/rooms/:id/events', (req, res) => {
    const roomId = req.params.id;
    const { event_date, memo } = req.body;
    db.run(`INSERT INTO room_events (room_id, event_date, memo) VALUES (?, ?, ?)`,
        [roomId, event_date, memo],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Event added', eventId: this.lastID });
        }
    );
});

// 28. Update Room Event
app.put('/api/room-events/:id', (req, res) => {
    const eventId = req.params.id;
    const { event_date, memo } = req.body;
    db.run(`UPDATE room_events SET event_date = ?, memo = ? WHERE id = ?`,
        [event_date, memo, eventId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Event updated' });
        }
    );
});

// 25. Search Building by Address Snippet - Moved to higher priority

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
