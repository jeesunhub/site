-- PostgreSQL Schema for Tenant and Landlord Management System

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
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

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS noti (
    id SERIAL PRIMARY KEY,
    author_id INTEGER,
    title TEXT,
    content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    type TEXT,
    confirmed INTEGER DEFAULT 0,
    FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS buildings (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address1 TEXT,
    address2 TEXT,
    memo TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS building_addresses (
    id SERIAL PRIMARY KEY,
    building_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    FOREIGN KEY (building_id) REFERENCES buildings(id)
);

CREATE TABLE IF NOT EXISTS landlord_buildings (
    id SERIAL PRIMARY KEY,
    landlord_id INTEGER NOT NULL,
    building_id INTEGER NOT NULL,
    FOREIGN KEY (landlord_id) REFERENCES users(id),
    FOREIGN KEY (building_id) REFERENCES buildings(id)
);

CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
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
    id SERIAL PRIMARY KEY,
    landlord_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,

    start_date DATE NOT NULL,
    end_date DATE,

    FOREIGN KEY (landlord_id) REFERENCES users(id),
    FOREIGN KEY (tenant_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS contracts (
    id SERIAL PRIMARY KEY,

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

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (landlord_id) REFERENCES users(id),
    FOREIGN KEY (tenant_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS monthly_bills (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL,

    bill_month TEXT NOT NULL, -- '2025-01' format

    rent INTEGER NOT NULL,
    management_fee INTEGER NOT NULL,
    total_amount INTEGER NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (contract_id, bill_month),
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,

    tenant_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    paid_at TIMESTAMP NOT NULL,

    type INTEGER DEFAULT 1, -- 1: Monthly Rent, 2: Deposit, 4: Other

    memo TEXT,

    FOREIGN KEY (tenant_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bill_payment_match (
    id SERIAL PRIMARY KEY,

    bill_id INTEGER NOT NULL,
    payment_id INTEGER NOT NULL,
    matched_amount INTEGER NOT NULL,

    FOREIGN KEY (bill_id) REFERENCES monthly_bills(id),
    FOREIGN KEY (payment_id) REFERENCES payments(id),

    UNIQUE (bill_id, payment_id)
);

CREATE TABLE IF NOT EXISTS room_events (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL,
    event_date DATE NOT NULL,
    memo TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS room_advs (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL,
    title TEXT,
    description TEXT,
    deposit INTEGER,
    rent INTEGER,
    management_fee INTEGER,
    cleaning_fee INTEGER,
    available_date TEXT,
    status INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS item_advs (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER,
    building_id INTEGER,
    name TEXT,
    price INTEGER,
    status TEXT,
    description TEXT,
    is_anonymous INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS images (
    id SERIAL PRIMARY KEY,
    related_id INTEGER,
    image_url TEXT,
    is_main INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
