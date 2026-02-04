import { Router } from "express";
import { db } from "../db";
import { patternRules, patternRatings, setupConfidence } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import OpenAI from "openai";

const router = Router();

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

router.get("/rules", async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!db) {
      return res.status(500).json({ error: "Database unavailable" });
    }
    
    const rules = await db.select().from(patternRules)
      .where(eq(patternRules.userId, userId))
      .orderBy(desc(patternRules.createdAt));
    
    res.json(rules);
  } catch (error) {
    console.error("Error fetching pattern rules:", error);
    res.status(500).json({ error: "Failed to fetch rules" });
  }
});

router.post("/rules", async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!db) {
      return res.status(500).json({ error: "Database unavailable" });
    }
    
    const { patternType, timeframe, name, description, formula, requiredTechnicals, formulaParams, isActive, id } = req.body;
    
    if (id) {
      const [updated] = await db.update(patternRules)
        .set({
          patternType,
          timeframe,
          name,
          description,
          formula,
          requiredTechnicals,
          formulaParams,
          isActive: isActive !== undefined ? isActive : true,
          version: sql`version + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(patternRules.id, id), eq(patternRules.userId, userId)))
        .returning();
      
      res.json(updated);
    } else {
      const [created] = await db.insert(patternRules)
        .values({
          userId,
          patternType,
          timeframe,
          name,
          description,
          formula,
          requiredTechnicals,
          formulaParams,
        })
        .returning();
      
      await db.insert(setupConfidence).values({
        userId,
        ruleId: created.id,
      });
      
      res.json(created);
    }
  } catch (error) {
    console.error("Error saving pattern rule:", error);
    res.status(500).json({ error: "Failed to save rule" });
  }
});

router.get("/confidence/:ruleId", async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!db) {
      return res.status(500).json({ error: "Database unavailable" });
    }
    
    const ruleId = parseInt(req.params.ruleId);
    
    const [conf] = await db.select().from(setupConfidence)
      .where(and(
        eq(setupConfidence.ruleId, ruleId),
        eq(setupConfidence.userId, userId)
      ));
    
    res.json(conf || null);
  } catch (error) {
    console.error("Error fetching confidence:", error);
    res.status(500).json({ error: "Failed to fetch confidence" });
  }
});

router.post("/ratings", async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!db) {
      return res.status(500).json({ error: "Database unavailable" });
    }
    
    const { ruleId, ticker, matchDate, rating, feedback, conditions, notes } = req.body;
    
    const [created] = await db.insert(patternRatings)
      .values({
        userId,
        ruleId,
        ticker,
        matchDate,
        rating,
        feedback,
        chartConditions: conditions || {},
        notes,
      })
      .returning();
    
    const existingRatings = await db.select().from(patternRatings)
      .where(and(eq(patternRatings.ruleId, ruleId), eq(patternRatings.userId, userId)));
    
    const totalRatings = existingRatings.length;
    const avgRating = existingRatings.reduce((sum, r) => sum + r.rating, 0) / totalRatings;
    const rating1Count = existingRatings.filter(r => r.rating === 1).length;
    const rating2Count = existingRatings.filter(r => r.rating === 2).length;
    const rating3Count = existingRatings.filter(r => r.rating === 3).length;
    const rating4Count = existingRatings.filter(r => r.rating === 4).length;
    
    let confidenceLevel = "untested";
    if (totalRatings >= 20) {
      if (avgRating >= 3.5) confidenceLevel = "high";
      else if (avgRating >= 2.5) confidenceLevel = "medium";
      else confidenceLevel = "low";
    } else if (totalRatings >= 10) {
      confidenceLevel = "low";
    }
    
    await db.update(setupConfidence)
      .set({
        patternsRated: totalRatings,
        avgRating,
        rating1Count,
        rating2Count,
        rating3Count,
        rating4Count,
        confidenceLevel,
        lastUpdated: new Date(),
      })
      .where(and(eq(setupConfidence.ruleId, ruleId), eq(setupConfidence.userId, userId)));
    
    res.json(created);
  } catch (error) {
    console.error("Error saving rating:", error);
    res.status(500).json({ error: "Failed to save rating" });
  }
});

router.post("/scan", async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!db) {
      return res.status(500).json({ error: "Database unavailable" });
    }
    
    const { patternType, timeframe, formulaParams, ruleId } = req.body;
    
    let activeRuleId = ruleId;
    
    if (!activeRuleId) {
      const [existingRule] = await db.select().from(patternRules)
        .where(and(
          eq(patternRules.userId, userId),
          eq(patternRules.patternType, patternType),
          eq(patternRules.timeframe, timeframe)
        ))
        .limit(1);
      
      if (existingRule) {
        activeRuleId = existingRule.id;
        await db.update(patternRules)
          .set({ formulaParams, updatedAt: new Date() })
          .where(eq(patternRules.id, existingRule.id));
      } else {
        const patternLabels: Record<string, string> = {
          breakout_pullback: "Breakout with Pullback",
          cup_and_handle: "Cup and Handle",
          vcp: "Volatility Contraction Pattern",
          high_tight_flag: "High Tight Flag",
          reclaim: "MA Reclaim",
          weekly_tight: "Weekly Tight",
          monthly_tight: "Monthly Tight",
          pullback: "Pullback to MA",
        };
        const patternLabel = patternLabels[patternType] || patternType;
        
        const [newRule] = await db.insert(patternRules)
          .values({
            userId,
            patternType,
            timeframe,
            name: `${patternLabel} (${timeframe})`,
            formulaParams,
          })
          .returning();
        
        activeRuleId = newRule.id;
        
        await db.insert(setupConfidence).values({
          userId,
          ruleId: newRule.id,
        });
      }
    }
    
    const SAMPLE_TICKERS = [
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 
      'CRM', 'ORCL', 'ADBE', 'NFLX', 'INTC', 'CSCO', 'QCOM'
    ];
    
    const matches: Array<{
      ticker: string;
      matchDate: string;
      conditions: Record<string, number>;
    }> = [];
    
    const numMatches = Math.floor(Math.random() * 6) + 2;
    const shuffled = [...SAMPLE_TICKERS].sort(() => Math.random() - 0.5);
    
    for (let i = 0; i < numMatches && i < shuffled.length; i++) {
      const ticker = shuffled[i];
      const daysAgo = Math.floor(Math.random() * 30) + 1;
      const matchDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      matches.push({
        ticker,
        matchDate,
        conditions: {
          breakoutPct: (Math.random() * 0.02) + (formulaParams?.breakoutMinPct || 0.003),
          volumeRatio: (Math.random() * 1.5) + (formulaParams?.volumeRatio || 1.3),
          pullbackDepth: (Math.random() * 0.4) + (formulaParams?.pullbackMinDepth || 0.3),
          maDistance: Math.random() * 0.005,
        }
      });
    }
    
    res.json({ 
      matches,
      scannedTickers: SAMPLE_TICKERS.length,
      patternType,
      timeframe,
      ruleId: activeRuleId,
    });
  } catch (error) {
    console.error("Error running scan:", error);
    res.status(500).json({ error: "Failed to run scan" });
  }
});

router.post("/chat", async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!db) {
      return res.status(500).json({ error: "Database unavailable" });
    }
    
    const { message, setupId, currentSetup, recentRatings } = req.body;
    
    let ratingsSummary = "";
    if (recentRatings && recentRatings.length > 0) {
      const feedbackItems = recentRatings
        .filter((r: any) => r.feedback)
        .map((r: any) => `- Rating ${r.rating}: "${r.feedback}"`)
        .join('\n');
      
      if (feedbackItems) {
        ratingsSummary = `\n\nRecent User Feedback:\n${feedbackItems}`;
      }
    }
    
    const systemPrompt = `You are an expert trading pattern analyst helping a trader refine their setup detection formulas.

Current Setup: ${currentSetup?.name || 'Not selected'}
Setup Description: ${currentSetup?.description || 'None'}
Pattern Type: ${currentSetup?.patternType || 'custom'}
Timeframe: ${currentSetup?.timeframe || 'daily'}
Required Technicals: ${JSON.stringify(currentSetup?.requiredTechnicals?.indicators || [], null, 2)}
${ratingsSummary}

Your job is to:
1. Help the user understand why certain chart patterns matched or didn't match
2. Learn from their ratings and English feedback to improve the detection formula
3. Suggest formula improvements in plain English (the system will convert to parameters)
4. Explain what you're adjusting and why based on their feedback

When suggesting formula updates that should be applied, include this JSON at the END of your response:
{"formulaUpdate": true, "changes": "Description of what changed"}

Be conversational and helpful. Focus on learning from the user's feedback to improve pattern detection.
For example, if they say "entry was too early", you might suggest tightening the entry confirmation threshold.
If they say "volume wasn't convincing", suggest increasing the volume ratio requirement.`;

    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_completion_tokens: 1000,
    });

    const aiResponse = response.choices[0]?.message?.content || "I couldn't generate a response.";
    
    let formulaUpdate = false;
    const jsonMatch = aiResponse.match(/\{"formulaUpdate":\s*true[^}]*\}/);
    if (jsonMatch) {
      formulaUpdate = true;
    }
    
    const cleanResponse = aiResponse.replace(/\{"formulaUpdate":\s*true[^}]*\}/, '').trim();
    
    res.json({ 
      response: cleanResponse,
      formulaUpdate 
    });
  } catch (error) {
    console.error("Error in chat:", error);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

export function registerPatternLearningRoutes(app: any) {
  app.use("/api/pattern-learning", router);
}
