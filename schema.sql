-- SQLite Schema for Tenant and Landlord Management System

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login_id TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,

    nickname TEXT,
    color TEXT,
    photo_path TEXT,

    role TEXT NOT NULL CHECK (role IN ('tenant', 'landlord', 'admin')),

    birth_date TEXT,
    phone_number TEXT,
    noti INTEGER DEFAULT 0,
    approved INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address1 TEXT,
    address2 TEXT,
    memo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS building_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    FOREIGN KEY (building_id) REFERENCES buildings(id)
);

CREATE TABLE IF NOT EXISTS landlord_buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    landlord_id INTEGER NOT NULL,
    building_id INTEGER NOT NULL,
    FOREIGN KEY (landlord_id) REFERENCES users(id),
    FOREIGN KEY (building_id) REFERENCES buildings(id)
);

CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL,
    room_number TEXT NOT NULL,
    memo TEXT,
    building TEXT,
    floor INTEGER,
    unit TEXT,
    status INTEGER DEFAULT 0,
    deposit INTEGER,
    rent INTEGER,
    management_fee INTEGER,
    available_date TEXT,
    FOREIGN KEY (building_id) REFERENCES buildings(id)
);

CREATE TABLE IF NOT EXISTS landlord_tenant (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    landlord_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,

    start_date DATE NOT NULL,
    end_date DATE,

    FOREIGN KEY (landlord_id) REFERENCES users(id),
    FOREIGN KEY (tenant_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    landlord_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,

    payment_type TEXT NOT NULL CHECK (payment_type IN ('prepaid', 'postpaid')),
    
    contract_start_date DATE NOT NULL,
    contract_end_date DATE,
    move_out_date DATE,

    deposit INTEGER NOT NULL,
    monthly_rent INTEGER NOT NULL,
    management_fee INTEGER NOT NULL,
    cleaning_fee INTEGER DEFAULT 0,
    extra_fee INTEGER DEFAULT 0,

    keyword TEXT,
    building TEXT,
    room_number TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (landlord_id) REFERENCES users(id),
    FOREIGN KEY (tenant_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS monthly_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL,

    bill_month TEXT NOT NULL, -- '2025-01' format

    rent INTEGER NOT NULL,
    management_fee INTEGER NOT NULL,
    total_amount INTEGER NOT NULL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (contract_id, bill_month),
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    tenant_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    paid_at DATETIME NOT NULL,

    type INTEGER DEFAULT 1, -- 1: Monthly Rent, 2: Deposit, 4: Other

    memo TEXT,

    FOREIGN KEY (tenant_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bill_payment_match (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    bill_id INTEGER NOT NULL,
    payment_id INTEGER NOT NULL,
    matched_amount INTEGER NOT NULL,

    FOREIGN KEY (bill_id) REFERENCES monthly_bills(id),
    FOREIGN KEY (payment_id) REFERENCES payments(id),

    UNIQUE (bill_id, payment_id)
);

CREATE TABLE IF NOT EXISTS room_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    event_date DATE NOT NULL,
    memo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS item_advs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER,
    building_id INTEGER,
    name TEXT,
    price INTEGER,
    status TEXT,
    description TEXT,
    is_anonymous INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    related_id INTEGER,
    image_url TEXT,
    is_main INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
