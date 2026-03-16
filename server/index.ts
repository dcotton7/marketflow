import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

// Keep server from exiting on unhandled errors (common with polling/DB/WS)
process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
  console.error("Promise:", promise);
  // Don't exit - log and continue so server stays up
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  // Give time to flush logs, then exit (process may be in bad state)
  setTimeout(() => process.exit(1), 1000);
});

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: '50mb' }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    console.log("Starting application initialization...");
    
    // Initialize database FIRST
    console.log("Attempting database connection...");
    const { initializeDatabase } = await import("./db");
    await initializeDatabase();
    
    // Initialize theme members cache (needs DB)
    console.log("Initializing theme members cache from database...");
    const { initializeThemeMembersCache } = await import("./market-condition/utils/theme-db-loader");
    await initializeThemeMembersCache();
    console.log("Theme members cache initialized");
    
    // Initialize acceleration baseline (needs DB)
    console.log("Initializing acceleration baseline from snapshots...");
    const { initializePreviousValuesFromSnapshots } = await import("./market-condition/engine/theme-score");
    await initializePreviousValuesFromSnapshots();
    console.log("Acceleration baseline initialized");

    // Preload constituent lists from local CSVs (fast, no network after first refresh)
    console.log("Preloading universe constituents...");
    const { getConstituents } = await import("./universe/constituents");
    await getConstituents("russell3000");
    await getConstituents("sp500");
    await getConstituents("russell2000");
    console.log("Universe constituents preloaded");
    
    // NOW register routes (which starts polling)
    await registerRoutes(httpServer, app);
    console.log("Routes registered successfully");

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error("Internal Server Error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({ message });
    });

    if (process.env.NODE_ENV === "production") {
      console.log("Setting up static file serving for production...");
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    const port = parseInt(process.env.PORT || "5000", 10);
    const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
    console.log(`Starting HTTP server on ${host}:${port}...`);
    httpServer.listen(port, host, () => {
      log(`serving on port ${port}`);
    });
  } catch (error) {
    console.error("Fatal error during application startup:", error);
    process.exit(1);
  }
})();