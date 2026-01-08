const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const isRender = !!process.env.RENDER;
const databaseUrl = process.env.DATABASE_URL;

let db;

// SQL Conversion Helper
function convertSqlToPg(sql) {
    let pIdx = 1;
    // Replace ? with $1, $2, ...
    let newSql = sql.replace(/\?/g, () => `$${pIdx++}`);

    // Replace SQLite specific functions
    newSql = newSql.replace(/date\('now'\)/gi, 'CURRENT_DATE');
    newSql = newSql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');

    // Handle shift logic from server.js: date(bill_month || '-01', '${direction} month')
    if (newSql.includes("date(bill_month || '-01'")) {
        newSql = newSql.replace(
            /date\(bill_month \|\| '-01', '(-?\d+) month'\)/g,
            "(bill_month || '-01')::date + interval '$1 month'"
        );
    }

    return newSql;
}

if (databaseUrl) {
    // PostgreSQL Mode
    console.log('Using PostgreSQL database');
    const pool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false }
    });

    // Test connection
    pool.query('SELECT NOW()', (err, res) => {
        if (err) console.error('PG Connection Error:', err);
        else console.log('Connected to PG:', res.rows[0]);
    });

    // Wrapper to mimic sqlite3 API
    db = {
        pool,
        serialize: (fn) => fn(),
        get: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            sql = convertSqlToPg(sql);
            pool.query(sql, params, (err, res) => {
                if (err) return cb ? cb(err) : console.error(err);
                cb && cb(null, res.rows[0]);
            });
        },
        all: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            sql = convertSqlToPg(sql);
            pool.query(sql, params, (err, res) => {
                if (err) return cb ? cb(err) : console.error(err);
                cb && cb(null, res.rows);
            });
        },
        run: function (sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            let isInsert = /^\s*insert/i.test(sql);
            sql = convertSqlToPg(sql);

            if (isInsert && !/returning/i.test(sql)) {
                sql += ' RETURNING id';
            }

            pool.query(sql, params, (err, res) => {
                const context = { lastID: 0, changes: 0 };
                if (!err) {
                    if (isInsert && res.rows.length > 0) {
                        context.lastID = res.rows[0].id;
                    }
                    context.changes = res.rowCount;
                }
                if (cb) cb.call(context, err);
            });
        },
        exec: (sql, cb) => {
            pool.query(sql, (err) => cb && cb(err));
        }
    };

    // Init PG Schema
    const SCHEMA_PG_PATH = path.join(__dirname, 'schema_pg.sql');
    if (fs.existsSync(SCHEMA_PG_PATH)) {
        const schema = fs.readFileSync(SCHEMA_PG_PATH, 'utf8');
        pool.query(schema, (err) => {
            if (err) console.error('Error initializing PG schema:', err.message);
            else console.log('PG Database schema initialized.');
        });
    }

} else {
    // SQLite Mode
    const DB_PATH = isRender
        ? "/data/sugar.db"
        : path.join(__dirname, "sugar.db");

    if (!isRender) {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

    db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error('Error opening database:', err.message);
        } else {
            console.log('Connected to the SQLite database:', DB_PATH);
            const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
            db.exec(schema, (err) => {
                if (err) console.error('Error initializing schema:', err.message);
                else console.log('Database schema initialized.');
            });
        }
    });
}

module.exports = db;
