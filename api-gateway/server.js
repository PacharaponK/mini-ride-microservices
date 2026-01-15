import express from "express";
import cors from "cors";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({
    service: "api-gateway",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Proxy to Saga Orchestrator (ride booking via SAGA)
app.use(
  "/api/saga",
  createProxyMiddleware({
    target: process.env.SAGA_SERVICE_URL || "http://saga-orchestrator:3004",
    changeOrigin: true,
    pathRewrite: { "^/api/saga": "/saga" },
    onProxyReq: (proxyReq, req, res) => {
      console.log(
        `[Gateway] ${req.method} ${req.originalUrl} -> Saga Orchestrator`
      );
      if (req.body && Object.keys(req.body).length > 0) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader("Content-Type", "application/json");
        proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`[Gateway] Response: ${proxyRes.statusCode}`);
    },
    onError: (err, req, res) => {
      console.error("[Gateway] Proxy error:", err.message);
      res.status(502).json({
        error: "Bad Gateway",
        message: "Unable to connect to Saga Orchestrator",
      });
    },
  })
);

// Proxy to Matching Service (ride queries only)
app.use(
  "/api/rides",
  createProxyMiddleware({
    target: process.env.MATCHING_SERVICE_URL || "http://matching-service:3001",
    changeOrigin: true,
    pathRewrite: { "^/api/rides": "/rides" },
    onProxyReq: (proxyReq, req, res) => {
      console.log(
        `[Gateway] ${req.method} ${req.originalUrl} -> Matching Service`
      );
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`[Gateway] Response: ${proxyRes.statusCode}`);
    },
    onError: (err, req, res) => {
      console.error("[Gateway] Proxy error:", err.message);
      res.status(502).json({
        error: "Bad Gateway",
        message: "Unable to connect to Matching Service",
      });
    },
  })
);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("[Gateway] Error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log(`📡 Proxying /api/* to Matching Service`);
});
