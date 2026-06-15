import type { Express, Request, Response } from "express";

import { desc, eq, and } from "drizzle-orm";

import { db } from "../../db";

import {

  chartSetupEnrichRuns,

  chartEnrichFeedback,

  chartEnrichModels,

} from "@shared/schema";

import type {

  ChartEnrichFeedbackInput,

  ChartEnrichModelInput,

  ChartSetupEnrichDossier,

  ChartSetupEnrichResult,

} from "@shared/chart-setup-enrich";

import {

  inferPatternCandidatesFromDossier,

  rankEnrichModelsForDossier,

  type ChartEnrichModelRowLike,

} from "@shared/chart-enrich-model-match";

import { runChartSetupEnrich } from "./engine";

import { resolveTradingDayKey } from "@shared/theme-daily-watchlist";

import { resolveChartSetupBaseMeta, type ResolveBaseMetaInput } from "@shared/chart-setup-base-meta";
import { resolveChartSetupUrMeta } from "@shared/chart-setup-ur-meta";



function uid(req: Request): number | null {

  return (req.session as { userId?: number }).userId ?? null;

}



async function loadSimilarModels(userId: number, dossier: ChartSetupEnrichDossier) {

  if (!db) return { models: [], patternCandidates: [] as string[] };

  try {

    const rows = await db

      .select()

      .from(chartEnrichModels)

      .where(and(eq(chartEnrichModels.userId, userId), eq(chartEnrichModels.applyFlag, true)))

      .orderBy(desc(chartEnrichModels.createdAt))

      .limit(80);



    const candidates = rows.map(

      (r): ChartEnrichModelRowLike => ({

        symbol: r.symbol,

        tier: r.tier,

        note: r.note,

        patternLabel: r.patternLabel,

        lifecycleStage: r.lifecycleStage,

        scopes: r.scopes,

        enrichSnapshot: r.enrichSnapshot as ChartSetupEnrichResult | null,

      })

    );



    const ranked = rankEnrichModelsForDossier(candidates, dossier);

    const patternCandidates = inferPatternCandidatesFromDossier(dossier);



    return {

      patternCandidates,

      models: ranked.map((r) => ({

        symbol: r.symbol,

        tier: r.tier,

        note: r.note,

        result: r.result,

        matchScore: r.score,

        matchReasons: r.matchReasons,

      })),

    };

  } catch {

    return { models: [], patternCandidates: [] as string[] };

  }

}



export function registerChartSetupEnrichRoutes(app: Express, requireAuth: (_: Request, res: Response, next: () => void) => void) {

  app.post("/api/sentinel/chart-setup-enrich", requireAuth, async (req: Request, res: Response) => {

    try {

      const userId = uid(req);

      if (!userId) return res.status(401).json({ error: "Unauthorized" });



      const body = req.body ?? {};

      const dossier = body.dossier as ChartSetupEnrichDossier | undefined;

      if (!dossier?.symbol) {

        return res.status(400).json({ error: "dossier.symbol required" });

      }



      const serverBaseMeta = resolveChartSetupBaseMeta({
        dailyCandles: dossier.dailyBars,
        scanRow: dossier.scanRow as ResolveBaseMetaInput["scanRow"],
      });
      const serverUrMeta = resolveChartSetupUrMeta({
        dailyCandles: dossier.dailyBars,
        scanRow: dossier.scanRow as ResolveBaseMetaInput["scanRow"],
      });
      const enrichedDossier: ChartSetupEnrichDossier = {
        ...dossier,
        baseMeta: dossier.baseMeta?.detected
          ? dossier.baseMeta
          : serverBaseMeta.detected
            ? serverBaseMeta
            : serverBaseMeta,
        urMeta: dossier.urMeta?.detected
          ? dossier.urMeta
          : serverUrMeta.detected
            ? serverUrMeta
            : serverUrMeta,
      };

      const { models: similar, patternCandidates } = await loadSimilarModels(userId, enrichedDossier);

      const result = await runChartSetupEnrich(
        enrichedDossier,
        similar.map(({ symbol, tier, note, result }) => ({ symbol, tier, note, result }))
      );



      let enrichRunId: number | null = null;

      if (db) {

        try {

          const [row] = await db

            .insert(chartSetupEnrichRuns)

            .values({

              userId,

              symbol: dossier.symbol.toUpperCase(),

              tradingDayKey: resolveTradingDayKey(),

              themeId: dossier.themeId ?? null,

              dossier,

              result,

              includeVisual: Boolean(dossier.includeVisual),

              source: result.source,

            })

            .returning({ id: chartSetupEnrichRuns.id });

          enrichRunId = row?.id ?? null;

        } catch (e) {

          console.warn("[ChartSetupEnrich] run persist failed:", e);

        }

      }



      res.json({

        enrichRunId,

        result,

        similarModelsUsed: similar.length,

        patternCandidates,

        similarModels: similar,

      });

    } catch (err) {

      console.error("[ChartSetupEnrich] enrich failed:", err);

      res.status(500).json({ error: "Chart enrich failed" });

    }

  });



  app.post("/api/sentinel/chart-setup-enrich/feedback", requireAuth, async (req: Request, res: Response) => {

    try {

      const userId = uid(req);

      if (!userId) return res.status(401).json({ error: "Unauthorized" });



      const body = req.body as ChartEnrichFeedbackInput;

      if (!body.symbol || !body.helpful) {

        return res.status(400).json({ error: "symbol and helpful required" });

      }



      let feedbackId: number | null = null;

      if (db) {

        try {

          const [row] = await db

            .insert(chartEnrichFeedback)

            .values({

              userId,

              enrichRunId: body.enrichRunId ?? null,

              symbol: body.symbol.toUpperCase(),

              helpful: body.helpful,

              correctionKind: body.correctionKind ?? null,

              correctedLifecycle: body.correctedLifecycle ?? null,

              correctedPattern: body.correctedPattern ?? null,

              note: body.note ?? null,

              enrichSnapshot: body.enrichSnapshot ?? null,

              dossier: body.dossier ?? null,

            })

            .returning({ id: chartEnrichFeedback.id });

          feedbackId = row?.id ?? null;

        } catch (e) {

          console.warn("[ChartSetupEnrich] feedback persist failed:", e);

        }

      }



      res.json({ ok: true, feedbackId });

    } catch (err) {

      console.error("[ChartSetupEnrich] feedback failed:", err);

      res.status(500).json({ error: "Feedback failed" });

    }

  });



  app.post("/api/sentinel/chart-setup-enrich/model", requireAuth, async (req: Request, res: Response) => {

    try {

      const userId = uid(req);

      if (!userId) return res.status(401).json({ error: "Unauthorized" });



      const body = req.body as ChartEnrichModelInput;

      if (!body.symbol || !body.tier || !body.scopes?.length) {

        return res.status(400).json({ error: "symbol, tier, and scopes required" });

      }



      let modelId: number | null = null;

      if (db) {

        try {

          const [row] = await db

            .insert(chartEnrichModels)

            .values({

              userId,

              enrichRunId: body.enrichRunId ?? null,

              feedbackId: body.feedbackId ?? null,

              symbol: body.symbol.toUpperCase(),

              tier: body.tier,

              scopes: body.scopes,

              patternLabel: body.patternLabel ?? null,

              patternCleanliness: body.patternCleanliness ?? null,

              lifecycleStage: body.lifecycleStage ?? null,

              note: body.note ?? null,

              enrichSnapshot: body.enrichSnapshot ?? null,

              dossier: body.dossier ?? null,

              applyFlag: true,

            })

            .returning({ id: chartEnrichModels.id });

          modelId = row?.id ?? null;

        } catch (e) {

          console.warn("[ChartSetupEnrich] model persist failed:", e);

        }

      }



      res.json({ ok: true, modelId });

    } catch (err) {

      console.error("[ChartSetupEnrich] model save failed:", err);

      res.status(500).json({ error: "Model save failed" });

    }

  });

}


