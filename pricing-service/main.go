package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	pb "pricing-service/pricingpb"
)

// =========================================
// MongoDB Database Connection
// =========================================
var mongoClient *mongo.Client
var pricingDB *mongo.Database
var ctx = context.Background()

// PricingRule from MongoDB
type PricingRule struct {
	RuleID    string    `bson:"rule_id" json:"rule_id"`
	BaseFare  float64   `bson:"base_fare" json:"baseFare"`
	PerKmRate float64   `bson:"per_km_rate" json:"perKmRate"`
	MinFare   float64   `bson:"min_fare" json:"minFare"`
	Currency  string    `bson:"currency" json:"currency"`
	Active    bool      `bson:"active" json:"active"`
	CreatedAt time.Time `bson:"created_at" json:"createdAt"`
}

// PriceHistory for MongoDB
type PriceHistory struct {
	ID         string    `bson:"_id" json:"id"`
	RideID     string    `bson:"ride_id" json:"rideId"`
	DistanceKm float64   `bson:"distance_km" json:"distanceKm"`
	Total      float64   `bson:"total" json:"total"`
	BaseFare   float64   `bson:"base_fare" json:"baseFare"`
	CreatedAt  time.Time `bson:"created_at" json:"createdAt"`
}

// Default fallback pricing rule
var defaultRule = PricingRule{
	RuleID:    "default",
	BaseFare:  25.0,
	PerKmRate: 7.0,
	MinFare:   35.0,
	Currency:  "THB",
	Active:    true,
}

func initMongoDB() {
	mongoURL := os.Getenv("MONGO_URL")
	if mongoURL == "" {
		mongoURL = "mongodb://pricing_user:pricing_pass@pricing-db:27017/pricing_db?authSource=admin"
	}

	clientOptions := options.Client().ApplyURI(mongoURL)
	var err error
	mongoClient, err = mongo.Connect(ctx, clientOptions)
	if err != nil {
		log.Printf("❌ MongoDB connection failed: %v", err)
		log.Println("⚠️ Using default pricing rules (in-memory)")
		return
	}

	// Ping to verify connection
	err = mongoClient.Ping(ctx, nil)
	if err != nil {
		log.Printf("❌ MongoDB ping failed: %v", err)
		return
	}

	pricingDB = mongoClient.Database("pricing_db")
	log.Println("✅ MongoDB connected")
}

func getPricingRule() PricingRule {
	if pricingDB == nil {
		return defaultRule
	}

	var rule PricingRule
	err := pricingDB.Collection("pricing_rules").FindOne(ctx, bson.M{"active": true}).Decode(&rule)
	if err != nil {
		log.Printf("⚠️ Could not fetch pricing rule from MongoDB, using default: %v", err)
		return defaultRule
	}
	return rule
}

func savePriceHistory(history PriceHistory) {
	if pricingDB == nil {
		return
	}

	_, err := pricingDB.Collection("price_history").InsertOne(ctx, history)
	if err != nil {
		log.Printf("⚠️ Failed to save price history: %v", err)
	}
}

// =========================================
// Redis Client (Cache)
// =========================================
var redisClient *redis.Client

func initRedis() {
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}

	redisClient = redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: "",
		DB:       0,
	})

	_, err := redisClient.Ping(ctx).Result()
	if err != nil {
		log.Printf("⚠️ Redis connection failed: %v", err)
	} else {
		log.Println("✅ Redis connected")
	}
}

// =========================================
// Price Calculation Logic
// =========================================
func haversineDistance(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadius = 6371.0 // km

	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadius * c
}

func calculatePrice(pickupLat, pickupLng, dropoffLat, dropoffLng float64) (float64, float64, float64, PricingRule) {
	rule := getPricingRule()
	
	distance := haversineDistance(pickupLat, pickupLng, dropoffLat, dropoffLng)
	distanceFee := distance * rule.PerKmRate
	total := rule.BaseFare + distanceFee

	if total < rule.MinFare {
		total = rule.MinFare
	}

	return total, distance, distanceFee, rule
}

// =========================================
// gRPC Server Implementation
// =========================================
type pricingServer struct {
	pb.UnimplementedPricingServiceServer
}

func (s *pricingServer) CalculatePrice(ctx context.Context, req *pb.PriceRequest) (*pb.PriceResponse, error) {
	log.Printf("📡 [gRPC] CalculatePrice request received")

	total, distanceKm, distanceFee, rule := calculatePrice(
		req.PickupLat, req.PickupLng,
		req.DropoffLat, req.DropoffLng,
	)

	// Cache in Redis
	if redisClient != nil {
		cacheKey := fmt.Sprintf("price:%.4f:%.4f:%.4f:%.4f",
			req.PickupLat, req.PickupLng, req.DropoffLat, req.DropoffLng)
		cacheValue, _ := json.Marshal(map[string]float64{"total": total})
		redisClient.Set(ctx, cacheKey, cacheValue, 5*time.Minute)
	}

	// Save to MongoDB
	savePriceHistory(PriceHistory{
		ID:         fmt.Sprintf("price-%d", time.Now().UnixNano()),
		DistanceKm: distanceKm,
		Total:      total,
		BaseFare:   rule.BaseFare,
		CreatedAt:  time.Now(),
	})

	dbSource := "in-memory"
	if pricingDB != nil {
		dbSource = "MongoDB"
	}
	log.Printf("✅ [gRPC] Calculated: %.2f THB (%.2f km) - rule from %s", total, distanceKm, dbSource)

	return &pb.PriceResponse{
		Total:       total,
		BaseFare:    rule.BaseFare,
		DistanceFee: distanceFee,
		DistanceKm:  distanceKm,
		Currency:    rule.Currency,
	}, nil
}

func startGrpcServer() {
	port := os.Getenv("GRPC_PORT")
	if port == "" {
		port = "50051"
	}

	lis, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("Failed to listen on port %s: %v", port, err)
	}

	s := grpc.NewServer()
	pb.RegisterPricingServiceServer(s, &pricingServer{})
	reflection.Register(s)

	log.Printf("📡 gRPC server listening on port %s", port)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("Failed to serve gRPC: %v", err)
	}
}

// =========================================
// HTTP Server (Gin) - Fallback
// =========================================
type CalculateRequest struct {
	PickupLocation  Location `json:"pickupLocation"`
	DropoffLocation Location `json:"dropoffLocation"`
}

type Location struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

func startHttpServer() {
	port := os.Getenv("HTTP_PORT")
	if port == "" {
		port = "3002"
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// Health check
	r.GET("/health", func(c *gin.Context) {
		mongoStatus := "disconnected"
		if pricingDB != nil {
			mongoStatus = "connected"
		}
		redisStatus := "disconnected"
		if redisClient != nil {
			if _, err := redisClient.Ping(ctx).Result(); err == nil {
				redisStatus = "connected"
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"service":   "pricing-service",
			"status":    "healthy",
			"mongodb":   mongoStatus,
			"redis":     redisStatus,
			"grpcPort":  "50051",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	// Calculate price (HTTP fallback)
	r.POST("/calculate", func(c *gin.Context) {
		var req CalculateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		log.Printf("📡 [HTTP] Calculate request received")

		total, distanceKm, distanceFee, rule := calculatePrice(
			req.PickupLocation.Lat, req.PickupLocation.Lng,
			req.DropoffLocation.Lat, req.DropoffLocation.Lng,
		)

		log.Printf("✅ [HTTP] Calculated: %.2f THB (%.2f km)", total, distanceKm)

		c.JSON(http.StatusOK, gin.H{
			"total":    total,
			"currency": rule.Currency,
			"breakdown": gin.H{
				"baseFare":    rule.BaseFare,
				"distanceFee": distanceFee,
				"distanceKm":  distanceKm,
			},
		})
	})

	// Get pricing rules
	r.GET("/rules", func(c *gin.Context) {
		rule := getPricingRule()
		c.JSON(http.StatusOK, rule)
	})

	log.Printf("🌐 HTTP server listening on port %s", port)
	r.Run(":" + port)
}

// =========================================
// Main
// =========================================
func main() {
	log.Println("💰 Starting Pricing Service (Go/Gin + gRPC + MongoDB)")

	// Initialize MongoDB
	initMongoDB()

	// Initialize Redis
	initRedis()

	// Start gRPC server in goroutine
	go startGrpcServer()

	// Start HTTP server (blocking)
	startHttpServer()
}
