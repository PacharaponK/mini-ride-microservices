FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod ./
RUN go mod download

# Copy source
COPY . .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o pricing-service .

# Final stage
FROM alpine:latest

WORKDIR /app

COPY --from=builder /app/pricing-service .

EXPOSE 3002 50051

CMD ["./pricing-service"]
