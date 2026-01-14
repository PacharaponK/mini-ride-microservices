-- Matching Service Database Schema
-- PostgreSQL

-- Drivers table
CREATE TABLE IF NOT EXISTS drivers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    vehicle VARCHAR(100) NOT NULL,
    plate VARCHAR(20) NOT NULL,
    available BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rides table
CREATE TABLE IF NOT EXISTS rides (
    id VARCHAR(50) PRIMARY KEY,
    rider_id VARCHAR(50) NOT NULL,
    driver_id VARCHAR(50) REFERENCES drivers(id),
    pickup_lat DECIMAL(10, 8) NOT NULL,
    pickup_lng DECIMAL(11, 8) NOT NULL,
    dropoff_lat DECIMAL(10, 8) NOT NULL,
    dropoff_lng DECIMAL(11, 8) NOT NULL,
    price_total DECIMAL(10, 2),
    price_currency VARCHAR(10) DEFAULT 'THB',
    payment_id VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample drivers
INSERT INTO drivers (id, name, vehicle, plate, available) VALUES
    ('driver-001', 'สมชาย', 'Toyota Camry', 'กข-1234', true),
    ('driver-002', 'สมหญิง', 'Honda Civic', 'คง-5678', true),
    ('driver-003', 'สมศักดิ์', 'Mazda 3', 'จฉ-9012', true)
ON CONFLICT (id) DO NOTHING;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_rides_rider_id ON rides(rider_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_drivers_available ON drivers(available);
