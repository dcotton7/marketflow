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

/** Default lowered from 50mb to reduce heap spikes on small Render instances; override with JSON_BODY_LIMIT. */
const jsonBodyLimit = process.env.JSON_BODY_LIMIT?.trim() || "10mb";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: jsonBodyLimit,
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: jsonBodyLimit }));

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

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  try {
    const bootStart = Date.now();
    const logMem = (label: string) => {
      const mem = process.memoryUsage();
      const elapsed = ((Date.now() - bootStart) / 1000).toFixed(1);
      console.log(`[Boot +${elapsed}s] ${label} — Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB, RSS: ${Math.round(mem.rss / 1024 / 1024)}MB`);
    };
    console.log("Starting application initialization...");
    logMem("init");
    
    // Initialize database FIRST
    console.log("Attempting database connection...");
    const { initializeDatabase } = await import("./db");
    await initializeDatabase();
    logMem("DB connected");
    
    // Strip persisted delisted symbols from in-memory universe before theme cache
    console.log("Initializing delisted ticker registry...");
    const { initializeDelistedTickerRegistry } = await import("./market-condition/utils/delisted-ticker-registry");
    await initializeDelistedTickerRegistry();

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
    
    logMem("pre-routes");
    // NOW register routes (which starts MC polling)
    await registerRoutes(httpServer, app);
    console.log("Routes registered successfully");
    logMem("routes registered (MC polling started)");

    // Start periodic memory logging (every 60s during market hours)
    const { startMemoryLogging } = await import("./infra/memory-gate");
    startMemoryLogging(60_000);

    // Defer alert poller 15s — it's lightweight but depends on MC snapshot prices
    setTimeout(async () => {
      try {
        const { startAlertPollingWorker } = await import("./alerts/poller");
        startAlertPollingWorker();
        console.log("[Startup Stagger] Alert poller started (t+15s)");
      } catch (err) {
        console.error("[Startup Stagger] Alert poller init failed:", err);
      }
    }, 15_000);

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
    const isProd = process.env.NODE_ENV === "production";
    /** Dev: omit host so Node uses default binding (avoids localhost→::1 vs 127.0.0.1-only "Failed to fetch"). Override with LISTEN_HOST. */
    const listenHost = process.env.LISTEN_HOST?.trim();
    const onListen = () => {
      log(`serving on port ${port}${listenHost ? ` (host=${listenHost})` : isProd ? " (host=0.0.0.0)" : " (default bind)"}`);
    };
    console.log(`Starting HTTP server on port ${port}...`);
    if (listenHost) {
      httpServer.listen(port, listenHost, onListen);
    } else if (isProd) {
      httpServer.listen(port, "0.0.0.0", onListen);
    } else {
      httpServer.listen(port, onListen);
    }
  } catch (error) {
    console.error("Fatal error during application startup:", error);
    process.exit(1);
  }
})();