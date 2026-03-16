import fs from "fs";
import path from "path";
import OpenAI from "openai";

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL });
}

/**
 * Extract text content from uploaded files
 * Supports: PDF (text + image-based via GPT-4o Vision), images, text files
 */
export async function extractTextFromFile(filePath: string, mimeType: string): Promise<string | null> {
  try {
    if (mimeType === "application/pdf") {
      return await extractTextFromPDF(filePath);
    }
    
    if (mimeType.startsWith("image/")) {
      return await extractTextFromImage(filePath, mimeType);
    }
    
    if (mimeType === "text/plain" || mimeType === "text/markdown") {
      return fs.readFileSync(filePath, "utf-8");
    }
    
    return null;
  } catch (error) {
    console.error("[Processor] Error extracting text:", error);
    throw error;
  }
}

/**
 * Extract text from PDF files using GPT-4o Vision
 */
async function extractTextFromPDF(filePath: string): Promise<string | null> {
  try {
    console.log("[Processor] Starting PDF extraction with GPT-4o Vision for:", filePath);
    return await extractTextFromPDFWithVision(filePath, 10);
  } catch (error: any) {
    console.error("[Processor] PDF extraction error:", error?.message || error);
    return "[PDF extraction failed - " + (error?.message || "unknown error") + "]";
  }
}

/**
 * Extract text from image-based PDF using GPT-4o Vision
 */
async function extractTextFromPDFWithVision(filePath: string, pageCount: number): Promise<string> {
  const openai = getOpenAI();
  if (!openai) {
    return `[IMAGE-BASED PDF - ${pageCount} pages. OpenAI API not configured for vision extraction.]`;
  }
  
  try {
    // Convert PDF pages to images using pdfjs-dist
    const images = await convertPDFToImages(filePath, pageCount);
    
    if (images.length === 0) {
      return `[IMAGE-BASED PDF - ${pageCount} pages. Failed to convert to images.]`;
    }
    
    console.log("[Processor] Converted PDF to", images.length, "images, sending to GPT-4o Vision...");
    
    // Build message content with all page images
    const imageContent: OpenAI.ChatCompletionContentPart[] = images.map((base64, idx) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:image/png;base64,${base64}`,
        detail: "high" as const,
      },
    }));
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: "You are an expert at reading and transcribing trading education documents. You can see text overlaid on charts, annotations, bullet points, and any written content. Extract EVERYTHING you can read.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `These are ${images.length} pages from a trading methodology PDF document. Please carefully examine each image and extract ALL readable text content including:

1. Page titles and headings
2. Body text and paragraphs  
3. Bullet points and numbered lists
4. Text annotations on charts (labels, arrows, notes)
5. Captions and descriptions
6. Any trading rules, entry/exit criteria, or setup descriptions
7. Indicator names and settings mentioned

Look very carefully at each image - there should be substantial text content describing trading setups and methodology. Transcribe everything you can read, organizing it by page.`,
            },
            ...imageContent,
          ],
        },
      ],
    });
    
    const extractedText = response.choices[0]?.message?.content || "";
    console.log("[Processor] GPT-4o Vision extracted", extractedText.length, "characters");
    
    if (!extractedText || extractedText.length < 50) {
      return `[IMAGE-BASED PDF - ${pageCount} pages. Vision extraction returned minimal content.]`;
    }
    
    return extractedText;
    
  } catch (error: any) {
    console.error("[Processor] Vision extraction error:", error?.message || error);
    return `[IMAGE-BASED PDF - ${pageCount} pages. Vision extraction failed: ${error?.message || "unknown error"}]`;
  }
}

/**
 * Convert PDF to array of base64-encoded PNG images using mupdf
 */
async function convertPDFToImages(filePath: string, maxPages: number = 10): Promise<string[]> {
  try {
    const mupdf = await import("mupdf");
    
    console.log("[Processor] Converting PDF to images with mupdf...");
    
    const pdfData = fs.readFileSync(filePath);
    const doc = mupdf.Document.openDocument(pdfData, "application/pdf");
    
    const pageCount = doc.countPages();
    const pagesToProcess = Math.min(pageCount, maxPages);
    
    console.log("[Processor] PDF has", pageCount, "pages, processing", pagesToProcess);
    
    const images: string[] = [];
    
    for (let i = 0; i < pagesToProcess; i++) {
      const page = doc.loadPage(i);
      
      // Render at 2x scale for better quality
      const scale = 2.0;
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false, // no alpha
        true   // with annotations
      );
      
      const pngData = pixmap.asPNG();
      const base64 = Buffer.from(pngData).toString("base64");
      images.push(base64);
      
      console.log("[Processor] Page", i + 1, "converted, size:", Math.round(base64.length / 1024), "KB");
    }
    
    console.log("[Processor] Converted", images.length, "pages to images");
    return images;
    
  } catch (error: any) {
    console.error("[Processor] PDF to image conversion error:", error?.message || error);
    return [];
  }
}

/**
 * Extract text from image files using GPT-4o Vision
 */
async function extractTextFromImage(filePath: string, mimeType: string): Promise<string> {
  const openai = getOpenAI();
  if (!openai) {
    const stats = fs.statSync(filePath);
    return JSON.stringify({
      type: "image",
      mimeType,
      sizeBytes: stats.size,
      note: "OpenAI API not configured for vision extraction",
    });
  }
  
  try {
    console.log("[Processor] Extracting text from image using GPT-4o Vision...");
    
    const imageBuffer = fs.readFileSync(filePath);
    const base64 = imageBuffer.toString("base64");
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract ALL text content from this image. This appears to be trading-related content.

Please extract:
- All visible text, headings, and labels
- Chart annotations
- Any rules, criteria, or setup descriptions
- Key terminology

Format as clean, readable text.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    });
    
    const extractedText = response.choices[0]?.message?.content || "";
    console.log("[Processor] Vision extracted", extractedText.length, "characters from image");
    
    return extractedText || "[Image - no text extracted]";
    
  } catch (error: any) {
    console.error("[Processor] Image vision error:", error?.message || error);
    return `[Image extraction failed: ${error?.message || "unknown error"}]`;
  }
}

/**
 * Get file info without full processing
 */
export function getFileInfo(filePath: string): { exists: boolean; size: number } {
  try {
    const stats = fs.statSync(filePath);
    return { exists: true, size: stats.size };
  } catch {
    return { exists: false, size: 0 };
  }
}
