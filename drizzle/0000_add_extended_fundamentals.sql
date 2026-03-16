CREATE TABLE "chart_drawings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"timeframe" text NOT NULL,
	"tool_type" text NOT NULL,
	"points" jsonb NOT NULL,
	"styling" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "formation_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"master_setup_id" integer NOT NULL,
	"stage_name" text NOT NULL,
	"stage_order" integer NOT NULL,
	"stage_type" text DEFAULT 'sequential' NOT NULL,
	"is_terminal" boolean DEFAULT false,
	"score_modifier" integer DEFAULT 0,
	"typical_duration_min" text,
	"typical_duration_max" text,
	"too_long_threshold" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "fundamentals_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"sector" text NOT NULL,
	"industry" text NOT NULL,
	"market_cap" double precision,
	"company_name" text,
	"exchange" text,
	"pe" double precision,
	"beta" double precision,
	"debt_to_equity" double precision,
	"pre_tax_margin" double precision,
	"analyst_consensus" text,
	"target_price" double precision,
	"next_earnings_date" text,
	"next_earnings_days" integer,
	"eps_current_q_yoy" text,
	"sales_growth_3q_yoy" text,
	"last_eps_surprise" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fundamentals_cache_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "indicator_learning_summary" (
	"indicator_id" text PRIMARY KEY NOT NULL,
	"indicator_name" text NOT NULL,
	"total_accepted" integer DEFAULT 0 NOT NULL,
	"total_discarded" integer DEFAULT 0 NOT NULL,
	"param_stats" jsonb,
	"avg_retention_rate" double precision,
	"avg_result_delta" double precision,
	"regime_performance" jsonb,
	"universe_performance" jsonb,
	"archetype_performance" jsonb,
	"avoid_params" jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "master_setups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_stages" jsonb DEFAULT '[]'::jsonb,
	"invalidation_rules" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pattern_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rule_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"match_date" text NOT NULL,
	"rating" integer NOT NULL,
	"feedback" text,
	"chart_conditions" jsonb DEFAULT '{}'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pattern_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"pattern_type" text NOT NULL,
	"timeframe" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"formula" text,
	"required_technicals" jsonb DEFAULT '{"indicators":[],"overlays":[],"volumeRequired":true}'::jsonb,
	"formula_params" jsonb DEFAULT '{}'::jsonb,
	"version" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rated_examples" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"setup_variant_id" integer,
	"ticker" text NOT NULL,
	"match_date" text NOT NULL,
	"human_rating" integer NOT NULL,
	"ai_score" integer,
	"formation_stage_id" integer,
	"criteria_scores" jsonb DEFAULT '{}'::jsonb,
	"feedback" text,
	"chart_snapshot" text,
	"market_phase" text,
	"sector_performance" text,
	"stock_stage" integer,
	"prior_attempt_count" integer DEFAULT 0,
	"chart_context" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rating_criteria" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"max_points" integer DEFAULT 4 NOT NULL,
	"is_universal" boolean DEFAULT true,
	"master_setup_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rating_weights" (
	"id" serial PRIMARY KEY NOT NULL,
	"setup_variant_id" integer NOT NULL,
	"criteria_id" integer NOT NULL,
	"default_weight" double precision DEFAULT 1,
	"weight" double precision DEFAULT 1,
	"user_id" integer,
	"is_default" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "saved_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scan_chart_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"idea_id" integer,
	"session_id" integer,
	"symbol" text NOT NULL,
	"rating" text NOT NULL,
	"scan_config" jsonb,
	"indicator_snapshot" jsonb,
	"price" double precision,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scan_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"idea_id" integer,
	"scan_config" jsonb NOT NULL,
	"result_count" integer NOT NULL,
	"result_symbols" text[],
	"funnel_data" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scan_tuning_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"idea_id" integer,
	"session_id" integer,
	"scan_config" jsonb NOT NULL,
	"config_before" jsonb,
	"funnel_data" jsonb NOT NULL,
	"ai_suggestions" jsonb NOT NULL,
	"accepted_suggestions" jsonb,
	"skipped_suggestions" jsonb,
	"config_after" jsonb,
	"result_count_before" integer NOT NULL,
	"result_count_after" integer,
	"retained_up_symbols" text[],
	"dropped_up_symbols" text[],
	"dropped_down_symbols" text[],
	"retained_down_symbols" text[],
	"new_symbols" text[],
	"thoughts_involved" text[],
	"outcome" text,
	"ratings_count" integer,
	"admin_approved" boolean,
	"user_feedback" text,
	"user_feedback_note" text,
	"market_regime" jsonb,
	"universe" text,
	"archetype_tags" text[],
	"tuning_directions" jsonb,
	"acceptance_ratio" double precision,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scanner_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"idea_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"added_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scanner_ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"universe" text DEFAULT 'sp500' NOT NULL,
	"nodes" jsonb NOT NULL,
	"edges" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scanner_thoughts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"ai_prompt" text,
	"criteria" jsonb NOT NULL,
	"timeframe" text DEFAULT 'daily' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_account_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"broker_id" text NOT NULL,
	"account_name" text NOT NULL,
	"account_number" text,
	"allows_short_sales" boolean DEFAULT false NOT NULL,
	"default_direction" text DEFAULT 'LONG',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"score" integer NOT NULL,
	"reasoning" text NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb,
	"recommendation" text NOT NULL,
	"is_deep_eval" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"description" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"broker_id" text NOT NULL,
	"account_settings_id" integer,
	"file_name" text NOT NULL,
	"import_name" text,
	"file_type" text DEFAULT 'CSV' NOT NULL,
	"total_trades_found" integer DEFAULT 0,
	"total_trades_imported" integer DEFAULT 0,
	"orphan_sells_count" integer DEFAULT 0,
	"duplicates_count" integer DEFAULT 0,
	"skipped_rows" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'PROCESSING' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "sentinel_import_batches_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "sentinel_imported_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"batch_id" text NOT NULL,
	"broker_id" text NOT NULL,
	"broker_order_id" text,
	"ticker" text NOT NULL,
	"asset_type" text DEFAULT 'STOCK' NOT NULL,
	"direction" text NOT NULL,
	"quantity" double precision NOT NULL,
	"price" double precision NOT NULL,
	"total_amount" double precision NOT NULL,
	"commission" double precision DEFAULT 0,
	"fees" double precision DEFAULT 0,
	"net_amount" double precision NOT NULL,
	"trade_date" text NOT NULL,
	"settlement_date" text,
	"execution_time" text,
	"timestamp_source" text DEFAULT 'UNKNOWN',
	"is_time_estimated" boolean DEFAULT true,
	"account_id" text,
	"account_name" text,
	"account_type" text DEFAULT 'TAXABLE',
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"is_fill" boolean DEFAULT false,
	"fill_group_key" text,
	"is_orphan_sell" boolean DEFAULT false,
	"orphan_status" text,
	"manual_cost_basis" double precision,
	"manual_open_date" text,
	"is_synthetic_date" boolean DEFAULT false,
	"is_duplicate" boolean DEFAULT false,
	"duplicate_status" text,
	"duplicate_of_trade_id" integer,
	"duplicate_of_import_id" integer,
	"promoted_to_card_id" integer,
	"promoted_at" timestamp,
	"raw_source" text,
	"imported_at" timestamp DEFAULT now(),
	CONSTRAINT "sentinel_imported_trades_trade_id_unique" UNIQUE("trade_id")
);
--> statement-breakpoint
CREATE TABLE "sentinel_order_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"level_type" text NOT NULL,
	"price" double precision NOT NULL,
	"quantity" double precision,
	"source" text DEFAULT 'manual',
	"status" text DEFAULT 'open',
	"order_number" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_rule_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rule_code" text NOT NULL,
	"custom_name" text,
	"custom_description" text,
	"custom_severity" text,
	"is_disabled" boolean DEFAULT false,
	"custom_formula" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_rule_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_code" text NOT NULL,
	"rule_name" text NOT NULL,
	"category" text,
	"total_trades" integer DEFAULT 0,
	"followed_count" integer DEFAULT 0,
	"not_followed_count" integer DEFAULT 0,
	"win_rate_when_followed" double precision,
	"win_rate_when_not_followed" double precision,
	"avg_pnl_when_followed" double precision,
	"avg_pnl_when_not_followed" double precision,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_rule_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"severity" text DEFAULT 'warning',
	"is_auto_reject" boolean DEFAULT false,
	"rule_code" text,
	"formula" text,
	"source" text NOT NULL,
	"confidence_score" double precision NOT NULL,
	"supporting_data" jsonb,
	"status" text DEFAULT 'pending',
	"adoption_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sentinel_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"is_active" boolean DEFAULT true,
	"order" integer DEFAULT 0,
	"source" text DEFAULT 'user',
	"severity" text DEFAULT 'warning',
	"is_auto_reject" boolean DEFAULT false,
	"rule_code" text,
	"formula" text,
	"parent_rule_id" integer,
	"confidence_score" double precision,
	"adoption_count" integer DEFAULT 0,
	"rule_type" text DEFAULT 'swing',
	"direction_tags" text[],
	"strategy_tags" text[],
	"is_global" boolean DEFAULT false,
	"is_deleted" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"overlay_color" text DEFAULT '#1e3a5f',
	"overlay_transparency" integer DEFAULT 75,
	"background_color" text DEFAULT '#0f172a',
	"logo_transparency" integer DEFAULT 6,
	"secondary_overlay_color" text DEFAULT '#e8e8e8',
	"text_color_title" text DEFAULT '#ffffff',
	"text_color_header" text DEFAULT '#ffffff',
	"text_color_section" text DEFAULT '#ffffff',
	"text_color_normal" text DEFAULT '#ffffff',
	"text_color_small" text DEFAULT '#a1a1aa',
	"text_color_tiny" text DEFAULT '#71717a',
	"font_size_title" text DEFAULT '1.5rem',
	"font_size_header" text DEFAULT '1.125rem',
	"font_size_section" text DEFAULT '1rem',
	"font_size_normal" text DEFAULT '0.875rem',
	"font_size_small" text DEFAULT '0.8125rem',
	"font_size_tiny" text DEFAULT '0.75rem',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sentinel_system_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "sentinel_trade_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6366f1',
	"description" text,
	"is_admin_only" boolean DEFAULT false,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "sentinel_trade_labels_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sentinel_trade_to_labels" (
	"trade_id" integer NOT NULL,
	"label_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"entry_price" double precision NOT NULL,
	"entry_date" timestamp,
	"stop_price" double precision,
	"partial_price" double precision,
	"target_price" double precision,
	"target_profit_price" double precision,
	"target_profit_level" text,
	"position_size" double precision,
	"thesis" text,
	"setup_type" text,
	"status" text DEFAULT 'considering' NOT NULL,
	"exit_price" double precision,
	"exit_date" timestamp,
	"actual_pnl" double precision,
	"outcome" text,
	"rules_followed" jsonb,
	"notes" text,
	"lot_entries" jsonb,
	"source" text DEFAULT 'hand',
	"import_batch_id" text,
	"hold_days" integer,
	"is_tagged" boolean DEFAULT false,
	"tagged_at" timestamp,
	"ai_suggested_setup" text,
	"ai_setup_confidence" double precision,
	"account_name" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sentinel_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"account_size" double precision DEFAULT 1000000,
	"is_admin" boolean DEFAULT false,
	"tier" text DEFAULT 'standard' NOT NULL,
	"community_opt_in" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "sentinel_users_username_unique" UNIQUE("username"),
	CONSTRAINT "sentinel_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sentinel_watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"target_entry" double precision,
	"stop_plan" double precision,
	"target_plan" double precision,
	"alert_price" double precision,
	"thesis" text,
	"priority" text DEFAULT 'medium',
	"status" text DEFAULT 'watching',
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_confidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rule_id" integer NOT NULL,
	"patterns_rated" integer DEFAULT 0,
	"avg_rating" double precision DEFAULT 0,
	"rating_1_count" integer DEFAULT 0,
	"rating_2_count" integer DEFAULT 0,
	"rating_3_count" integer DEFAULT 0,
	"rating_4_count" integer DEFAULT 0,
	"trades_taken" integer DEFAULT 0,
	"trades_won" integer DEFAULT 0,
	"win_rate" double precision DEFAULT 0,
	"avg_return" double precision DEFAULT 0,
	"confidence_level" text DEFAULT 'untested',
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "setup_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"master_setup_id" integer NOT NULL,
	"name" text NOT NULL,
	"timeframe" text NOT NULL,
	"duration_min" text,
	"duration_max" text,
	"chart_period" text,
	"required_criteria_ids" integer[],
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stock_data_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "thought_score_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"score_value" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "thought_score_rules_rule_key_unique" UNIQUE("rule_key")
);
--> statement-breakpoint
CREATE TABLE "thought_selection_weights" (
	"id" serial PRIMARY KEY NOT NULL,
	"strategy_key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"weight_percent" integer NOT NULL,
	"config_n" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "thought_selection_weights_strategy_key_unique" UNIQUE("strategy_key")
);
--> statement-breakpoint
CREATE TABLE "tnn_factors" (
	"id" serial PRIMARY KEY NOT NULL,
	"factor_type" text NOT NULL,
	"factor_key" text NOT NULL,
	"factor_name" text NOT NULL,
	"description" text,
	"category" text,
	"base_weight" integer DEFAULT 50 NOT NULL,
	"ai_adjusted_weight" integer DEFAULT 50,
	"auto_adjust" boolean DEFAULT false,
	"max_magnitude" integer,
	"max_drift" integer,
	"sample_size" integer DEFAULT 0,
	"last_ai_update" timestamp,
	"order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "tnn_factors_factor_key_unique" UNIQUE("factor_key")
);
--> statement-breakpoint
CREATE TABLE "tnn_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"change_type" text NOT NULL,
	"factor_key" text,
	"factor_name" text,
	"old_value" text,
	"new_value" text,
	"changed_by" text NOT NULL,
	"reason" text,
	"suggestion_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tnn_modifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"factor_key" text NOT NULL,
	"factor_name" text NOT NULL,
	"when_condition" text NOT NULL,
	"when_condition_name" text NOT NULL,
	"weight_modifier" integer NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"confidence" double precision,
	"sample_size" integer DEFAULT 0,
	"win_rate_impact" double precision,
	"is_active" boolean DEFAULT true,
	"created_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tnn_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"setting_key" text NOT NULL,
	"setting_value" text NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "tnn_settings_setting_key_unique" UNIQUE("setting_key")
);
--> statement-breakpoint
CREATE TABLE "tnn_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"suggestion_type" text NOT NULL,
	"factor_key" text NOT NULL,
	"factor_name" text NOT NULL,
	"when_condition" text,
	"when_condition_name" text,
	"current_value" integer NOT NULL,
	"proposed_value" integer NOT NULL,
	"confidence_score" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"supporting_data" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_chart_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"default_bars_on_screen" integer DEFAULT 200 NOT NULL,
	"data_limit_daily" integer DEFAULT 750 NOT NULL,
	"data_limit_5min" integer DEFAULT 63 NOT NULL,
	"data_limit_15min" integer DEFAULT 126 NOT NULL,
	"data_limit_30min" integer DEFAULT 126 NOT NULL,
	CONSTRAINT "user_chart_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_ma_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"row_id" text NOT NULL,
	"title" text NOT NULL,
	"ma_type" text NOT NULL,
	"period" integer,
	"color" text DEFAULT '#ffffff' NOT NULL,
	"line_type" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"daily_on" boolean DEFAULT true NOT NULL,
	"five_min_on" boolean DEFAULT true NOT NULL,
	"fifteen_min_on" boolean DEFAULT true NOT NULL,
	"thirty_min_on" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"calc_on" text DEFAULT 'daily' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"added_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "formation_stages" ADD CONSTRAINT "formation_stages_master_setup_id_master_setups_id_fk" FOREIGN KEY ("master_setup_id") REFERENCES "public"."master_setups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rated_examples" ADD CONSTRAINT "rated_examples_setup_variant_id_setup_variants_id_fk" FOREIGN KEY ("setup_variant_id") REFERENCES "public"."setup_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rated_examples" ADD CONSTRAINT "rated_examples_formation_stage_id_formation_stages_id_fk" FOREIGN KEY ("formation_stage_id") REFERENCES "public"."formation_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_criteria" ADD CONSTRAINT "rating_criteria_master_setup_id_master_setups_id_fk" FOREIGN KEY ("master_setup_id") REFERENCES "public"."master_setups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_weights" ADD CONSTRAINT "rating_weights_setup_variant_id_setup_variants_id_fk" FOREIGN KEY ("setup_variant_id") REFERENCES "public"."setup_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_weights" ADD CONSTRAINT "rating_weights_criteria_id_rating_criteria_id_fk" FOREIGN KEY ("criteria_id") REFERENCES "public"."rating_criteria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_variants" ADD CONSTRAINT "setup_variants_master_setup_id_master_setups_id_fk" FOREIGN KEY ("master_setup_id") REFERENCES "public"."master_setups"("id") ON DELETE no action ON UPDATE no action;