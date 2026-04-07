import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { CreateAlertDefinitionInput } from "@shared/alerts";
import { playAlertChime } from "@/lib/alert-sound";

export interface UserAlertRecord {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  sourceClient: string;
  targetScope: unknown;
  ruleTree: unknown;
  evaluationConfig: unknown;
  deliveryConfig: unknown;
  expirationAt: string | null;
  enabled: boolean;
  isPaused: boolean;
  lastTriggeredAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AlertDeliveryConfigRecord {
  channels?: string[];
  deliveryMode?: string;
  soundEnabled?: boolean;
  batchWindowMinutes?: number;
  emailAddress?: string | null;
  phoneNumber?: string | null;
}

export interface AlertPreviewResult {
  evaluatedAt: string;
  sourceLabel: string;
  symbolCount: number;
  matchedCount: number;
  matchedSymbols: string[];
  matches: Array<{
    symbol: string;
    summary: string;
    lastPrice: number | null;
    triggeredClauses: string[];
  }>;
}

export interface AlertEventRecord {
  id: number;
  alertId: number;
  userId: number;
  matchedSymbols: string[];
  matchedCount: number;
  summary: string | null;
  triggerReason: string | null;
  sourceGroupLabel: string | null;
  deliveryMode: string;
  deliveryChannels: string[];
  createdAt: string | null;
}

export interface CreateAlertResponse {
  alert: UserAlertRecord;
  initialEvaluation: AlertPreviewResult | null;
}

function supportsInAppSound(deliveryConfig: unknown): boolean {
  if (!deliveryConfig || typeof deliveryConfig !== "object") return false;
  const config = deliveryConfig as AlertDeliveryConfigRecord;
  return config.soundEnabled === true && Array.isArray(config.channels) && config.channels.includes("in_app");
}

export function useAlerts() {
  return useQuery<UserAlertRecord[]>({
    queryKey: ["/api/alerts"],
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const res = await fetch("/api/alerts", { credentials: "include" });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to fetch alerts" }));
        throw new Error(error.error || "Failed to fetch alerts");
      }
      return res.json();
    },
  });
}

export function useAlertEvents(limit: number = 25) {
  return useQuery<AlertEventRecord[]>({
    queryKey: ["/api/alerts/events", limit],
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const res = await fetch(`/api/alerts/events?limit=${limit}`, { credentials: "include" });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to fetch alert events" }));
        throw new Error(error.error || "Failed to fetch alert events");
      }
      return res.json();
    },
  });
}

export function useCreateAlert() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateAlertDefinitionInput) => {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to create alert" }));
        throw new Error(error.error || "Failed to create alert");
      }

      return res.json() as Promise<CreateAlertResponse>;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/alerts"] }),
        queryClient.refetchQueries({ queryKey: ["/api/alerts/events"] }),
      ]);

      if (result.initialEvaluation?.matchedCount && supportsInAppSound(result.alert.deliveryConfig)) {
        void playAlertChime();
      }

      toast({
        title: result.initialEvaluation?.matchedCount ? "Alert created and matched" : "Alert created",
        description: result.initialEvaluation?.matchedCount
          ? "Your alert is live and matched immediately."
          : "Your alert is now active.",
      });
    },
    onError: (error) => {
      toast({
        title: "Alert failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function usePreviewAlert() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateAlertDefinitionInput) => {
      const res = await fetch("/api/alerts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to preview alert" }));
        throw new Error(error.error || "Failed to preview alert");
      }

      return res.json() as Promise<AlertPreviewResult>;
    },
    onError: (error) => {
      toast({
        title: "Preview failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useToggleAlert() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/alerts/${id}/toggle`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to toggle alert" }));
        throw new Error(error.error || "Failed to toggle alert");
      }
      return res.json() as Promise<UserAlertRecord>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Alert updated" });
    },
    onError: (error) => {
      toast({ title: "Toggle failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useEvaluateAlert() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, persist = true }: { id: number; persist?: boolean }) => {
      const res = await fetch(`/api/alerts/${id}/evaluate?persist=${persist ? "true" : "false"}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to evaluate alert" }));
        throw new Error(error.error || "Failed to evaluate alert");
      }
      return res.json() as Promise<AlertPreviewResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/events"] });
      toast({
        title: result.matchedCount > 0 ? "Alert matched" : "No current matches",
        description: result.matchedCount > 0
          ? `${result.matchedCount} symbol${result.matchedCount === 1 ? "" : "s"} currently satisfy the rule.`
          : "The alert evaluated successfully but nothing matches right now.",
      });
    },
    onError: (error) => {
      toast({ title: "Evaluate failed", description: error.message, variant: "destructive" });
    },
  });
}
