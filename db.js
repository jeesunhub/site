const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const isRender = !!process.env.RENDER;

const DB_PATH = isRender
    ? "/data/sugar.db"
    : path.join(__dirname, "sugar.db");

// DB 디렉토리 없으면 생성
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema, (err) => {
        if (err) {
            console.error('Error initializing schema:', err.message);
        } else {
            console.log('Database schema initialized.');
        }
    });
}

module.exports = db;
