CREATE TABLE "indicator_execution_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"indicator_id" text NOT NULL,
	"indicator_name" text NOT NULL,
	"category" text NOT NULL,
	"avg_execution_time_ms" double precision DEFAULT 10 NOT NULL,
	"avg_pass_rate" double precision DEFAULT 0.5 NOT NULL,
	"total_evaluations" integer DEFAULT 0 NOT NULL,
	"total_passes" integer DEFAULT 0 NOT NULL,
	"universe_stats" jsonb,
	"regime_stats" jsonb,
	"timeframe_stats" jsonb,
	"selectivity_score" double precision DEFAULT 0.5 NOT NULL,
	"recent_execution_times" jsonb,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "indicator_execution_stats_indicator_id_unique" UNIQUE("indicator_id")
);
