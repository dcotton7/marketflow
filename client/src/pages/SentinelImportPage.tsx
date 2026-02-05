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
  Upload, FileSpreadsheet, Check, X, Loader2, Trash2, 
  ArrowUpRight, ArrowDownRight, Clock, AlertCircle, History,
  ChevronDown, ChevronUp, Building2, Calendar, DollarSign, AlertTriangle,
  VolumeX, Volume2, RefreshCw, Edit3
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";

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
}

const BROKER_OPTIONS = [
  { value: "FIDELITY", label: "Fidelity" },
  { value: "SCHWAB", label: "Charles Schwab" },
  { value: "ROBINHOOD", label: "Robinhood" },
];

export default function SentinelImportPage() {
  const { user } = useSentinelAuth();
  const { toast } = useToast();
  const { settings: systemSettings, cssVariables } = useSystemSettings();
  
  const [activeTab, setActiveTab] = useState("upload");
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>("FIDELITY");
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [showSkippedDialog, setShowSkippedDialog] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [showResetConfirmDialog, setShowResetConfirmDialog] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [tickerFilter, setTickerFilter] = useState("");
  const [timestampOverride, setTimestampOverride] = useState<string>("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showOrphanDialog, setShowOrphanDialog] = useState(false);
  const [selectedOrphanBatchId, setSelectedOrphanBatchId] = useState<string | null>(null);
  const [orphanResolutions, setOrphanResolutions] = useState<Record<string, { costBasis: string; openDate: string }>>({});
  const [recentlyUnmutedIds, setRecentlyUnmutedIds] = useState<Set<string>>(new Set());
  
  // Duplicate detection state
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [selectedDuplicateBatchId, setSelectedDuplicateBatchId] = useState<string | null>(null);
  
  const { data: batches, isLoading: batchesLoading } = useQuery<ImportBatch[]>({
    queryKey: ['/api/sentinel/import/batches'],
  });

  const { data: allTrades, isLoading: tradesLoading } = useQuery<ImportedTrade[]>({
    queryKey: ['/api/sentinel/import/trades'],
  });
  
  const { data: orphanData, isLoading: orphansLoading, refetch: refetchOrphans } = useQuery<{ orphans: ImportedTrade[]; lastBuyDates: Record<string, string> }>({
    queryKey: ['/api/sentinel/import/batches', selectedOrphanBatchId, 'orphans'],
    enabled: !!selectedOrphanBatchId,
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/import/batches/${selectedOrphanBatchId}/orphans`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch orphan sells');
      return res.json();
    }
  });
  
  const orphanSells = orphanData?.orphans;
  const lastBuyDates = orphanData?.lastBuyDates || {};

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
      toast({
        title: "Import Complete",
        description: `Successfully imported ${data.tradesImported} trades. Checking for duplicates...`,
      });
      setPreviewData(null);
      setCsvContent(null);
      setFileName(null);
      setTimestampOverride("");
      setActiveTab("history");
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
      
      // Auto-detect duplicates immediately after import
      if (data.batch?.batchId) {
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

  const promoteToCardsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/sentinel/import/promote-to-cards', {});
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Promotion failed with status ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "Trades Promoted to Cards", 
        description: `Created ${data.cardsCreated || 0} trading cards from ${data.transactionsProcessed || 0} transactions`
      });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/trades'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/trade-sources'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/labels'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
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
    mutationFn: async (data: { tradeId: string; action: 'delete' | 'resolve' | 'mute'; costBasis?: number; openDate?: string }) => {
      const response = await apiRequest('PATCH', `/api/sentinel/import/trades/${data.tradeId}/resolve-orphan`, {
        action: data.action,
        costBasis: data.costBasis,
        openDate: data.openDate,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to resolve orphan');
      }
      return response.json();
    },
    onSuccess: (data) => {
      refetchOrphans();
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
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
      const response = await apiRequest('POST', `/api/sentinel/import/batches/${selectedDuplicateBatchId}/duplicates/bulk`, { action });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Bulk action failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
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
    setShowOrphanDialog(true);
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

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setCsvContent(content);
        setFileName(file.name);
        setPreviewData(null);
      };
      reader.readAsText(file);
    } else {
      toast({ title: "Invalid File", description: "Please upload a CSV file", variant: "destructive" });
    }
  }, [toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.name.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setCsvContent(content);
        setFileName(file.name);
        setPreviewData(null);
      };
      reader.readAsText(file);
    }
  }, []);

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
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', day: 'numeric', year: 'numeric' 
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div 
      className="min-h-screen sentinel-page"
      style={{ 
        backgroundColor: cssVariables.backgroundColor,
        '--logo-opacity': cssVariables.logoOpacity,
        '--overlay-bg': cssVariables.overlayBg,
      } as React.CSSProperties}
    >
      {/* Watermark applied via background-image on container */}
      <SentinelHeader />
      
      <main className="container mx-auto p-4 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Import Trades</h1>
          <p className="text-muted-foreground">Upload CSV files from your brokerage to import trade history</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-md grid-cols-3">
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
          </TabsList>

          <TabsContent value="upload" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Select Broker
                </CardTitle>
                <CardDescription>Choose your brokerage platform</CardDescription>
              </CardHeader>
              <CardContent>
                <Select value={selectedBrokerId} onValueChange={setSelectedBrokerId}>
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
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Timestamp Override (Optional)
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
                    <span className="text-sm text-muted-foreground">
                      Leave empty to use timestamps from CSV (if available)
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5" />
                  Upload CSV File
                </CardTitle>
                <CardDescription>
                  Drag and drop or click to select your activity export file
                </CardDescription>
              </CardHeader>
              <CardContent>
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
                    onChange={handleFileSelect}
                  />
                  {fileName ? (
                    <div className="space-y-2">
                      <FileSpreadsheet className="h-12 w-12 mx-auto text-primary" />
                      <p className="text-lg font-medium">{fileName}</p>
                      <p className="text-sm text-muted-foreground">
                        {csvContent ? `${csvContent.split('\n').length} lines` : 'Ready to preview'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                      <p className="text-muted-foreground">Drop CSV file here or click to browse</p>
                    </div>
                  )}
                </div>

                {fileName && !previewData && (
                  <div className="mt-4 flex justify-center">
                    <Button 
                      onClick={handlePreview} 
                      disabled={previewMutation.isPending}
                      data-testid="button-preview"
                    >
                      {previewMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Parsing...</>
                      ) : (
                        'Preview Import'
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {previewData && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Check className="h-5 w-5 text-green-500" />
                      Preview Results
                    </span>
                    <Badge variant={previewData.batch.status === "COMPLETE" ? "default" : "destructive"}>
                      {previewData.batch.status}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Found {previewData.trades.length} trades from {previewData.batch.brokerId}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-4 flex-wrap">
                    <div className="bg-muted p-3 rounded-lg">
                      <div className="text-sm text-muted-foreground">Trades Found</div>
                      <div className="text-2xl font-bold text-green-500">{previewData.trades.length}</div>
                    </div>
                    <div className="bg-muted p-3 rounded-lg">
                      <div className="text-sm text-muted-foreground">Rows Skipped</div>
                      <div className="text-2xl font-bold text-yellow-500">{previewData.batch.skippedRows.length}</div>
                    </div>
                    <div className="bg-muted p-3 rounded-lg">
                      <div className="text-sm text-muted-foreground">Total Value</div>
                      <div className="text-2xl font-bold">
                        {formatCurrency(previewData.trades.reduce((sum, t) => sum + t.totalAmount, 0))}
                      </div>
                    </div>
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
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Import {previewData.trades.length} Trades
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Import History</CardTitle>
                  <CardDescription>Previous CSV imports and their status</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    {hasPendingDuplicates && (
                      <span className="text-xs text-orange-500 font-medium">
                        {totalPendingDuplicates} duplicate{totalPendingDuplicates > 1 ? 's' : ''} need review first
                      </span>
                    )}
                    {hasPendingOrphans && (
                      <span className="text-xs text-yellow-500">
                        {totalPendingOrphans} orphan{totalPendingOrphans > 1 ? 's' : ''} need review
                      </span>
                    )}
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => redetectOrphansMutation.mutate()}
                      disabled={!batches || batches.length === 0 || redetectOrphansMutation.isPending}
                      data-testid="button-redetect-orphans"
                      title="Re-evaluates all imported trades across all batches to fix false orphans from out-of-order imports"
                    >
                      {redetectOrphansMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Re-detect Orphans
                    </Button>
                    <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={() => setShowResetConfirmDialog(true)}
                      disabled={!batches || batches.length === 0 || resetAndRedetectMutation.isPending}
                      data-testid="button-reset-and-redetect"
                      title="Deletes all import-created cards, resets orphan status, and re-runs detection with fixed FIFO logic"
                    >
                      {resetAndRedetectMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Reset & Re-detect
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => cleanupDuplicatesMutation.mutate()}
                      disabled={cleanupDuplicatesMutation.isPending}
                      data-testid="button-cleanup-duplicates"
                      title="Merges duplicate trading cards (same ticker+account) into one, combining all lot entries"
                    >
                      {cleanupDuplicatesMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Cleanup Duplicates
                    </Button>
                    <Button 
                      variant="default" 
                      size="sm"
                      onClick={() => promoteToCardsMutation.mutate()}
                      disabled={!allTrades || allTrades.length === 0 || promoteToCardsMutation.isPending || hasPendingDuplicates || hasPendingOrphans}
                      data-testid="button-promote-to-cards"
                    >
                      {promoteToCardsMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 mr-2" />
                      )}
                      Promote to Trading Cards
                    </Button>
                  </div>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => setShowDeleteAllDialog(true)}
                    disabled={!batches || batches.length === 0}
                    data-testid="button-delete-all"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete All
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
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
                                        <Check className="h-3 w-3 text-green-500" />
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
                                <div className="text-lg font-bold text-green-500">{batch.totalTradesImported}</div>
                                <div className="text-xs text-muted-foreground">trades imported</div>
                              </div>
                              {/* Duplicates shown FIRST - must be resolved before orphans */}
                              {(batch.duplicatesCount || 0) > 0 ? (
                                <Badge variant="outline" className="text-orange-500 border-orange-500 gap-1">
                                  <AlertCircle className="h-3 w-3" />
                                  {batch.duplicatesCount} Duplicates <span className="text-white">(Step 1)</span>
                                </Badge>
                              ) : batch.status === "NEEDS_REVIEW" && (batch.orphanSellsCount || 0) > 0 ? (
                                <Badge variant="outline" className="text-yellow-500 border-yellow-500 gap-1">
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
                                  className="text-yellow-500 border-yellow-500/50"
                                  disabled={(batch.duplicatesCount || 0) > 0}
                                  title={(batch.duplicatesCount || 0) > 0 ? "Resolve duplicates first" : "Review orphan sells"}
                                  data-testid={`button-review-orphans-${batch.batchId}`}
                                >
                                  Review Orphans
                                </Button>
                              )}
                              {(batch.duplicatesCount || 0) > 0 && (
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => {
                                    setSelectedDuplicateBatchId(batch.batchId);
                                    setShowDuplicateDialog(true);
                                  }}
                                  className="text-orange-500 border-orange-500/50"
                                  data-testid={`button-review-duplicates-${batch.batchId}`}
                                >
                                  Review Duplicates
                                </Button>
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

      <Dialog open={showOrphanDialog} onOpenChange={(open) => {
        setShowOrphanDialog(open);
        if (!open) {
          setSelectedOrphanBatchId(null);
          setOrphanResolutions({});
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-yellow-500">
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
                  // Look up the last buy date for this ticker:account combo from batch trades
                  const lookupKey = `${orphan.ticker}:${orphan.accountName || 'default'}`;
                  const lastBuyDate = lastBuyDates[lookupKey];
                  
                  return (
                  <Card key={orphan.tradeId} className={`transition-all duration-500 ${isMuted ? 'border-muted opacity-60' : isRecentlyUnmuted ? 'border-green-500 bg-green-500/10 ring-2 ring-green-500/30' : 'border-yellow-500/30'}`}>
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
                      
                      {lastBuyDate && (
                        <p className="text-xs text-muted-foreground mb-2">
                          Defaulting to last purchase date from file: {lastBuyDate}
                        </p>
                      )}
                      
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="space-y-2">
                          <Label>Original Purchase Date</Label>
                          <Input
                            type="date"
                            value={orphanResolutions[orphan.tradeId]?.openDate || lastBuyDate || ''}
                            onChange={(e) => setOrphanResolutions(prev => ({
                              ...prev,
                              [orphan.tradeId]: { ...prev[orphan.tradeId], openDate: e.target.value }
                            }))}
                            data-testid={`input-open-date-${orphan.tradeId}`}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Cost Basis per Share</Label>
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
                <Check className="h-12 w-12 mx-auto mb-4 text-green-500" />
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
              <AlertCircle className="h-5 w-5 text-orange-500" />
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
                <Trash2 className="h-4 w-4 mr-1" />
                Delete All
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => bulkDuplicateMutation.mutate('overwrite_all')}
                disabled={bulkDuplicateMutation.isPending}
                data-testid="button-overwrite-all-duplicates"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Overwrite All
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
                  <Card key={dup.tradeId} className="border-orange-500/30">
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
                <Check className="h-12 w-12 mx-auto mb-4 text-green-500" />
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
