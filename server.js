require('dotenv').config();
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

// Admin Helper Endpoints
app.get('/api/admin/buildings', (req, res) => {
    console.log('[API] GET /api/admin/buildings');
    const query = `
        SELECT b.*, GROUP_CONCAT(ba.address, '|||') as addresses
        FROM buildings b
        LEFT JOIN building_addresses ba ON b.id = ba.building_id
        GROUP BY b.id
        ORDER BY b.name
    `;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('[API] Error fetching buildings:', err);
            return res.status(500).json({ error: err.message });
        }
        rows.forEach(row => {
            if (row.addresses) {
                const parts = row.addresses.split('|||');
                row.address1 = parts[0] || '';
                row.address2 = parts[1] || '';
            } else {
                row.address1 = '';
                row.address2 = '';
            }
            delete row.addresses;
        });
        res.json(rows);
    });
});

app.get('/api/admin/tenants', (req, res) => {
    console.log('[API] GET /api/admin/tenants');
    db.all("SELECT id, nickname FROM users WHERE role = ? ORDER BY nickname", ['tenant'], (err, rows) => {
        if (err) {
            console.error('[API] Error fetching tenants:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

app.get('/api/health/db', async (req, res) => {
    try {
        const dbType = process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite';
        let result;

        const dbCheckPromise = new Promise((resolve, reject) => {
            // Use a simple query that works on both
            // SQLite: SELECT 1 (returns 1)
            // PG: SELECT 1 (returns 1)
            // wrapper handles ? vs $1 but here no params.
            const query = "SELECT 1 as val";
            db.get(query, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('DB Connection Timeout (5s)')), 5000)
        );

        await Promise.race([dbCheckPromise, timeoutPromise]);
        result = 'Connected';

        res.json({
            status: 'ok',
            dbType,
            connection: result,
            env_db_url_configured: !!process.env.DATABASE_URL
        });
    } catch (error) {
        console.error('DB Health Check Error:', error);
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
        WHERE REPLACE(ba.address, ' ', '') LIKE ?
        LIMIT 1
    `;
    db.get(query, [searchTerm], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || null);
    });
});

// 0a. Public Stats (For Landing Page)
app.get('/api/public/stats', (req, res) => {
    const query = `
        SELECT 
            (SELECT COUNT(*) FROM advertisements WHERE (related_table = 'room' OR related_table = 'contract') AND status = 'advertising') as "roomCount",
            (SELECT COUNT(*) FROM advertisements WHERE related_table = 'item' AND status = 'advertising') as "itemCount",
            (SELECT COUNT(*) FROM advertisements WHERE (related_table = 'info') AND status = 'advertising') as "infoCount"
    `;
    db.get(query, [], (err, row) => {
        if (err) {
            console.error('Stats Error:', err);
            return res.status(500).json({ error: err.message });
        }
        const data = row || { roomCount: 0, itemCount: 0, infoCount: 0 };
        res.json({
            roomCount: data.roomCount,
            itemCount: data.itemCount,
            infoCount: data.infoCount
        });
    });
});

app.get('/api/info/stats', (req, res) => {
    const query = `
        SELECT category, COUNT(*) as count 
        FROM advertisements 
        WHERE related_table = 'info' AND status = 'advertising'
        GROUP BY category
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const stats = {};
        rows.forEach(r => {
            if (r.category) stats[r.category] = r.count;
        });
        res.json(stats);
    });
});



// 34. Get Advertisements
app.get('/api/ads', (req, res) => {
    const { type, role, user_id, viewer_id, viewer_role, category } = req.query;
    let query = `
        SELECT a.*, 
            u.nickname as owner_name, u.login_id as owner_login_id, u.id as owner_id,
            CASE 
                WHEN a.related_table = 'room' THEN b.name 
                WHEN a.related_table = 'contract' THEN bc.name
                WHEN a.related_table = 'item' THEN b_item.name
                ELSE NULL 
            END as building,
            CASE 
                WHEN a.related_table = 'room' THEN b.name 
                WHEN a.related_table = 'contract' THEN bc.name
                WHEN a.related_table = 'item' THEN b_item.name
                ELSE NULL 
            END as building_name,
            COALESCE(r.room_number, rc.room_number) as room_number,
            COALESCE(r.deposit, c.deposit) as deposit,
            COALESCE(r.rent, c.monthly_rent) as rent,
            COALESCE(r.management_fee, c.maintenance_fee) as management_fee,
            c.cleaning_fee as cleaning_fee,
            COALESCE(r.available_date, c.contract_start_date) as available_date,
            COALESCE(r.building_id, rc.building_id) as building_id,
            (SELECT image_url FROM images WHERE related_id = a.id AND related_table = 'advertisements' LIMIT 1) as main_image
        FROM advertisements a
        LEFT JOIN users u ON a.created_by = u.id
        LEFT JOIN rooms r ON a.related_id = r.id AND a.related_table = 'room'
        LEFT JOIN buildings b ON r.building_id = b.id
        LEFT JOIN contracts c ON a.related_id = c.id AND a.related_table = 'contract'
        LEFT JOIN rooms rc ON c.room_id = rc.id
        LEFT JOIN buildings bc ON rc.building_id = bc.id
        LEFT JOIN items i ON a.related_id = i.id AND a.related_table = 'item'
        LEFT JOIN buildings b_item ON i.building_id = b_item.id
    `;

    let params = [];
    let whereClauses = [];

    if (type) {
        if (type === 'room') {
            whereClauses.push(`(a.related_table = 'room' OR a.related_table = 'contract')`);
        } else {
            whereClauses.push(`a.related_table = ? `);
            params.push(type);
        }
    }

    if (category) {
        whereClauses.push(`a.category = ? `);
        params.push(category);
    }

    // Manager/Self view filter (Show only MY ads)
    if (user_id && (role === 'landlord' || role === 'tenant' || role === 'admin')) {
        whereClauses.push(`a.created_by = ? `);
        params.push(user_id);
    }
    // Browse View Visibility Logic
    else if ((viewer_role || role) !== 'admin') {
        const v_id = viewer_id || user_id;
        const v_role = viewer_role || role;

        if (!v_id) {
            // Guest sees only public ads (NULL or Empty String)
            whereClauses.push(`(a.target_id IS NULL OR a.target_id = '')`);
        } else if (v_role === 'tenant') {
            // Tenant sees public + their building
            whereClauses.push(`(a.target_id IS NULL OR a.target_id = '' OR a.target_id = (SELECT r.building_id FROM rooms r JOIN room_tenant rt ON r.id = rt.room_id WHERE rt.tenant_id = ? LIMIT 1))`);
            params.push(v_id);
        } else if (v_role === 'landlord') {
            // Landlord sees public + their managed buildings
            whereClauses.push(`(a.target_id IS NULL OR a.target_id = '' OR a.target_id IN(SELECT building_id FROM landlord_buildings WHERE landlord_id = ?))`);
            params.push(v_id);
        }
    }

    if (whereClauses.length > 0) {
        query += ` WHERE ` + whereClauses.join(' AND ');
    }

    query += ` ORDER BY a.created_at DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/ads', upload.array('photos', 5), (req, res) => {
    const { type, title, description, created_by, is_anonymous, item_name, building_id, target_id, category } = req.body;
    let { price } = req.body;
    let { related_id } = req.body;

    // Convert types
    const finalPrice = parseInt(price) || 0;
    const finalCreatedBy = parseInt(created_by) || null;
    const finalBuildingId = building_id ? parseInt(building_id) : null;
    const finalTargetId = (target_id && target_id !== "" && target_id !== "null") ? parseInt(target_id) : null;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const finalizeAd = (finalRelId, targetTable = type) => {
            const query = `INSERT INTO advertisements(related_id, related_table, title, description, price, created_by, status, target_id, category) VALUES(?, ?, ?, ?, ?, ?, 'advertising', ?, ?)`;
            db.run(query, [finalRelId, targetTable, title, description, finalPrice, finalCreatedBy, finalTargetId, category || null], function (err) {
                if (err) {
                    console.error('[API] Error inserting advertisement:', err.message);
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
                const adId = this.lastID;

                // Handle photos
                if (req.files && req.files.length > 0) {
                    req.files.forEach((file, index) => {
                        db.run(`INSERT INTO images(related_id, image_url, is_main, related_table) VALUES(?, ?, ?, ?)`,
                            [adId, `/ uploads / ${file.filename} `, index === 0 ? 1 : 0, 'advertisements']);
                    });
                }

                // --- Create Message Notification ---
                const finalizeMessage = (msgCategory, msgTarget = 'to_all') => {
                    dispatchMessage({
                        author_id: finalCreatedBy,
                        category: msgCategory,
                        target: msgTarget,
                        related_id: adId,
                        related_table: 'advertisements'
                    }, (err) => {
                        if (err) console.error('Failed to create ad message:', err.message);
                        db.run('COMMIT');
                        res.json({ message: 'Ad created', id: adId });
                    });
                };

                if (type === 'item') {
                    finalizeMessage('물품공유', 'to_all');
                } else if (type === 'room') {
                    finalizeMessage('방있어요', 'to_all');
                } else if (type === 'info') {
                    finalizeMessage('시스템', 'to_all');
                } else {
                    db.run('COMMIT');
                    res.json({ message: 'Ad created', id: adId });
                }
            });
        };

        if (type === 'item') {
            // Create the item record first
            const itemQuery = `INSERT INTO items(owner_id, title, description, status, building_id, belongs_to) VALUES(?, ?, ?, 'open', ?, ?)`;
            db.run(itemQuery, [finalCreatedBy, item_name, description, finalBuildingId, finalCreatedBy], function (err) {
                if (err) {
                    console.error('[API] Error inserting item:', err.message);
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
                const itemId = this.lastID;

                // Add log entry
                db.run(`INSERT INTO logs(related_table, related_id, memo) VALUES(?, ?, ?)`,
                    ['items', itemId, `Item created by user ${finalCreatedBy} `]);

                finalizeAd(itemId);
            });
        } else if (type === 'room') {
            const { deposit, rent, management_fee, cleaning_fee, available_date } = req.body;
            // Get building/landlord info for the room
            db.get(`
                SELECT b.id as building_id, lb.landlord_id 
                FROM rooms r 
                JOIN buildings b ON r.building_id = b.id 
                LEFT JOIN landlord_buildings lb ON b.id = lb.building_id 
                WHERE r.id = ?
    `, [related_id], (err, roomInfo) => {
                if (err || !roomInfo) {
                    console.error('[API] Error finding room info:', err?.message || 'Room not found');
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Room or Building info not found' });
                }

                const finalLandlordId = roomInfo.landlord_id || finalCreatedBy;
                const finalTenantId = finalCreatedBy; // Using creator as placeholder tenant

                const contractQuery = `
                    INSERT INTO contracts(
                        room_id, tenant_id, payment_type, contract_start_date,
                        deposit, monthly_rent, maintenance_fee, cleaning_fee
                    ) VALUES(?, ?, 'postpaid', ?, ?, ?, ?, ?)
                `;
                const finalAvailableDate = available_date || new Date().toISOString().split('T')[0];

                db.run(contractQuery, [
                    related_id, finalTenantId, finalAvailableDate,
                    parseInt(deposit) || 0, parseInt(rent) || 0, parseInt(management_fee) || 0,
                    parseInt(cleaning_fee) || 0
                ], function (err) {
                    if (err) {
                        console.error('[API] Error creating contract for ad:', err.message);
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }
                    const contractId = this.lastID;
                    finalizeAd(contractId, 'contract');
                });
            });
        } else if (type === 'info') {
            finalizeAd(finalBuildingId);
        } else {
            finalizeAd(related_id);
        }
    });
});

app.put('/api/ads/:id', upload.array('photos', 5), (req, res) => {
    const adId = req.params.id;
    const { title, description, price, item_name, building_id, type, target_id, category, deposit, rent, management_fee, cleaning_fee, available_date } = req.body;

    // Convert types
    const finalPrice = parseInt(price) || 0;
    const finalBuildingId = building_id ? parseInt(building_id) : null;
    const finalTargetId = (target_id && target_id !== "" && target_id !== "null") ? parseInt(target_id) : null;

    db.get("SELECT related_table, related_id FROM advertisements WHERE id = ?", [adId], (err, ad) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!ad) return res.status(404).json({ error: 'Ad not found' });

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            const finalizeUpdate = () => {
                const query = `UPDATE advertisements SET title = ?, description = ?, price = ?, target_id = ?, category = ? WHERE id = ? `;
                db.run(query, [title, description, finalPrice, finalTargetId, category || null, adId], function (err) {
                    if (err) {
                        console.error('[API] Update Error:', err.message);
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }

                    if (req.files && req.files.length > 0) {
                        req.files.forEach((file) => {
                            db.run(`INSERT INTO images(related_id, image_url, is_main, related_table) VALUES(?, ?, ?, ?)`,
                                [adId, `/ uploads / ${file.filename} `, 0, 'advertisements']);
                        });
                    }
                    db.run('COMMIT');
                    res.json({ message: 'Ad updated' });
                });
            };

            if (ad.related_table === 'item' && ad.related_id) {
                const itemQuery = `UPDATE items SET title = ?, description = ?, building_id = ? WHERE id = ? `;
                db.run(itemQuery, [item_name, description, finalBuildingId, ad.related_id], function (err) {
                    if (err) {
                        console.error('[API] Item Update Error:', err.message);
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }
                    finalizeUpdate();
                });
            } else if (ad.related_table === 'contract' && ad.related_id) {
                const contractQuery = `UPDATE contracts SET deposit = ?, monthly_rent = ?, maintenance_fee = ?, cleaning_fee = ?, contract_start_date = ? WHERE id = ? `;
                const finalAvailableDate = available_date || new Date().toISOString().split('T')[0];
                db.run(contractQuery, [
                    parseInt(deposit) || 0, parseInt(rent) || 0, parseInt(management_fee) || 0,
                    parseInt(cleaning_fee) || 0, finalAvailableDate, ad.related_id
                ], function (err) {
                    if (err) {
                        console.error('[API] Contract Update Error:', err.message);
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }
                    finalizeUpdate();
                });
            } else {
                finalizeUpdate();
            }
        });
    });
});

app.delete('/api/ads/:id', (req, res) => {
    const id = req.params.id;
    db.get("SELECT related_table, related_id FROM advertisements WHERE id = ?", [id], (err, ad) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!ad) return res.status(404).json({ error: 'Ad not found' });

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // 1. Delete Applicants
            db.run("DELETE FROM applicants WHERE advertisement_id = ?", [id], (err) => {
                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                // 2. Delete Messages
                // Cascading delete handles messages and recipients
                db.run("DELETE FROM message_box WHERE related_id = ? AND related_table = 'advertisements'", [id], (err) => {
                    if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                    // 3. Delete Images
                    db.run("DELETE FROM images WHERE related_id = ? AND related_table = 'advertisements'", [id], (err) => {
                        if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                        const finishAdDelete = () => {
                            db.run("DELETE FROM advertisements WHERE id = ?", [id], function (err) {
                                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                                db.run('COMMIT');
                                res.json({ message: 'Ad deleted' });
                            });
                        };

                        if (ad.related_table === 'item') {
                            // 4. Delete Item
                            db.run("DELETE FROM items WHERE id = ?", [ad.related_id], (err) => {
                                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                                finishAdDelete();
                            });
                        } else if (ad.related_table === 'contract') {
                            // 4. Delete Contract
                            db.run("DELETE FROM contracts WHERE id = ?", [ad.related_id], (err) => {
                                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                                finishAdDelete();
                            });
                        } else {
                            finishAdDelete();
                        }
                    });
                });
            });
        });
    });
});

app.get('/api/ads/:id/applicants', (req, res) => {
    const id = req.params.id;
    const query = `
        SELECT a.*, u.nickname, u.login_id, u.photo_path
        FROM applicants a
        JOIN users u ON a.user_id = u.id
        WHERE a.advertisement_id = ?
    `;
    db.all(query, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/ads/:id/select-winner', (req, res) => {
    const adId = req.params.id;
    const { user_id } = req.body;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Find if this ad is for an item
        db.get("SELECT related_table, related_id, title FROM advertisements WHERE id = ?", [adId], (err, ad) => {
            if (err || !ad) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err ? err.message : 'Ad not found' });
            }

            db.run("UPDATE applicants SET status = 'won' WHERE advertisement_id = ? AND user_id = ?", [adId, user_id], (err) => {
                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                db.run("UPDATE applicants SET status = 'lost' WHERE advertisement_id = ? AND user_id != ?", [adId, user_id], (err) => {
                    if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                    db.run("UPDATE advertisements SET status = 'completed' WHERE id = ?", [adId], (err) => {
                        if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                        // If it's an item, update belongs_to
                        if (ad.related_table === 'item') {
                            db.run("UPDATE items SET belongs_to = ?, status = 'completed' WHERE id = ?", [user_id, ad.related_id], (err) => {
                                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                                // Add log entry for ownership transfer
                                db.run(`INSERT INTO logs(related_table, related_id, memo) VALUES(?, ?, ?)`,
                                    ['items', ad.related_id, `Ownership transferred to user ${user_id} via ad ${adId} `]);

                                db.run('COMMIT');
                                res.json({ message: 'Winner selected and ownership transferred' });
                            });
                        } else {
                            db.run('COMMIT');
                            res.json({ message: 'Winner selected' });
                        }
                    });
                });
            });
        });
    });
});

app.post('/api/ads/:id/apply', (req, res) => {
    const adId = req.params.id;
    const { user_id } = req.body;

    // Check if duplicate, if so update timestamp
    db.get("SELECT id FROM applicants WHERE advertisement_id = ? AND user_id = ?", [adId, user_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            db.run("UPDATE applicants SET created_at = CURRENT_TIMESTAMP WHERE id = ?", [row.id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Application timestamp updated' });
            });
        } else {
            db.run("INSERT INTO applicants (user_id, advertisement_id, status) VALUES (?, ?, 'applying')", [user_id, adId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Application submitted' });
            });
        }
    });
});

app.get('/api/ads/:id', (req, res) => {
    const id = req.params.id;
    const query = `
        SELECT a.*,
    u.nickname as owner_name, u.login_id as owner_login_id,
    CASE 
                WHEN a.related_table = 'room' THEN b.name 
                WHEN a.related_table = 'contract' THEN bc.name
                WHEN a.related_table = 'item' THEN b_item.name
                ELSE NULL
END as building_name,
    COALESCE(r.room_number, rc.room_number) as room_number,
    COALESCE(r.deposit, c.deposit) as deposit,
    COALESCE(r.rent, c.monthly_rent) as rent,
    COALESCE(r.management_fee, c.maintenance_fee) as management_fee,
    c.cleaning_fee as cleaning_fee,
    COALESCE(r.available_date, c.contract_start_date) as available_date,
    COALESCE(r.building_id, rc.building_id) as room_building_id,
    i.title as item_name,
    i.description as item_description,
    i.building_id as item_building_id,
    target_b.name as target_building_name
        FROM advertisements a
        LEFT JOIN users u ON a.created_by = u.id
        LEFT JOIN rooms r ON a.related_id = r.id AND a.related_table = 'room'
        LEFT JOIN buildings b ON r.building_id = b.id
        LEFT JOIN contracts c ON a.related_id = c.id AND a.related_table = 'contract'
        LEFT JOIN rooms rc ON c.room_id = rc.id
        LEFT JOIN buildings bc ON rc.building_id = bc.id
        LEFT JOIN items i ON a.related_id = i.id AND a.related_table = 'item'
        LEFT JOIN buildings b_item ON i.building_id = b_item.id
        LEFT JOIN buildings target_b ON a.target_id = target_b.id
        WHERE a.id = ?
    `;

    db.get(query, [id], (err, ad) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!ad) return res.status(404).json({ error: 'Ad not found' });

        if (ad.related_table === 'item') ad.building_id = ad.item_building_id;
        else if (ad.related_table === 'room' || ad.related_table === 'contract') ad.building_id = ad.room_building_id;

        db.all("SELECT * FROM images WHERE related_id = ? AND related_table = 'advertisements'", [id], (err, images) => {
            ad.images = images || [];
            res.json(ad);
        });
    });
});

app.get('/api/config/kakao', (req, res) => {
    res.json({ kakaoKey: process.env.KAKAO_JS_KEY });
});

app.get('/api/config/mode', (req, res) => {
    res.json({ mode: process.env.MODE });
});

// 1. Login API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    console.log(`[Login Attempt]ID: ${username} `);

    // First check if user exists by login_id (Case-insensitive check for better UX)
    db.get('SELECT * FROM users WHERE LOWER(login_id) = LOWER(?)', [username], (err, user) => {
        if (err) {
            console.error('Login Error:', err);
            return res.status(500).json({ error: err.message });
        }

        // If no user found with that ID
        if (!user) {
            return res.status(404).json({ error: '존재하지 않는 사용자 아이디입니다.' });
        }

        // Check password
        if (String(user.password) !== String(password)) {
            return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });
        }

        // Check status
        if (user.status === '임시') {
            return res.status(403).json({ error: '가입 승인 대기 중입니다. 승인 후 이용 가능합니다.' });
        }
        if (user.status === '종료') {
            return res.status(403).json({ error: '가입이 거절되었거나 탈퇴한 사용자입니다.' });
        }
        if (user.status !== '승인') {
            return res.status(403).json({ error: '계정 상태가 비정상입니다.' });
        }

        res.json({ message: 'Login successful', user });
    });
});

// Helper to dispatch messages to multiple recipients based on target group
function dispatchMessage({ author_id, category, target, related_id, related_table, recipient_id, building_id, title, content }, callback) {
    // 1. Insert content into messages table first
    db.run(`INSERT INTO messages(content) VALUES(?)`, [content || null], function (err) {
        if (err) return callback(err);
        const messageId = this.lastID;

        // 2. Insert into message_box referencing the messageId
        db.run(`INSERT INTO message_box(author_id, message_id, target, category, related_id, related_table, title) VALUES(?, ?, ?, ?, ?, ?, ?)`,
            [author_id || null, messageId, target, category, related_id, related_table, title || null],
            function (err2) {
                if (err2) return callback(err2);
                const boxId = this.lastID;

                let recipientQuery = '';
                let params = [boxId];

                if (target === 'direct' && recipient_id) {
                    recipientQuery = `INSERT INTO message_recipient(message_id, recipient_id) VALUES(?, ?)`;
                    params.push(recipient_id);
                } else if (target === 'to_all') {
                    recipientQuery = `INSERT INTO message_recipient(message_id, recipient_id)
SELECT ?, id FROM users WHERE status = '승인'`;
                } else if (target === 'to_building' && building_id) {
                    recipientQuery = `INSERT INTO message_recipient(message_id, recipient_id)
SELECT ?, id FROM users 
                                         WHERE status = '승인'
AND(
    id IN(SELECT tenant_id FROM room_tenant rt JOIN rooms r ON rt.room_id = r.id WHERE r.building_id = ?)
                                            OR id IN(SELECT landlord_id FROM landlord_buildings WHERE building_id = ?)
)`;
                    params.push(building_id, building_id);
                } else if (target === 'to_landlords') {
                    recipientQuery = `INSERT INTO message_recipient(message_id, recipient_id)
SELECT ?, id FROM users WHERE status = '승인' AND role = 'landlord'`;
                }

                if (recipientQuery) {
                    db.run(recipientQuery, params, (err) => {
                        if (callback) callback(err, boxId);
                    });
                } else {
                    if (callback) callback(null, boxId);
                }
            }
        );
    }
    );
}

// 34b. Generic Message Dispatch API
app.post('/api/messages/direct', (req, res) => {
    const { author_id, recipient_id, category, target, related_id, related_table, building_id, title, content } = req.body;
    dispatchMessage({ author_id, recipient_id, category, target, related_id, related_table, building_id, title, content }, (err, msgId) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Message sent', id: msgId });
    });
});

// Helper to distribute all existing "to_all" messages to a new/approved user
function distributeGlobalMessagesToUser(userId) {
    const query = `
        INSERT INTO message_recipient(message_id, recipient_id)
        SELECT id, ? FROM message_box 
        WHERE target = 'to_all'
        AND id NOT IN(SELECT message_id FROM message_recipient WHERE recipient_id = ?)
    `;
    db.run(query, [userId, userId], (err) => {
        if (err) console.error(`[GlobalMsg] Failed to distribute to user ${userId}: `, err.message);
        else console.log(`[GlobalMsg] Distributed global messages to user ${userId} `);
    });
}

// 34c. Get Potential Message Recipients
app.get('/api/messages/recipients', async (req, res) => {
    const { user_id, role } = req.query;

    if (!user_id || !role) return res.status(400).json({ error: 'User ID and role required' });

    try {
        const results = [];

        if (role === 'admin') {
            // 1. All Landlords (Individual)
            const landlords = await new Promise((resolve, reject) => {
                db.all("SELECT id, nickname FROM users WHERE role = 'landlord' AND status = '승인' ORDER BY nickname", (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
            landlords.forEach(l => results.push({ type: 'direct', id: l.id, nickname: l.nickname, role: 'landlord' }));

            // 2. Global targets
            results.push({ type: 'global', id: 'to_landlords', nickname: '전체 임대인' });
            results.push({ type: 'global', id: 'to_all', nickname: '전체 사용자 (공지)' });

            // 3. Buildings
            const buildings = await new Promise((resolve, reject) => {
                db.all("SELECT id, name FROM buildings ORDER BY name", (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
            buildings.forEach(b => results.push({ type: 'building', id: b.id, nickname: `[건물] ${b.name} ` }));

        } else if (role === 'landlord') {
            // 1. Specific tenants belonging to this landlord
            const tenants = await new Promise((resolve, reject) => {
                const query = `
                    SELECT DISTINCT u.id, u.nickname, u.title, b.name as bname FROM users u
                    JOIN room_tenant rt ON u.id = rt.tenant_id
                    JOIN rooms r ON rt.room_id = r.id
                    JOIN buildings b ON r.building_id = b.id
                    JOIN landlord_buildings lb ON r.building_id = lb.building_id
                    WHERE lb.landlord_id = ? AND u.status = '승인'
                    ORDER BY u.nickname
    `;
                db.all(query, [user_id], (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
            tenants.forEach(t => {
                // Priority: users.title (Building + Room) > buildings.name > '세입자'
                const bname = t.title || t.bname || '세입자';
                results.push({ type: 'direct', id: t.id, nickname: t.nickname, role: 'tenant', building_name: bname });
            });

            // 2. Admin
            const admins = await new Promise((resolve, reject) => {
                db.all("SELECT id, nickname FROM users WHERE role = 'admin' AND status = '승인' ORDER BY nickname", (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
            admins.forEach(a => results.push({ type: 'direct', id: a.id, nickname: a.nickname, role: 'admin' }));

            // 3. Their Buildings
            const buildings = await new Promise((resolve, reject) => {
                db.all("SELECT b.id, b.name FROM buildings b JOIN landlord_buildings lb ON b.id = lb.building_id WHERE lb.landlord_id = ?", [user_id], (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
            buildings.forEach(b => results.push({ type: 'building', id: b.id, nickname: `[건물 단체] ${b.name} ` }));

        } else if (role === 'tenant') {
            // 1. Their Landlords
            const landlords = await new Promise((resolve, reject) => {
                const query = `
                    SELECT DISTINCT u.id, u.nickname FROM users u
                    JOIN landlord_buildings lb ON u.id = lb.landlord_id
                    JOIN rooms r ON lb.building_id = r.building_id
                    JOIN room_tenant rt ON r.id = rt.room_id
                    WHERE rt.tenant_id = ? AND u.status = '승인'
                    ORDER BY u.nickname
    `;
                db.all(query, [user_id], (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
            landlords.forEach(l => results.push({ type: 'direct', id: l.id, nickname: l.nickname, role: 'landlord' }));

            // 2. Admin
            const admins = await new Promise((resolve, reject) => {
                db.all("SELECT id, nickname FROM users WHERE role = 'admin' AND status = '승인' ORDER BY nickname", (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
            admins.forEach(a => results.push({ type: 'direct', id: a.id, nickname: a.nickname, role: 'admin' }));
        }

        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Helper to sync user building/room info from relational tables to user profile (title/description)
function syncUserBuildingInfo(userId) {
    const query = `
        SELECT u.id, u.login_id, u.nickname, u.role, u.birth_date, u.phone_number,
    b.name as building_name,
    COALESCE(
        (SELECT r.room_number FROM contracts c JOIN rooms r ON c.room_id = r.id WHERE c.tenant_id = u.id ORDER BY c.id DESC LIMIT 1),
    r_rt.room_number
               ) as room_number
        FROM users u
        LEFT JOIN room_tenant rt ON u.id = rt.tenant_id
        LEFT JOIN rooms r_rt ON rt.room_id = r_rt.id
        LEFT JOIN buildings b ON r_rt.building_id = b.id
        WHERE u.id = ?
    `;
    db.get(query, [userId], (err, user) => {
        if (err || !user) return;

        let title = user.title;
        let description = user.description;

        if (user.role === 'tenant' && user.building_name) {
            title = `${user.building_name} ${user.room_number || ''} `.trim();
            description = `아이디: ${user.login_id} \n이름: ${user.nickname} \n생년월일: ${user.birth_date || '-'} \n전화번호: ${formatPhone(user.phone_number) || '-'} \n건물명: ${user.building_name} \n호수: ${user.room_number || '-'} `;

            db.run("UPDATE users SET title = ?, description = ? WHERE id = ?", [title, description, userId]);
        }
    });
}

// Helper to format phone number for display (01012345678 -> 010-1234-5678)
function formatPhone(val) {
    if (!val) return '';
    const num = String(val).replace(/[^0-9]/g, '');
    if (num.length <= 4) return num;
    if (num.length <= 8) {
        return num.slice(0, num.length - 4) + '-' + num.slice(num.length - 4);
    }
    const part3 = num.slice(-4);
    const part2 = num.slice(-8, -4);
    const part1 = num.slice(0, -8);
    return `${part1} -${part2} -${part3} `;
}

// 1a. Signup API
app.post('/api/signup', (req, res) => {
    let { login_id, password, nickname, birth_date, phone_number, role, building_id, room_number } = req.body;
    const cleanPhone = phone_number ? phone_number.replace(/[^0-9]/g, '') : '';

    // Check duplicate login_id
    db.get('SELECT id FROM users WHERE login_id = ?', [login_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: 'ID_EXISTS' });

        // Check duplicate user (phone + DOB)
        db.get('SELECT id FROM users WHERE phone_number = ? AND birth_date = ?', [cleanPhone, birth_date], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (row) return res.status(400).json({ error: 'USER_EXISTS' });

            // Generate random color for profile avatar
            const colors = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];

            // Insert new user with '임시' status and random color
            db.run(`INSERT INTO users(login_id, password, nickname, birth_date, phone_number, role, approved, status, color) VALUES(?, ?, ?, ?, ?, ?, 0, '임시', ?)`,
                [login_id, password, nickname, birth_date, cleanPhone, role, randomColor],
                async function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    const newUserId = this.lastID;

                    // Save relationship to room if provided
                    if (role === 'tenant' && room_number) {
                        db.run(`INSERT INTO room_tenant(room_id, tenant_id, start_date) VALUES(?, ?, date('now'))`,
                            [room_number, newUserId], // room_number here actually contains room_id from frontend
                            (err) => {
                                if (err) console.error('Error saving room relationship:', err.message);
                            }
                        );
                    }

                    // Create Notification for Admin
                    let buildingName = '';
                    const getBuildingName = () => {
                        return new Promise((resolve) => {
                            if (role === 'tenant' && building_id) {
                                db.get('SELECT name FROM buildings WHERE id = ?', [building_id], (err, b) => {
                                    if (b) buildingName = b.name;
                                    resolve();
                                });
                            } else {
                                resolve();
                            }
                        });
                    };

                    await getBuildingName();

                    let displayRoom = '-';
                    if (role === 'tenant' && room_number) {
                        // Find room number from id
                        const roomRow = await new Promise(resolve => db.get("SELECT room_number FROM rooms WHERE id = ?", [room_number], (e, r) => resolve(r)));
                        if (roomRow) displayRoom = roomRow.room_number;
                    }

                    const title = (role === 'tenant' && buildingName) ? `${buildingName} ${displayRoom} `.trim() : (role === 'landlord' ? '임대인 가입 신청' : '세입자 가입 신청');
                    let content = `아이디: ${login_id} \n이름: ${nickname} \n생년월일: ${birth_date} \n전화번호: ${formatPhone(cleanPhone)} `;

                    if (role === 'tenant' && building_id) {
                        content += `\n건물명: ${buildingName} \n호수: ${displayRoom} `;
                    }

                    // Update user with title and description
                    db.run(`UPDATE users SET title = ?, description = ? WHERE id = ? `, [title, content, newUserId], (err) => {
                        if (err) console.error('Error updating user title/description:', err.message);

                        // Admin Notification
                        db.run(`INSERT INTO message_box(author_id, target, category, related_id, related_table, title) VALUES(?, ?, ?, ?, ?, ?)`,
                            [newUserId, 'direct', '가입신청', newUserId, 'users', title],
                            function (err) {
                                if (err) {
                                    console.error('Error creating admin signup message:', err.message);
                                    return res.status(500).json({ error: err.message });
                                }
                                const boxId = this.lastID;

                                // Insert initial message
                                db.run(`INSERT INTO messages(message_box_id, sender_id, content) VALUES(?, ?, ?)`, [boxId, newUserId, content]);

                                // Notify Admins
                                db.all("SELECT id FROM users WHERE role = 'admin'", (err, admins) => {
                                    if (admins) {
                                        admins.forEach(admin => {
                                            db.run("INSERT INTO message_recipient (message_id, recipient_id) VALUES (?, ?)", [boxId, admin.id]);
                                        });
                                    }
                                });

                                // If tenant, also notify the landlord
                                if (role === 'tenant' && building_id) {
                                    db.all(`SELECT landlord_id FROM landlord_buildings WHERE building_id = ? `, [building_id], (err, landlords) => {
                                        if (landlords) {
                                            landlords.forEach(l => {
                                                db.run("INSERT INTO message_recipient (message_id, recipient_id) VALUES (?, ?)", [boxId, l.landlord_id]);
                                            });
                                        }
                                    });
                                }

                                // Sync Profile Info
                                syncUserBuildingInfo(newUserId);

                                res.json({ message: 'Signup application submitted', userId: newUserId });
                            }
                        );
                    });
                }
            );
        });
    });
});

// 1b. Room Application API (Applicant)
app.post('/api/apply', (req, res) => {
    const { name, phone, birth, memo, landlordId, buildingId } = req.body;
    const cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '';

    if (!name || !phone || !birth) {
        return res.status(400).json({ error: 'Name, phone and birth date are required' });
    }

    const login_id = name;

    db.get('SELECT id FROM users WHERE login_id = ? OR phone_number = ?', [login_id, cleanPhone], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        const password = Math.floor(1000000000 + Math.random() * 9000000000).toString(); // 10 digit random
        const colors = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c56e', '#06b6d4', '#3b82f6', '#8b5cf6'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        const proceedWithInsert = (finalId) => {
            db.run(`INSERT INTO users(login_id, password, nickname, role, birth_date, phone_number, color, approved, status) VALUES(?, ?, ?, ?, ?, ?, ?, 0, '임시')`,
                [finalId, password, name, 'tenant', birth, cleanPhone, randomColor],
                function (err) {
                    if (err) {
                        if (err.message.includes('UNIQUE')) {
                            const newId = name + Math.floor(Math.random() * 1000);
                            return proceedWithInsert(newId);
                        }
                        return res.status(500).json({ error: err.message });
                    }
                    const newUserId = this.lastID;

                    // Save relationship
                    const saveRelationship = (bid) => {
                        if (bid) {
                            // Find first room in this building
                            db.get("SELECT id FROM rooms WHERE building_id = ? LIMIT 1", [bid], (err, r) => {
                                if (r) {
                                    db.run(`INSERT INTO room_tenant(room_id, tenant_id, start_date) VALUES(?, ?, date('now'))`,
                                        [r.id, newUserId],
                                        (err) => {
                                            if (err) console.error('Error saving relationship:', err.message);
                                        }
                                    );
                                }
                            });
                        }
                    };

                    if (buildingId) {
                        saveRelationship(buildingId);
                    } else if (landlordId) {
                        // Fallback: Find a building for this landlord
                        db.get("SELECT building_id FROM landlord_buildings WHERE landlord_id = ? LIMIT 1", [landlordId], (err, lb) => {
                            const bid = lb ? lb.building_id : null;
                            saveRelationship(bid);
                        });
                    }

                    // Create Notification
                    const title = '방구해요 신청';
                    const content = `방 구하는 사람 정보\n이름: ${name} \n생년월일: ${birth} \n연락처: ${formatPhone(cleanPhone)} \n메모: ${memo} `;

                    db.run(`UPDATE users SET title = ?, description = ? WHERE id = ? `, [title, content, newUserId], (err) => {
                        db.run(`INSERT INTO message_box(author_id, target, category, related_id, related_table, title) VALUES(?, ?, ?, ?, ?, ?)`,
                            [newUserId, 'direct', '방있어요', newUserId, 'users', title],
                            function (err) {
                                if (err) {
                                    console.error('Error creating apply notification:', err.message);
                                    return res.status(500).json({ error: err.message });
                                }
                                const boxId = this.lastID;

                                // Insert initial message
                                db.run(`INSERT INTO messages(message_box_id, sender_id, content) VALUES(?, ?, ?)`, [boxId, newUserId, content]);

                                if (landlordId) {
                                    db.run("INSERT INTO message_recipient (message_id, recipient_id) VALUES (?, ?)", [boxId, landlordId]);
                                }
                                res.json({ message: 'Application submitted', userId: newUserId });
                            }
                        );
                    });
                }
            );
        };

        if (row) {
            proceedWithInsert(login_id + Math.floor(Math.random() * 1000));
        } else {
            proceedWithInsert(login_id);
        }
    });
});

// 2. Profile API
app.put('/api/profile/:id', upload.single('photo'), (req, res) => {
    const { login_id, password, nickname, color } = req.body;
    const photo_path = req.file ? `/ uploads / ${req.file.filename} ` : null;
    const userId = req.params.id;

    // First check if login_id is changing and if it is available
    db.get('SELECT id FROM users WHERE login_id = ? AND id != ?', [login_id, userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: 'Login ID already taken' });

        let query = `UPDATE users SET login_id = ?, nickname = ?, color = ? `;
        let params = [login_id, nickname, color];

        if (password) {
            query += `, password = ? `;
            params.push(password);
        }

        if (photo_path) {
            query += `, photo_path = ? `;
            params.push(photo_path);
        }
        query += ` WHERE id = ? `;
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


app.get('/api/admin/users', (req, res) => {
    // Show only temporary and approved users to admin
    db.all("SELECT id, login_id, nickname, role, color, photo_path, status FROM users ORDER BY role, nickname", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'User not found' });
        res.json(row);
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
    const { role } = req.query;
    let query = `
        SELECT DISTINCT u.id, u.login_id, u.nickname, u.photo_path, u.color
        FROM users u
        JOIN room_tenant rt ON u.id = rt.tenant_id
        JOIN rooms r ON rt.room_id = r.id
        JOIN landlord_buildings lb ON r.building_id = lb.building_id
        WHERE lb.landlord_id = ?
    `;
    if (role !== 'admin') {
        query += ` AND u.status != '종료'`;
    }

    const landlordId = req.params.id;
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
i.id as bill_id,
    i.billing_month as bill_month,
    i.amount as total_amount,
    i.type as invoice_type,
    c.contract_start_date,
    c.payment_type,
    p.id as payment_id,
    p.amount as payment_amount,
    p.paid_at,
    p.memo,
    pa.amount as matched_amount
        FROM invoices i
        JOIN contracts c ON i.contract_id = c.id
        LEFT JOIN payment_allocation pa ON i.id = pa.invoice_id
        LEFT JOIN payments p ON pa.payment_id = p.id
        WHERE c.tenant_id = ?
    ORDER BY i.billing_month DESC, p.paid_at ASC
    `;

    db.all(query, [tenantId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Group by invoice (bill_id)
        const billsMap = {};
        rows.forEach(row => {
            if (!billsMap[row.bill_id]) {
                billsMap[row.bill_id] = {
                    id: row.bill_id,
                    bill_month: row.bill_month,
                    total_amount: row.total_amount,
                    type: row.invoice_type,
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

app.post('/api/payments', (req, res) => {
    const { contract_id, amount, memo, type, paid_at } = req.body;
    const paidAt = paid_at || new Date().toISOString();
    const paymentType = type || 2; // Default to Rent(2)

    db.run(`INSERT INTO payments(contract_id, amount, paid_at, memo, type) VALUES(?, ?, ?, ?, ?)`,
        [contract_id, amount, paidAt, memo, paymentType],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Payment recorded', paymentId: this.lastID });
        }
    );
});

// 6. Match Payment to Invoice
app.post('/api/match-payment', (req, res) => {
    const { invoice_id, payment_id, matched_amount } = req.body;

    db.run(`INSERT INTO payment_allocation(invoice_id, payment_id, amount) VALUES(?, ?, ?)`,
        [invoice_id, payment_id, matched_amount],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Payment matched to invoice', matchId: this.lastID });
        }
    );
});

// 7. Get Unmatched Payments for a Contract
app.get('/api/contract/:id/unmatched-payments', (req, res) => {
    const contractId = req.params.id;
    const query = `
        SELECT p.*,
    COALESCE(SUM(pa.amount), 0) as total_matched,
    (p.amount - COALESCE(SUM(pa.amount), 0)) as remaining_amount
        FROM payments p
        LEFT JOIN payment_allocation pa ON p.id = pa.payment_id
        WHERE p.contract_id = ?
    GROUP BY p.id
        HAVING remaining_amount > 0
        ORDER BY p.paid_at ASC
    `;

    db.all(query, [contractId], (err, payments) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(payments);
    });
});

// 8. Get Contract Details
app.get('/api/contracts/:id', (req, res) => {
    const contractId = req.params.id;
    const query = `
        SELECT c.*, r.room_number, b.name as building, b.id as building_id,
    u1.nickname as tenant_nickname, u1.color as tenant_color, u1.phone_number as tenant_phone, u1.birth_date as tenant_dob,
    u2.nickname as landlord_nickname, lb.landlord_id
        FROM contracts c
        JOIN rooms r ON c.room_id = r.id
        JOIN buildings b ON r.building_id = b.id
        JOIN users u1 ON c.tenant_id = u1.id
        LEFT JOIN landlord_buildings lb ON b.id = lb.building_id
        LEFT JOIN users u2 ON lb.landlord_id = u2.id
        WHERE c.id = ?
    `;

    db.get(query, [contractId], (err, contract) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!contract) return res.status(404).json({ error: 'Contract not found' });
        res.json(contract);
    });
});

// 8a. Get Contract Full Details (Helper for UI)
app.get('/api/contract/:id/full-details', (req, res) => {
    const contractId = req.params.id;
    const query = `
        SELECT c.*, r.room_number, b.name as building, b.id as building_id,
    u1.nickname as tenant_name, u1.birth_date, u1.phone_number, u1.id as tenant_id
        FROM contracts c
        JOIN rooms r ON c.room_id = r.id
        JOIN buildings b ON r.building_id = b.id
        JOIN users u1 ON c.tenant_id = u1.id
        WHERE c.id = ?
    `;
    db.get(query, [contractId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ contract: row });
    });
});

// 9. Get Calendar Data for Tenant
app.get('/api/tenant/:id/calendar-data', (req, res) => {
    const tenantId = req.params.id;
    const query = `
        SELECT
c.id as contract_id,
    c.contract_start_date,
    c.contract_end_date,
    c.payment_type,
    i.id as bill_id,
    i.billing_month as bill_month,
    i.amount as total_amount,
    i.type as invoice_type,
    COALESCE(SUM(pa.amount), 0) as paid_amount
        FROM contracts c
        LEFT JOIN invoices i ON c.id = i.contract_id
        LEFT JOIN payment_allocation pa ON i.id = pa.invoice_id
        WHERE c.tenant_id = ?
    GROUP BY c.id, i.id
        ORDER BY i.billing_month ASC
    `;

    db.all(query, [tenantId], (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(data || []);
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
    i.id as bill_id,
    i.billing_month as bill_month,
    i.amount as total_amount,
    i.type as invoice_type,
    COALESCE(SUM(pa.amount), 0) as paid_amount
        FROM contracts c
        JOIN rooms r ON c.room_id = r.id
        JOIN buildings b ON r.building_id = b.id
        JOIN landlord_buildings lb ON b.id = lb.building_id
        JOIN users u ON c.tenant_id = u.id
        LEFT JOIN invoices i ON c.id = i.contract_id
        LEFT JOIN payment_allocation pa ON i.id = pa.invoice_id
        WHERE lb.landlord_id = ?
    GROUP BY c.id, u.id, i.id
        ORDER BY i.billing_month ASC
    `;

    db.all(query, [landlordId], (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(data || []);
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
    (SELECT GROUP_CONCAT(keyword, ', ') FROM contract_keywords WHERE contract_id = c.id) as keywords,
        b.name as building_name,
        b.id as building_id,
        c.id as contract_id,
        c.contract_start_date,
        c.payment_type,
        c.deposit,
        c.monthly_rent,
        c.maintenance_fee,
        r.room_number,
        i.id as invoice_id,
        i.billing_month as bill_month,
        i.amount as due_amount,
        i.type as invoice_type,
        i.status as invoice_status,
        COALESCE(SUM(pa.amount), 0) as paid_amount,
        MAX(p.paid_at) as last_paid_date
        FROM contracts c
        JOIN rooms r ON c.room_id = r.id
        JOIN buildings b ON r.building_id = b.id
        JOIN landlord_buildings lb ON b.id = lb.building_id
        JOIN users l ON lb.landlord_id = l.id
        JOIN users t ON c.tenant_id = t.id
        LEFT JOIN invoices i ON c.id = i.contract_id
        LEFT JOIN payment_allocation pa ON i.id = pa.invoice_id
        LEFT JOIN payments p ON pa.payment_id = p.id
        WHERE 1 = 1
    `;

    const params = [];

    // Filter out terminated contracts (tenants)
    query += ` AND t.status != '종료'`;

    if (role === 'landlord') {
        query += ` AND lb.landlord_id = ? `;
        params.push(user_id);
    } else if (role === 'tenant') {
        query += ` AND c.tenant_id = ? `;
        params.push(user_id);
    }

    if (landlord_id && landlord_id !== 'all') {
        query += ` AND lb.landlord_id = ? `;
        params.push(landlord_id);
    }
    if (building_id && building_id !== 'all') {
        query += ` AND b.id = ? `;
        params.push(building_id);
    }
    if (tenant_id && tenant_id !== 'all') {
        query += ` AND c.tenant_id = ? `;
        params.push(tenant_id);
    }

    query += ` 
        GROUP BY
l.id, t.id, b.id, c.id, i.id
        ORDER BY i.billing_month DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const processed = rows.map(r => ({
            ...r,
            keywords: r.keywords ? r.keywords.split(', ').filter(k => k) : []
        }));
        res.json(processed);
    });
});

// 11. Adjust Invoice Date
app.post('/api/invoices/adjust-date', (req, res) => {
    const { invoice_id, new_month, adjustment_type } = req.body;

    if (adjustment_type === 'single') {
        db.run(`UPDATE invoices SET billing_month = ? WHERE id = ? `,
            [new_month, invoice_id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Invoice date updated' });
            }
        );
    } else {
        db.get(`SELECT contract_id, billing_month FROM invoices WHERE id = ? `, [invoice_id], (err, inv) => {
            if (err) return res.status(500).json({ error: err.message });

            const direction = adjustment_type === 'shift_forward' ? -1 : 1;
            const query = `
                UPDATE invoices 
                SET billing_month = date(billing_month || '-01', '${direction} month')
                WHERE contract_id = ? AND billing_month >= ?
    `;

            db.run(query, [inv.contract_id, inv.billing_month], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: `${this.changes} invoices adjusted` });
            });
        });
    }
});

// 12. Get Active Contracts (for Import Matching)
app.get('/api/landlord/:id/contracts/active', (req, res) => {
    const landlordId = req.params.id;
    const { role } = req.query;
    let query = `
        SELECT c.*, r.room_number, b.name as building, u.nickname, u.color,
    (SELECT GROUP_CONCAT(keyword, ', ') FROM contract_keywords WHERE contract_id = c.id) as keywords_str
        FROM contracts c
        JOIN rooms r ON c.room_id = r.id
        JOIN buildings b ON r.building_id = b.id
        JOIN landlord_buildings lb ON b.id = lb.building_id
        JOIN users u ON c.tenant_id = u.id
        WHERE lb.landlord_id = ?
    `;
    if (role !== 'admin') {
        query += ` AND u.status != '종료'`;
    }
    db.all(query, [landlordId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const processed = rows.map(r => ({
            ...r,
            keywords: r.keywords_str ? r.keywords_str.split(', ').filter(k => k) : []
        }));
        res.json(processed);
    });
});

// 12a. Get Unified Tenant List based on role
app.get('/api/tenants/active-list', (req, res) => {
    const { role, user_id } = req.query;

    let query = `
        SELECT u.id as user_id, u.nickname, u.color, u.phone_number, u.birth_date, u.status,
    c.id as contract_id,
    COALESCE(b.name, b_bt.name) as building,
    COALESCE(b.id, b_bt.id) as building_id,
    COALESCE(r.room_number, r_rt.room_number) as room_number,
    COALESCE(r.id, r_rt.id) as room_id,
    c.contract_start_date, c.contract_end_date,
    c.deposit, c.monthly_rent as rent, c.maintenance_fee, lb.landlord_id,
    (SELECT GROUP_CONCAT(keyword, ', ') FROM contract_keywords WHERE contract_id = c.id) as keywords_str
        FROM users u
        LEFT JOIN contracts c ON u.id = c.tenant_id
        LEFT JOIN rooms r ON c.room_id = r.id
        LEFT JOIN buildings b ON r.building_id = b.id
        LEFT JOIN room_tenant rt ON u.id = rt.tenant_id
        LEFT JOIN rooms r_rt ON rt.room_id = r_rt.id
        LEFT JOIN buildings b_bt ON r_rt.building_id = b_bt.id
        LEFT JOIN landlord_buildings lb ON b.id = lb.building_id
        WHERE u.role = 'tenant'
    `;
    const params = [];

    if (role !== 'admin') {
        query += ` AND u.status != '종료'`;
    }

    if (role === 'landlord') {
        query += ` AND(lb.landlord_id = ? OR EXISTS(SELECT 1 FROM room_tenant rt JOIN rooms r ON rt.room_id = r.id JOIN landlord_buildings elb ON r.building_id = elb.building_id WHERE elb.landlord_id = ? AND rt.tenant_id = u.id))`;
        params.push(user_id, user_id);
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const processed = rows.map(r => ({
            ...r,
            keywords: r.keywords_str ? r.keywords_str.split(', ').filter(k => k) : []
        }));
        res.json(processed);
    });
});

// 13. Sync Contract Keywords (Relational approach: multi-row)
app.post('/api/contracts/:id/keyword', (req, res) => {
    const contractId = parseInt(req.params.id);
    const { keywords } = req.body;

    console.log(`[DEBUG] Received keyword update request for Contract ID ${contractId}: `, keywords);

    if (!Array.isArray(keywords)) {
        return res.status(400).json({ error: 'Keywords must be an array' });
    }

    // Filter out invalid keywords
    const validKeywords = keywords
        .map(k => String(k).trim())
        .filter(k => k && k.toLowerCase() !== 'null' && k !== 'undefined');

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        db.run("DELETE FROM contract_keywords WHERE contract_id = ?", [contractId], (err) => {
            if (err) {
                console.error(`[ERROR] Delete failed for contract ${contractId}: `, err.message);
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }

            if (validKeywords.length === 0) {
                db.run("COMMIT");
                return res.json({ message: 'Keywords cleared', keywords: [] });
            }

            let completed = 0;
            let hasError = false;

            validKeywords.forEach(k => {
                if (hasError) return;
                db.run("INSERT INTO contract_keywords (contract_id, keyword) VALUES (?, ?)", [contractId, k], (err) => {
                    if (err) {
                        hasError = true;
                        db.run("ROLLBACK");
                        console.error(`[ERROR] Insert failed for contract ${contractId}, keyword "${k}": `, err.message);
                        return res.status(500).json({ error: err.message });
                    }
                    completed++;
                    if (completed === validKeywords.length && !hasError) {
                        db.run("COMMIT");
                        console.log(`[SUCCESS] Updated ${completed} keywords for contract ${contractId}`);
                        res.json({ message: 'Keywords updated', count: completed, keywords: validKeywords });
                    }
                });
            });
        });
    });
});

// 14. Batch Insert Payments
app.post('/api/payments/batch', (req, res) => {
    const { payments } = req.body; // Array of { contract_id, amount, paid_at, memo }

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
        return res.status(400).json({ error: 'No payments provided' });
    }

    const placeholder = payments.map(() => '(?, ?, ?, ?, ?)').join(',');
    const flatParams = [];
    payments.forEach(p => {
        flatParams.push(p.contract_id, p.amount, p.paid_at, p.memo, p.type || 2);
    });

    const query = `INSERT INTO payments(contract_id, amount, paid_at, memo, type) VALUES ${placeholder} `;

    db.run(query, flatParams, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `${this.changes} payments imported` });
    });
});

// 14a. Allocate Payment to Invoices (and create missing invoices)
app.post('/api/payments/allocate', (req, res) => {
    const { contract_id, amount, paid_at, memo, allocations } = req.body;

    if (!contract_id || !amount || !allocations) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 1. Create the Payment record
        // Determine type based on dominant allocation or generic? Let's use Rent as default
        const mainType = allocations.length > 0 ? allocations[0].type : 'monthly_rent';

        db.run(
            `INSERT INTO payments(contract_id, amount, paid_at, memo, type) VALUES(?, ?, ?, ?, ?)`,
            [contract_id, amount, paid_at, memo, mainType],
            function (err) {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err.message });
                }

                const paymentId = this.lastID;
                let processedCount = 0;
                let hasError = false;

                if (allocations.length === 0) {
                    db.run("COMMIT");
                    return res.json({ message: 'Payment saved with no allocations', paymentId });
                }

                allocations.forEach(alloc => {
                    if (hasError) return;

                    const updateInvoiceStatus = (invId) => {
                        // Check total amount paid for this invoice
                        const statusQuery = `
SELECT
i.amount as due,
    COALESCE(SUM(pa.amount), 0) as paid
                            FROM invoices i
                            LEFT JOIN payment_allocation pa ON i.id = pa.invoice_id
                            WHERE i.id = ?
    `;
                        db.get(statusQuery, [invId], (err, row) => {
                            if (err || !row) return;
                            const newStatus = (row.paid >= row.due) ? '완납' : '부분납부';
                            db.run("UPDATE invoices SET status = ? WHERE id = ?", [newStatus, invId]);
                        });
                    };

                    const proceedWithAllocation = (invoiceId) => {
                        db.run(
                            `INSERT INTO payment_allocation(payment_id, invoice_id, amount) VALUES(?, ?, ?)`,
                            [paymentId, invoiceId, alloc.amount],
                            (err) => {
                                if (err) {
                                    hasError = true;
                                    db.run("ROLLBACK");
                                    return res.status(500).json({ error: err.message });
                                }

                                updateInvoiceStatus(invoiceId);

                                processedCount++;
                                if (processedCount === allocations.length && !hasError) {
                                    db.run("COMMIT");
                                    res.json({ message: 'Payment allocated successfully', paymentId });
                                }
                            }
                        );
                    };

                    if (!alloc.invoice_id) {
                        // Create NEW invoice
                        // For new invoices, we use due_total if provided (from frontend virtual allocation)
                        const dueAmount = alloc.due_total || alloc.amount;
                        const initialStatus = (alloc.amount >= dueAmount) ? '완납' : '부분납부';

                        db.run(
                            `INSERT INTO invoices(contract_id, type, billing_month, amount, status, due_date) VALUES(?, ?, ?, ?, ?, ?)`,
                            [contract_id, alloc.type, alloc.bill_month, dueAmount, initialStatus, alloc.due_date],
                            function (err) {
                                if (err) {
                                    hasError = true;
                                    db.run("ROLLBACK");
                                    return res.status(500).json({ error: err.message });
                                }
                                proceedWithAllocation(this.lastID);
                            }
                        );
                    } else {
                        proceedWithAllocation(alloc.invoice_id);
                    }
                });
            }
        );
    });
});

// 14b. Delete Invoice and associated data (Smart Delete)
app.delete('/api/invoices/:id', (req, res) => {
    const invoiceId = req.params.id;

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 1. Find all payment IDs tied to this invoice
        db.all("SELECT payment_id FROM payment_allocation WHERE invoice_id = ?", [invoiceId], (err, rows) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }

            const paymentIds = rows.map(r => r.payment_id);

            // 2. Delete all allocations for this invoice
            db.run("DELETE FROM payment_allocation WHERE invoice_id = ?", [invoiceId], (err) => {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err.message });
                }

                // 3. Delete the invoice itself
                db.run("DELETE FROM invoices WHERE id = ?", [invoiceId], (err) => {
                    if (err) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err.message });
                    }

                    // 4. Cleanup orphaned payments (payments with no remaining allocations)
                    if (paymentIds.length === 0) {
                        db.run("COMMIT");
                        return res.json({ message: 'Invoice deleted (no payments were linked)' });
                    }

                    let completed = 0;
                    paymentIds.forEach(pid => {
                        db.get("SELECT COUNT(*) as count FROM payment_allocation WHERE payment_id = ?", [pid], (err, row) => {
                            if (!err && row.count === 0) {
                                // This payment is now orphaned, delete it
                                db.run("DELETE FROM payments WHERE id = ?", [pid]);
                            }
                            completed++;
                            if (completed === paymentIds.length) {
                                db.run("COMMIT");
                                res.json({ message: 'Invoice and associated orphaned payments deleted' });
                            }
                        });
                    });
                });
            });
        });
    });
});

// 15. Get Landlord's Buildings
app.get('/api/landlord/:id/buildings', (req, res) => {
    const landlordId = req.params.id;
    const query = `
        SELECT b.*, GROUP_CONCAT(ba.address, '|||') as addresses
        FROM buildings b
        JOIN landlord_buildings lb ON b.id = lb.building_id
        LEFT JOIN building_addresses ba ON b.id = ba.building_id
        WHERE lb.landlord_id = ?
    GROUP BY b.id
        `;
    db.all(query, [landlordId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        rows.forEach(row => {
            if (row.addresses) {
                const parts = row.addresses.split('|||');
                row.address1 = parts[0] || '';
                row.address2 = parts[1] || '';
            } else {
                row.address1 = '';
                row.address2 = '';
            }
            delete row.addresses;
        });
        res.json(rows);
    });
});

// 15a. Get Tenant's Buildings
app.get('/api/tenant/:id/buildings', (req, res) => {
    const tenantId = req.params.id;
    const query = `
        SELECT b.*, GROUP_CONCAT(ba.address, '|||') as addresses
        FROM buildings b
        LEFT JOIN building_addresses ba ON b.id = ba.building_id
        WHERE b.id IN(
            SELECT r.building_id FROM rooms r JOIN room_tenant rt ON r.id = rt.room_id WHERE rt.tenant_id = ?
                UNION
            SELECT r.building_id FROM rooms r JOIN contracts c ON r.id = c.room_id 
            WHERE c.tenant_id = ? AND(c.contract_end_date IS NULL OR c.contract_end_date >= date('now'))
        )
        GROUP BY b.id
    `;
    db.all(query, [tenantId, tenantId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        rows.forEach(row => {
            if (row.addresses) {
                const parts = row.addresses.split('|||');
                row.address1 = parts[0] || '';
                row.address2 = parts[1] || '';
            } else {
                row.address1 = '';
                row.address2 = '';
            }
            delete row.addresses;
        });
        res.json(rows);
    });
});
app.post('/api/buildings', (req, res) => {
    const { landlord_id, name, address1, address2, memo } = req.body;

    if (!landlord_id || !name) {
        return res.status(400).json({ error: 'landlord_id and name are required' });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Removed address1, address2
        const insertQuery = `INSERT INTO buildings(name, memo) VALUES(?, ?)`;
        db.run(insertQuery, [name, memo || ''], function (err) {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
            const buildingId = this.lastID;

            // Insert addresses if provided
            const addresses = [];
            if (address1) addresses.push(address1);
            if (address2) addresses.push(address2);

            const addressPromises = addresses.map(addr => {
                return new Promise((resolve, reject) => {
                    db.run('INSERT INTO building_addresses (building_id, address) VALUES (?, ?)', [buildingId, addr], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            });

            Promise.all(addressPromises)
                .then(() => {
                    db.run(`INSERT INTO landlord_buildings(landlord_id, building_id) VALUES(?, ?)`,
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
                })
                .catch(err => {
                    db.run('ROLLBACK');
                    res.status(500).json({ error: err.message });
                });
        });
    });
});

// 16a. Update Building
// 16a. Update Building
app.put('/api/buildings/:id', (req, res) => {
    const buildingId = req.params.id;
    const { name, address1, address2, memo } = req.body;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(
            `UPDATE buildings SET name = ?, memo = ? WHERE id = ? `,
            [name, memo, buildingId],
            function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }

                // If addresses are provided, we replace them. 
                // Note: If frontend sends empty strings, we might clear addresses. 
                // Assuming frontend sends all current addresses.
                // If address1/address2 are undefined, we might skip updating addresses? 
                // But standard PUT replaces. Let's assume we want to update addresses if keys exist.

                if (address1 !== undefined || address2 !== undefined) {
                    db.run('DELETE FROM building_addresses WHERE building_id = ?', [buildingId], err => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: err.message });
                        }

                        const addresses = [];
                        if (address1) addresses.push(address1);
                        if (address2) addresses.push(address2);

                        const addressPromises = addresses.map(addr => {
                            return new Promise((resolve, reject) => {
                                db.run('INSERT INTO building_addresses (building_id, address) VALUES (?, ?)', [buildingId, addr], (err) => {
                                    if (err) reject(err);
                                    else resolve();
                                });
                            });
                        });

                        Promise.all(addressPromises)
                            .then(() => {
                                db.run('COMMIT');
                                res.json({ message: 'Building updated' });
                            })
                            .catch(err => {
                                db.run('ROLLBACK');
                                res.status(500).json({ error: err.message });
                            });
                    });
                } else {
                    db.run('COMMIT');
                    res.json({ message: 'Building updated' });
                }
            }
        );
    });
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
         WHERE c.room_id = r.id
         ORDER BY c.contract_start_date DESC LIMIT 1) as tenant_name
        FROM rooms r
        WHERE r.building_id = ?
    `;
    db.all(query, [buildingId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 17a. Get Building's Addresses
app.get('/api/buildings/:id/addresses', (req, res) => {
    const buildingId = req.params.id;
    db.all(`SELECT * FROM building_addresses WHERE building_id = ? `, [buildingId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});



// 17b. Add Building Address
app.post('/api/buildings/:id/addresses', (req, res) => {
    const buildingId = req.params.id;
    const { address } = req.body;
    db.run(`INSERT INTO building_addresses(building_id, address) VALUES(?, ?)`,
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
    db.run(`DELETE FROM building_addresses WHERE id = ? `, [addressId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Address deleted' });
    });
});

// 17d. Delete All Addresses for Building
app.delete('/api/buildings/:id/addresses', (req, res) => {
    const buildingId = req.params.id;
    db.run(`DELETE FROM building_addresses WHERE building_id = ? `, [buildingId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'All addresses deleted for building' });
    });
});

// 18. Create Room
app.post('/api/rooms', (req, res) => {
    const { building_id, room_number, memo, building, floor, unit } = req.body;
    db.run(`INSERT INTO rooms(building_id, room_number, memo, building, floor, unit) VALUES(?, ?, ?, ?, ?, ?)`,
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
    console.log(`PUT / api / rooms / ${req.params.id} called with body: `, req.body);
    const roomId = req.params.id;
    const { room_number, memo, building, floor, unit } = req.body;
    db.run(`UPDATE rooms SET room_number = ?, memo = ?, building = ?, floor = ?, unit = ? WHERE id = ? `,
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
    let query = `
        SELECT u.*,
    COALESCE(r.id, r_c.id) as room_id,
    COALESCE(r.room_number, r_c.room_number) as room_number,
    COALESCE(r.building_id, r_c.building_id) as building_id,
    COALESCE(b.name, b_c.name) as building_name
        FROM users u
        LEFT JOIN room_tenant rt ON u.id = rt.tenant_id
        LEFT JOIN rooms r ON rt.room_id = r.id
        LEFT JOIN buildings b ON r.building_id = b.id
        LEFT JOIN contracts c ON u.id = c.tenant_id
        LEFT JOIN rooms r_c ON c.room_id = r_c.id
        LEFT JOIN buildings b_c ON r_c.building_id = b_c.id
        WHERE u.role = ? AND u.nickname = ? AND u.birth_date = ? AND u.status != '종료'
        ORDER BY c.id DESC, rt.start_date DESC
    `;
    db.all(query, [role, name, birth_date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 20. Create or Update User (Quick Add/Save)
app.post('/api/users/quick', (req, res) => {
    console.log('POST /api/users/quick body:', req.body);
    const { id, login_id, password, nickname, role, birth_date, phone_number, building_id } = req.body;
    const cleanPhone = phone_number ? phone_number.replace(/[^0-9]/g, '') : '';

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
            const updateFields = [];
            const updateParams = [];

            if (login_id) {
                updateFields.push('login_id = ?');
                updateParams.push(login_id);
            }
            if (nickname) {
                updateFields.push('nickname = ?');
                updateParams.push(nickname);
            }
            if (birth_date) {
                updateFields.push('birth_date = ?');
                updateParams.push(birth_date);
            }
            if (phone_number) {
                updateFields.push('phone_number = ?');
                updateParams.push(cleanPhone);
            }
            if (req.body.status) {
                updateFields.push('status = ?');
                updateParams.push(req.body.status);
            }
            if (req.body.approved !== undefined) {
                updateFields.push('approved = ?');
                updateParams.push(req.body.approved);
            }

            if (updateFields.length > 0) {
                const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ? `;
                updateParams.push(targetId);

                db.run(updateQuery, updateParams, function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'User updated', userId: targetId });
                });
            } else {
                res.json({ message: 'No changes provided', userId: targetId });
            }
        } else {
            // Truly new - Insert
            const colors = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];

            // Failsafe: Ensure login_id exists
            const finalLoginId = login_id || (nickname + (birth_date ? birth_date.replace(/-/g, '').slice(2) : Math.floor(Math.random() * 10000)));

            db.run(`INSERT INTO users(login_id, password, nickname, role, color, birth_date, phone_number, approved, status) VALUES(?, ?, ?, ?, ?, ?, ?, 1, '승인')`,
                [finalLoginId, password || '1234', nickname, role, randomColor, birth_date, cleanPhone],
                async function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    const newUserId = this.lastID;

                    // Save relationship to room if provided
                    if (role === 'tenant' && building_id) {
                        // Find first room in building
                        db.get("SELECT id FROM rooms WHERE building_id = ? LIMIT 1", [building_id], (err, r) => {
                            if (r) {
                                db.run(`INSERT INTO room_tenant(room_id, tenant_id, start_date) VALUES(?, ?, date('now'))`,
                                    [r.id, newUserId],
                                    (err) => {
                                        if (err) console.error('Error saving quick user room relationship:', err.message);
                                    }
                                );
                            }
                        });
                    }

                    // Notification & Building Info Resolution
                    let buildingName = '';
                    let roomNumber = '';

                    const getBuildingInfo = () => {
                        return new Promise((resolve) => {
                            if (role === 'tenant' && building_id) {
                                db.get('SELECT name FROM buildings WHERE id = ?', [building_id], (err, b) => {
                                    if (b) buildingName = b.name;

                                    // Also try to find the latest room assigned
                                    db.get('SELECT room_number FROM rooms WHERE building_id = ? AND id IN (SELECT room_id FROM contracts WHERE tenant_id = ?)', [building_id, newUserId], (err, r) => {
                                        if (r) roomNumber = r.room_number;
                                        resolve();
                                    });
                                });
                            } else {
                                resolve();
                            }
                        });
                    };

                    await getBuildingInfo();

                    const titleText = (role === 'tenant' && buildingName) ? `${buildingName} ${roomNumber || ''} `.trim() : (role === 'landlord' ? '임대인 등록 완료' : '세입자 등록 완료');
                    let content = `아이디: ${login_id} \n이름: ${nickname} \n생년월일: ${birth_date} \n전화번호: ${formatPhone(cleanPhone)} `;

                    if (role === 'tenant' && buildingName) {
                        content += `\n건물명: ${buildingName} \n호수: ${roomNumber || '-'} `;
                    }

                    db.run(`UPDATE users SET title = ?, description = ? WHERE id = ? `, [titleText, content, newUserId], (err) => {
                        db.run(`INSERT INTO message_box(author_id, target, category, related_id, related_table, title) VALUES(?, ?, ?, ?, ?, ?)`,
                            [newUserId, 'direct', '시스템', newUserId, 'users', titleText],
                            function (err) {
                                if (err) {
                                    console.error('Error creating user quick notification:', err.message);
                                } else {
                                    const boxId = this.lastID;

                                    // Insert initial message
                                    db.run(`INSERT INTO messages(message_box_id, sender_id, content) VALUES(?, ?, ?)`, [boxId, newUserId, content]);

                                    // Auto-send to the user themselves
                                    db.run("INSERT INTO message_recipient (message_id, recipient_id) VALUES (?, ?)", [boxId, newUserId]);
                                }
                                // Distribute global messages
                                distributeGlobalMessagesToUser(newUserId);

                                // Sync Profile Info
                                syncUserBuildingInfo(newUserId);

                                res.json({ message: 'User created', userId: newUserId });
                            }
                        );
                    });
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
        SELECT DISTINCT u.id, u.nickname, b.name as building, r.room_number,
               (SELECT GROUP_CONCAT(keyword, ', ') FROM contract_keywords WHERE contract_id = c.id) as keywords_str
        FROM contracts c
        JOIN rooms r ON c.room_id = r.id
        JOIN buildings b ON r.building_id = b.id
        JOIN landlord_buildings lb ON b.id = lb.building_id
        JOIN users u ON c.tenant_id = u.id
        LEFT JOIN contract_keywords ck ON c.id = ck.contract_id
        WHERE c.contract_end_date >= date('now')
        AND u.status != '종료'
    `;

    const params = [];

    if (landlord_id) {
        query += ` AND lb.landlord_id = ? `;
        params.push(landlord_id);
    }

    if (keyword) {
        query += ` AND (u.nickname LIKE ? OR ck.keyword LIKE ?)`;
        const likeKey = `%${keyword}%`;
        params.push(likeKey, likeKey);
    }

    query += ` ORDER BY u.nickname`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const processed = rows.map(r => ({
            ...r,
            keywords: r.keywords_str ? r.keywords_str.split(', ').filter(k => k) : []
        }));
        res.json(processed);
    });
});

// 24. Terminate Contract (Set End Date)
app.post('/api/contracts/:id/terminate', (req, res) => {
    const contractId = req.params.id;
    const { end_date } = req.body;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`UPDATE contracts SET move_out_date = ?, contract_end_date = ? WHERE id = ? `, [end_date, end_date, contractId], function (err) {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
            // Also update the user status to '종료'
            db.run(`UPDATE users SET status = '종료' WHERE id = (SELECT tenant_id FROM contracts WHERE id = ?)`, [contractId], function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
                db.run('COMMIT');
                res.json({ message: 'Contract terminated and user status updated to 종료' });
            });
        });
    });
});

// 24a. Create Contract
app.post('/api/contracts/full', (req, res) => {
    const {
        tenant_id, payment_type, contract_start_date, contract_end_date,
        deposit, monthly_rent, management_fee, cleaning_fee, room_id, landlord_id
    } = req.body;

    const query = `
        INSERT INTO contracts(
        tenant_id, payment_type, contract_start_date, contract_end_date,
        deposit, monthly_rent, maintenance_fee, cleaning_fee, room_id
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

    db.run(query, [
        tenant_id, payment_type, contract_start_date, contract_end_date,
        deposit, monthly_rent, management_fee, cleaning_fee, room_id
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });

        // Sync user info because room might have changed
        syncUserBuildingInfo(tenant_id);

        // Update tenant status to approved
        db.run("UPDATE users SET approved = 1, status = '승인' WHERE id = ?", [tenant_id]);

        res.json({ message: 'Contract created', contractId: this.lastID });
    });
});

// 24b. Update Contract
app.put('/api/contracts/:id', (req, res) => {
    const contractId = req.params.id;
    const {
        tenant_id, payment_type, contract_start_date, contract_end_date,
        deposit, monthly_rent, management_fee, cleaning_fee, room_id, keyword
    } = req.body;

    const query = `
        UPDATE contracts SET
tenant_id = ?, payment_type = ?, contract_start_date = ?, contract_end_date = ?,
    deposit = ?, monthly_rent = ?, maintenance_fee = ?, cleaning_fee = ?, room_id = ?
        WHERE id = ?
            `;

    db.run(query, [
        tenant_id, payment_type, contract_start_date, contract_end_date,
        deposit, monthly_rent, management_fee, cleaning_fee, room_id,
        contractId
    ], function (err) {
        if (err) return res.status(500).json({ error: err.message });

        // Update tenant status to approved
        db.run("UPDATE users SET approved = 1, status = '승인' WHERE id = ?", [tenant_id]);

        res.json({ message: 'Contract updated' });
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
AND(re.memo LIKE ? OR ? = '')
         ORDER BY re.event_date DESC, re.id DESC LIMIT 1) as latest_event,
    (SELECT re.event_date 
         FROM room_events re 
         WHERE re.room_id = r.id
AND(re.memo LIKE ? OR ? = '')
         ORDER BY re.event_date DESC, re.id DESC LIMIT 1) as latest_event_date,
    (SELECT COUNT(*) FROM room_events re WHERE re.room_id = r.id) as event_count
        FROM rooms r
        WHERE r.building_id = ?
    `;

    const searchQuery = `% ${search}% `;
    db.all(query, [searchQuery, search, searchQuery, search, buildingId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 26b. Get Single Room Event
app.get('/api/room-events/:id', (req, res) => {
    const eventId = req.params.id;
    const query = `
        SELECT re.*, r.building_id 
        FROM room_events re
        JOIN rooms r ON re.room_id = r.id
        WHERE re.id = ?
    `;
    db.get(query, [eventId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Event not found' });
        res.json(row);
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

app.post('/api/rooms/:id/events', upload.single('photo'), (req, res) => {
    const roomId = req.params.id;
    const { event_date, memo } = req.body;
    const photo = req.file ? `/uploads/${req.file.filename}` : null;
    db.run(`INSERT INTO room_events(room_id, event_date, memo, photo) VALUES(?, ?, ?, ?)`,
        [roomId, event_date, memo, photo],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Event added', eventId: this.lastID });
        }
    );
});

// 28. Update Room Event
app.put('/api/room-events/:id', upload.single('photo'), (req, res) => {
    const eventId = req.params.id;
    const { event_date, memo } = req.body;
    let query = `UPDATE room_events SET event_date = ?, memo = ? `;
    let params = [event_date, memo];

    if (req.file) {
        query += `, photo = ? `;
        params.push(`/uploads/${req.file.filename}`);
    }

    query += ` WHERE id = ? `;
    params.push(eventId);

    db.run(query, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Event updated' });
    });
});

// 28a. Delete Room Event
app.delete('/api/room-events/:id', (req, res) => {
    const eventId = req.params.id;
    db.run(`DELETE FROM room_events WHERE id = ? `, [eventId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Event deleted' });
    });
});

// 29a. Get Room Tenants
app.get('/api/rooms/:id/tenants', (req, res) => {
    const roomId = req.params.id;
    const query = `
        SELECT rt.*, u.nickname, u.status as user_status
        FROM room_tenant rt
        JOIN users u ON rt.tenant_id = u.id
        WHERE rt.room_id = ?
        ORDER BY rt.start_date DESC
    `;
    db.all(query, [roomId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 29. Get Single Room Detail
app.get('/api/rooms/:id', (req, res) => {
    const roomId = req.params.id;
    const query = `
        SELECT r.*, b.name as building_name 
        FROM rooms r 
        LEFT JOIN buildings b ON r.building_id = b.id 
        WHERE r.id = ? 
    `;
    db.get(query, [roomId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: `Room with ID ${roomId} not found in database.` });
        res.json(row);
    });
});


// 30. Get Messages (Visibility Logic)
app.get('/api/notices', (req, res) => {
    const { role, user_id } = req.query;
    let query = '';
    let params = [];

    const baseFields = `
        mb.*,
        COALESCE(mb.title, a.title, i.title, u_rel.title, '알림') as title,
        msg.content as content,
        COALESCE(a.status, i.status, u_rel.status, '-') as related_status,
        u.nickname, u.status as user_status,
        (SELECT COUNT(*) FROM message_recipient WHERE message_id = mb.id AND recipient_id != mb.author_id) as total_cnt,
        (SELECT COUNT(*) FROM message_recipient WHERE message_id = mb.id AND read_at IS NOT NULL AND recipient_id != mb.author_id) as read_cnt,
        (SELECT read_at FROM message_recipient WHERE message_id = mb.id AND recipient_id = ?) as my_read_at
    `;

    const joinClause = `
        LEFT JOIN messages msg ON mb.message_id = msg.id
        LEFT JOIN advertisements a ON mb.related_table = 'advertisements' AND mb.related_id = a.id
        LEFT JOIN items i ON mb.related_table = 'items' AND mb.related_id = i.id
        LEFT JOIN users u_rel ON mb.related_table = 'users' AND mb.related_id = u_rel.id
        LEFT JOIN users u ON mb.author_id = u.id
        LEFT JOIN message_recipient mr ON mb.id = mr.message_id
    `;

    if (role === 'admin') {
        query = `
            SELECT DISTINCT ${baseFields}
            FROM message_box mb
            ${joinClause}
            ORDER BY mb.created_at DESC
        `;
        params = [user_id];
    } else {
        query = `
            SELECT DISTINCT ${baseFields}
            FROM message_box mb
            ${joinClause}
            WHERE (
                mb.author_id = ?
                OR mr.recipient_id = ?
            )
            ORDER BY mb.created_at DESC
        `;
        params = [user_id, user_id, user_id];
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('[API Error] GET /api/notices:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// 31b. Get Message Recipients Status
// 31b. Get Message Recipients Status
app.get('/api/message-recipients/:id', (req, res) => {
    const messageId = req.params.id;
    const query = `
        SELECT u.nickname, mr.read_at, mr.recipient_id
        FROM message_recipient mr
        JOIN users u ON mr.recipient_id = u.id
        JOIN message_box mb ON mr.message_id = mb.id
        WHERE mr.message_id = ? AND mr.recipient_id != mb.author_id
        ORDER BY mr.read_at DESC, u.nickname ASC
    `;
    db.all(query, [messageId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 31. Get Single Message
app.get('/api/notices/:id', (req, res) => {
    const id = req.params.id;
    const query = `
        SELECT mb.*,
    COALESCE(mb.title, a.title, i.title, u_rel.title, '알림') as title,
    msg.content as content,
    COALESCE(a.status, i.status, u_rel.status, '-') as related_status,
    u.nickname as author_name, u.login_id as author_id_str, u.birth_date, u.phone_number, u.status as user_status
        FROM message_box mb
        LEFT JOIN messages msg ON mb.message_id = msg.id
        LEFT JOIN advertisements a ON mb.related_table = 'advertisements' AND mb.related_id = a.id
        LEFT JOIN items i ON mb.related_table = 'items' AND mb.related_id = i.id
        LEFT JOIN users u_rel ON mb.related_table = 'users' AND mb.related_id = u_rel.id
        LEFT JOIN users u ON mb.author_id = u.id
        WHERE mb.id = ?
    `;
    db.get(query, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Message not found' });
        res.json(row);
    });
});

// 31. Confirm Message (Mark as read)
app.put('/api/notices/:id/confirm', (req, res) => {
    const messageId = req.params.id;
    const { user_id } = req.body;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // 1. Update individual recipient status
        db.run(`UPDATE message_recipient SET read_at = CURRENT_TIMESTAMP WHERE message_id = ? AND recipient_id = ? `,
            [messageId, user_id], function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }

                // 2. Find the content message_id and update messages table
                db.get(`SELECT message_id FROM message_box WHERE id = ? `, [messageId], (err, row) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }
                    if (row && row.message_id) {
                        // Update messages table: Only update if it hasn't been marked read yet (is_read=0)
                        // This captures the time of the *first* read.
                        db.run(`UPDATE messages SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ? AND is_read = 0`,
                            [row.message_id], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: err.message });
                                }
                                db.run('COMMIT');
                                res.json({ message: 'Message confirmed' });
                            });
                    } else {
                        // Should not happen, but commit anyway
                        db.run('COMMIT');
                        res.json({ message: 'Message confirmed' });
                    }
                });
            });
    });
});

// 31a. Delete Message
app.delete('/api/notices/:id', (req, res) => {
    const messageId = req.params.id;
    console.log(`[API] DELETE / api / notices / ${messageId} `);

    // Get all necessary details in one go
    db.get("SELECT category, author_id, message_id as contentId FROM message_box WHERE id = ?", [messageId], (err, msg) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!msg) return res.status(404).json({ error: 'Message not found' });

        const { category, author_id, contentId } = msg;

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // 1. Delete Recipients
            db.run(`DELETE FROM message_recipient WHERE message_id = ? `, [messageId], (err) => {
                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                // 2. Delete the box
                db.run(`DELETE FROM message_box WHERE id = ? `, [messageId], (err) => {
                    if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                    // 3. Delete the message content
                    if (contentId) {
                        db.run(`DELETE FROM messages WHERE id = ? `, [contentId]);
                    }

                    // 4. Delete the user if it's a signup AND not approved yet
                    if (category === '가입신청' && author_id) {
                        // Check if user is approved or has contracts before deleting
                        db.get("SELECT approved FROM users WHERE id = ?", [author_id], (err, userRow) => {
                            if (userRow && userRow.approved === 1) {
                                // User is already approved, just commit message deletion
                                db.run('COMMIT');
                                return res.json({ message: 'Message deleted' });
                            }

                            // Check for contracts as a secondary safety measure
                            db.get("SELECT id FROM contracts WHERE tenant_id = ? LIMIT 1", [author_id], (err, contractRow) => {
                                if (contractRow) {
                                    // User has contracts, don't delete user
                                    db.run('COMMIT');
                                    return res.json({ message: 'Message deleted' });
                                }

                                // Safe to delete the temporary user
                                db.run("DELETE FROM room_tenant WHERE tenant_id = ?", [author_id], (err) => {
                                    if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: `Room relationship deletion failed: ${err.message}` }); }

                                    db.run("DELETE FROM users WHERE id = ?", [author_id], (err) => {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ error: `User deletion failed: ${err.message}` });
                                        }
                                        db.run('COMMIT');
                                        res.json({ message: 'Message and temporary user deleted' });
                                    });
                                });
                            });
                        });
                    } else {
                        db.run('COMMIT');
                        res.json({ message: 'Message deleted' });
                    }
                });
            });
        });
    });
});

// 32. Approve User (Signup)
app.post('/api/users/:id/approve', (req, res) => {
    const targetUserId = req.params.id;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`UPDATE users SET approved = 1, status = '승인' WHERE id = ? `, [targetUserId], function (err) {
            if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

            db.run(`UPDATE message_box SET confirmed = 1 WHERE author_id = ? AND category = '가입신청'`, [targetUserId], function (err) {
                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

                // Distribute global messages upon approval
                distributeGlobalMessagesToUser(targetUserId);

                db.run('COMMIT');
                res.json({ message: 'User approved' });
            });
        });
    });
});

// 33. Reject User (Signup)
app.post('/api/users/:id/reject', (req, res) => {
    const targetUserId = req.params.id;
    db.run(`UPDATE users SET approved = 2, status = '거절' WHERE id = ? `, [targetUserId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`UPDATE message_box SET confirmed = 1 WHERE author_id = ? AND category = '가입신청'`, [targetUserId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'User rejected' });
        });
    });
});

app.delete('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    const isHardDelete = req.query.hard === 'true';

    if (isHardDelete) {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // Recursive deletion of related data
            // Note: Order matters due to Foreign Key constraints (if enforced) and logic.
            // We must delete payments and keywords (children of contracts) before contracts.
            // Also payment_allocation -> invoices -> contracts
            const deleteOps = [
                { name: 'applicants_user', sql: `DELETE FROM applicants WHERE user_id = ? ` },
                { name: 'applicants_adv', sql: `DELETE FROM applicants WHERE advertisement_id IN(SELECT id FROM advertisements WHERE created_by = ?)` },
                { name: 'payment_allocation_inv', sql: `DELETE FROM payment_allocation WHERE invoice_id IN(SELECT id FROM invoices WHERE contract_id IN(SELECT id FROM contracts WHERE tenant_id = ?))` },
                { name: 'payment_allocation_pay', sql: `DELETE FROM payment_allocation WHERE payment_id IN(SELECT id FROM payments WHERE contract_id IN(SELECT id FROM contracts WHERE tenant_id = ?))` },
                { name: 'invoices', sql: `DELETE FROM invoices WHERE contract_id IN(SELECT id FROM contracts WHERE tenant_id = ?)` },
                { name: 'payments', sql: `DELETE FROM payments WHERE contract_id IN(SELECT id FROM contracts WHERE tenant_id = ?)` },
                { name: 'contract_keywords', sql: `DELETE FROM contract_keywords WHERE contract_id IN(SELECT id FROM contracts WHERE tenant_id = ?)` },
                { name: 'contracts', sql: `DELETE FROM contracts WHERE tenant_id = ? ` },
                { name: 'messages', sql: `DELETE FROM message_box WHERE author_id = ? ` },
                { name: 'advertisements', sql: `DELETE FROM advertisements WHERE created_by = ? ` },
                { name: 'items', sql: `DELETE FROM items WHERE owner_id = ? ` },
                { name: 'room_tenant', sql: `DELETE FROM room_tenant WHERE tenant_id = ? ` },
                { name: 'message_recipient', sql: `DELETE FROM message_recipient WHERE recipient_id = ? ` },
                { name: 'landlord_buildings', sql: `DELETE FROM landlord_buildings WHERE landlord_id = ? ` }
            ];

            let completed = 0;
            let hasError = false;
            const checkDone = () => {
                completed++;
                if (completed === deleteOps.length) {
                    if (hasError) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'One or more cascade delete operations failed. Check server logs.' });
                    }
                    db.run(`DELETE FROM users WHERE id = ? `, [userId], function (err) {
                        if (err) {
                            console.error('Final user delete error:', err);
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: err.message });
                        }
                        db.run('COMMIT');
                        res.json({ message: 'User and all related data permanently deleted' });
                    });
                }
            };

            deleteOps.forEach(op => {
                db.run(op.sql, [userId], (err) => {
                    if (err) {
                        console.error(`Cascade delete error in ${op.name}: `, err);
                        hasError = true;
                    }
                    checkDone();
                });
            });
        });
    } else {
        db.run(`UPDATE users SET status = '종료' WHERE id = ? `, [userId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'User withdrawn' });
        });
    }
});




// 36. Update Room Status (for Advertising 완료)
app.post('/api/rooms/:id/status', (req, res) => {
    const { status } = req.body;
    const roomId = req.params.id;
    db.run(`UPDATE rooms SET status = ? WHERE id = ? `, [status, roomId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Room status updated' });
    });
});

// 37. Get Unread Message Count
app.get('/api/messages/unread-count/:userId', (req, res) => {
    const userId = req.params.userId;
    const query = `
        SELECT COUNT(*) as count 
        FROM message_recipient 
        WHERE recipient_id = ? AND read_at IS NULL
    `;
    db.get(query, [userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ count: row.count || 0 });
    });
});

app.post('/api/admin/reset-db', (req, res) => {
    db.resetDatabase((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Database reset successfully' });
    });
});

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Please kill the process using it and try again.`);
        process.exit(1);
    } else {
        console.error('Server error:', err);
    }
});
