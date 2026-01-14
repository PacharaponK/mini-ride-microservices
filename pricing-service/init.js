// Pricing Service Database Initialization
// MongoDB

// Switch to pricing_db database
db = db.getSiblingDB("pricing_db");

// Create pricing_rules collection
db.createCollection("pricing_rules");

// Insert default pricing rule
db.pricing_rules.insertOne({
  rule_id: "default",
  base_fare: 25.0,
  per_km_rate: 7.0,
  min_fare: 35.0,
  currency: "THB",
  active: true,
  created_at: new Date(),
});

// Create price_history collection with TTL index (auto-delete after 30 days)
db.createCollection("price_history");
db.price_history.createIndex(
  { created_at: 1 },
  { expireAfterSeconds: 2592000 }
);

// Create index for faster queries
db.price_history.createIndex({ ride_id: 1 });

print("✅ Pricing database initialized");
