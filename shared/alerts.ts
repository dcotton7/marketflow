import { z } from "zod";

export const ALERT_SOURCE_CLIENTS = [
  "chart",
  "market_flow",
  "watchlist",
  "scanner",
  "alerts_center",
] as const;

export const ALERT_TARGET_TYPES = ["symbol", "theme", "watchlist", "scanner"] as const;
export const ALERT_DELIVERY_CHANNELS = ["in_app", "email", "sms"] as const;
export const ALERT_DELIVERY_MODES = ["individual", "batched"] as const;
export const ALERT_TRIGGER_TIMINGS = ["realtime", "bar_close", "condition_change"] as const;
export const ALERT_GROUP_MATCH_MODES = ["any_symbol"] as const;
export const ALERT_GROUP_OPERATORS = ["AND", "OR", "THEN"] as const;
export const ALERT_INDICATOR_KINDS = ["EMA", "SMA"] as const;
export const ALERT_SEQUENCE_WINDOW_UNITS = ["market_hours", "market_days"] as const;
export const ALERT_ROW_TYPES = [
  "price_reference",
  "price_distance",
  "indicator_cross",
  "indicator_reference",
  "volume_confirmation",
  "trade_plan_reference",
] as const;
export const ALERT_REFERENCE_KINDS = [
  "horizontal_line",
  "daily_vwap",
  "session_vwap",
  "sma",
  "ema",
  "trade_entry",
  "trade_stop",
  "trade_target",
  "constant",
] as const;

export type AlertSourceClient = (typeof ALERT_SOURCE_CLIENTS)[number];
export type AlertTargetType = (typeof ALERT_TARGET_TYPES)[number];
export type AlertDeliveryChannel = (typeof ALERT_DELIVERY_CHANNELS)[number];
export type AlertDeliveryMode = (typeof ALERT_DELIVERY_MODES)[number];
export type AlertTriggerTiming = (typeof ALERT_TRIGGER_TIMINGS)[number];
export type AlertGroupMatchMode = (typeof ALERT_GROUP_MATCH_MODES)[number];
export type AlertGroupOperator = (typeof ALERT_GROUP_OPERATORS)[number];
export type AlertIndicatorKind = (typeof ALERT_INDICATOR_KINDS)[number];
export type AlertSequenceWindowUnit = (typeof ALERT_SEQUENCE_WINDOW_UNITS)[number];
export type AlertRowType = (typeof ALERT_ROW_TYPES)[number];
export type AlertReferenceKind = (typeof ALERT_REFERENCE_KINDS)[number];

export interface AlertTargetScope {
  mode: "single_symbol" | "group";
  targetType: AlertTargetType;
  sourceClient: AlertSourceClient;
  label: string;
  symbol?: string;
  themeId?: string;
  themeName?: string;
  watchlistId?: number;
  watchlistName?: string;
  scannerId?: string;
  scannerName?: string;
  symbols?: string[];
  memberCount?: number;
}

export interface AlertReferenceOperand {
  kind: AlertReferenceKind;
  label?: string;
  value?: number;
  indicatorKind?: AlertIndicatorKind;
  length?: number;
  timeframe?: string;
  lineId?: string;
  tradePlanField?: "entry" | "stop" | "target";
}

export interface AlertIndicatorOperand {
  kind: AlertIndicatorKind;
  length: number;
  timeframe: string;
}

export interface AlertBaseCondition {
  id: string;
  rowType: AlertRowType;
  label?: string;
}

export interface AlertPriceReferenceCondition extends AlertBaseCondition {
  rowType: "price_reference";
  comparator: "crosses_above" | "crosses_below" | "is_above" | "is_below";
  reference: AlertReferenceOperand;
  priceSource?: "lastPrice" | "close";
}

export interface AlertPriceDistanceCondition extends AlertBaseCondition {
  rowType: "price_distance";
  comparator: "within_percent_of" | "outside_percent_of";
  percent: number;
  reference: AlertReferenceOperand;
  priceSource?: "lastPrice" | "close";
}

export interface AlertIndicatorCrossCondition extends AlertBaseCondition {
  rowType: "indicator_cross";
  comparator: "crosses_above" | "crosses_below";
  left: AlertIndicatorOperand;
  right: AlertIndicatorOperand;
}

export interface AlertIndicatorReferenceCondition extends AlertBaseCondition {
  rowType: "indicator_reference";
  comparator: "crosses_above" | "crosses_below" | "is_above" | "is_below";
  indicator: AlertIndicatorOperand;
  reference: AlertReferenceOperand;
}

export interface AlertVolumeConfirmationCondition extends AlertBaseCondition {
  rowType: "volume_confirmation";
  comparator: "is_above";
  multiplier: number;
  timeframe: string;
}

export interface AlertTradePlanReferenceCondition extends AlertBaseCondition {
  rowType: "trade_plan_reference";
  comparator: "crosses_above" | "crosses_below" | "within_percent_of";
  percent?: number;
  tradePlanField: "entry" | "stop" | "target";
  priceSource?: "lastPrice" | "close";
}

export type AlertRuleCondition =
  | AlertPriceReferenceCondition
  | AlertPriceDistanceCondition
  | AlertIndicatorCrossCondition
  | AlertIndicatorReferenceCondition
  | AlertVolumeConfirmationCondition
  | AlertTradePlanReferenceCondition;

export interface AlertRuleGroup {
  nodeType: "group";
  operator: AlertGroupOperator;
  sequenceWindow?: {
    value: number;
    unit: AlertSequenceWindowUnit;
  } | null;
  children: Array<AlertRuleGroup | AlertRuleCondition>;
}

export interface AlertEvaluationConfig {
  triggerTiming: AlertTriggerTiming;
  groupMatchMode: AlertGroupMatchMode;
  cooldownMinutes: number;
}

export interface AlertDeliveryConfig {
  channels: AlertDeliveryChannel[];
  deliveryMode: AlertDeliveryMode;
  soundEnabled: boolean;
  batchWindowMinutes: number;
  emailAddress?: string | null;
  phoneNumber?: string | null;
}

const alertReferenceOperandSchema: z.ZodType<AlertReferenceOperand> = z.object({
  kind: z.enum(ALERT_REFERENCE_KINDS),
  label: z.string().optional(),
  value: z.number().optional(),
  indicatorKind: z.enum(ALERT_INDICATOR_KINDS).optional(),
  length: z.number().int().positive().optional(),
  timeframe: z.string().min(1).optional(),
  lineId: z.string().optional(),
  tradePlanField: z.enum(["entry", "stop", "target"]).optional(),
});

const alertIndicatorOperandSchema: z.ZodType<AlertIndicatorOperand> = z.object({
  kind: z.enum(ALERT_INDICATOR_KINDS),
  length: z.number().int().positive(),
  timeframe: z.string().min(1),
});

export const alertTargetScopeSchema: z.ZodType<AlertTargetScope> = z.object({
  mode: z.enum(["single_symbol", "group"]),
  targetType: z.enum(ALERT_TARGET_TYPES),
  sourceClient: z.enum(ALERT_SOURCE_CLIENTS),
  label: z.string().min(1),
  symbol: z.string().min(1).optional(),
  themeId: z.string().min(1).optional(),
  themeName: z.string().min(1).optional(),
  watchlistId: z.number().int().positive().optional(),
  watchlistName: z.string().min(1).optional(),
  scannerId: z.string().min(1).optional(),
  scannerName: z.string().min(1).optional(),
  symbols: z.array(z.string().min(1)).optional(),
  memberCount: z.number().int().nonnegative().optional(),
});

const alertRuleConditionSchema: z.ZodType<AlertRuleCondition> = z.discriminatedUnion("rowType", [
  z.object({
    id: z.string().min(1),
    rowType: z.literal("price_reference"),
    label: z.string().optional(),
    comparator: z.enum(["crosses_above", "crosses_below", "is_above", "is_below"]),
    reference: alertReferenceOperandSchema,
    priceSource: z.enum(["lastPrice", "close"]).optional(),
  }),
  z.object({
    id: z.string().min(1),
    rowType: z.literal("price_distance"),
    label: z.string().optional(),
    comparator: z.enum(["within_percent_of", "outside_percent_of"]),
    percent: z.number().positive(),
    reference: alertReferenceOperandSchema,
    priceSource: z.enum(["lastPrice", "close"]).optional(),
  }),
  z.object({
    id: z.string().min(1),
    rowType: z.literal("indicator_cross"),
    label: z.string().optional(),
    comparator: z.enum(["crosses_above", "crosses_below"]),
    left: alertIndicatorOperandSchema,
    right: alertIndicatorOperandSchema,
  }),
  z.object({
    id: z.string().min(1),
    rowType: z.literal("indicator_reference"),
    label: z.string().optional(),
    comparator: z.enum(["crosses_above", "crosses_below", "is_above", "is_below"]),
    indicator: alertIndicatorOperandSchema,
    reference: alertReferenceOperandSchema,
  }),
  z.object({
    id: z.string().min(1),
    rowType: z.literal("volume_confirmation"),
    label: z.string().optional(),
    comparator: z.literal("is_above"),
    multiplier: z.number().positive(),
    timeframe: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    rowType: z.literal("trade_plan_reference"),
    label: z.string().optional(),
    comparator: z.enum(["crosses_above", "crosses_below", "within_percent_of"]),
    percent: z.number().positive().optional(),
    tradePlanField: z.enum(["entry", "stop", "target"]),
    priceSource: z.enum(["lastPrice", "close"]).optional(),
  }),
]);

export const alertRuleGroupSchema: z.ZodType<AlertRuleGroup> = z.lazy(() =>
  z.object({
    nodeType: z.literal("group"),
    operator: z.enum(ALERT_GROUP_OPERATORS),
    sequenceWindow: z.object({
      value: z.number().int().positive(),
      unit: z.enum(ALERT_SEQUENCE_WINDOW_UNITS),
    }).nullable().optional(),
    children: z.array(z.union([alertRuleGroupSchema, alertRuleConditionSchema])).min(1),
  })
);

export const alertEvaluationConfigSchema: z.ZodType<AlertEvaluationConfig> = z.object({
  triggerTiming: z.enum(ALERT_TRIGGER_TIMINGS),
  groupMatchMode: z.enum(ALERT_GROUP_MATCH_MODES),
  cooldownMinutes: z.number().int().nonnegative(),
});

export const alertDeliveryConfigSchema: z.ZodType<AlertDeliveryConfig> = z.object({
  channels: z.array(z.enum(ALERT_DELIVERY_CHANNELS)).min(1),
  deliveryMode: z.enum(ALERT_DELIVERY_MODES),
  soundEnabled: z.boolean(),
  batchWindowMinutes: z.number().int().nonnegative(),
  emailAddress: z.string().email().nullable().optional(),
  phoneNumber: z.string().min(7).nullable().optional(),
});

export const createAlertDefinitionSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  sourceClient: z.enum(ALERT_SOURCE_CLIENTS),
  targetScope: alertTargetScopeSchema,
  ruleTree: alertRuleGroupSchema,
  evaluationConfig: alertEvaluationConfigSchema,
  deliveryConfig: alertDeliveryConfigSchema,
  expirationAt: z.string().datetime().optional().nullable(),
  enabled: z.boolean().optional(),
});

export const updateAlertDefinitionSchema = createAlertDefinitionSchema.partial();

export type CreateAlertDefinitionInput = z.infer<typeof createAlertDefinitionSchema>;
export type UpdateAlertDefinitionInput = z.infer<typeof updateAlertDefinitionSchema>;
