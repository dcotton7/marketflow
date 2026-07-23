import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed assets: long-cache. Missing files must 404 (not SPA HTML) so stale
  // clients fail cleanly after a deploy instead of "Failed to fetch dynamically imported module".
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      fallthrough: false,
      maxAge: "1y",
      immutable: true,
    }),
  );

  // index.html must revalidate so clients pick up new chunk hashes after deploy
  app.get(["/", "/index.html"], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });

  app.use(
    express.static(distPath, {
      index: false,
      setHeaders(res, filePath) {
        if (path.basename(filePath) === "index.html") {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    }),
  );

  // SPA fallback for client routes only — never for /api or /assets
  app.use("/{*path}", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/assets")) {
      return next();
    }
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
