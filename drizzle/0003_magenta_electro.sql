CREATE TABLE "ivy_eval_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"current_price_at_eval" double precision,
	"selected_entry" double precision,
	"selected_stop" double precision,
	"selected_target" double precision,
	"recommended_entry" double precision,
	"recommended_stop" double precision,
	"recommended_target" double precision,
	"evaluation_text" text NOT NULL,
	"risk_assessment" text,
	"user_rating" text,
	"rated_at" timestamp,
	"technical_snapshot" jsonb,
	"watchlist_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ivy_eval_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier_free_limit" integer DEFAULT 5,
	"tier_free_trial_days" integer DEFAULT 7,
	"tier_premium_limit" integer DEFAULT 30,
	"tier_pro_limit" integer DEFAULT 100,
	"tier_pro_can_buy_more" boolean DEFAULT true,
	"extra_eval_price" double precision DEFAULT 0.5,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ivy_eval_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"month_year" text NOT NULL,
	"evals_used" integer DEFAULT 0,
	"extra_evals_purchased" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "optimizer_display_settings" ALTER COLUMN "overlay_position" SET DEFAULT 'bottom-center';--> statement-breakpoint
ALTER TABLE "sentinel_users" ALTER COLUMN "account_size" SET DEFAULT 100000;--> statement-breakpoint
ALTER TABLE "sentinel_users" ALTER COLUMN "tier" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "sentinel_users" ADD COLUMN "max_account_risk_percent" double precision DEFAULT 2;--> statement-breakpoint
ALTER TABLE "sentinel_users" ADD COLUMN "avg_position_size" double precision;--> statement-breakpoint
ALTER TABLE "sentinel_users" ADD COLUMN "risk_profile_completed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "sentinel_users" ADD COLUMN "risk_profile_skipped_at" timestamp;--> statement-breakpoint
ALTER TABLE "sentinel_watchlist" ADD COLUMN "direction" text DEFAULT 'long';--> statement-breakpoint
ALTER TABLE "sentinel_watchlist" ADD COLUMN "ivy_eval_id" integer;--> statement-breakpoint
ALTER TABLE "sentinel_watchlist" ADD COLUMN "ivy_eval_text" text;--> statement-breakpoint
ALTER TABLE "sentinel_watchlist" ADD COLUMN "ivy_recommended_entry" double precision;--> statement-breakpoint
ALTER TABLE "sentinel_watchlist" ADD COLUMN "ivy_recommended_stop" double precision;--> statement-breakpoint
ALTER TABLE "sentinel_watchlist" ADD COLUMN "ivy_recommended_target" double precision;--> statement-breakpoint
ALTER TABLE "sentinel_watchlist" ADD COLUMN "ivy_risk_assessment" text;