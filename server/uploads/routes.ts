import { Express, Request, Response } from "express";
import { db, isDatabaseAvailable } from "../db";
import { uploads, setupUploads } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { extractTextFromFile } from "./processor";

// Configure multer for file uploads
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "text/plain",
      "text/markdown",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

export function registerUploadRoutes(app: Express) {
  // Upload a file
  app.post("/api/uploads", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      // Create upload record
      const [uploadRecord] = await db.insert(uploads).values({
        filename: file.originalname,
        storagePath: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        processingStatus: "pending",
        createdBy: userId,
      }).returning();

      // Start background processing
      processUploadAsync(uploadRecord.id, file.path, file.mimetype);

      res.status(201).json(uploadRecord);
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });

  // Get all uploads for current user
  app.get("/api/uploads", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const userUploads = await db.select()
        .from(uploads)
        .where(eq(uploads.createdBy, userId))
        .orderBy(desc(uploads.createdAt));

      res.json(userUploads);
    } catch (error) {
      console.error("Error fetching uploads:", error);
      res.status(500).json({ error: "Failed to fetch uploads" });
    }
  });

  // Get single upload by ID
  app.get("/api/uploads/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid upload ID" });
      }

      const [uploadRecord] = await db.select()
        .from(uploads)
        .where(eq(uploads.id, id));

      if (!uploadRecord) {
        return res.status(404).json({ error: "Upload not found" });
      }

      res.json(uploadRecord);
    } catch (error) {
      console.error("Error fetching upload:", error);
      res.status(500).json({ error: "Failed to fetch upload" });
    }
  });

  // Download/serve uploaded file
  app.get("/api/uploads/:id/file", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid upload ID" });
      }

      const [uploadRecord] = await db.select()
        .from(uploads)
        .where(eq(uploads.id, id));

      if (!uploadRecord) {
        return res.status(404).json({ error: "Upload not found" });
      }

      const filePath = path.join(UPLOAD_DIR, uploadRecord.storagePath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found on disk" });
      }

      res.setHeader("Content-Type", uploadRecord.mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${uploadRecord.filename}"`);
      res.sendFile(filePath);
    } catch (error) {
      console.error("Error serving file:", error);
      res.status(500).json({ error: "Failed to serve file" });
    }
  });

  // Delete upload
  app.delete("/api/uploads/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid upload ID" });
      }

      const [uploadRecord] = await db.select()
        .from(uploads)
        .where(eq(uploads.id, id));

      if (!uploadRecord) {
        return res.status(404).json({ error: "Upload not found" });
      }

      // Delete file from disk
      const filePath = path.join(UPLOAD_DIR, uploadRecord.storagePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete from database
      await db.delete(uploads).where(eq(uploads.id, id));

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting upload:", error);
      res.status(500).json({ error: "Failed to delete upload" });
    }
  });

  // Link upload to setup
  app.post("/api/uploads/:id/link-setup", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const uploadId = parseInt(req.params.id);
      const { setupId, purpose } = req.body;

      if (isNaN(uploadId) || !setupId) {
        return res.status(400).json({ error: "uploadId and setupId required" });
      }

      const [link] = await db.insert(setupUploads).values({
        setupId,
        uploadId,
        purpose: purpose || "reference",
      }).returning();

      res.status(201).json(link);
    } catch (error) {
      console.error("Error linking upload to setup:", error);
      res.status(500).json({ error: "Failed to link upload" });
    }
  });

  // Re-process an upload (extract text again)
  app.post("/api/uploads/:id/reprocess", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid upload ID" });
      }

      const [uploadRecord] = await db.select()
        .from(uploads)
        .where(eq(uploads.id, id));

      if (!uploadRecord) {
        return res.status(404).json({ error: "Upload not found" });
      }

      const filePath = path.join(UPLOAD_DIR, uploadRecord.storagePath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found on disk" });
      }

      // Start background processing
      processUploadAsync(uploadRecord.id, filePath, uploadRecord.mimeType);

      res.json({ success: true, message: "Re-processing started" });
    } catch (error) {
      console.error("Error re-processing upload:", error);
      res.status(500).json({ error: "Failed to re-process upload" });
    }
  });

  // Get uploads for a setup
  app.get("/api/setups/:setupId/uploads", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!isDatabaseAvailable() || !db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const setupId = parseInt(req.params.setupId);
      if (isNaN(setupId)) {
        return res.status(400).json({ error: "Invalid setup ID" });
      }

      const links = await db.select()
        .from(setupUploads)
        .where(eq(setupUploads.setupId, setupId));

      // Fetch full upload records
      const uploadIds = links.map(l => l.uploadId);
      if (uploadIds.length === 0) {
        return res.json([]);
      }

      const uploadRecords = await Promise.all(
        uploadIds.map(async (id) => {
          const [record] = await db.select().from(uploads).where(eq(uploads.id, id));
          if (!record) return null;
          const link = links.find(l => l.uploadId === id);
          return { ...record, purpose: link?.purpose };
        })
      );

      res.json(uploadRecords.filter((r): r is NonNullable<typeof r> => r !== null));
    } catch (error) {
      console.error("Error fetching setup uploads:", error);
      res.status(500).json({ error: "Failed to fetch uploads" });
    }
  });

  console.log("[Uploads] Routes registered");
}

// Background processing function
async function processUploadAsync(uploadId: number, filePath: string, mimeType: string) {
  if (!isDatabaseAvailable() || !db) return;

  try {
    // Update status to processing
    await db.update(uploads)
      .set({ processingStatus: "processing" })
      .where(eq(uploads.id, uploadId));

    // Extract text based on file type
    const extractedText = await extractTextFromFile(filePath, mimeType);

    // Update with results
    await db.update(uploads)
      .set({
        processingStatus: "completed",
        extractedText,
      })
      .where(eq(uploads.id, uploadId));

    console.log(`[Uploads] Processed upload ${uploadId} successfully`);
  } catch (error) {
    console.error(`[Uploads] Error processing upload ${uploadId}:`, error);
    await db.update(uploads)
      .set({
        processingStatus: "failed",
        processingError: error instanceof Error ? error.message : "Unknown error",
      })
      .where(eq(uploads.id, uploadId));
  }
}
