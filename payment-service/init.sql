-- Payment Service Database Schema
-- PostgreSQL

-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
    rider_id VARCHAR(50) PRIMARY KEY,
    balance DECIMAL(10, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'THB',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(50) PRIMARY KEY,
    ride_id VARCHAR(50) NOT NULL,
    rider_id VARCHAR(50) REFERENCES wallets(rider_id),
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'THB',
    status VARCHAR(20) DEFAULT 'pending',
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transaction history for audit
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    wallet_id VARCHAR(50) REFERENCES wallets(rider_id),
    payment_id VARCHAR(50) REFERENCES payments(id),
    type VARCHAR(20) NOT NULL, -- 'debit' or 'credit'
    amount DECIMAL(10, 2) NOT NULL,
    balance_before DECIMAL(10, 2) NOT NULL,
    balance_after DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample wallets with initial balance
INSERT INTO wallets (rider_id, balance, currency) VALUES
    ('rider-001', 1000.00, 'THB'),
    ('rider-002', 500.00, 'THB'),
    ('rider-003', 2000.00, 'THB')
ON CONFLICT (rider_id) DO NOTHING;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_payments_ride_id ON payments(ride_id);
CREATE INDEX IF NOT EXISTS idx_payments_rider_id ON payments(rider_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON transactions(wallet_id);
