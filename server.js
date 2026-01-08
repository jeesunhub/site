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

app.get('/api/health/db', async (req, res) => {
    try {
        const dbType = process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite';
        let result;

        if (dbType === 'PostgreSQL') {
            // We need to access the pool directly or run a simple query
            // Since our db wrapper supports .all or .get, let's use that.
            // But for PG specific 'SELECT NOW()', we might need to handle it.
            // valid sqlite query: SELECT date('now')
            // valid pg query: SELECT NOW()
            // Our wrapper attempts to convert syntax. 
            // Let's try a simple universal query: SELECT 1 as val
            await new Promise((resolve, reject) => {
                db.get('SELECT 1 as val', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            result = 'Connected';
        } else {
            await new Promise((resolve, reject) => {
                db.get('SELECT 1 as val', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            result = 'Connected';
        }

        res.json({
            status: 'ok',
            dbType,
            connection: result,
            env_db_url_configured: !!process.env.DATABASE_URL
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message,
            dbType: process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'
        });
    }
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

    // First check if user exists by login_id
    db.get('SELECT * FROM users WHERE login_id = ?', [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });

        // If no user found with that ID
        if (!user) {
            return res.status(404).json({ error: '없는 사용자입니다.' });
        }

        // Check password
        if (String(user.password) !== String(password)) {
            return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });
        }

        // Check approval status
        if (user.approved === 0) {
            return res.status(403).json({ error: '가입 승인 대기 중입니다. 승인 후 이용 가능합니다.' });
        }
        if (user.approved === 2) { // Rejected
            return res.status(403).json({ error: '가입이 거절되었습니다.' });
        }

        res.json({ message: 'Login successful', user });
    });
});

// 1a. Signup API
app.post('/api/signup', (req, res) => {
    const { login_id, password, nickname, birth_date, phone_number, role } = req.body;

    // Check duplicate login_id
    db.get('SELECT id FROM users WHERE login_id = ?', [login_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: 'ID_EXISTS' });

        // Check duplicate user (phone + DOB)
        db.get('SELECT id FROM users WHERE phone_number = ? AND birth_date = ?', [phone_number, birth_date], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (row) return res.status(400).json({ error: 'USER_EXISTS' });

            // Insert new user
            db.run(`INSERT INTO users (login_id, password, nickname, birth_date, phone_number, role, approved) VALUES (?, ?, ?, ?, ?, ?, 0)`,
                [login_id, password, nickname, birth_date, phone_number, role],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    const newUserId = this.lastID;

                    // Create Notification
                    const title = role === 'landlord' ? '임대인 가입 신청' : '세입자 가입 신청';
                    const content = `아이디: ${login_id}\n이름: ${nickname}\n생년월일: ${birth_date}\n전화번호: ${phone_number}`;

                    db.run(`INSERT INTO noti (author_id, title, content, type) VALUES (?, ?, ?, ?)`,
                        [newUserId, title, content, '가입신청'],
                        function (err) {
                            if (err) console.error('Error creating signup notification:', err.message);
                            res.json({ message: 'Signup application submitted', userId: newUserId });
                        }
                    );
                }
            );
        });
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
    // Exclude rejected users (approved=2) if we consider them "deleted" but keep record, OR include them?
    // User requested "db entry deleted" but for safety we used status 2.
    // Let's filter out approved=2 users from normal lists to simulate deletion.
    db.all('SELECT id, login_id, nickname, role, color, photo_path, noti FROM users WHERE approved != 2 ORDER BY role, nickname', [], (err, rows) => {
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
        WHERE lt.landlord_id = ? AND u.approved != 2
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
        WHERE 1=1 AND t.approved != 2 -- Exclude deleted tenants
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
        WHERE c.landlord_id = ? AND u.approved != 2
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
    let query = `SELECT * FROM users WHERE role = ? AND nickname = ? AND birth_date = ? AND approved != 2`;
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
            targetId = existingUser.id;
        }

        if (targetId) {
            // Update the identified target user
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

// 20a. Search Tenants by Keyword (Active Contracts)
app.get('/api/tenants/search', (req, res) => {
    const { keyword, landlord_id } = req.query;

    // Base query to find active contracts matching keyword
    // We search in: Users.nickname, Contracts.keyword
    // Filter by landlord_id if provided (for context)
    let query = `
        SELECT DISTINCT u.id, u.nickname, c.building, c.room_number, c.keyword
        FROM contracts c
        JOIN users u ON c.tenant_id = u.id
        WHERE c.contract_end_date >= date('now') -- Active or not ended
        AND u.approved != 2
    `;

    const params = [];

    if (landlord_id) {
        query += ` AND c.landlord_id = ?`;
        params.push(landlord_id);
    }

    if (keyword) {
        query += ` AND (u.nickname LIKE ? OR c.keyword LIKE ?)`;
        const likeKey = `%${keyword}%`;
        params.push(likeKey, likeKey);
    }

    query += ` ORDER BY u.nickname`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
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

// --- NEW NOTICES API ---

// 30. Get Notices (Visibility Logic)
app.get('/api/notices', (req, res) => {
    const { role, user_id } = req.query;

    // Default: no result
    let query = '';
    let params = [];

    // NOTE: user_approved status is needed for UI to show/hide Approve buttons for '가입신청'
    const baseFields = `n.*, u.nickname, u.approved as user_approved`;

    if (role === 'admin') {
        // Admin: See all
        query = `
            SELECT ${baseFields}
            FROM noti n
            LEFT JOIN users u ON n.author_id = u.id
            ORDER BY n.created_at DESC
        `;
    } else if (role === 'landlord') {
        // Landlord:
        // 1. Own posts (n.author_id = ?)
        // 2. Tenants' posts (n.author_id IN (SELECT tenant_id FROM landlord_tenant WHERE landlord_id = ?))
        // 3. Admin's posts where type='공지사항' (u.role='admin' AND n.type='공지사항')
        query = `
            SELECT ${baseFields}
            FROM noti n
            LEFT JOIN users u ON n.author_id = u.id
            WHERE n.author_id = ?
               OR n.author_id IN (SELECT tenant_id FROM landlord_tenant WHERE landlord_id = ?)
               OR (u.role = 'admin' AND n.type = '공지사항')
            ORDER BY n.created_at DESC
        `;
        params = [user_id, user_id];
    } else if (role === 'tenant') {
        // Tenant:
        // 1. Own posts (n.author_id = ?)
        // 2. Admin's posts where type='공지사항' (u.role='admin' AND n.type='공지사항')
        // 3. Their Landlord's posts where type='공지사항' (n.author_id IN (SELECT landlord_id FROM landlord_tenant WHERE tenant_id = ?) AND n.type = '공지사항')
        query = `
            SELECT ${baseFields}
            FROM noti n
            LEFT JOIN users u ON n.author_id = u.id
            WHERE n.author_id = ?
               OR (u.role = 'admin' AND n.type = '공지사항')
               OR (n.author_id IN (SELECT landlord_id FROM landlord_tenant WHERE tenant_id = ?) AND n.type = '공지사항')
            ORDER BY n.created_at DESC
        `;
        params = [user_id, user_id];
    } else {
        return res.json([]);
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 31. Confirm Notice (Mark as read or handled)
app.put('/api/notices/:id/confirm', (req, res) => {
    const noticeId = req.params.id;
    db.run(`UPDATE noti SET confirmed = 1 WHERE id = ?`, [noticeId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Notice confirmed' });
    });
});

// 32. Approve User (Signup)
app.post('/api/users/:id/approve', (req, res) => {
    const targetUserId = req.params.id;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        // Update User
        db.run(`UPDATE users SET approved = 1 WHERE id = ?`, [targetUserId], function (err) {
            if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

            // Confirm the notification associated with this user (optional, but good UX)
            // We don't have noti ID here easily, but we can update by author_id and type='가입신청'
            db.run(`UPDATE noti SET confirmed = 1 WHERE author_id = ? AND type = '가입신청'`, [targetUserId], function (err) {
                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                db.run('COMMIT');
                res.json({ message: 'User approved' });
            });
        });
    });
});

// 33. Reject User (Signup)
app.post('/api/users/:id/reject', (req, res) => {
    const targetUserId = req.params.id;
    // Requirement: "user deleted, approved becomes 2".
    // We interpret this as "Soft Delete" (approved=2) is the primary state, 
    // but the user explicitly said "db에서 user는 삭제되고".
    // If we DELETE the row, we cannot see "approved=2".
    // Compromise: We will DELETE the user row to satisfy "deleted",
    // AND we will update the NOTIFICATION to indicate rejection (so we keep record of the event).
    // Or we update the user's approved to 2 and maybe rename them to indicate deletion?
    // Let's stick to the prompt's strong wording: "user is deleted".
    // To handle "approved becomes 2", we might be talking about the notification's confirmed status?
    // Let's assume the user meant "Set user status to 2" effectively deleting them from access.
    // I will set approved=2. This is safer and reversible if needed.

    db.run(`UPDATE users SET approved = 2 WHERE id = ?`, [targetUserId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        // Also confirm/mark the noti
        db.run(`UPDATE noti SET confirmed = 1 WHERE author_id = ? AND type = '가입신청'`, [targetUserId], function (err) {
            res.json({ message: 'User rejected' });
        });
    });
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
