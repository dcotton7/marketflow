import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALERT_DELIVERY_MODES,
  ALERT_GROUP_OPERATORS,
  ALERT_REFERENCE_KINDS,
  ALERT_ROW_TYPES,
  ALERT_SEQUENCE_WINDOW_UNITS,
  type AlertDeliveryMode,
  type AlertGroupOperator,
  type AlertIndicatorKind,
  type AlertReferenceOperand,
  type AlertRuleCondition,
  type AlertRowType,
  type AlertSequenceWindowUnit,
  type AlertTargetScope,
  type CreateAlertDefinitionInput,
} from "@shared/alerts";
import { Bell, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useCreateAlert, usePreviewAlert } from "@/hooks/use-alerts";
import { useSystemSettings } from "@/context/SystemSettingsContext";

interface AlertBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetScope: AlertTargetScope;
  suggestedName?: string;
  tradePlanPreview?: {
    mode?: "single" | "per_symbol";
    entry?: number | null;
    stop?: number | null;
    target?: number | null;
  } | null;
}

type ExpirationPreset = "none" | "eod" | "1w";
const DEFAULT_ALERT_EMAIL = "donaldecotton@gmail.com";
const DEFAULT_ALERT_SMS_NUMBER = "+17727663194";
interface AlertBuilderDraft {
  name: string;
  description: string;
  rows: AlertRuleCondition[];
  operator: AlertGroupOperator;
  sequenceWindowValue: number;
  sequenceWindowUnit: AlertSequenceWindowUnit;
  triggerTiming: "realtime" | "bar_close" | "condition_change";
  deliveryMode: AlertDeliveryMode;
  sendEmail: boolean;
  sendSms: boolean;
  emailAddress: string;
  phoneNumber: string;
  soundEnabled: boolean;
  cooldownMinutes: number;
  expirationPreset: ExpirationPreset;
  preset: string;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `alert-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultReference(kind: AlertReferenceOperand["kind"] = "daily_vwap"): AlertReferenceOperand {
  switch (kind) {
    case "sma":
      return { kind, indicatorKind: "SMA", length: 50, timeframe: "1D" };
    case "ema":
      return { kind, indicatorKind: "EMA", length: 21, timeframe: "5m" };
    case "constant":
    case "horizontal_line":
      return { kind, value: 0 };
    case "trade_entry":
      return { kind, tradePlanField: "entry" };
    case "trade_stop":
      return { kind, tradePlanField: "stop" };
    case "trade_target":
      return { kind, tradePlanField: "target" };
    default:
      return { kind };
  }
}

function createDefaultCondition(rowType: AlertRowType, id: string = makeId()): AlertRuleCondition {
  switch (rowType) {
    case "price_distance":
      return {
        id,
        rowType,
        comparator: "within_percent_of",
        percent: 1.2,
        reference: defaultReference("sma"),
        priceSource: "lastPrice",
      };
    case "indicator_cross":
      return {
        id,
        rowType,
        comparator: "crosses_above",
        left: { kind: "EMA", length: 6, timeframe: "5m" },
        right: { kind: "EMA", length: 20, timeframe: "5m" },
      };
    case "indicator_reference":
      return {
        id,
        rowType,
        comparator: "crosses_above",
        indicator: { kind: "EMA", length: 6, timeframe: "5m" },
        reference: defaultReference("daily_vwap"),
      };
    case "volume_confirmation":
      return {
        id,
        rowType,
        comparator: "is_above",
        multiplier: 1.5,
        timeframe: "5m",
      };
    case "trade_plan_reference":
      return {
        id,
        rowType,
        comparator: "within_percent_of",
        percent: 0.5,
        tradePlanField: "entry",
        priceSource: "lastPrice",
      };
    case "price_reference":
    default:
      return {
        id,
        rowType: "price_reference",
        comparator: "crosses_above",
        reference: defaultReference("daily_vwap"),
        priceSource: "lastPrice",
      };
  }
}

function summarizeReference(reference: AlertReferenceOperand): string {
  switch (reference.kind) {
    case "daily_vwap":
      return "daily VWAP";
    case "session_vwap":
      return "session VWAP";
    case "sma":
    case "ema":
      return `${reference.indicatorKind ?? reference.kind.toUpperCase()} ${reference.length ?? ""} ${reference.timeframe ?? ""}`.trim();
    case "trade_entry":
      return "trade entry";
    case "trade_stop":
      return "trade stop";
    case "trade_target":
      return "trade target";
    case "constant":
    case "horizontal_line":
      return reference.value != null ? `${reference.value}` : reference.kind.replace("_", " ");
  }

  const fallbackKind: string = reference.kind;
  return fallbackKind.replace("_", " ");
}

function summarizeCondition(condition: AlertRuleCondition): string {
  switch (condition.rowType) {
    case "price_reference":
      return `price ${condition.comparator.replaceAll("_", " ")} ${summarizeReference(condition.reference)}`;
    case "price_distance":
      return `price ${condition.comparator === "within_percent_of" ? "within" : "outside"} ${condition.percent}% of ${summarizeReference(condition.reference)}`;
    case "indicator_cross":
      return `${condition.left.kind} ${condition.left.length} ${condition.comparator.replaceAll("_", " ")} ${condition.right.kind} ${condition.right.length} on ${condition.left.timeframe}`;
    case "indicator_reference":
      return `${condition.indicator.kind} ${condition.indicator.length} ${condition.comparator.replaceAll("_", " ")} ${summarizeReference(condition.reference)}`;
    case "volume_confirmation":
      return `volume above ${condition.multiplier}x average on ${condition.timeframe}`;
    case "trade_plan_reference":
      return condition.comparator === "within_percent_of"
        ? `price within ${condition.percent ?? 0}% of ${condition.tradePlanField}`
        : `price ${condition.comparator.replaceAll("_", " ")} ${condition.tradePlanField}`;
  }
}

function getRowTypeLabel(rowType: AlertRowType): string {
  switch (rowType) {
    case "price_reference":
      return "Current Price";
    case "price_distance":
      return "Current Price Distance";
    case "indicator_cross":
      return "Indicator Cross";
    case "indicator_reference":
      return "Indicator vs Level";
    case "volume_confirmation":
      return "Volume Confirmation";
    case "trade_plan_reference":
      return "Trade Plan Price";
    default:
      return String(rowType).replaceAll("_", " ");
  }
}

function formatPrice(value: number | null | undefined): string | null {
  return value != null && Number.isFinite(value) ? `$${value.toFixed(2)}` : null;
}

function applyPreset(
  preset: string,
  setName: (value: string) => void,
  setRows: (rows: AlertRuleCondition[]) => void,
  setOperator: (value: AlertGroupOperator) => void
) {
  if (preset === "blank") {
    setRows([createDefaultCondition("price_reference")]);
    setOperator("AND");
    return;
  }

  if (preset === "ready_names") {
    setName("Ready names EMA + VWAP");
    setRows([
      createDefaultCondition("indicator_cross"),
      createDefaultCondition("price_reference"),
    ]);
    setOperator("AND");
    return;
  }

  if (preset === "sma_proximity") {
    setName("Near daily SMA");
    setRows([createDefaultCondition("price_distance")]);
    setOperator("AND");
  }
}

export function AlertBuilderDialog({
  open,
  onOpenChange,
  targetScope,
  suggestedName,
  tradePlanPreview,
}: AlertBuilderDialogProps) {
  const { cssVariables } = useSystemSettings();
  const createAlert = useCreateAlert();
  const previewAlert = usePreviewAlert();
  const wasOpenRef = useRef(false);
  const [name, setName] = useState(suggestedName ?? "");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<AlertRuleCondition[]>([createDefaultCondition("price_reference")]);
  const [operator, setOperator] = useState<AlertGroupOperator>("AND");
  const [sequenceWindowValue, setSequenceWindowValue] = useState(10);
  const [sequenceWindowUnit, setSequenceWindowUnit] = useState<AlertSequenceWindowUnit>("market_hours");
  const [triggerTiming, setTriggerTiming] = useState<"realtime" | "bar_close" | "condition_change">("realtime");
  const [deliveryMode, setDeliveryMode] = useState<AlertDeliveryMode>("individual");
  const [sendEmail, setSendEmail] = useState(false);
  const [sendSms, setSendSms] = useState(false);
  const [emailAddress, setEmailAddress] = useState(DEFAULT_ALERT_EMAIL);
  const [phoneNumber, setPhoneNumber] = useState(DEFAULT_ALERT_SMS_NUMBER);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [cooldownMinutes, setCooldownMinutes] = useState(15);
  const [expirationPreset, setExpirationPreset] = useState<ExpirationPreset>("eod");
  const [preset, setPreset] = useState("blank");
  const draftStorageKey = useMemo(
    () =>
      `alert-builder-draft:${targetScope.sourceClient}:${targetScope.mode}:${targetScope.label}:${targetScope.symbol ?? ""}`,
    [targetScope.label, targetScope.mode, targetScope.sourceClient, targetScope.symbol]
  );

  const clearDraftStorage = () => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(draftStorageKey);
  };

  useEffect(() => {
    const isOpening = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!isOpening) return;
    if (typeof window !== "undefined") {
      const savedDraft = window.sessionStorage.getItem(draftStorageKey);
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft) as AlertBuilderDraft;
          setName(draft.name);
          setDescription(draft.description);
          setRows(draft.rows);
          setOperator(draft.operator);
          setSequenceWindowValue(draft.sequenceWindowValue);
          setSequenceWindowUnit(draft.sequenceWindowUnit);
          setTriggerTiming(draft.triggerTiming);
          setDeliveryMode(draft.deliveryMode);
          setSendEmail(draft.sendEmail);
          setSendSms(draft.sendSms);
          setEmailAddress(draft.emailAddress);
          setPhoneNumber(draft.phoneNumber);
          setSoundEnabled(draft.soundEnabled);
          setCooldownMinutes(draft.cooldownMinutes);
          setExpirationPreset(draft.expirationPreset);
          setPreset(draft.preset);
          return;
        } catch {
          window.sessionStorage.removeItem(draftStorageKey);
        }
      }
    }
    setName(
      suggestedName ??
        (targetScope.mode === "group"
          ? `Alert on ${targetScope.label}`
          : `Alert on ${targetScope.symbol ?? targetScope.label}`)
    );
    setDescription("");
    setRows([createDefaultCondition("price_reference")]);
    setOperator("AND");
    setSequenceWindowValue(10);
    setSequenceWindowUnit("market_hours");
    setTriggerTiming("realtime");
    setDeliveryMode("individual");
    setSendEmail(false);
    setSendSms(false);
    setEmailAddress(DEFAULT_ALERT_EMAIL);
    setPhoneNumber(DEFAULT_ALERT_SMS_NUMBER);
    setSoundEnabled(true);
    setCooldownMinutes(15);
    setExpirationPreset("eod");
    setPreset("blank");
  }, [draftStorageKey, open, suggestedName, targetScope.label, targetScope.mode, targetScope.sourceClient, targetScope.symbol]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const draft: AlertBuilderDraft = {
      name,
      description,
      rows,
      operator,
      sequenceWindowValue,
      sequenceWindowUnit,
      triggerTiming,
      deliveryMode,
      sendEmail,
      sendSms,
      emailAddress,
      phoneNumber,
      soundEnabled,
      cooldownMinutes,
      expirationPreset,
      preset,
    };
    window.sessionStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [
    cooldownMinutes,
    deliveryMode,
    description,
    draftStorageKey,
    emailAddress,
    expirationPreset,
    name,
    open,
    operator,
    phoneNumber,
    preset,
    rows,
    sendEmail,
    sendSms,
    sequenceWindowUnit,
    sequenceWindowValue,
    soundEnabled,
    triggerTiming,
  ]);

  const summary = useMemo(() => {
    const prefix =
      targetScope.mode === "group"
        ? `Any symbol in ${targetScope.label}`
        : `${targetScope.symbol ?? targetScope.label}`;
    const joiner = operator === "THEN"
      ? ` THEN within ${sequenceWindowValue} ${sequenceWindowUnit === "market_days" ? `market day${sequenceWindowValue === 1 ? "" : "s"}` : `market hour${sequenceWindowValue === 1 ? "" : "s"}`} `
      : ` ${operator} `;
    const body = rows.map(summarizeCondition).join(joiner);
    return `${prefix}: ${body}`;
  }, [operator, rows, sequenceWindowUnit, sequenceWindowValue, targetScope]);

  const addRow = () => setRows((prev) => [...prev, createDefaultCondition("price_reference")]);
  const removeRow = (id: string) => setRows((prev) => prev.filter((row) => row.id !== id));

  const updateRow = (id: string, updater: (row: AlertRuleCondition) => AlertRuleCondition) => {
    setRows((prev) => prev.map((row) => (row.id === id ? updater(row) : row)));
  };

  const updateReference = (id: string, getReference: (row: AlertRuleCondition) => AlertReferenceOperand | null, next: AlertReferenceOperand) => {
    updateRow(id, (row) => {
      if (row.rowType === "price_reference") return { ...row, reference: next };
      if (row.rowType === "price_distance") return { ...row, reference: next };
      if (row.rowType === "indicator_reference") return { ...row, reference: next };
      return row;
    });
  };

  const buildExpirationAt = (): string | null => {
    const now = new Date();
    if (expirationPreset === "none") return null;
    if (expirationPreset === "1w") {
      const next = new Date(now);
      next.setDate(next.getDate() + 7);
      return next.toISOString();
    }

    const eod = new Date(now);
    eod.setHours(23, 59, 59, 999);
    return eod.toISOString();
  };

  const buildDescription = (appendSummary: boolean): string | null => {
    const trimmedDescription = description.trim();
    if (!appendSummary) {
      return trimmedDescription || null;
    }

    return trimmedDescription ? `${trimmedDescription}<BR>${summary}` : summary;
  };

  const buildPayload = (appendSummaryToDescription: boolean): CreateAlertDefinitionInput => ({
      name: name.trim(),
      description: buildDescription(appendSummaryToDescription),
      sourceClient: targetScope.sourceClient,
      targetScope,
      ruleTree: {
        nodeType: "group",
        operator,
        sequenceWindow: operator === "THEN"
          ? { value: Math.max(1, sequenceWindowValue), unit: sequenceWindowUnit }
          : null,
        children: rows,
      },
      evaluationConfig: {
        triggerTiming,
        groupMatchMode: "any_symbol",
        cooldownMinutes,
      },
      deliveryConfig: {
        channels: [
          "in_app",
          ...(sendEmail ? ["email" as const] : []),
          ...(sendSms ? ["sms" as const] : []),
        ],
        deliveryMode,
        soundEnabled,
        batchWindowMinutes: deliveryMode === "batched" ? 5 : 0,
        emailAddress: sendEmail ? emailAddress.trim() || DEFAULT_ALERT_EMAIL : null,
        phoneNumber: sendSms ? phoneNumber.trim() || DEFAULT_ALERT_SMS_NUMBER : null,
      },
      expirationAt: buildExpirationAt(),
      enabled: true,
  });

  const activeTradePlanPriceLabel = (field: "entry" | "stop" | "target"): string => {
    if (tradePlanPreview?.mode === "per_symbol") return "Uses each symbol's saved watchlist price";
    const price = field === "entry" ? tradePlanPreview?.entry : field === "stop" ? tradePlanPreview?.stop : tradePlanPreview?.target;
    return formatPrice(price) ?? "No saved price";
  };

  const activeReferencePriceLabel = (referenceKind: AlertReferenceOperand["kind"]): string | null => {
    if (referenceKind === "trade_entry") return activeTradePlanPriceLabel("entry");
    if (referenceKind === "trade_stop") return activeTradePlanPriceLabel("stop");
    if (referenceKind === "trade_target") return activeTradePlanPriceLabel("target");
    return null;
  };

  const handleSubmit = async () => {
    await createAlert.mutateAsync(buildPayload(true));
    clearDraftStorage();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          clearDraftStorage();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Create Alert
          </DialogTitle>
          <DialogDescription>
            Standalone alert definition for charts, Market Flow, and watchlists.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{targetScope.sourceClient.replaceAll("_", " ")}</Badge>
              <Badge variant="secondary">{targetScope.mode === "group" ? "Group target" : "Single symbol"}</Badge>
              <Badge variant="outline">{targetScope.label}</Badge>
              {targetScope.memberCount != null && targetScope.mode === "group" && (
                <Badge variant="outline">{targetScope.memberCount} symbols</Badge>
              )}
            </div>
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {summary}
            </div>
            {previewAlert.data && (
              <div className="rounded-md border px-3 py-2 text-sm">
                <div className="font-medium">
                  Preview: {previewAlert.data.matchedCount}/{previewAlert.data.symbolCount} symbols match now
                </div>
                {previewAlert.data.matches.length > 0 ? (
                  <div className="mt-1 text-muted-foreground">
                    {previewAlert.data.matches
                      .slice(0, 5)
                      .map((match) => `${match.symbol}${match.lastPrice != null ? ` @ $${match.lastPrice.toFixed(2)}` : ""}`)
                      .join(", ")}
                    {previewAlert.data.matches.length > 5 ? ` +${previewAlert.data.matches.length - 5} more` : ""}
                  </div>
                ) : (
                  <div className="mt-1 text-muted-foreground">No current matches.</div>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="alert-name">Alert Name</Label>
              <Input id="alert-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alert name" />
            </div>
            <div className="space-y-2">
              <Label>Preset</Label>
              <Select
                value={preset}
                onValueChange={(value) => {
                  setPreset(value);
                  applyPreset(value, setName, setRows, setOperator);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">Blank builder</SelectItem>
                  <SelectItem value="ready_names">6/20 EMA cross + daily VWAP</SelectItem>
                  <SelectItem value="sma_proximity">Price within % of daily SMA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="alert-description">Description</Label>
            <Textarea
              id="alert-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional note for this alert"
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Conditions</h3>
                <p className="text-xs text-muted-foreground">Build readable rows first. The subsystem stores the full rule tree underneath.</p>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Join rows with</Label>
                <Select value={operator} onValueChange={(value: AlertGroupOperator) => setOperator(value)}>
                  <SelectTrigger className="w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALERT_GROUP_OPERATORS.map((groupOperator) => (
                      <SelectItem key={groupOperator} value={groupOperator}>
                        {groupOperator}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {operator === "THEN" && (
              <div
                className="grid gap-3 rounded-md border p-3 md:grid-cols-[160px_160px_1fr]"
                style={{
                  backgroundColor: `${cssVariables.overlayColor}26`,
                  borderColor: `${cssVariables.secondaryOverlayColor}88`,
                  boxShadow: `inset 3px 0 0 ${cssVariables.secondaryOverlayColor}`,
                }}
              >
                <div className="space-y-2">
                  <Label style={{ color: cssVariables.textColorHeader }}>Stage window</Label>
                  <Input
                    type="number"
                    min={1}
                    value={sequenceWindowValue}
                    onChange={(e) => setSequenceWindowValue(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
                <div className="space-y-2">
                  <Label style={{ color: cssVariables.textColorHeader }}>Unit</Label>
                  <Select value={sequenceWindowUnit} onValueChange={(value: AlertSequenceWindowUnit) => setSequenceWindowUnit(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALERT_SEQUENCE_WINDOW_UNITS.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit === "market_hours" ? "market hours" : "market days"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div
                  className="text-sm flex items-end pb-2"
                  style={{ color: cssVariables.textColorNormal }}
                >
                  Each stage must complete in order. After one stage arms, the remaining sequence must finish within this market-time window.
                </div>
              </div>
            )}

            {rows.map((row, index) => (
              <div
                key={row.id}
                className="rounded-lg border p-4 space-y-4"
                style={{
                  backgroundColor: index % 2 === 0 ? `${cssVariables.overlayColor}1c` : `${cssVariables.overlayColor}2a`,
                  borderColor: `${cssVariables.secondaryOverlayColor}55`,
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{operator === "THEN" ? `Stage ${index + 1}` : `Row ${index + 1}`}</Badge>
                    <Select
                      value={row.rowType}
                      onValueChange={(value: AlertRowType) =>
                        updateRow(row.id, (current) => createDefaultCondition(value, current.id))
                      }
                    >
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALERT_ROW_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {getRowTypeLabel(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {rows.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeRow(row.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                {(row.rowType === "price_reference" || row.rowType === "price_distance") && (
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Comparator</Label>
                      <Select
                        value={row.comparator}
                        onValueChange={(value) => updateRow(row.id, (current) => ({ ...current, comparator: value } as AlertRuleCondition))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {row.rowType === "price_reference" ? (
                            <>
                              <SelectItem value="crosses_above">crosses above</SelectItem>
                              <SelectItem value="crosses_below">crosses below</SelectItem>
                              <SelectItem value="is_above">is above</SelectItem>
                              <SelectItem value="is_below">is below</SelectItem>
                            </>
                          ) : (
                            <>
                              <SelectItem value="within_percent_of">within % of</SelectItem>
                              <SelectItem value="outside_percent_of">outside % of</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    {row.rowType === "price_distance" && (
                      <div className="space-y-2">
                        <Label>Percent</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={row.percent}
                          onChange={(e) => updateRow(row.id, (current) => ({ ...current, percent: Number(e.target.value) || 0 } as AlertRuleCondition))}
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Reference</Label>
                      <Select
                        value={row.reference.kind}
                        onValueChange={(value: AlertReferenceOperand["kind"]) => updateReference(row.id, () => row.reference, defaultReference(value))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ALERT_REFERENCE_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {kind.replaceAll("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {activeReferencePriceLabel(row.reference.kind) && (
                      <div className="space-y-2">
                        <Label>Saved Price</Label>
                        <div className="flex h-10 items-center rounded-md border bg-muted/20 px-3 text-sm">
                          {activeReferencePriceLabel(row.reference.kind)}
                        </div>
                      </div>
                    )}
                    {(row.reference.kind === "sma" || row.reference.kind === "ema") && (
                      <>
                        <div className="space-y-2">
                          <Label>Length</Label>
                          <Input
                            type="number"
                            value={row.reference.length ?? ""}
                            onChange={(e) => updateReference(row.id, () => row.reference, { ...row.reference, indicatorKind: row.reference.kind.toUpperCase() as AlertIndicatorKind, length: Number(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Timeframe</Label>
                          <Input
                            value={row.reference.timeframe ?? ""}
                            onChange={(e) => updateReference(row.id, () => row.reference, { ...row.reference, indicatorKind: row.reference.kind.toUpperCase() as AlertIndicatorKind, timeframe: e.target.value })}
                            placeholder="1D, 5m..."
                          />
                        </div>
                      </>
                    )}
                    {(row.reference.kind === "constant" || row.reference.kind === "horizontal_line") && (
                      <div className="space-y-2">
                        <Label>Value</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={row.reference.value ?? ""}
                          onChange={(e) => updateReference(row.id, () => row.reference, { ...row.reference, value: Number(e.target.value) || 0 })}
                        />
                      </div>
                    )}
                  </div>
                )}

                {row.rowType === "indicator_cross" && (
                  <div className="grid gap-3 md:grid-cols-5">
                    <div className="space-y-2">
                      <Label>Left</Label>
                      <Select value={row.left.kind} onValueChange={(value: AlertIndicatorKind) => updateRow(row.id, (current) => ({ ...current, left: { ...row.left, kind: value } } as AlertRuleCondition))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EMA">EMA</SelectItem>
                          <SelectItem value="SMA">SMA</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Left Length</Label>
                      <Input type="number" value={row.left.length} onChange={(e) => updateRow(row.id, (current) => ({ ...current, left: { ...row.left, length: Number(e.target.value) || 1 } } as AlertRuleCondition))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Comparator</Label>
                      <Select value={row.comparator} onValueChange={(value) => updateRow(row.id, (current) => ({ ...current, comparator: value } as AlertRuleCondition))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="crosses_above">crosses above</SelectItem>
                          <SelectItem value="crosses_below">crosses below</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Right</Label>
                      <Select value={row.right.kind} onValueChange={(value: AlertIndicatorKind) => updateRow(row.id, (current) => ({ ...current, right: { ...row.right, kind: value } } as AlertRuleCondition))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EMA">EMA</SelectItem>
                          <SelectItem value="SMA">SMA</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Right Length</Label>
                      <Input type="number" value={row.right.length} onChange={(e) => updateRow(row.id, (current) => ({ ...current, right: { ...row.right, length: Number(e.target.value) || 1 } } as AlertRuleCondition))} />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Timeframe</Label>
                      <Input value={row.left.timeframe} onChange={(e) => updateRow(row.id, (current) => ({ ...current, left: { ...row.left, timeframe: e.target.value }, right: { ...row.right, timeframe: e.target.value } } as AlertRuleCondition))} />
                    </div>
                  </div>
                )}

                {row.rowType === "indicator_reference" && (
                  <div className="grid gap-3 md:grid-cols-5">
                    <div className="space-y-2">
                      <Label>Indicator</Label>
                      <Select value={row.indicator.kind} onValueChange={(value: AlertIndicatorKind) => updateRow(row.id, (current) => ({ ...current, indicator: { ...row.indicator, kind: value } } as AlertRuleCondition))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EMA">EMA</SelectItem>
                          <SelectItem value="SMA">SMA</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Length</Label>
                      <Input type="number" value={row.indicator.length} onChange={(e) => updateRow(row.id, (current) => ({ ...current, indicator: { ...row.indicator, length: Number(e.target.value) || 1 } } as AlertRuleCondition))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Timeframe</Label>
                      <Input value={row.indicator.timeframe} onChange={(e) => updateRow(row.id, (current) => ({ ...current, indicator: { ...row.indicator, timeframe: e.target.value } } as AlertRuleCondition))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Comparator</Label>
                      <Select value={row.comparator} onValueChange={(value) => updateRow(row.id, (current) => ({ ...current, comparator: value } as AlertRuleCondition))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="crosses_above">crosses above</SelectItem>
                          <SelectItem value="crosses_below">crosses below</SelectItem>
                          <SelectItem value="is_above">is above</SelectItem>
                          <SelectItem value="is_below">is below</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Reference</Label>
                      <Select value={row.reference.kind} onValueChange={(value: AlertReferenceOperand["kind"]) => updateReference(row.id, () => row.reference, defaultReference(value))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ALERT_REFERENCE_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {kind.replaceAll("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {activeReferencePriceLabel(row.reference.kind) && (
                      <div className="space-y-2 md:col-span-2">
                        <Label>Saved Price</Label>
                        <div className="flex h-10 items-center rounded-md border bg-muted/20 px-3 text-sm">
                          {activeReferencePriceLabel(row.reference.kind)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {row.rowType === "volume_confirmation" && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Multiplier</Label>
                      <Input type="number" step="0.1" value={row.multiplier} onChange={(e) => updateRow(row.id, (current) => ({ ...current, multiplier: Number(e.target.value) || 0 } as AlertRuleCondition))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Timeframe</Label>
                      <Input value={row.timeframe} onChange={(e) => updateRow(row.id, (current) => ({ ...current, timeframe: e.target.value } as AlertRuleCondition))} />
                    </div>
                  </div>
                )}

                {row.rowType === "trade_plan_reference" && (
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Comparator</Label>
                      <Select value={row.comparator} onValueChange={(value) => updateRow(row.id, (current) => ({ ...current, comparator: value } as AlertRuleCondition))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="crosses_above">crosses above</SelectItem>
                          <SelectItem value="crosses_below">crosses below</SelectItem>
                          <SelectItem value="within_percent_of">within % of</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {row.comparator === "within_percent_of" && (
                      <div className="space-y-2">
                        <Label>Percent</Label>
                        <Input type="number" step="0.1" value={row.percent ?? ""} onChange={(e) => updateRow(row.id, (current) => ({ ...current, percent: Number(e.target.value) || 0 } as AlertRuleCondition))} />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Trade Field</Label>
                      <Select value={row.tradePlanField} onValueChange={(value: "entry" | "stop" | "target") => updateRow(row.id, (current) => ({ ...current, tradePlanField: value } as AlertRuleCondition))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="entry">entry</SelectItem>
                          <SelectItem value="stop">stop</SelectItem>
                          <SelectItem value="target">target</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Saved Price</Label>
                      <div className="flex h-10 items-center rounded-md border bg-muted/20 px-3 text-sm">
                        {activeTradePlanPriceLabel(row.tradePlanField)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <Button type="button" variant="outline" className="gap-2" onClick={addRow}>
              <Plus className="w-4 h-4" />
              Add Condition
            </Button>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Trigger timing</Label>
              <Select value={triggerTiming} onValueChange={(value: "realtime" | "bar_close" | "condition_change") => setTriggerTiming(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="realtime">Realtime</SelectItem>
                  <SelectItem value="bar_close">Once per bar close</SelectItem>
                  <SelectItem value="condition_change">Once per condition change</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Delivery mode</Label>
              <Select value={deliveryMode} onValueChange={(value: AlertDeliveryMode) => setDeliveryMode(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALERT_DELIVERY_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode === "individual" ? "Individual alerts" : "Grouped nearby matches"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cooldown (minutes)</Label>
              <Input type="number" value={cooldownMinutes} onChange={(e) => setCooldownMinutes(Math.max(0, Number(e.target.value) || 0))} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Expiration</Label>
              <Select value={expirationPreset} onValueChange={(value: ExpirationPreset) => setExpirationPreset(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No expiration</SelectItem>
                  <SelectItem value="eod">End of day</SelectItem>
                  <SelectItem value="1w">In 1 week</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <div className="text-sm font-medium">Email</div>
                <div className="text-xs text-muted-foreground">Send an email when triggered</div>
              </div>
              <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <div className="text-sm font-medium">SMS</div>
                <div className="text-xs text-muted-foreground">Send a text when triggered</div>
              </div>
              <Switch checked={sendSms} onCheckedChange={setSendSms} />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <div className="text-sm font-medium">Sound</div>
                <div className="text-xs text-muted-foreground">Play sound for in-app alerts</div>
              </div>
              <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
            </div>
          </div>

          {sendEmail && (
            <div className="space-y-2">
              <Label>Email destination</Label>
              <Input
                type="email"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder={DEFAULT_ALERT_EMAIL}
              />
            </div>
          )}

          {sendSms && (
            <div className="space-y-2">
              <Label>SMS destination</Label>
              <Input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder={DEFAULT_ALERT_SMS_NUMBER}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => previewAlert.mutate(buildPayload(false))}
            disabled={previewAlert.isPending || !name.trim() || rows.length === 0}
          >
            {previewAlert.isPending ? "Previewing..." : "Preview now"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createAlert.isPending || !name.trim() || rows.length === 0}
          >
            {createAlert.isPending ? "Saving..." : "Save alert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
