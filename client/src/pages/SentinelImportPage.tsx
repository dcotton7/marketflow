import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { 
  Upload, FileSpreadsheet, Check, X, Loader2, Trash2, Search,
  ArrowUpRight, ArrowDownRight, Clock, AlertCircle, History,
  ChevronDown, ChevronUp, Building2, Calendar, DollarSign, AlertTriangle,
  VolumeX, Volume2, RefreshCw, Edit3, ShieldAlert, CheckCircle2, Circle, Eye
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";
import { getBrokerImportGuide } from "@/lib/broker-import-instructions";
import {
  parseFidelityClosedPositionsAvgCost,
  calculateSyntheticOpenDate,
} from "@shared/fidelity-csv";
import {
  describeSchwabRglParseFailure,
  parseSchwabRealizedGainLossAvgCost,
  parseSchwabRealizedGainLossLots,
} from "@shared/schwab-csv";
import {
  detectBrokerForCsv,
  primaryImportFileType,
  orphanCostBasisFileType,
  expectedBundleFileHint,
  bundleHasAnyTradeFiles,
  bundleHasTradeFiles,
  IMPORT_BUNDLE_LABELS,
  type ImportBundleFileType,
} from "@shared/import-bundle";

interface ImportBatch {
  id: number;
  batchId: string;
  brokerId: string;
  fileName: string;
  importName?: string;
  fileType: string;
  totalTradesFound: number;
  totalTradesImported: number;
  orphanSellsCount?: number;
  duplicatesCount?: number;
  skippedRows: Array<{ rowIndex: number; rawData: string; reason: string }>;
  status: string;
  errorMessage?: string;
  createdAt: string;
}

interface ImportedTrade {
  id: number;
  tradeId: string;
  batchId: string;
  brokerId: string;
  brokerOrderId?: string;
  ticker: string;
  assetType: string;
  direction: string;
  quantity: number;
  price: number;
  totalAmount: number;
  commission: number;
  fees: number;
  netAmount: number;
  tradeDate: string;
  settlementDate?: string;
  executionTime?: string;
  timestampSource: string;
  isTimeEstimated: boolean;
  accountId?: string;
  accountName?: string;
  accountType: string;
  status: string;
  isFill: boolean;
  fillGroupKey?: string;
  isOrphanSell?: boolean;
  orphanStatus?: string;
  manualCostBasis?: number;
  manualOpenDate?: string;
  isDuplicate?: boolean;
  duplicateStatus?: string;
  duplicateOfTradeId?: number;
  duplicateOfImportId?: number;
  matchInfo?: {
    type: 'card' | 'import';
    card?: { id: number; symbol: string; entryDate?: string; entryPrice?: number; status: string };
    trade?: ImportedTrade;
  };
  rawSource?: string;
  importedAt: string;
}

interface PreviewResult {
  batch: {
    batchId: string;
    brokerId: string;
    fileName: string;
    totalTradesFound: number;
    totalTradesImported: number;
    skippedRows: Array<{ rowIndex: number; rawData: string; reason: string }>;
    status: string;
  };
  trades: ImportedTrade[];
  detectedBroker: string;
  dateRange?: { earliest: string; latest: string; totalTrades: number } | null;
  /** Rows in CSV that match trades already in the database (overlap imports). */
  skippedAlreadyImported?: number;
  parsedTradesFound?: number;
}

const BROKER_OPTIONS = [
  { value: "FIDELITY", label: "Fidelity" },
  { value: "SCHWAB", label: "Charles Schwab" },
  { value: "ROBINHOOD", label: "Robinhood" },
];

export default function SentinelImportPage() {
  const { user } = useSentinelAuth();
  const { toast } = useToast();
  const { settings: systemSettings, cssVariables, pageShellStyle } = useSystemSettings();
  
  const [activeTab, setActiveTab] = useState("upload");
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>("FIDELITY");
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [bundleFiles, setBundleFiles] = useState<Array<{
    id: string;
    fileName: string;
    csvContent: string;
    brokerId: string;
    type: ImportBundleFileType;
  }>>([]);
  const [smartImportRunning, setSmartImportRunning] = useState(false);
  const [smartImportStep, setSmartImportStep] = useState<string | null>(null);
  const [bundleResult, setBundleResult] = useState<{
    tradesImported: number;
    skippedAlreadyImported: number;
    orphansResolved: number;
    orphansRemaining: number;
    duplicatesFound: number;
    promoted: boolean;
    cardsCreated: number;
    ordersImported: number;
    ordersSkipped: number;
    warnings: string[];
  } | null>(null);
  const [showSkippedDialog, setShowSkippedDialog] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [showResetConfirmDialog, setShowResetConfirmDialog] = useState(false);
  const [showRepromoteDialog, setShowRepromoteDialog] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [tickerFilter, setTickerFilter] = useState("");
  const [timestampOverride, setTimestampOverride] = useState<string>("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showOrphanDialog, setShowOrphanDialog] = useState(false);
  const [selectedOrphanBatchId, setSelectedOrphanBatchId] = useState<string | null>(null);
  const [orphanResolutions, setOrphanResolutions] = useState<Record<string, { costBasis: string; openDate: string; isSyntheticDate?: boolean }>>({});
  const [recentlyUnmutedIds, setRecentlyUnmutedIds] = useState<Set<string>>(new Set());
  const [costBasisMap, setCostBasisMap] = useState<Record<string, number> | null>(null);
  const [costBasisFileName, setCostBasisFileName] = useState<string>("");
  const [costBasisMatchCount, setCostBasisMatchCount] = useState<{ matched: number; total: number } | null>(null);
  const [showAllOrphansDialog, setShowAllOrphansDialog] = useState(false);
  
  // Delete all trading cards state
  const [showDeleteCardsDialog, setShowDeleteCardsDialog] = useState(false);
  const [deleteCardsConfirmText, setDeleteCardsConfirmText] = useState("");
  
  // Orphans tab state
  const [orphanTickerSearch, setOrphanTickerSearch] = useState("");
  const [orphanSortField, setOrphanSortField] = useState<"tradeDate" | "importedAt" | "ticker">("tradeDate");
  const [orphanSortDir, setOrphanSortDir] = useState<"asc" | "desc">("desc");
  const [orphanStatusFilter, setOrphanStatusFilter] = useState<"all" | "pending" | "resolved" | "muted">("all");
  const [orphanEditingId, setOrphanEditingId] = useState<string | null>(null);
  const [orphanEditCostBasis, setOrphanEditCostBasis] = useState("");
  const [orphanEditOpenDate, setOrphanEditOpenDate] = useState("");
  
  // Duplicate detection state
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [selectedDuplicateBatchId, setSelectedDuplicateBatchId] = useState<string | null>(null);
  const [bulkProcessingBatchId, setBulkProcessingBatchId] = useState<string | null>(null);
  
  // Promote report state
  const [promoteReport, setPromoteReport] = useState<any>(null);
  
  // Orders import state
  const [ordersFile, setOrdersFile] = useState<File | null>(null);
  const [ordersCsvContent, setOrdersCsvContent] = useState<string | null>(null);
  const [ordersPreview, setOrdersPreview] = useState<any>(null);
  const [ordersDefaultAccount, setOrdersDefaultAccount] = useState<string>("");
  const [ordersImporting, setOrdersImporting] = useState(false);
  
  const { data: batches, isLoading: batchesLoading } = useQuery<ImportBatch[]>({
    queryKey: ['/api/sentinel/import/batches'],
  });

  const { data: allTrades, isLoading: tradesLoading } = useQuery<ImportedTrade[]>({
    queryKey: ['/api/sentinel/import/trades'],
  });
  
  const { data: orphanData, isLoading: orphansLoading, refetch: refetchOrphans } = useQuery<{ orphans: ImportedTrade[] }>({
    queryKey: ['/api/sentinel/import/batches', selectedOrphanBatchId, 'orphans'],
    enabled: !!selectedOrphanBatchId,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/import/batches/${selectedOrphanBatchId}/orphans`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch orphan sells');
      return res.json();
    }
  });
  
  const orphanSells = orphanData?.orphans;

  const { data: unpromotedStats } = useQuery<{ unpromotedCount: number; totalPromotable: number; hasExistingCards: boolean }>({
    queryKey: ['/api/sentinel/import/unpromoted-stats'],
  });
  
  const { data: allOrphansData, isLoading: allOrphansLoading, refetch: refetchAllOrphans } = useQuery<{ orphans: ImportedTrade[]; totalOrphans: number; resolvedCount: number; pendingCount: number; mutedCount: number }>({
    queryKey: ['/api/sentinel/import/all-orphans', 'includeResolved'],
    queryFn: async () => {
      const res = await fetch('/api/sentinel/import/all-orphans?includeResolved=true', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch all orphan sells');
      return res.json();
    }
  });
  
  const allOrphanSells = allOrphansData?.orphans;

  // Duplicate data query
  const { data: duplicateData, isLoading: duplicatesLoading, refetch: refetchDuplicates } = useQuery<{ duplicates: ImportedTrade[] }>({
    queryKey: ['/api/sentinel/import/batches', selectedDuplicateBatchId, 'duplicates'],
    enabled: !!selectedDuplicateBatchId,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/import/batches/${selectedDuplicateBatchId}/duplicates`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch duplicates');
      return res.json();
    }
  });
  
  const duplicateTrades = duplicateData?.duplicates;

  // Count total pending orphans across all batches that need review
  const totalPendingOrphans = batches?.reduce((sum, b) => sum + (b.orphanSellsCount || 0), 0) || 0;
  const hasPendingOrphans = totalPendingOrphans > 0;
  
  // Count total pending duplicates across all batches
  const totalPendingDuplicates = batches?.reduce((sum, b) => sum + (b.duplicatesCount || 0), 0) || 0;
  const hasPendingDuplicates = totalPendingDuplicates > 0;
  
  const { data: tradeSources } = useQuery<{ id: string; name: string; count: number; isSystemTag?: boolean }[]>({
    queryKey: ['/api/sentinel/trades/sources'],
  });
  const hasExistingImportCards = tradeSources?.some(s => s.id !== 'hand' && s.count > 0) || false;

  const previewMutation = useMutation({
    mutationFn: async (data: { csvContent: string; fileName: string; brokerId: string }) => {
      const response = await apiRequest('POST', '/api/sentinel/import/preview', data);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Preview failed with status ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data: PreviewResult) => {
      setPreviewData(data);
      if (data.batch.status === "FAILED") {
        toast({
          title: "Parse Failed",
          description: data.batch.skippedRows[0]?.reason || "Could not parse CSV",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Preview Failed",
        description: error.message || "Failed to preview CSV",
        variant: "destructive",
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (data: { csvContent: string; fileName: string; brokerId: string; timestampOverride?: string }) => {
      const response = await apiRequest('POST', '/api/sentinel/import/confirm', data);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Import failed with status ${response.status}`);
      }
      return response.json();
    },
    onSuccess: async (data) => {
      const skipped = data.skippedAlreadyImported ?? 0;
      const imported = data.tradesImported ?? 0;
      if (imported === 0 && skipped > 0) {
        toast({
          title: "Nothing new to import",
          description: `All ${skipped} trade(s) in this file were already on file — overlap skipped automatically.`,
        });
      } else {
        const skipNote = skipped > 0 ? ` Skipped ${skipped} already on file.` : "";
        toast({
          title: "Import Complete",
          description: `Imported ${imported} new trade(s).${skipNote}`,
        });
      }
      setPreviewData(null);
      setCsvContent(null);
      setFileName(null);
      setTimestampOverride("");
      setActiveTab("history");
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      
      // Auto-detect duplicates for trades that slipped past fingerprint match
      if (data.batch?.batchId && imported > 0) {
        try {
          const dupResponse = await apiRequest('POST', `/api/sentinel/import/batches/${data.batch.batchId}/detect-duplicates`, {});
          if (dupResponse.ok) {
            const dupData = await dupResponse.json();
            queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
            if (dupData.duplicatesFound > 0) {
              toast({ 
                title: "Duplicates Found", 
                description: `Found ${dupData.duplicatesFound} duplicate trades that need review before promoting`
              });
            }
          }
        } catch (err) {
          console.error("Auto duplicate detection failed:", err);
        }
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "Failed to import trades";
      toast({
        title: "Import Failed",
        description: errorMsg.includes("duplicate") 
          ? "Some trades may already exist. Try deleting the batch first."
          : errorMsg,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const response = await apiRequest('DELETE', `/api/sentinel/import/batches/${batchId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Delete failed with status ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Batch Deleted" });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Delete Failed", 
        description: error?.message || "Could not delete batch. Please try again.",
        variant: "destructive" 
      });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', '/api/sentinel/import/all', {
        confirmDelete: "DELETE_ALL_TRADES"
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Delete failed with status ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "All Trades Deleted", 
        description: `Removed ${data.deleted?.trades || 0} trades and ${data.deleted?.batches || 0} batches`
      });
      setShowDeleteAllDialog(false);
      setDeleteConfirmText("");
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Delete All Failed", 
        description: error?.message || "Could not delete trades. Please try again.",
        variant: "destructive" 
      });
    },
  });

  const deleteAllCardsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', '/api/sentinel/trades/all', {
        confirmDelete: "DELETE"
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Delete failed with status ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      const d = data.deleted || {};
      toast({ 
        title: "All Trading Cards Deleted", 
        description: `Removed ${d.trades || 0} cards, ${d.evaluations || 0} evaluations, ${d.events || 0} events, ${d.orderLevels || 0} order levels`
      });
      setShowDeleteCardsDialog(false);
      setDeleteCardsConfirmText("");
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/trades'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Delete Failed", 
        description: error?.message || "Could not delete trading cards. Please try again.",
        variant: "destructive" 
      });
    },
  });

  const promoteToCardsMutation = useMutation({
    mutationFn: async (options?: { clean?: boolean }) => {
      const response = await apiRequest('POST', '/api/sentinel/import/promote-to-cards', { clean: options?.clean });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Promotion failed with status ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      const report = data.syntheticCostBasisReport;
      const synthInfo = report && report.totalSyntheticInjections > 0
        ? ` | ${report.cardsUsingSyntheticCostBasis} cards used synthetic cost basis (${report.tickersWithSynthetic?.join(', ')})`
        : ' | All cards used real imported cost basis';
      const orderInfo = data.orderLevelsPreserved > 0 
        ? ` | ${data.orderLevelsPreserved} order levels preserved` 
        : '';
      const modeLabel = data.mode === 'incremental' ? 'Incremental Merge' : data.mode === 'clean' ? 'Clean Re-promote' : 'Initial Promote';
      toast({ 
        title: `${modeLabel} Complete`, 
        description: `${data.tradesPromoted || 0} trades processed. Created ${data.cardsCreated || 0} cards, merged ${data.cardsMerged || 0}. Open: ${data.openPositions || 0}, Closed: ${data.closedPositions || 0}${synthInfo}${orderInfo}`
      });
      if (report) {
        setPromoteReport(report);
      }
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/trades'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/trades/sources'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/labels'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/unpromoted-stats'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Promotion Failed", 
        description: error?.message || "Could not promote trades. Please try again.",
        variant: "destructive" 
      });
    },
  });

  const redetectOrphansMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/sentinel/import/redetect-orphans', {});
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to re-detect orphans');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      refetchOrphans();
      toast({ 
        title: "Orphan Re-detection Complete", 
        description: `Cleared ${data.orphansCleared || 0} false orphans. Found ${data.newOrphansFound || 0} new orphans. ${data.totalTrueOrphans || 0} total orphans remain.`
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Re-detection Failed", 
        description: error?.message || "Could not re-detect orphans. Please try again.",
        variant: "destructive" 
      });
    },
  });

  const resetAndRedetectMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/sentinel/import/reset-and-redetect', {});
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to reset and re-detect');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/trades'] });
      refetchOrphans();
      toast({ 
        title: "Reset Complete", 
        description: `Deleted ${data.cardsDeleted || 0} cards. Cleared ${data.orphansCleared || 0} orphans. ${data.trueOrphansFound || 0} true orphans found.`
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Reset Failed", 
        description: error?.message || "Could not reset. Please try again.",
        variant: "destructive" 
      });
    },
  });

  const cleanupDuplicatesMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/sentinel/import/cleanup-duplicates', {});
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to cleanup duplicates');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/trades'] });
      toast({ 
        title: "Cleanup Complete", 
        description: data.merged > 0 
          ? `Merged ${data.merged} duplicate position${data.merged > 1 ? 's' : ''}, removed ${data.deleted} extra card${data.deleted > 1 ? 's' : ''}.${data.closed > 0 ? ` Auto-closed ${data.closed} position${data.closed > 1 ? 's' : ''}.` : ''}`
          : "No duplicate positions found. Your data is clean!"
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Cleanup Failed", 
        description: error?.message || "Could not cleanup duplicates. Please try again.",
        variant: "destructive" 
      });
    },
  });

  const resolveOrphanMutation = useMutation({
    mutationFn: async (data: { tradeId: string; action: 'delete' | 'resolve' | 'mute'; costBasis?: number; openDate?: string; isSyntheticDate?: boolean }) => {
      const response = await apiRequest('PATCH', `/api/sentinel/import/trades/${data.tradeId}/resolve-orphan`, {
        action: data.action,
        costBasis: data.costBasis,
        openDate: data.openDate,
        isSyntheticDate: data.isSyntheticDate,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to resolve orphan');
      }
      return response.json();
    },
    onSuccess: (data) => {
      refetchOrphans();
      refetchAllOrphans();
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/unpromoted-stats'] });
      if (data.action === 'muted') {
        toast({ title: "Trade Muted", description: "Hidden from dashboard until cost basis is set" });
      } else if (data.action === 'unmuted') {
        toast({ title: "Trade Unmuted", description: "Trade is back in pending state" });
      } else if (data.action === 'resolved') {
        toast({ title: "Cost Basis Saved", description: "Trade is ready to be promoted" });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to resolve orphan",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const bulkOrphanMutation = useMutation({
    mutationFn: async (action: 'mute_all' | 'delete_all') => {
      if (!selectedOrphanBatchId) throw new Error('No batch selected');
      const response = await apiRequest('POST', `/api/sentinel/import/batches/${selectedOrphanBatchId}/orphans/bulk`, { action });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Bulk action failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      refetchOrphans();
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      toast({ 
        title: data.action === 'mute_all' ? "All Orphans Muted" : "All Orphans Deleted",
        description: data.action === 'mute_all' 
          ? "Hidden from dashboard until cost basis is set" 
          : "All orphan sells removed"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Bulk action failed",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const bulkAllOrphansMutation = useMutation({
    mutationFn: async (payload: { action: 'mute_all' | 'delete_all' | 'resolve_all'; items?: Array<{ tradeId: string; costBasis: number; openDate: string; isSyntheticDate: boolean }> }) => {
      const response = await apiRequest('POST', '/api/sentinel/import/all-orphans/bulk', payload);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Bulk action failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      refetchAllOrphans();
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      if (data.action === 'resolve_all') {
        if (data.resolvedTradeIds && Array.isArray(data.resolvedTradeIds)) {
          const resolvedSet = new Set(data.resolvedTradeIds as string[]);
          setOrphanResolutions(prev => {
            const next: Record<string, { costBasis: string; openDate: string; isSyntheticDate?: boolean }> = {};
            for (const key of Object.keys(prev)) {
              if (!resolvedSet.has(key)) {
                next[key] = prev[key];
              }
            }
            return next;
          });
        } else {
          setOrphanResolutions({});
        }
        setCostBasisMatchCount(null);
        toast({ 
          title: "All Matched Orphans Saved",
          description: `${data.resolvedCount} orphan${data.resolvedCount === 1 ? '' : 's'} resolved. Load another CSV to match remaining orphans.`
        });
      } else {
        toast({ 
          title: data.action === 'mute_all' ? "All Orphans Muted" : "All Orphans Deleted",
          description: data.action === 'mute_all' 
            ? "Hidden from dashboard until cost basis is set" 
            : "All orphan sells removed"
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Bulk action failed",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    },
  });
  
  // Duplicate detection mutation
  const detectDuplicatesMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const response = await apiRequest('POST', `/api/sentinel/import/batches/${batchId}/detect-duplicates`, {});
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to detect duplicates');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      if (data.duplicatesFound > 0) {
        toast({ 
          title: "Duplicates Found", 
          description: `Found ${data.duplicatesFound} duplicate trades that match existing data`
        });
      } else {
        toast({ title: "No Duplicates", description: "No duplicate trades found in this import" });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Detection Failed",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    },
  });
  
  // Resolve duplicate mutation
  const resolveDuplicateMutation = useMutation({
    mutationFn: async (data: { tradeId: string; action: 'delete' | 'overwrite' }) => {
      const response = await apiRequest('PATCH', `/api/sentinel/import/trades/${data.tradeId}/resolve-duplicate`, {
        action: data.action,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to resolve duplicate');
      }
      return response.json();
    },
    onSuccess: (data) => {
      refetchDuplicates();
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      if (data.action === 'deleted') {
        toast({ title: "Duplicate Removed", description: "Import row deleted, existing data kept" });
      } else if (data.action === 'overwritten') {
        toast({ title: "Data Updated", description: "Existing record updated with new import data" });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to resolve duplicate",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    },
  });
  
  // Bulk duplicate actions
  const bulkDuplicateMutation = useMutation({
    mutationFn: async (action: 'delete_all' | 'overwrite_all') => {
      if (!selectedDuplicateBatchId) throw new Error('No batch selected');
      setBulkProcessingBatchId(selectedDuplicateBatchId);
      const response = await fetch(`/api/sentinel/import/batches/${selectedDuplicateBatchId}/duplicates/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Bulk action failed (${response.status})`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      setBulkProcessingBatchId(null);
      refetchDuplicates();
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      toast({ 
        title: data.action === 'delete_all' ? "All Duplicates Removed" : "All Records Updated",
        description: data.action === 'delete_all' 
          ? `Removed ${data.count} duplicate import rows` 
          : `Updated ${data.count} existing records with new data`
      });
    },
    onError: (error: any) => {
      setBulkProcessingBatchId(null);
      toast({
        title: "Bulk action failed",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    },
  });
  
  // State for inline editing of import names
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editingImportName, setEditingImportName] = useState("");
  
  const renameBatchMutation = useMutation({
    mutationFn: async ({ batchId, importName }: { batchId: string; importName: string }) => {
      const response = await apiRequest('PATCH', `/api/sentinel/import/batches/${batchId}/rename`, { importName });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Rename failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/trades/sources'] });
      setEditingBatchId(null);
      setEditingImportName("");
      toast({ title: "Import renamed successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Rename failed",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    },
  });
  
  const startEditingImportName = (batch: ImportBatch) => {
    setEditingBatchId(batch.batchId);
    // Default name if not set
    const defaultName = batch.importName || `FILE${batch.fileName.replace(/\.[^/.]+$/, "").slice(-4).toUpperCase()}`;
    setEditingImportName(defaultName);
  };
  
  const saveImportName = () => {
    if (editingBatchId && editingImportName.trim()) {
      renameBatchMutation.mutate({ batchId: editingBatchId, importName: editingImportName.trim() });
    }
  };
  
  const cancelEditingImportName = () => {
    setEditingBatchId(null);
    setEditingImportName("");
  };

  const handleReviewOrphans = (batchId: string) => {
    setSelectedOrphanBatchId(batchId);
    setOrphanResolutions({});
    setCostBasisMap(null);
    setCostBasisFileName("");
    setCostBasisMatchCount(null);
    setShowOrphanDialog(true);
  };

  const handleCostBasisCsvUpload = (file: File, orphansList?: ImportedTrade[]) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      const parsed = parseFidelityClosedPositionsAvgCost(text);
      const tickerCount = Object.keys(parsed).length;

      if (tickerCount === 0) {
        toast({
          title: "No data found",
          description: "Could not find cost basis data in the uploaded file. Make sure it's a Fidelity Closed Positions CSV.",
          variant: "destructive",
        });
        return;
      }

      setCostBasisMap(parsed);
      setCostBasisFileName(file.name);

      const sourceOrphans = orphansList || orphanSells || [];
      const pendingOrphans = sourceOrphans.filter(o => o.orphanStatus === 'pending' || o.orphanStatus === 'muted');
      let matched = 0;
      const newResolutions: Record<string, { costBasis: string; openDate: string; isSyntheticDate?: boolean }> = { ...orphanResolutions };

      for (const orphan of pendingOrphans) {
        const ticker = orphan.ticker.toUpperCase();
        if (parsed[ticker] !== undefined) {
          matched++;
          const existingDate = newResolutions[orphan.tradeId]?.openDate;
          const hasUserDate = !!existingDate && !newResolutions[orphan.tradeId]?.isSyntheticDate;
          const openDate = hasUserDate ? existingDate : (orphan.tradeDate ? calculateSyntheticOpenDate(orphan.tradeDate) : '');
          const isSynthetic = !hasUserDate && !!orphan.tradeDate;
          
          newResolutions[orphan.tradeId] = {
            costBasis: parsed[ticker].toFixed(2),
            openDate,
            isSyntheticDate: isSynthetic,
          };
        }
      }

      setOrphanResolutions(newResolutions);
      setCostBasisMatchCount({ matched, total: pendingOrphans.length });

      toast({
        title: `Cost basis loaded from ${file.name}`,
        description: `Matched ${matched} of ${pendingOrphans.length} orphans with cost basis data (${tickerCount} tickers in file)`,
      });
    };
    reader.readAsText(file);
  };

  const handleResolveOrphan = (tradeId: string, action: 'delete' | 'resolve' | 'mute', currentStatus?: string) => {
    const resolution = orphanResolutions[tradeId];
    if (action === 'resolve') {
      if (!resolution?.costBasis || !resolution?.openDate) {
        toast({
          title: "Missing Information",
          description: "Please enter cost basis and open date",
          variant: "destructive",
        });
        return;
      }
      resolveOrphanMutation.mutate({
        tradeId,
        action: 'resolve',
        costBasis: parseFloat(resolution.costBasis),
        openDate: resolution.openDate,
        isSyntheticDate: resolution.isSyntheticDate === true,
      });
    } else if (action === 'mute') {
      // Check if we're unmuting (going from muted to pending)
      const isUnmuting = currentStatus === 'muted';
      resolveOrphanMutation.mutate({ tradeId, action: 'mute' }, {
        onSuccess: () => {
          if (isUnmuting) {
            // Add to recently unmuted set for visual feedback
            setRecentlyUnmutedIds(prev => new Set(Array.from(prev).concat(tradeId)));
            // Remove the highlight after 3 seconds
            setTimeout(() => {
              setRecentlyUnmutedIds(prev => {
                const next = new Set(prev);
                next.delete(tradeId);
                return next;
              });
            }, 3000);
          }
        }
      });
    } else {
      resolveOrphanMutation.mutate({ tradeId, action: 'delete' });
    }
  };
  
  const handleResolveDuplicate = (tradeId: string, action: 'delete' | 'overwrite') => {
    resolveDuplicateMutation.mutate({ tradeId, action });
  };

  const addBundleFiles = useCallback(async (files: FileList | File[]) => {
    const csvFiles = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".csv"));
    if (csvFiles.length === 0) {
      toast({ title: "Invalid File", description: "Please upload CSV files", variant: "destructive" });
      return;
    }

    const newEntries: typeof bundleFiles = [];
    const unknownMessages: string[] = [];

    for (const file of csvFiles) {
      const content = await file.text();
      const detected = detectBrokerForCsv(content, file.name);
      if (!detected || detected.fileType === "UNKNOWN") {
        unknownMessages.push(
          `${file.name} — expected Schwab Transactions/RGL or Fidelity Activity/Closed Positions/Orders CSV.`
        );
        continue;
      }
      if (
        detected.brokerId === "SCHWAB" &&
        detected.fileType === "REALIZED_GAIN_LOSS" &&
        parseSchwabRealizedGainLossLots(content).length === 0
      ) {
        unknownMessages.push(
          `${file.name}: ${describeSchwabRglParseFailure(content)}`
        );
        continue;
      }

      newEntries.push({
        id: crypto.randomUUID(),
        fileName: file.name,
        csvContent: content,
        brokerId: detected.brokerId,
        type: detected.fileType,
      });
    }

    if (unknownMessages.length > 0) {
      toast({
        title: "Unrecognized CSV",
        description: unknownMessages.join(" "),
        variant: "destructive",
      });
    }

    if (newEntries.length > 0) {
      setBundleFiles((prev) => [...prev, ...newEntries]);
      setBundleResult(null);
      setPreviewData(null);
      setCsvContent(null);
      setFileName(null);
    }
  }, [toast]);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      void addBundleFiles(e.dataTransfer.files);
    }
  }, [addBundleFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void addBundleFiles(e.target.files);
      e.target.value = "";
    }
  }, [addBundleFiles]);

  const removeBundleFile = (id: string) => {
    setBundleFiles((prev) => prev.filter((f) => f.id !== id));
    setBundleResult(null);
  };

  const runSmartImport = async () => {
    if (!bundleHasAnyTradeFiles(bundleFiles)) {
      toast({
        title: "Trade CSV required",
        description: `Drop Schwab or Fidelity trade files. ${expectedBundleFileHint(selectedBrokerId)}.`,
        variant: "destructive",
      });
      return;
    }

    setSmartImportRunning(true);
    setBundleResult(null);

    const warnings: string[] = [];
    let tradesImported = 0;
    let skippedAlreadyImported = 0;
    let duplicatesAutoRemoved = 0;
    let orphansAutoRemoved = 0;
    const ordersFiles = bundleFiles.filter((f) => f.type === "ORDERS");

    const brokerGroups = new Map<string, typeof bundleFiles>();
    for (const file of bundleFiles) {
      const group = brokerGroups.get(file.brokerId) ?? [];
      group.push(file);
      brokerGroups.set(file.brokerId, group);
    }

    try {
      for (const [brokerId, files] of brokerGroups) {
        const primaryType = primaryImportFileType(brokerId);
        const costBasisType = orphanCostBasisFileType(brokerId);
        const tradeFiles =
          brokerId === "SCHWAB"
            ? (() => {
                const transactions = files.filter((f) => f.type === "TRANSACTIONS");
                if (transactions.length > 0) return transactions;
                return files.filter((f) => f.type === "REALIZED_GAIN_LOSS");
              })()
            : files.filter((f) => f.type === primaryType);
        const usingRglAsPrimary =
          brokerId === "SCHWAB" && tradeFiles.some((f) => f.type === "REALIZED_GAIN_LOSS");
        const costBasisFiles =
          costBasisType && !usingRglAsPrimary
            ? files.filter((f) => f.type === costBasisType)
            : [];

        if (tradeFiles.length === 0) continue;

        const brokerLabel = brokerId === "SCHWAB" ? "Schwab" : "Fidelity";
        const tradeLabel = IMPORT_BUNDLE_LABELS[tradeFiles[0]?.type ?? primaryType];
        setSmartImportStep(`Importing ${brokerLabel} ${tradeLabel}…`);

        for (const file of tradeFiles) {
          const response = await apiRequest("POST", "/api/sentinel/import/confirm", {
            csvContent: file.csvContent,
            fileName: file.fileName,
            brokerId,
            timestampOverride: timestampOverride || undefined,
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            const parseReason = err.batch?.skippedRows?.[0]?.reason;
            throw new Error(
              parseReason
                ? `${file.fileName}: ${parseReason}`
                : err.error || `Failed to import ${file.fileName}`
            );
          }
          const data = await response.json();
          tradesImported += data.tradesImported || 0;
          skippedAlreadyImported += data.skippedAlreadyImported || 0;
          duplicatesAutoRemoved += data.autoFinalized?.duplicatesRemoved || 0;
          orphansAutoRemoved += data.autoFinalized?.orphansRemoved || 0;
        }

        setSmartImportStep(`Checking ${brokerLabel} orphan sells…`);
        const orphansRes = await fetch("/api/sentinel/import/all-orphans?includeResolved=false", {
          credentials: "include",
        });
        const orphansData = orphansRes.ok ? await orphansRes.json() : { orphans: [] };
        const pendingOrphans: ImportedTrade[] = (orphansData.orphans || []).filter(
          (o: ImportedTrade) =>
            o.brokerId === brokerId &&
            (o.orphanStatus === "pending" || o.orphanStatus === "muted")
        );

        if (costBasisFiles.length > 0 && pendingOrphans.length > 0) {
          setSmartImportStep(`Applying ${brokerLabel} cost basis…`);
          const costMap: Record<string, number> = {};
          for (const file of costBasisFiles) {
            if (file.type === "CLOSED_POSITIONS") {
              Object.assign(costMap, parseFidelityClosedPositionsAvgCost(file.csvContent));
            } else if (file.type === "REALIZED_GAIN_LOSS") {
              Object.assign(costMap, parseSchwabRealizedGainLossAvgCost(file.csvContent));
            }
          }

          const items = pendingOrphans
            .filter((orphan) => costMap[orphan.ticker.toUpperCase()] !== undefined)
            .map((orphan) => ({
              tradeId: orphan.tradeId,
              costBasis: costMap[orphan.ticker.toUpperCase()],
              openDate: calculateSyntheticOpenDate(orphan.tradeDate),
              isSyntheticDate: true,
            }));

          if (items.length > 0) {
            const resolveRes = await apiRequest("POST", "/api/sentinel/import/all-orphans/bulk", {
              action: "resolve_all",
              items,
            });
            if (resolveRes.ok) {
              const resolveData = await resolveRes.json();
              orphansAutoRemoved += resolveData.resolvedCount || 0;
            }
          }
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/import/batches"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/import/all-orphans"] });

      const batchesRes = await fetch("/api/sentinel/import/batches", { credentials: "include" });
      const batchesData = batchesRes.ok ? await batchesRes.json() : [];
      const pendingDuplicatesAfter = (batchesData as ImportBatch[]).reduce(
        (sum, b) => sum + (b.duplicatesCount || 0),
        0
      );

      const orphansAfterRes = await fetch("/api/sentinel/import/all-orphans?includeResolved=false", {
        credentials: "include",
      });
      const orphansAfterData = orphansAfterRes.ok ? await orphansAfterRes.json() : { orphans: [] };
      const pendingOrphansAfter = ((orphansAfterData.orphans || []) as ImportedTrade[]).filter(
        (o) => o.orphanStatus === "pending" || o.orphanStatus === "muted"
      ).length;

      if (duplicatesAutoRemoved > 0) {
        warnings.push(
          `${duplicatesAutoRemoved} duplicate row(s) already on Trading Cards — removed automatically.`
        );
      }
      if (orphansAutoRemoved > 0) {
        warnings.push(`${orphansAutoRemoved} false orphan sell(s) cleaned up automatically.`);
      }
      if (pendingDuplicatesAfter > 0) {
        warnings.push(`${pendingDuplicatesAfter} duplicate(s) still need manual review in History.`);
      }
      if (pendingOrphansAfter > 0) {
        warnings.push(`${pendingOrphansAfter} orphan(s) still pending — resolve in Orphans tab.`);
      }
      if (ordersFiles.length > 0) {
        warnings.push("Orders CSV noted — use Orders tab after you Promote to Trading Cards in History.");
      }
      if (pendingDuplicatesAfter === 0 && pendingOrphansAfter === 0) {
        warnings.push("Ready — History → Promote to Trading Cards.");
      }

      if (skippedAlreadyImported > 0) {
        warnings.unshift(
          `${skippedAlreadyImported} overlapping trade(s) were already on file and skipped automatically.`
        );
      }

      const result = {
        tradesImported,
        skippedAlreadyImported,
        orphansResolved: orphansAutoRemoved,
        orphansRemaining: pendingOrphansAfter,
        duplicatesFound: duplicatesAutoRemoved,
        promoted: false,
        cardsCreated: 0,
        ordersImported: 0,
        ordersSkipped: 0,
        warnings,
      };
      setBundleResult(result);

      const skipNote =
        skippedAlreadyImported > 0 ? `, ${skippedAlreadyImported} overlap skipped` : "";
      const cleanNote =
        duplicatesAutoRemoved + orphansAutoRemoved > 0
          ? `, ${duplicatesAutoRemoved + orphansAutoRemoved} auto-cleaned`
          : "";
      toast({
        title: "Smart Import complete",
        description:
          tradesImported > 0
            ? `${tradesImported} new trade(s) imported${skipNote}${cleanNote}. Go to History → Promote.`
            : `No new trades — ${skippedAlreadyImported} overlap row(s) already on file.`,
      });

      setBundleFiles([]);
      setActiveTab("history");
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/import/batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/import/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/import/all-orphans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Smart import failed";
      toast({ title: "Smart Import failed", description: message, variant: "destructive" });
    } finally {
      setSmartImportRunning(false);
      setSmartImportStep(null);
    }
  };

  const handlePreview = () => {
    if (csvContent && fileName) {
      previewMutation.mutate({ csvContent, fileName, brokerId: selectedBrokerId });
    }
  };

  const handleConfirm = () => {
    if (csvContent && fileName) {
      confirmMutation.mutate({ 
        csvContent, 
        fileName, 
        brokerId: selectedBrokerId,
        timestampOverride: timestampOverride || undefined 
      });
    }
  };

  const handleDeleteAll = () => {
    if (deleteConfirmText === "DELETE") {
      deleteAllMutation.mutate();
    }
  };

  const toggleBatchExpand = (batchId: string) => {
    const newExpanded = new Set(expandedBatches);
    if (newExpanded.has(batchId)) {
      newExpanded.delete(batchId);
    } else {
      newExpanded.add(batchId);
    }
    setExpandedBatches(newExpanded);
  };

  const filteredTrades = allTrades?.filter(t => 
    !tickerFilter || t.ticker.toUpperCase().includes(tickerFilter.toUpperCase())
  ) || [];

  const formatDate = (dateStr: string) => {
    const isDateOnlyVal = dateStr.endsWith('T00:00:00.000Z') || dateStr.endsWith('T00:00:00Z') || !dateStr.includes('T');
    if (isDateOnlyVal) {
      const [y, m, d] = dateStr.substring(0, 10).split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', day: 'numeric', year: 'numeric',
      timeZone: 'America/New_York'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const handleOrdersFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOrdersFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setOrdersCsvContent(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleParseOrders = async () => {
    if (!ordersCsvContent) return;
    try {
      const response = await apiRequest('POST', '/api/sentinel/order-levels/parse-orders-csv', {
        csvContent: ordersCsvContent,
        defaultAccountName: ordersDefaultAccount || undefined,
      });
      const data = await response.json();
      setOrdersPreview(data);
    } catch (error: any) {
      toast({ title: "Failed to parse orders", description: error.message, variant: "destructive" });
    }
  };

  const handleImportOrders = async () => {
    if (!ordersPreview) return;
    setOrdersImporting(true);
    try {
      const newOrders = ordersPreview.matched.filter((m: any) => !m.isDuplicate);
      const response = await apiRequest('POST', '/api/sentinel/order-levels/bulk-import', {
        orders: newOrders.map((m: any) => ({
          tradeId: m.trade.id,
          levelType: m.order.levelType,
          price: m.order.price,
          quantity: m.order.quantity,
          orderNumber: m.order.orderNumber,
        })),
      });
      const result = await response.json();
      toast({ title: `Imported ${result.imported} order levels (${result.skippedDuplicates} duplicates skipped)` });
      setOrdersPreview(null);
      setOrdersCsvContent(null);
      setOrdersFile(null);
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/dashboard'] });
    } catch (error: any) {
      toast({ title: "Failed to import orders", description: error.message, variant: "destructive" });
    } finally {
      setOrdersImporting(false);
    }
  };

  const brokerGuide = getBrokerImportGuide(selectedBrokerId);

  return (
    <div 
      className="min-h-screen sentinel-page"
      style={pageShellStyle as React.CSSProperties}
    >
      {/* Watermark applied via background-image on container */}
      <SentinelHeader />
      
      <main className="container mx-auto p-4 max-w-6xl">
        <div className="mb-6">
          <h1 className="font-bold" style={{ color: cssVariables.textColorTitle, fontSize: cssVariables.fontSizeTitle }}>Import Trades</h1>
          <p style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Upload CSV files from your brokerage to import trade history</p>
        </div>

        <Tabs value={activeTab} onValueChange={(tab) => {
          setActiveTab(tab);
          if (tab === 'history') {
            queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
            queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/all-orphans'] });
          }
        }}>
          <TabsList className="grid w-full max-w-lg grid-cols-5">
            <TabsTrigger value="upload" className="gap-2" data-testid="tab-upload">
              <Upload className="h-4 w-4" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2" data-testid="tab-history">
              <History className="h-4 w-4" />
              History
            </TabsTrigger>
            <TabsTrigger value="trades" className="gap-2" data-testid="tab-trades">
              <FileSpreadsheet className="h-4 w-4" />
              Trades
            </TabsTrigger>
            <TabsTrigger value="orphans" className="gap-2" data-testid="tab-orphans">
              <AlertTriangle className="h-4 w-4" />
              Orphans
              {(allOrphansData?.orphans?.length || 0) > 0 && (
                <Badge variant="secondary" className="ml-1">{allOrphansData?.orphans?.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2" data-testid="tab-orders">
              <ShieldAlert className="h-4 w-4" />
              Orders
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
              <div className="space-y-6 min-w-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2" style={{ color: cssVariables.textColorSection, fontSize: cssVariables.fontSizeSection }}>
                  <Building2 className="h-5 w-5" />
                  1. Select Broker
                </CardTitle>
                <CardDescription>Choose your brokerage platform</CardDescription>
              </CardHeader>
              <CardContent>
                <Select
                  value={selectedBrokerId}
                  onValueChange={(value) => {
                    setSelectedBrokerId(value);
                    setBundleFiles([]);
                    setBundleResult(null);
                  }}
                >
                  <SelectTrigger className="w-full max-w-xs" data-testid="select-broker">
                    <SelectValue placeholder="Select broker" />
                  </SelectTrigger>
                  <SelectContent>
                    {BROKER_OPTIONS.map(broker => (
                      <SelectItem key={broker.value} value={broker.value}>
                        {broker.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2" style={{ color: cssVariables.textColorSection, fontSize: cssVariables.fontSizeSection }}>
                  <Clock className="h-5 w-5" />
                  2. Timestamp Override (Optional)
                </CardTitle>
                <CardDescription>
                  Override execution time for all trades (useful when CSV lacks timestamps)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <Input
                    type="time"
                    value={timestampOverride}
                    onChange={(e) => setTimestampOverride(e.target.value)}
                    className="w-40"
                    placeholder="HH:MM"
                    data-testid="input-timestamp-override"
                  />
                  {timestampOverride && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="gap-1">
                        <Clock className="h-3 w-3" />
                        {timestampOverride}
                      </Badge>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setTimestampOverride("")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  {!timestampOverride && (
                    <span style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
                      Leave empty to use timestamps from CSV (if available)
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2" style={{ color: cssVariables.textColorSection, fontSize: cssVariables.fontSizeSection }}>
                  <FileSpreadsheet className="h-5 w-5" />
                  3. Upload CSV File
                </CardTitle>
                <CardDescription>
                  {selectedBrokerId === "SCHWAB"
                    ? "Drop Schwab Transactions or Realized Gain/Loss CSV (+ both if you have them). The engine sorts them out."
                    : "Drop all Fidelity CSVs together — Activity, Closed Positions, Orders. The engine sorts them out."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div 
                  className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  onClick={() => document.getElementById('file-input')?.click()}
                  data-testid="dropzone-upload"
                >
                  <input
                    type="file"
                    id="file-input"
                    className="hidden"
                    accept=".csv"
                    multiple
                    onChange={handleFileSelect}
                  />
                  <div className="space-y-2">
                    <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">
                      Drop Schwab or Fidelity CSVs here — broker auto-detected per file
                    </p>
                    <p className="text-xs text-muted-foreground">Or click to browse — multiple files OK</p>
                  </div>
                </div>

                {bundleFiles.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Detected files</div>
                    {bundleFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
                          <span className="truncate">{file.fileName}</span>
                          <Badge variant="outline" className="shrink-0">
                            {file.brokerId === "SCHWAB" ? "Schwab" : "Fidelity"}
                          </Badge>
                          <Badge
                            variant={
                              file.type === primaryImportFileType(file.brokerId) ? "default" : "outline"
                            }
                            className="shrink-0"
                          >
                            {IMPORT_BUNDLE_LABELS[file.type]}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => removeBundleFile(file.id)}
                          disabled={smartImportRunning}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {bundleFiles.length > 0 && (
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      onClick={() => void runSmartImport()}
                      disabled={smartImportRunning || !bundleHasAnyTradeFiles(bundleFiles)}
                      data-testid="button-smart-import"
                      className="w-full max-w-sm"
                    >
                      {smartImportRunning ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {smartImportStep || "Running…"}</>
                      ) : (
                        <><Check className="h-4 w-4 mr-2" /> Run Smart Import</>
                      )}
                    </Button>
                    <span style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
                      {!bundleHasAnyTradeFiles(bundleFiles)
                        ? "Add Schwab Transactions/RGL or Fidelity Activity CSV to enable Smart Import."
                        : "Duplicates on Trading Cards and false orphan sells are auto-cleaned. Then Promote in History."}
                    </span>
                  </div>
                )}

                {bundleResult && (
                  <div className="rounded-md border bg-muted/50 p-3 space-y-1 text-sm" data-testid="bundle-import-result">
                    <div className="font-medium">Last import</div>
                    <div>{bundleResult.tradesImported} new trade(s) imported</div>
                    {bundleResult.skippedAlreadyImported > 0 && (
                      <div className="text-muted-foreground">
                        {bundleResult.skippedAlreadyImported} overlap skipped (already on file)
                      </div>
                    )}
                    {bundleResult.orphansResolved > 0 && (
                      <div className="text-rs-green">{bundleResult.orphansResolved} orphans auto-resolved</div>
                    )}
                    {bundleResult.promoted && (
                      <div className="text-rs-green">{bundleResult.cardsCreated} trading cards created</div>
                    )}
                    {bundleResult.ordersImported > 0 && (
                      <div>{bundleResult.ordersImported} order levels synced</div>
                    )}
                    {bundleResult.warnings.map((w, i) => (
                      <div key={i} className="text-rs-yellow text-xs">• {w}</div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {previewData && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between" style={{ color: cssVariables.textColorSection, fontSize: cssVariables.fontSizeSection }}>
                    <span className="flex items-center gap-2">
                      <Check className="h-5 w-5 text-rs-green" />
                      4. Preview Results
                    </span>
                    <Badge variant={previewData.batch.status === "COMPLETE" ? "default" : "destructive"}>
                      {previewData.batch.status}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {previewData.trades.length} new trade(s) to import from {previewData.batch.brokerId}
                    {(previewData.skippedAlreadyImported ?? 0) > 0 && (
                      <span className="ml-2 text-muted-foreground">
                        ({previewData.skippedAlreadyImported} overlap already on file — will skip)
                      </span>
                    )}
                    {previewData.dateRange && (
                      <span className="ml-2 font-medium">
                        ({previewData.dateRange.earliest} to {previewData.dateRange.latest})
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-4 flex-wrap">
                    <div className="bg-muted p-3 rounded-lg">
                      <div style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>New Trades</div>
                      <div className="text-2xl font-bold text-rs-green">{previewData.trades.length}</div>
                    </div>
                    {(previewData.skippedAlreadyImported ?? 0) > 0 && (
                      <div className="bg-muted p-3 rounded-lg">
                        <div style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Already on file</div>
                        <div className="text-2xl font-bold text-slate-400">{previewData.skippedAlreadyImported}</div>
                      </div>
                    )}
                    <div className="bg-muted p-3 rounded-lg">
                      <div style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>CSV rows skipped</div>
                      <div className="text-2xl font-bold text-rs-yellow">{previewData.batch.skippedRows.length}</div>
                    </div>
                    <div className="bg-muted p-3 rounded-lg">
                      <div style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Total Value</div>
                      <div className="text-2xl font-bold">
                        {formatCurrency(previewData.trades.reduce((sum, t) => sum + t.totalAmount, 0))}
                      </div>
                    </div>
                    {previewData.dateRange && (
                      <div className="bg-muted p-3 rounded-lg">
                        <div style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Date Range</div>
                        <div className="text-lg font-bold">{previewData.dateRange.earliest} to {previewData.dateRange.latest}</div>
                      </div>
                    )}
                  </div>

                  {previewData.batch.skippedRows.length > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setShowSkippedDialog(true)}
                      data-testid="button-view-skipped"
                    >
                      <AlertCircle className="h-4 w-4 mr-2" />
                      View Skipped Rows
                    </Button>
                  )}

                  <ScrollArea className="h-80 border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Direction</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Fill</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.trades.slice(0, 50).map((trade, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm">{trade.tradeDate}</TableCell>
                            <TableCell className="font-mono font-medium">{trade.ticker}</TableCell>
                            <TableCell>
                              <Badge variant={trade.direction === "BUY" ? "default" : "secondary"}>
                                {trade.direction === "BUY" ? (
                                  <ArrowUpRight className="h-3 w-3 mr-1" />
                                ) : (
                                  <ArrowDownRight className="h-3 w-3 mr-1" />
                                )}
                                {trade.direction}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{trade.quantity.toFixed(3)}</TableCell>
                            <TableCell className="text-right">${trade.price.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(trade.totalAmount)}</TableCell>
                            <TableCell>
                              {trade.isFill && <Badge variant="outline" className="text-xs">Fill</Badge>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {previewData.trades.length > 50 && (
                      <div className="p-2 text-center text-sm text-muted-foreground">
                        Showing first 50 of {previewData.trades.length} trades
                      </div>
                    )}
                  </ScrollArea>

                  <div className="flex gap-3 justify-end">
                    <Button 
                      variant="outline" 
                      onClick={() => { setPreviewData(null); setCsvContent(null); setFileName(null); }}
                      data-testid="button-cancel-import"
                    >
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleConfirm} 
                      disabled={confirmMutation.isPending || previewData.trades.length === 0}
                      data-testid="button-confirm-import"
                    >
                      {confirmMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...</>
                      ) : previewData.trades.length === 0 ? (
                        <>Nothing new to import</>
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Import {previewData.trades.length} New Trade{previewData.trades.length === 1 ? "" : "s"}
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
              </div>

              {brokerGuide && (
                <aside className="lg:sticky lg:top-4 lg:self-start">
                  <Card data-testid="broker-import-guide">
                    <CardHeader>
                      <CardTitle style={{ color: cssVariables.textColorSection, fontSize: cssVariables.fontSizeSection }}>
                        {brokerGuide.label} import checklist
                      </CardTitle>
                      <CardDescription>{brokerGuide.summary}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {!brokerGuide.supported && (
                        <div className="rounded-md border border-rs-yellow/40 bg-rs-yellow/10 px-3 py-2 text-sm text-rs-yellow">
                          {brokerGuide.label} import is not enabled yet.
                        </div>
                      )}

                      {brokerGuide.steps.map((step) => (
                        <div key={step.order} className="space-y-2 border-b border-border/60 pb-4 last:border-0 last:pb-0">
                          <div className="flex items-start gap-2">
                            <span
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                              aria-hidden
                            >
                              {step.order}
                            </span>
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold">
                                  {step.fidelityExport ?? "Duplicates & Promote"}
                                </span>
                                <Badge variant={step.required ? "default" : "outline"} className="text-xs">
                                  {step.required ? "Required" : "If needed"}
                                </Badge>
                              </div>

                              {step.downloadedAs && (
                                <div className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs break-all">
                                  {step.downloadedAs}
                                </div>
                              )}

                              {step.firstLine && (
                                <div style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
                                  File starts with: {step.firstLine}
                                </div>
                              )}

                              {step.headerRow && (
                                <div style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }} className="break-all">
                                  Header: {step.headerRow}
                                </div>
                              )}

                              <div className="text-sm">
                                <span className="font-medium">{step.tab} — </span>
                                {step.action}
                              </div>

                              {step.neverDo && (
                                <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                  <span>{step.neverDo}</span>
                                </div>
                              )}

                              {step.skipWhen && (
                                <div style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
                                  Skip when: {step.skipWhen}
                                </div>
                              )}

                              {step.problems.length > 0 && (
                                <div className="space-y-1 pt-0.5">
                                  <div className="text-xs font-medium text-rs-yellow">If problems</div>
                                  <ul className="space-y-1">
                                    {step.problems.map((problem, i) => (
                                      <li
                                        key={i}
                                        className="flex gap-1.5 text-xs"
                                        style={{ color: cssVariables.textColorSmall }}
                                      >
                                        <span className="shrink-0 text-rs-yellow">•</span>
                                        <span>{problem}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </aside>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <CardTitle style={{ color: cssVariables.textColorSection, fontSize: cssVariables.fontSizeSection }}>Import History</CardTitle>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => redetectOrphansMutation.mutate()}
                      disabled={!batches || batches.length === 0 || redetectOrphansMutation.isPending}
                      data-testid="button-redetect-orphans"
                      title="Re-detect Orphans"
                    >
                      {redetectOrphansMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => setShowResetConfirmDialog(true)}
                      disabled={!batches || batches.length === 0 || resetAndRedetectMutation.isPending}
                      data-testid="button-reset-and-redetect"
                      title="Reset & Re-detect"
                    >
                      {resetAndRedetectMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldAlert className="h-4 w-4" />
                      )}
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => cleanupDuplicatesMutation.mutate()}
                      disabled={cleanupDuplicatesMutation.isPending}
                      data-testid="button-cleanup-duplicates"
                      title="Cleanup Duplicates"
                    >
                      {cleanupDuplicatesMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <AlertCircle className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                {(() => {
                  const hasBatches = batches && batches.length > 0;
                  const hasImportedTrades = allTrades && allTrades.length > 0;
                  const step1Complete = !!hasBatches;
                  const step2Complete = step1Complete && !hasPendingDuplicates;
                  const step3Complete = step2Complete && !hasPendingOrphans;

                  const step1Disabled = hasPendingDuplicates;
                  const step2Disabled = !step1Complete;
                  const step3Disabled = !step2Complete;

                  return (
                    <div className="mt-2 space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Button
                          variant={step1Disabled ? "ghost" : "outline"}
                          size="sm"
                          onClick={() => setActiveTab("upload")}
                          disabled={step1Disabled}
                          data-testid="button-step-import"
                          className={step1Disabled ? "opacity-40" : ""}
                        >
                          {step1Complete ? (
                            <CheckCircle2 className="h-4 w-4 mr-2 text-rs-green" />
                          ) : (
                            <Circle className="h-4 w-4 mr-2 text-muted-foreground" />
                          )}
                          1. Import
                        </Button>
                        <Button
                          variant={!step2Disabled && hasPendingDuplicates ? "outline" : "ghost"}
                          size="sm"
                          onClick={() => {
                            const firstDupBatch = batches?.find(b => (b.duplicatesCount || 0) > 0);
                            if (firstDupBatch) {
                              setSelectedDuplicateBatchId(firstDupBatch.batchId);
                              setShowDuplicateDialog(true);
                            }
                          }}
                          disabled={step2Disabled || !hasPendingDuplicates}
                          data-testid="button-step-resolve-duplicates"
                          className={step2Disabled ? "opacity-40" : step2Complete && !hasPendingDuplicates ? "opacity-60" : ""}
                        >
                          {step2Complete ? (
                            <CheckCircle2 className="h-4 w-4 mr-2 text-rs-green" />
                          ) : step2Disabled ? (
                            <Circle className="h-4 w-4 mr-2 text-muted-foreground" />
                          ) : (
                            <AlertCircle className="h-4 w-4 mr-2 text-rs-amber" />
                          )}
                          2. Resolve Duplicates
                          {hasPendingDuplicates && (
                            <Badge variant="secondary" className="ml-1">{totalPendingDuplicates}</Badge>
                          )}
                        </Button>
                        <Button
                          variant={!step3Disabled && hasPendingOrphans ? "outline" : "ghost"}
                          size="sm"
                          onClick={() => {
                            setOrphanResolutions({});
                            setCostBasisMap(null);
                            setCostBasisFileName("");
                            setCostBasisMatchCount(null);
                            setShowAllOrphansDialog(true);
                          }}
                          disabled={step3Disabled || !hasPendingOrphans}
                          data-testid="button-step-resolve-orphans"
                          className={step3Disabled ? "opacity-40" : step3Complete && !hasPendingOrphans ? "opacity-60" : ""}
                        >
                          {step3Complete ? (
                            <CheckCircle2 className="h-4 w-4 mr-2 text-rs-green" />
                          ) : step3Disabled ? (
                            <Circle className="h-4 w-4 mr-2 text-muted-foreground" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 mr-2 text-rs-yellow" />
                          )}
                          3. Resolve Orphans
                          {hasPendingOrphans && !step3Disabled && (
                            <Badge variant="secondary" className="ml-1">{totalPendingOrphans}</Badge>
                          )}
                        </Button>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        {unpromotedStats?.hasExistingCards ? (
                          <>
                            <Button 
                              variant="default" 
                              size="sm"
                              onClick={() => promoteToCardsMutation.mutate({})}
                              disabled={!hasImportedTrades || promoteToCardsMutation.isPending || (unpromotedStats?.unpromotedCount || 0) === 0}
                              data-testid="button-merge-new-trades"
                            >
                              {promoteToCardsMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <ArrowUpRight className="h-4 w-4 mr-2" />
                              )}
                              Merge New Trades
                              {(unpromotedStats?.unpromotedCount || 0) > 0 && (
                                <Badge variant="secondary" className="ml-1">{unpromotedStats?.unpromotedCount}</Badge>
                              )}
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => setShowRepromoteDialog(true)}
                              disabled={!hasImportedTrades || promoteToCardsMutation.isPending}
                              data-testid="button-repromote-to-cards"
                            >
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Re-promote (Clean)
                            </Button>
                          </>
                        ) : (
                          <Button 
                            variant="default" 
                            size="sm"
                            onClick={() => promoteToCardsMutation.mutate({})}
                            disabled={!hasImportedTrades || promoteToCardsMutation.isPending || !step3Complete}
                            data-testid="button-promote-to-cards"
                            className={!step3Complete ? "opacity-40" : ""}
                          >
                            {promoteToCardsMutation.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4 mr-2" />
                            )}
                            Promote to Trading Cards
                          </Button>
                        )}
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => setShowDeleteAllDialog(true)}
                          disabled={!hasBatches}
                          data-testid="button-delete-all"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete All
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </CardHeader>
              <CardContent>
                {promoteReport && (
                  <div className="mb-4 p-4 rounded-md border bg-card" data-testid="promote-report">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold">Promotion Report - Cost Basis Breakdown</h4>
                      <Button variant="ghost" size="icon" onClick={() => setPromoteReport(null)} data-testid="button-dismiss-report">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Cards using real imported cost basis:</span>{' '}
                        <span className="font-medium text-rs-green">{promoteReport.cardsUsingRealCostBasis}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cards using synthetic cost basis:</span>{' '}
                        <span className="font-medium text-rs-yellow">{promoteReport.cardsUsingSyntheticCostBasis}</span>
                      </div>
                    </div>
                    {promoteReport.totalSyntheticInjections > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-muted-foreground mb-2">
                          Synthetic cost basis is used when the original buy transaction was not in any imported CSV.
                          The cost basis you entered during orphan resolution is used instead.
                        </p>
                        <div className="space-y-1">
                          {promoteReport.syntheticByTicker?.map((s: any, i: number) => (
                            <div key={i} className="text-xs flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-rs-yellow border-rs-yellow/30">
                                {s.ticker}{s.account ? ` (${s.account})` : ''}
                              </Badge>
                              <span className="text-muted-foreground">
                                {s.syntheticShares} synthetic shares @ ${Number(s.costBasis).toFixed(2)} cost basis
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {promoteReport.totalSyntheticInjections === 0 && (
                      <p className="mt-2 text-xs text-rs-green">
                        All cards used real imported cost basis from your CSV files. No synthetic data needed.
                      </p>
                    )}
                  </div>
                )}
                {batchesLoading ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : batches && batches.length > 0 ? (
                  <div className="space-y-3">
                    {batches.map((batch) => {
                      const displayImportName = batch.importName || `FILE${batch.fileName.replace(/\.[^/.]+$/, "").slice(-4).toUpperCase()}`;
                      return (
                      <Card key={batch.batchId} className="hover-elevate">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                              <div>
                                <div className="flex items-center gap-2">
                                  {editingBatchId === batch.batchId ? (
                                    <div className="flex items-center gap-1">
                                      <Input
                                        value={editingImportName}
                                        onChange={(e) => setEditingImportName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveImportName();
                                          if (e.key === 'Escape') cancelEditingImportName();
                                        }}
                                        className="h-7 w-32 text-sm"
                                        maxLength={50}
                                        autoFocus
                                        data-testid={`input-import-name-${batch.batchId}`}
                                      />
                                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveImportName} disabled={renameBatchMutation.isPending}>
                                        <Check className="h-3 w-3 text-rs-green" />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelEditingImportName}>
                                        <X className="h-3 w-3 text-muted-foreground" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <>
                                      <Badge variant="secondary" className="font-medium" data-testid={`badge-import-name-${batch.batchId}`}>
                                        {displayImportName}
                                      </Badge>
                                      <Button 
                                        size="icon" 
                                        variant="ghost" 
                                        className="h-5 w-5" 
                                        onClick={() => startEditingImportName(batch)}
                                        data-testid={`button-edit-import-name-${batch.batchId}`}
                                      >
                                        <Edit3 className="h-3 w-3 text-muted-foreground" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">{batch.fileName}</div>
                                <div className="text-sm text-muted-foreground flex items-center gap-2">
                                  <Badge variant="outline">{batch.brokerId}</Badge>
                                  <span>{formatDate(batch.createdAt)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="text-lg font-bold text-rs-green">{batch.totalTradesImported}</div>
                                <div className="text-xs text-muted-foreground">trades imported</div>
                              </div>
                              {/* Duplicates shown FIRST - must be resolved before orphans */}
                              {(batch.duplicatesCount || 0) > 0 ? (
                                <Badge variant="outline" className="text-rs-amber border-rs-amber gap-1">
                                  {bulkProcessingBatchId === batch.batchId ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <AlertCircle className="h-3 w-3" />
                                  )}
                                  {bulkProcessingBatchId === batch.batchId 
                                    ? "Processing duplicates..." 
                                    : <>{batch.duplicatesCount} Duplicates <span className="text-white">(Step 1)</span></>
                                  }
                                </Badge>
                              ) : batch.status === "NEEDS_REVIEW" && (batch.orphanSellsCount || 0) > 0 ? (
                                <Badge variant="outline" className="text-rs-yellow border-rs-yellow gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {batch.orphanSellsCount} Orphans <span className="text-white">(Step 2)</span>
                                </Badge>
                              ) : (
                                <Badge variant={batch.status === "COMPLETE" ? "default" : "destructive"}>
                                  {batch.status}
                                </Badge>
                              )}
                              {batch.status === "NEEDS_REVIEW" && (batch.orphanSellsCount || 0) > 0 && (
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleReviewOrphans(batch.batchId)}
                                  className="text-rs-yellow border-rs-yellow/50"
                                  disabled={(batch.duplicatesCount || 0) > 0}
                                  title={(batch.duplicatesCount || 0) > 0 ? "Resolve duplicates first" : "Review orphan sells"}
                                  data-testid={`button-review-orphans-${batch.batchId}`}
                                >
                                  Review Orphans
                                </Button>
                              )}
                              {(batch.duplicatesCount || 0) > 0 && (
                                bulkProcessingBatchId === batch.batchId ? (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    disabled
                                    className="text-rs-amber border-rs-amber/50"
                                    data-testid={`button-review-duplicates-${batch.batchId}`}
                                  >
                                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                    Processing...
                                  </Button>
                                ) : (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => {
                                      setSelectedDuplicateBatchId(batch.batchId);
                                      setShowDuplicateDialog(true);
                                    }}
                                    className="text-rs-amber border-rs-amber/50"
                                    data-testid={`button-review-duplicates-${batch.batchId}`}
                                  >
                                    Review Duplicates
                                  </Button>
                                )
                              )}
                              {batch.status === "COMPLETE" && (batch.duplicatesCount || 0) === 0 && (
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => detectDuplicatesMutation.mutate(batch.batchId)}
                                  disabled={detectDuplicatesMutation.isPending}
                                  data-testid={`button-detect-duplicates-${batch.batchId}`}
                                >
                                  {detectDuplicatesMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                  ) : (
                                    <AlertCircle className="h-4 w-4 mr-1" />
                                  )}
                                  Check Duplicates
                                </Button>
                              )}
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => toggleBatchExpand(batch.batchId)}
                              >
                                {expandedBatches.has(batch.batchId) ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => deleteMutation.mutate(batch.batchId)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          
                          {expandedBatches.has(batch.batchId) && (
                            <div className="mt-4 pt-4 border-t">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div>
                                  <div className="text-muted-foreground">Batch ID</div>
                                  <div className="font-mono text-xs">{batch.batchId.slice(0, 8)}...</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground">File Type</div>
                                  <div>{batch.fileType}</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground">Rows Found</div>
                                  <div>{batch.totalTradesFound}</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground">Rows Skipped</div>
                                  <div>{batch.skippedRows?.length || 0}</div>
                                </div>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No imports yet</p>
                    <p className="text-sm">Upload a CSV file to get started</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trades" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>All Imported Trades</span>
                  <div className="flex items-center gap-2">
                    <Input 
                      placeholder="Filter by ticker..." 
                      value={tickerFilter}
                      onChange={(e) => setTickerFilter(e.target.value)}
                      className="w-48"
                      data-testid="input-filter-ticker"
                    />
                  </div>
                </CardTitle>
                <CardDescription>
                  {filteredTrades.length} trades from all imports
                </CardDescription>
              </CardHeader>
              <CardContent>
                {tradesLoading ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : filteredTrades.length > 0 ? (
                  <ScrollArea className="h-[600px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Direction</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                          <TableHead>Account</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTrades.map((trade) => (
                          <TableRow key={trade.id}>
                            <TableCell className="text-sm">{trade.tradeDate}</TableCell>
                            <TableCell className="font-mono font-medium">{trade.ticker}</TableCell>
                            <TableCell>
                              <Badge variant={trade.direction === "BUY" ? "default" : "secondary"}>
                                {trade.direction === "BUY" ? (
                                  <ArrowUpRight className="h-3 w-3 mr-1" />
                                ) : (
                                  <ArrowDownRight className="h-3 w-3 mr-1" />
                                )}
                                {trade.direction}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{trade.quantity.toFixed(3)}</TableCell>
                            <TableCell className="text-right">${trade.price.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(trade.totalAmount)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(trade.netAmount)}</TableCell>
                            <TableCell className="text-xs">{trade.accountType}</TableCell>
                            <TableCell>
                              <Badge variant={trade.status === "CONFIRMED" ? "outline" : "secondary"}>
                                {trade.status === "CONFIRMED" ? <Check className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                                {trade.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No trades imported yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card className="mt-6 border-destructive/30">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-destructive flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5" />
                    Danger Zone
                  </CardTitle>
                  <CardDescription>
                    Delete all promoted Trading Cards to start fresh. Import history is preserved.
                  </CardDescription>
                </div>
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={() => setShowDeleteCardsDialog(true)}
                  data-testid="button-delete-all-cards"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete All Trading Cards
                </Button>
              </CardHeader>
            </Card>
          </TabsContent>

          <TabsContent value="orphans" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Orphan Sells Manager
                </CardTitle>
                <CardDescription>
                  Sells without matching buys in your imported data. Add cost basis and open date to resolve them, then merge into your Trading Cards.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by ticker..."
                      value={orphanTickerSearch}
                      onChange={(e) => setOrphanTickerSearch(e.target.value.toUpperCase())}
                      className="pl-9"
                      data-testid="input-orphan-ticker-search"
                    />
                  </div>
                  <Select value={orphanStatusFilter} onValueChange={(v) => setOrphanStatusFilter(v as any)}>
                    <SelectTrigger className="w-[140px]" data-testid="select-orphan-status-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="muted">Muted</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={orphanSortField} onValueChange={(v) => setOrphanSortField(v as any)}>
                    <SelectTrigger className="w-[140px]" data-testid="select-orphan-sort">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tradeDate">Trade Date</SelectItem>
                      <SelectItem value="importedAt">Import Date</SelectItem>
                      <SelectItem value="ticker">Ticker</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setOrphanSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    data-testid="button-orphan-sort-dir"
                  >
                    {orphanSortDir === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                  <div className="flex items-center gap-2 ml-auto text-sm text-muted-foreground">
                    {allOrphansData && (
                      <>
                        <span>{allOrphansData.pendingCount} pending</span>
                        <span className="text-muted-foreground/50">|</span>
                        <span>{allOrphansData.resolvedCount} resolved</span>
                        <span className="text-muted-foreground/50">|</span>
                        <span>{allOrphansData.mutedCount} muted</span>
                      </>
                    )}
                  </div>
                </div>

                {allOrphansLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : !allOrphansData?.orphans?.length ? (
                  <div className="text-center py-12 text-muted-foreground" data-testid="text-no-orphans">
                    No orphan sells found
                  </div>
                ) : (() => {
                  let filtered = allOrphansData.orphans.filter(o => {
                    if (orphanTickerSearch && !o.ticker.includes(orphanTickerSearch)) return false;
                    if (orphanStatusFilter !== 'all' && o.orphanStatus !== orphanStatusFilter) return false;
                    return true;
                  });
                  
                  filtered.sort((a, b) => {
                    let cmp = 0;
                    if (orphanSortField === 'tradeDate') {
                      cmp = (a.tradeDate || '').localeCompare(b.tradeDate || '');
                    } else if (orphanSortField === 'importedAt') {
                      cmp = (a.importedAt || '').localeCompare(b.importedAt || '');
                    } else if (orphanSortField === 'ticker') {
                      cmp = a.ticker.localeCompare(b.ticker);
                    }
                    return orphanSortDir === 'asc' ? cmp : -cmp;
                  });
                  
                  if (filtered.length === 0) {
                    return (
                      <div className="text-center py-8 text-muted-foreground">
                        No orphans match your filters
                      </div>
                    );
                  }
                  
                  return (
                    <ScrollArea className="max-h-[600px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[80px]">Ticker</TableHead>
                            <TableHead className="w-[80px]">Side</TableHead>
                            <TableHead className="w-[60px]">Qty</TableHead>
                            <TableHead className="w-[80px]">Price</TableHead>
                            <TableHead className="w-[100px]">Trade Date</TableHead>
                            <TableHead className="w-[100px]">Import Date</TableHead>
                            <TableHead className="w-[80px]">Status</TableHead>
                            <TableHead className="w-[100px]">Cost Basis</TableHead>
                            <TableHead className="w-[110px]">Open Date</TableHead>
                            <TableHead className="w-[100px]">Account</TableHead>
                            <TableHead className="w-[140px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((orphan) => {
                            const isEditing = orphanEditingId === orphan.tradeId;
                            const isPending = orphan.orphanStatus === 'pending';
                            const isResolved = orphan.orphanStatus === 'resolved';
                            const isMuted = orphan.orphanStatus === 'muted';
                            
                            return (
                              <TableRow key={orphan.tradeId} data-testid={`row-orphan-${orphan.tradeId}`}>
                                <TableCell className="font-mono font-medium">{orphan.ticker}</TableCell>
                                <TableCell>
                                  <Badge variant={orphan.direction === 'SELL' ? 'destructive' : 'default'}>
                                    {orphan.direction}
                                  </Badge>
                                </TableCell>
                                <TableCell>{orphan.quantity}</TableCell>
                                <TableCell>${orphan.price.toFixed(2)}</TableCell>
                                <TableCell className="text-sm">{orphan.tradeDate}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {new Date(orphan.importedAt).toLocaleDateString()}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={isResolved ? 'default' : isMuted ? 'secondary' : 'outline'}>
                                    {orphan.orphanStatus || 'pending'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={orphanEditCostBasis}
                                      onChange={(e) => setOrphanEditCostBasis(e.target.value)}
                                      placeholder="Cost basis"
                                      className="w-[90px]"
                                      data-testid="input-orphan-cost-basis"
                                    />
                                  ) : orphan.manualCostBasis != null ? (
                                    <span className="text-rs-green">${orphan.manualCostBasis.toFixed(2)}</span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    <Input
                                      type="date"
                                      value={orphanEditOpenDate}
                                      onChange={(e) => setOrphanEditOpenDate(e.target.value)}
                                      className="w-[120px]"
                                      data-testid="input-orphan-open-date"
                                    />
                                  ) : orphan.manualOpenDate ? (
                                    <span className="text-sm">{orphan.manualOpenDate}</span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {orphan.accountName || '-'}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    {isEditing ? (
                                      <>
                                        <Button
                                          variant="default"
                                          size="sm"
                                          onClick={() => {
                                            if (!orphanEditCostBasis || !orphanEditOpenDate) {
                                              toast({ title: "Missing Info", description: "Enter both cost basis and open date", variant: "destructive" });
                                              return;
                                            }
                                            resolveOrphanMutation.mutate({
                                              tradeId: orphan.tradeId,
                                              action: 'resolve',
                                              costBasis: parseFloat(orphanEditCostBasis),
                                              openDate: orphanEditOpenDate,
                                            }, {
                                              onSuccess: () => {
                                                setOrphanEditingId(null);
                                                setOrphanEditCostBasis("");
                                                setOrphanEditOpenDate("");
                                              }
                                            });
                                          }}
                                          disabled={resolveOrphanMutation.isPending}
                                          data-testid="button-orphan-save"
                                        >
                                          {resolveOrphanMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            setOrphanEditingId(null);
                                            setOrphanEditCostBasis("");
                                            setOrphanEditOpenDate("");
                                          }}
                                          data-testid="button-orphan-cancel"
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </>
                                    ) : (
                                      <>
                                        {(isPending || isMuted) && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                              setOrphanEditingId(orphan.tradeId);
                                              setOrphanEditCostBasis(orphan.manualCostBasis?.toString() || '');
                                              setOrphanEditOpenDate(orphan.manualOpenDate || '');
                                            }}
                                            data-testid="button-orphan-edit"
                                          >
                                            <Edit3 className="h-3 w-3" />
                                          </Button>
                                        )}
                                        {isPending && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => resolveOrphanMutation.mutate({ tradeId: orphan.tradeId, action: 'mute' })}
                                            disabled={resolveOrphanMutation.isPending}
                                            data-testid="button-orphan-mute"
                                          >
                                            <VolumeX className="h-3 w-3" />
                                          </Button>
                                        )}
                                        {isMuted && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => resolveOrphanMutation.mutate({ tradeId: orphan.tradeId, action: 'resolve', costBasis: orphan.manualCostBasis || orphan.price, openDate: orphan.manualOpenDate || orphan.tradeDate })}
                                            disabled={resolveOrphanMutation.isPending}
                                            data-testid="button-orphan-unmute"
                                          >
                                            <Volume2 className="h-3 w-3" />
                                          </Button>
                                        )}
                                        {(isPending || isMuted) && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => resolveOrphanMutation.mutate({ tradeId: orphan.tradeId, action: 'delete' })}
                                            disabled={resolveOrphanMutation.isPending}
                                            data-testid="button-orphan-delete"
                                          >
                                            <Trash2 className="h-3 w-3 text-destructive" />
                                          </Button>
                                        )}
                                        {isResolved && (
                                          <span className="text-xs text-rs-green flex items-center gap-1">
                                            <CheckCircle2 className="h-3 w-3" /> Ready
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5" />
                  Import Broker Orders
                </CardTitle>
                <CardDescription>
                  Upload your broker's open orders file to sync stops and profit targets
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div 
                  className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => document.getElementById('orders-file-input')?.click()}
                  data-testid="dropzone-orders-upload"
                >
                  <input
                    type="file"
                    id="orders-file-input"
                    className="hidden"
                    accept=".csv"
                    onChange={handleOrdersFileSelect}
                    data-testid="input-orders-file"
                  />
                  {ordersFile ? (
                    <div className="space-y-2">
                      <FileSpreadsheet className="h-12 w-12 mx-auto text-primary" />
                      <p className="text-lg font-medium" data-testid="text-orders-filename">{ordersFile.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {ordersCsvContent ? `${ordersCsvContent.split('\n').length} lines` : 'Reading...'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                      <p className="text-muted-foreground">Drop orders CSV file here or click to browse</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="orders-default-account">Default Account Name</Label>
                  <Input
                    id="orders-default-account"
                    placeholder="e.g. Individual Brokerage"
                    value={ordersDefaultAccount}
                    onChange={(e) => setOrdersDefaultAccount(e.target.value)}
                    data-testid="input-orders-default-account"
                  />
                  <p className="text-xs text-muted-foreground">
                    Specify if the CSV does not contain account info
                  </p>
                </div>

                <div className="flex justify-center">
                  <Button
                    onClick={handleParseOrders}
                    disabled={!ordersCsvContent}
                    data-testid="button-parse-orders"
                  >
                    {ordersPreview === undefined ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Parsing...</>
                    ) : (
                      <><ShieldAlert className="h-4 w-4 mr-2" /> Parse Orders</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {ordersPreview && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2" data-testid="text-orders-preview-title">
                    <ShieldAlert className="h-5 w-5" />
                    Orders Preview
                    <Badge variant="outline" className="ml-2">
                      {ordersPreview.matched?.length || 0} matched, {ordersPreview.unmatched?.length || 0} unmatched
                    </Badge>
                  </CardTitle>
                  {!ordersPreview.hasAccountInfo && (
                    <div className="flex items-center gap-2 text-sm text-rs-yellow mt-2" data-testid="text-orders-no-account-warning">
                      <AlertTriangle className="h-4 w-4" />
                      No account info detected in CSV. Orders matched by ticker only.
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead>Account</TableHead>
                          <TableHead>Matched Trade</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ordersPreview.matched?.map((m: any, i: number) => (
                          <TableRow key={`matched-${i}`} data-testid={`row-matched-order-${i}`}>
                            <TableCell className="font-mono font-medium">{m.order.symbol}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={m.order.levelType === 'STOP' ? 'border-rs-red text-rs-red' : 'border-rs-green text-rs-green'}
                              >
                                {m.order.levelType === 'STOP' ? 'STOP' : 'TARGET'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">${Number(m.order.price).toFixed(2)}</TableCell>
                            <TableCell className="text-right">{m.order.quantity}</TableCell>
                            <TableCell className="text-xs">{m.order.accountName || '—'}</TableCell>
                            <TableCell className="text-xs">
                              {m.trade.symbol} <span className="text-muted-foreground">#{m.trade.id}</span>
                            </TableCell>
                            <TableCell>
                              {m.isDuplicate ? (
                                <Badge variant="secondary" data-testid={`badge-duplicate-${i}`}>Duplicate</Badge>
                              ) : (
                                <Badge variant="default" data-testid={`badge-new-${i}`}>New</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {ordersPreview.unmatched?.map((u: any, i: number) => (
                          <TableRow key={`unmatched-${i}`} className="opacity-70" data-testid={`row-unmatched-order-${i}`}>
                            <TableCell className="font-mono font-medium">{u.symbol}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={u.levelType === 'STOP' ? 'border-rs-red text-rs-red' : 'border-rs-green text-rs-green'}
                              >
                                {u.levelType === 'STOP' ? 'STOP' : 'TARGET'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">${Number(u.price).toFixed(2)}</TableCell>
                            <TableCell className="text-right">{u.quantity}</TableCell>
                            <TableCell className="text-xs">{u.accountName || '—'}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">No match</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="border-rs-yellow text-rs-yellow" data-testid={`badge-unmatched-${i}`}>Unmatched</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>

                  <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm text-muted-foreground" data-testid="text-orders-summary">
                      {ordersPreview.matched?.filter((m: any) => !m.isDuplicate).length || 0} new orders to import, {ordersPreview.matched?.filter((m: any) => m.isDuplicate).length || 0} duplicates skipped, {ordersPreview.unmatched?.length || 0} unmatched{ordersPreview.skipped > 0 ? `, ${ordersPreview.skipped} cancelled/expired/filled filtered out` : ''}
                    </p>
                    <Button
                      onClick={handleImportOrders}
                      disabled={ordersImporting || (ordersPreview.matched?.filter((m: any) => !m.isDuplicate).length || 0) === 0}
                      data-testid="button-import-orders"
                    >
                      {ordersImporting ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...</>
                      ) : (
                        <><Check className="h-4 w-4 mr-2" /> Import Orders</>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={showSkippedDialog} onOpenChange={setShowSkippedDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Skipped Rows</DialogTitle>
            <DialogDescription>
              These rows were skipped during parsing (non-trade entries, headers, etc.)
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewData?.batch.skippedRows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.rowIndex + 1}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.reason}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-xs">
                      {row.rawData.slice(0, 100)}...
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
          <DialogFooter>
            <Button onClick={() => setShowSkippedDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteAllDialog} onOpenChange={(open) => {
        setShowDeleteAllDialog(open);
        if (!open) setDeleteConfirmText("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Delete All Imported Trades
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete all {allTrades?.length || 0} imported trades and {batches?.length || 0} import batches.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-2">
              Type <span className="font-mono font-bold text-foreground">DELETE</span> to confirm:
            </p>
            <Input 
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="font-mono"
              data-testid="input-delete-confirm"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowDeleteAllDialog(false);
                setDeleteConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDeleteAll}
              disabled={deleteConfirmText !== "DELETE" || deleteAllMutation.isPending}
              data-testid="button-confirm-delete-all"
            >
              {deleteAllMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting...</>
              ) : (
                <>Delete All Trades</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteCardsDialog} onOpenChange={(open) => {
        setShowDeleteCardsDialog(open);
        if (!open) setDeleteCardsConfirmText("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Delete All Trading Cards
            </DialogTitle>
            <DialogDescription>
              This will permanently delete all your Trading Cards along with their evaluations, events, labels, and order levels. Your import history will be preserved so you can re-promote.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-2">
              Type <span className="font-mono font-bold text-foreground">DELETE</span> to confirm:
            </p>
            <Input 
              value={deleteCardsConfirmText}
              onChange={(e) => setDeleteCardsConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="font-mono"
              data-testid="input-delete-cards-confirm"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowDeleteCardsDialog(false);
                setDeleteCardsConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => deleteAllCardsMutation.mutate()}
              disabled={deleteCardsConfirmText !== "DELETE" || deleteAllCardsMutation.isPending}
              data-testid="button-confirm-delete-cards"
            >
              {deleteAllCardsMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting...</>
              ) : (
                <>Delete All Trading Cards</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showResetConfirmDialog} onOpenChange={setShowResetConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Reset & Re-detect
            </DialogTitle>
            <DialogDescription>
              This will delete all Trading Cards created from imports and reset all orphan statuses.
              The orphan detection will be re-run with corrected FIFO logic (buys processed before sells on the same date).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <p className="text-sm text-muted-foreground">This action will:</p>
            <ul className="text-sm list-disc pl-5 space-y-1">
              <li>Delete all Trading Cards created from imports</li>
              <li>Reset all muted/resolved orphan statuses</li>
              <li>Re-run orphan detection with fixed order</li>
            </ul>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowResetConfirmDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => {
                setShowResetConfirmDialog(false);
                resetAndRedetectMutation.mutate();
              }}
              disabled={resetAndRedetectMutation.isPending}
              data-testid="button-confirm-reset"
            >
              {resetAndRedetectMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Resetting...</>
              ) : (
                <>Confirm Reset</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRepromoteDialog} onOpenChange={setShowRepromoteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Re-promote Trading Cards
            </DialogTitle>
            <DialogDescription>
              This will delete all existing import-created Trading Cards and rebuild them fresh from your imported transactions.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <p className="text-sm text-muted-foreground">This action will:</p>
            <ul className="text-sm list-disc pl-5 space-y-1">
              <li>Remove all Trading Cards created from imports</li>
              <li>Remove associated evaluations, labels, events, and order levels</li>
              <li>Re-create cards from your imported transactions with correct FIFO matching</li>
            </ul>
            <p className="text-sm text-muted-foreground mt-2">Hand-entered trades will not be affected.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowRepromoteDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                setShowRepromoteDialog(false);
                promoteToCardsMutation.mutate({ clean: true });
              }}
              disabled={promoteToCardsMutation.isPending}
              data-testid="button-confirm-repromote"
            >
              {promoteToCardsMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Re-promoting...</>
              ) : (
                <>Confirm Re-promote</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showOrphanDialog} onOpenChange={(open) => {
        setShowOrphanDialog(open);
        if (!open) {
          setSelectedOrphanBatchId(null);
          setOrphanResolutions({});
          setCostBasisMap(null);
          setCostBasisFileName("");
          setCostBasisMatchCount(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rs-yellow">
              <AlertTriangle className="h-5 w-5" />
              Missing Cost Basis - Orphan Sells
            </DialogTitle>
            <DialogDescription>
              These sell transactions have no matching buy order in the imported data. 
              This can happen when the buy was placed before the export period or in a different account.
              You can either add the original purchase info or delete the orphan sell.
            </DialogDescription>
          </DialogHeader>
          
          {orphanSells && orphanSells.filter(o => o.orphanStatus !== 'resolved').length > 0 && (
            <div className="flex items-center justify-between py-2 border-b">
              <div className="text-sm text-muted-foreground">
                {orphanSells.filter(o => o.orphanStatus === 'pending').length} pending, {orphanSells.filter(o => o.orphanStatus === 'muted').length} muted
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkOrphanMutation.mutate('mute_all')}
                  disabled={bulkOrphanMutation.isPending || orphanSells.filter(o => o.orphanStatus === 'pending').length === 0}
                  data-testid="button-mute-all-orphans"
                >
                  <VolumeX className="h-4 w-4 mr-1" />
                  Mute All Pending
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => bulkOrphanMutation.mutate('delete_all')}
                  disabled={bulkOrphanMutation.isPending || orphanSells.filter(o => o.orphanStatus === 'pending').length === 0}
                  data-testid="button-delete-all-orphans"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete All Pending
                </Button>
              </div>
            </div>
          )}
          
          <ScrollArea className="flex-1 max-h-[50vh] pr-4">
            {orphansLoading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : orphanSells && orphanSells.length > 0 ? (
              <div className="space-y-4">
                {orphanSells.filter(o => o.orphanStatus !== 'resolved').map((orphan) => {
                  const isMuted = orphan.orphanStatus === 'muted';
                  const isRecentlyUnmuted = recentlyUnmutedIds.has(orphan.tradeId);
                  
                  return (
                  <Card key={orphan.tradeId} className={`transition-all duration-500 ${isMuted ? 'border-muted opacity-60' : isRecentlyUnmuted ? 'border-rs-green bg-rs-green/10 ring-2 ring-rs-green/30' : 'border-rs-yellow/30'}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="font-mono font-bold text-lg">{orphan.ticker}</div>
                          <Badge variant="secondary" className="gap-1">
                            <ArrowDownRight className="h-3 w-3" />
                            SELL
                          </Badge>
                          <span className="text-muted-foreground">
                            {orphan.quantity.toFixed(3)} shares @ ${orphan.price.toFixed(2)}
                          </span>
                          {isMuted && (
                            <Badge variant="outline" className="bg-muted text-muted-foreground">
                              <VolumeX className="h-3 w-3 mr-1" />
                              Muted
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Sold on {formatDate(orphan.tradeDate)}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="space-y-2">
                          <Label>Original Purchase Date</Label>
                          <Input
                            type="date"
                            value={orphanResolutions[orphan.tradeId]?.openDate || ''}
                            onChange={(e) => setOrphanResolutions(prev => ({
                              ...prev,
                              [orphan.tradeId]: { ...prev[orphan.tradeId], openDate: e.target.value, isSyntheticDate: false }
                            }))}
                            data-testid={`input-open-date-${orphan.tradeId}`}
                          />
                          {orphanResolutions[orphan.tradeId]?.isSyntheticDate && (
                            <p className="text-[11px] text-muted-foreground" data-testid={`text-synthetic-date-${orphan.tradeId}`}>
                              Synthetic Date due to missing information
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            Cost Basis per Share
                            {costBasisMap && costBasisMap[orphan.ticker.toUpperCase()] !== undefined && (
                              <Badge variant="outline" className="text-rs-green border-rs-green/50 text-[10px] py-0">
                                <Check className="h-3 w-3 mr-0.5" />
                                CSV
                              </Badge>
                            )}
                          </Label>
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              className="pl-9"
                              value={orphanResolutions[orphan.tradeId]?.costBasis || ''}
                              onChange={(e) => setOrphanResolutions(prev => ({
                                ...prev,
                                [orphan.tradeId]: { ...prev[orphan.tradeId], costBasis: e.target.value }
                              }))}
                              data-testid={`input-cost-basis-${orphan.tradeId}`}
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex justify-end gap-2">
                        <Button
                          variant={isMuted ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => handleResolveOrphan(orphan.tradeId, 'mute', orphan.orphanStatus)}
                          disabled={resolveOrphanMutation.isPending}
                          data-testid={`button-mute-orphan-${orphan.tradeId}`}
                        >
                          {isMuted ? (
                            <><Volume2 className="h-4 w-4 mr-1" /> Unmute</>
                          ) : (
                            <><VolumeX className="h-4 w-4 mr-1" /> Mute</>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => handleResolveOrphan(orphan.tradeId, 'delete')}
                          disabled={resolveOrphanMutation.isPending}
                          data-testid={`button-delete-orphan-${orphan.tradeId}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleResolveOrphan(orphan.tradeId, 'resolve')}
                          disabled={resolveOrphanMutation.isPending || isMuted}
                          data-testid={`button-resolve-orphan-${orphan.tradeId}`}
                        >
                          {resolveOrphanMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <><Check className="h-4 w-4 mr-1" /> Save Cost Basis</>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )})}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Check className="h-12 w-12 mx-auto mb-4 text-rs-green" />
                <p>All orphan sells have been resolved!</p>
              </div>
            )}
          </ScrollArea>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOrphanDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve All Orphans Dialog */}
      <Dialog open={showAllOrphansDialog} onOpenChange={(open) => {
        setShowAllOrphansDialog(open);
        if (!open) {
          setOrphanResolutions({});
          setCostBasisMap(null);
          setCostBasisFileName("");
          setCostBasisMatchCount(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rs-yellow" />
              Resolve All Orphans
            </DialogTitle>
            <div className="mt-1">
              <p className="text-base font-medium text-foreground" data-testid="text-orphan-progress">
                {allOrphansData ? `${allOrphansData.resolvedCount} of ${allOrphansData.totalOrphans} orphans resolved` : 'Loading...'}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Manually resolve, Mute or load another CSV
              </p>
            </div>
          </DialogHeader>
          
          <div className="flex items-center justify-between py-2 border-b">
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".csv"
                className="hidden"
                id="cost-basis-csv-upload-all"
                data-testid="input-cost-basis-csv-all"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCostBasisCsvUpload(file, allOrphanSells);
                  e.target.value = '';
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('cost-basis-csv-upload-all')?.click()}
                data-testid="button-load-cost-basis-csv-all"
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                Load Cost Basis from CSV
              </Button>
              {costBasisMatchCount && (
                <span className="text-xs text-muted-foreground">
                  {costBasisFileName}: {costBasisMatchCount.matched}/{costBasisMatchCount.total} matched
                </span>
              )}
            </div>
          </div>
          
          {allOrphanSells && allOrphanSells.length > 0 && (() => {
            const matchedOrphans = allOrphanSells.filter(o => {
              const res = orphanResolutions[o.tradeId];
              return res?.costBasis && res?.openDate && (o.orphanStatus === 'pending' || o.orphanStatus === 'muted');
            });
            const matchedCount = matchedOrphans.length;
            
            return (
            <div className="flex items-center justify-between py-2 border-b flex-wrap gap-2">
              <div className="text-sm text-muted-foreground">
                {allOrphanSells.filter(o => o.orphanStatus === 'pending').length} pending, {allOrphanSells.filter(o => o.orphanStatus === 'muted').length} muted
                {matchedCount > 0 && (
                  <span className="text-rs-green ml-2 font-medium">{matchedCount} matched ready to save</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {matchedCount > 0 && (
                  <Button
                    size="sm"
                    onClick={() => {
                      const items = matchedOrphans
                        .map(o => ({
                          tradeId: o.tradeId,
                          costBasis: parseFloat(orphanResolutions[o.tradeId].costBasis),
                          openDate: orphanResolutions[o.tradeId].openDate,
                          isSyntheticDate: orphanResolutions[o.tradeId].isSyntheticDate === true,
                        }))
                        .filter(item => Number.isFinite(item.costBasis) && item.openDate);
                      if (items.length === 0) return;
                      bulkAllOrphansMutation.mutate({ action: 'resolve_all', items });
                    }}
                    disabled={bulkAllOrphansMutation.isPending}
                    data-testid="button-save-all-matched"
                  >
                    {bulkAllOrphansMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Check className="h-4 w-4 mr-1" />
                    )}
                    Save All Matched ({matchedCount})
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkAllOrphansMutation.mutate({ action: 'mute_all' })}
                  disabled={bulkAllOrphansMutation.isPending || allOrphanSells.filter(o => o.orphanStatus === 'pending').length === 0}
                  data-testid="button-mute-all-orphans-global"
                >
                  <VolumeX className="h-4 w-4 mr-1" />
                  Mute All Pending
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => bulkAllOrphansMutation.mutate({ action: 'delete_all' })}
                  disabled={bulkAllOrphansMutation.isPending || allOrphanSells.filter(o => o.orphanStatus === 'pending').length === 0}
                  data-testid="button-delete-all-orphans-global"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete All Pending
                </Button>
              </div>
            </div>
            );
          })()}
          
          <ScrollArea className="flex-1 max-h-[50vh] pr-4">
            {allOrphansLoading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : allOrphanSells && allOrphanSells.length > 0 ? (
              <div className="space-y-4">
                {allOrphanSells.map((orphan) => {
                  const isMuted = orphan.orphanStatus === 'muted';
                  const isRecentlyUnmuted = recentlyUnmutedIds.has(orphan.tradeId);
                  
                  return (
                  <Card key={orphan.tradeId} className={`transition-all duration-500 ${isMuted ? 'border-muted opacity-60' : isRecentlyUnmuted ? 'border-rs-green bg-rs-green/10 ring-2 ring-rs-green/30' : 'border-rs-yellow/30'}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="font-mono font-bold text-lg">{orphan.ticker}</div>
                          <Badge variant="secondary" className="gap-1">
                            <ArrowDownRight className="h-3 w-3" />
                            SELL
                          </Badge>
                          <span className="text-muted-foreground">
                            {orphan.quantity.toFixed(3)} shares @ ${orphan.price.toFixed(2)}
                          </span>
                          {isMuted && (
                            <Badge variant="outline" className="bg-muted text-muted-foreground">
                              <VolumeX className="h-3 w-3 mr-1" />
                              Muted
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Sold on {formatDate(orphan.tradeDate)}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="space-y-2">
                          <Label>Original Purchase Date</Label>
                          <Input
                            type="date"
                            value={orphanResolutions[orphan.tradeId]?.openDate || ''}
                            onChange={(e) => setOrphanResolutions(prev => ({
                              ...prev,
                              [orphan.tradeId]: { ...prev[orphan.tradeId], openDate: e.target.value, isSyntheticDate: false }
                            }))}
                            data-testid={`input-open-date-all-${orphan.tradeId}`}
                          />
                          {orphanResolutions[orphan.tradeId]?.isSyntheticDate && (
                            <p className="text-[11px] text-muted-foreground" data-testid={`text-synthetic-date-all-${orphan.tradeId}`}>
                              Synthetic Date due to missing information
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            Cost Basis per Share
                            {costBasisMap && costBasisMap[orphan.ticker.toUpperCase()] !== undefined && (
                              <Badge variant="outline" className="text-rs-green border-rs-green/50 text-[10px] py-0">
                                <Check className="h-3 w-3 mr-0.5" />
                                CSV
                              </Badge>
                            )}
                          </Label>
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              className="pl-9"
                              value={orphanResolutions[orphan.tradeId]?.costBasis || ''}
                              onChange={(e) => setOrphanResolutions(prev => ({
                                ...prev,
                                [orphan.tradeId]: { ...prev[orphan.tradeId], costBasis: e.target.value }
                              }))}
                              data-testid={`input-cost-basis-all-${orphan.tradeId}`}
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex justify-end gap-2">
                        <Button
                          variant={isMuted ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => handleResolveOrphan(orphan.tradeId, 'mute', orphan.orphanStatus)}
                          disabled={resolveOrphanMutation.isPending}
                          data-testid={`button-mute-orphan-all-${orphan.tradeId}`}
                        >
                          {isMuted ? (
                            <><Volume2 className="h-4 w-4 mr-1" /> Unmute</>
                          ) : (
                            <><VolumeX className="h-4 w-4 mr-1" /> Mute</>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => handleResolveOrphan(orphan.tradeId, 'delete')}
                          disabled={resolveOrphanMutation.isPending}
                          data-testid={`button-delete-orphan-all-${orphan.tradeId}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleResolveOrphan(orphan.tradeId, 'resolve')}
                          disabled={resolveOrphanMutation.isPending || isMuted}
                          data-testid={`button-resolve-orphan-all-${orphan.tradeId}`}
                        >
                          {resolveOrphanMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <><Check className="h-4 w-4 mr-1" /> Save Cost Basis</>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )})}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Check className="h-12 w-12 mx-auto mb-4 text-rs-green" />
                <p>All orphan sells have been resolved!</p>
              </div>
            )}
          </ScrollArea>
          
          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setShowAllOrphansDialog(false)} data-testid="button-close-orphan-dialog">
              Close
            </Button>
            <Button
              onClick={() => setShowAllOrphansDialog(false)}
              disabled={!allOrphanSells || allOrphanSells.filter(o => o.orphanStatus === 'pending').length > 0}
              data-testid="button-resolve-batch"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Resolve Batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicates Dialog */}
      <Dialog open={showDuplicateDialog} onOpenChange={(open) => {
        if (!open) {
          setSelectedDuplicateBatchId(null);
        }
        setShowDuplicateDialog(open);
      }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-rs-amber" />
              Duplicate Trades Found
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p>These trades match existing data in your Trading Cards or previous imports.</p>
              <div className="mt-3 p-3 bg-muted rounded-md text-sm space-y-2">
                <p><strong>Delete:</strong> Remove this import row and keep existing data unchanged.</p>
                <p><strong>Overwrite:</strong> Update existing records with data from this import.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          
          {duplicateTrades && duplicateTrades.filter(d => d.duplicateStatus === 'pending').length > 0 && (
            <div className="flex justify-end gap-2 mb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkDuplicateMutation.mutate('delete_all')}
                disabled={bulkDuplicateMutation.isPending}
                data-testid="button-delete-all-duplicates"
              >
                {bulkDuplicateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                {bulkDuplicateMutation.isPending ? 'Processing...' : 'Delete All'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => bulkDuplicateMutation.mutate('overwrite_all')}
                disabled={bulkDuplicateMutation.isPending}
                data-testid="button-overwrite-all-duplicates"
              >
                {bulkDuplicateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                {bulkDuplicateMutation.isPending ? 'Processing...' : 'Overwrite All'}
              </Button>
            </div>
          )}
          
          <ScrollArea className="flex-1 max-h-[50vh] pr-4">
            {duplicatesLoading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : duplicateTrades && duplicateTrades.filter(d => d.duplicateStatus === 'pending').length > 0 ? (
              <div className="space-y-4">
                {duplicateTrades.filter(d => d.duplicateStatus === 'pending').map((dup) => (
                  <Card key={dup.tradeId} className="border-rs-amber/30">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="font-mono font-bold text-lg">{dup.ticker}</div>
                          <Badge variant={dup.direction === 'BUY' ? 'default' : 'secondary'} className="gap-1">
                            {dup.direction === 'BUY' ? (
                              <><ArrowUpRight className="h-3 w-3" /> BUY</>
                            ) : (
                              <><ArrowDownRight className="h-3 w-3" /> SELL</>
                            )}
                          </Badge>
                          <span className="text-muted-foreground">
                            {dup.quantity.toFixed(3)} shares @ ${dup.price.toFixed(2)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatDate(dup.tradeDate)}
                        </div>
                      </div>
                      
                      {dup.matchInfo && (
                        <div className="mb-3 p-2 bg-muted rounded-md text-sm">
                          <span className="text-muted-foreground">Matches: </span>
                          {dup.matchInfo.type === 'card' ? (
                            <span>Existing Trading Card for <strong>{dup.matchInfo.card?.symbol}</strong> ({dup.matchInfo.card?.status})</span>
                          ) : (
                            <span>Previously imported trade from {dup.matchInfo.trade?.tradeDate}</span>
                          )}
                        </div>
                      )}
                      
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResolveDuplicate(dup.tradeId, 'delete')}
                          disabled={resolveDuplicateMutation.isPending}
                          data-testid={`button-delete-duplicate-${dup.tradeId}`}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleResolveDuplicate(dup.tradeId, 'overwrite')}
                          disabled={resolveDuplicateMutation.isPending}
                          data-testid={`button-overwrite-duplicate-${dup.tradeId}`}
                        >
                          {resolveDuplicateMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <><RefreshCw className="h-4 w-4 mr-1" /> Overwrite</>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Check className="h-12 w-12 mx-auto mb-4 text-rs-green" />
                <p>All duplicates have been resolved!</p>
              </div>
            )}
          </ScrollArea>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDuplicateDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
