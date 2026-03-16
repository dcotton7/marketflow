import OpenAI from "openai";
import { INDICATOR_LIBRARY } from "./indicators";
import { ExtractedThought, ExtractedIdeaData } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL });
}

function getIndicatorSummary(): string {
  const grouped: Record<string, Array<{ id: string; name: string; description: string }>> = {};
  
  for (const ind of INDICATOR_LIBRARY) {
    if (!grouped[ind.category]) grouped[ind.category] = [];
    grouped[ind.category].push({
      id: ind.id,
      name: ind.name,
      description: ind.description,
    });
  }
  
  let summary = "AVAILABLE INDICATORS BY CATEGORY:\n\n";
  for (const [category, indicators] of Object.entries(grouped)) {
    summary += `## ${category}\n`;
    for (const ind of indicators) {
      summary += `- ID: "${ind.id}" | Name: "${ind.name}" | ${ind.description}\n`;
    }
    summary += "\n";
  }
  
  return summary;
}

export interface ExtractionResult {
  ideas: ExtractedIdeaData[];
  rawResponse: string;
  model: string;
  promptVersion: string;
}

const EXTRACTION_PROMPT_VERSION = "v1.0";

export async function extractIdeasFromText(
  extractedText: string,
  setupName: string,
  sourceDocumentName?: string
): Promise<ExtractionResult> {
  const openai = getOpenAI();
  if (!openai) {
    throw new Error("OpenAI API not configured");
  }

  const indicatorSummary = getIndicatorSummary();

  const systemPrompt = `You are an expert trading system architect. Your task is to analyze trading methodology documents and extract actionable scan definitions (Ideas) that can be run on a stock scanner.

CRITICAL RULES:
1. Each distinct pattern/setup becomes ONE Idea (= one runnable scan)
2. Each Idea contains 1+ Thoughts (groups of indicators that work together)
3. Each Thought contains 1+ Indicators with specific parameters
4. Use ONLY the indicator IDs provided in the indicator library
5. Be specific with parameters - use reasonable defaults based on the methodology

OUTPUT FORMAT (JSON):
{
  "ideas": [
    {
      "name": "Pattern Name",
      "description": "What this pattern identifies",
      "confidence": 85,
      "thoughts": [
        {
          "id": "uuid",
          "name": "Thought Name",
          "description": "What this thought checks",
          "indicators": [
            {
              "id": "indicator_id_from_library",
              "name": "Indicator Display Name",
              "params": { "paramName": value }
            }
          ]
        }
      ]
    }
  ]
}`;

  const userPrompt = `Analyze this trading methodology document for "${setupName}" and extract all distinct patterns as scannable Ideas.

${indicatorSummary}

DOCUMENT CONTENT:
---
${extractedText}
---

Extract each pattern as a separate Idea. For each pattern:
1. Create a descriptive name
2. Write a clear description of what the pattern identifies
3. Break it into Thoughts (logical groupings of conditions)
4. Map each condition to the most appropriate indicator(s) from the library above
5. Set reasonable parameter values based on the methodology description
6. Assign a confidence score (0-100) based on how well you could map the concept

Remember:
- Scan = Idea = 1+ Thoughts
- Each Thought = 1+ Indicators (AND logic within thought)
- Multiple Thoughts = OR logic between them
- ONLY use indicator IDs from the library provided

Return ONLY valid JSON matching the format above.`;

  console.log("[Extraction] Sending document to GPT-4o for analysis...");
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 4096,
    temperature: 0.3,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const rawResponse = response.choices[0]?.message?.content || "";
  console.log("[Extraction] Received response, length:", rawResponse.length);

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = rawResponse;
  const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  let parsed: { ideas: ExtractedIdeaData[] };
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error("[Extraction] Failed to parse JSON:", e);
    throw new Error("Failed to parse AI response as JSON");
  }

  // Validate and clean up the extracted ideas
  const validatedIdeas: ExtractedIdeaData[] = [];
  
  for (const idea of parsed.ideas || []) {
    if (!idea.name || !idea.thoughts || idea.thoughts.length === 0) {
      console.warn("[Extraction] Skipping invalid idea:", idea.name);
      continue;
    }

    // Validate thoughts and indicators
    const validatedThoughts: ExtractedThought[] = [];
    
    for (const thought of idea.thoughts) {
      if (!thought.indicators || thought.indicators.length === 0) continue;

      // Validate indicator IDs exist in library
      const validIndicators = thought.indicators.filter((ind) => {
        const exists = INDICATOR_LIBRARY.some((lib) => lib.id === ind.id);
        if (!exists) {
          console.warn(`[Extraction] Unknown indicator ID: ${ind.id}, skipping`);
        }
        return exists;
      });

      if (validIndicators.length > 0) {
        validatedThoughts.push({
          id: thought.id || uuidv4(),
          name: thought.name || "Unnamed Thought",
          description: thought.description,
          indicators: validIndicators.map((ind) => ({
            id: ind.id,
            name: ind.name || INDICATOR_LIBRARY.find((l) => l.id === ind.id)?.name || ind.id,
            params: ind.params || {},
          })),
        });
      }
    }

    if (validatedThoughts.length > 0) {
      validatedIdeas.push({
        name: idea.name,
        description: idea.description || "",
        thoughts: validatedThoughts,
        sourceDocument: sourceDocumentName,
        confidence: Math.min(100, Math.max(0, idea.confidence || 50)),
      });
    }
  }

  console.log(`[Extraction] Extracted ${validatedIdeas.length} valid Ideas`);

  return {
    ideas: validatedIdeas,
    rawResponse,
    model: "gpt-4o",
    promptVersion: EXTRACTION_PROMPT_VERSION,
  };
}

export async function extractIdeasFromSetup(
  setupId: number,
  extractedTexts: Array<{ documentId: number; documentName: string; text: string }>
): Promise<ExtractionResult> {
  // Combine all document texts
  const combinedText = extractedTexts
    .map((doc) => `=== Document: ${doc.documentName} ===\n${doc.text}`)
    .join("\n\n");

  const setupName = extractedTexts[0]?.documentName || `Setup ${setupId}`;
  
  return extractIdeasFromText(combinedText, setupName);
}

export interface IndicatorMapping {
  indicatorId: string;
  indicatorName: string;
  confidence: number;
  suggestedParams: Record<string, any>;
  reasoning: string;
}

export async function suggestIndicatorMappings(concept: string): Promise<IndicatorMapping[]> {
  const openai = getOpenAI();
  if (!openai) {
    throw new Error("OpenAI API not configured");
  }

  const indicatorSummary = getIndicatorSummary();

  const systemPrompt = `You are an expert at mapping trading concepts to technical indicators.
Given a concept description, suggest the best matching indicators from the library.

Return JSON array:
[
  {
    "indicatorId": "id_from_library",
    "indicatorName": "Name",
    "confidence": 85,
    "suggestedParams": { "paramName": value },
    "reasoning": "Why this indicator matches"
  }
]

Only suggest indicators that genuinely match the concept. Return up to 5 best matches.`;

  const userPrompt = `${indicatorSummary}

CONCEPT TO MAP:
"${concept}"

Return ONLY valid JSON array of matching indicators.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1024,
    temperature: 0.3,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const rawResponse = response.choices[0]?.message?.content || "[]";
  
  let jsonStr = rawResponse;
  const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  let mappings: IndicatorMapping[];
  try {
    mappings = JSON.parse(jsonStr);
  } catch {
    console.error("[Mappings] Failed to parse:", rawResponse);
    return [];
  }

  // Validate indicator IDs
  return mappings.filter((m) => {
    const exists = INDICATOR_LIBRARY.some((lib) => lib.id === m.indicatorId);
    if (!exists) {
      console.warn(`[Mappings] Unknown indicator: ${m.indicatorId}`);
    }
    return exists;
  });
}
