import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
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
  VolumeX, Volume2
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
  fileType: string;
  totalTradesFound: number;
  totalTradesImported: number;
  orphanSellsCount?: number;
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
  
  const [activeTab, setActiveTab] = useState("upload");
  const [selectedBrokerId, setSelectedBrokerId] = useState<string>("FIDELITY");
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [showSkippedDialog, setShowSkippedDialog] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [tickerFilter, setTickerFilter] = useState("");
  const [timestampOverride, setTimestampOverride] = useState<string>("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showOrphanDialog, setShowOrphanDialog] = useState(false);
  const [selectedOrphanBatchId, setSelectedOrphanBatchId] = useState<string | null>(null);
  const [orphanResolutions, setOrphanResolutions] = useState<Record<string, { costBasis: string; openDate: string }>>({});
  
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

  // Count total pending orphans across all batches that need review
  const totalPendingOrphans = batches?.reduce((sum, b) => sum + (b.orphanSellsCount || 0), 0) || 0;
  const hasPendingOrphans = totalPendingOrphans > 0;

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
    onSuccess: (data) => {
      toast({
        title: "Import Complete",
        description: `Successfully imported ${data.tradesImported} trades`,
      });
      setPreviewData(null);
      setCsvContent(null);
      setFileName(null);
      setTimestampOverride("");
      setActiveTab("history");
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
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
    },
    onError: (error: any) => {
      toast({ 
        title: "Promotion Failed", 
        description: error?.message || "Could not promote trades. Please try again.",
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

  const handleReviewOrphans = (batchId: string) => {
    setSelectedOrphanBatchId(batchId);
    setOrphanResolutions({});
    setShowOrphanDialog(true);
  };

  const handleResolveOrphan = (tradeId: string, action: 'delete' | 'resolve' | 'mute') => {
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
      resolveOrphanMutation.mutate({ tradeId, action: 'mute' });
    } else {
      resolveOrphanMutation.mutate({ tradeId, action: 'delete' });
    }
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
    <div className="min-h-screen bg-background">
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
                    {hasPendingOrphans && (
                      <span className="text-xs text-yellow-500">
                        {totalPendingOrphans} orphan{totalPendingOrphans > 1 ? 's' : ''} need review
                      </span>
                    )}
                    <Button 
                      variant="default" 
                      size="sm"
                      onClick={() => promoteToCardsMutation.mutate()}
                      disabled={!allTrades || allTrades.length === 0 || promoteToCardsMutation.isPending || hasPendingOrphans}
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
                    {batches.map((batch) => (
                      <Card key={batch.batchId} className="hover-elevate">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                              <div>
                                <div className="font-medium">{batch.fileName}</div>
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
                              {batch.status === "NEEDS_REVIEW" && (batch.orphanSellsCount || 0) > 0 ? (
                                <Badge variant="outline" className="text-yellow-500 border-yellow-500 gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {batch.orphanSellsCount} Orphans
                                </Badge>
                              ) : (
                                <Badge variant={batch.status === "COMPLETE" ? "default" : "destructive"}>
                                  {batch.status}
                                </Badge>
                              )}
                              {batch.status === "NEEDS_REVIEW" && (
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleReviewOrphans(batch.batchId)}
                                  className="text-yellow-500 border-yellow-500/50"
                                  data-testid={`button-review-orphans-${batch.batchId}`}
                                >
                                  Review
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
                    ))}
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
                  // Look up the last buy date for this ticker:account combo from batch trades
                  const lookupKey = `${orphan.ticker}:${orphan.accountName || 'default'}`;
                  const lastBuyDate = lastBuyDates[lookupKey];
                  
                  return (
                  <Card key={orphan.tradeId} className={`${isMuted ? 'border-muted opacity-60' : 'border-yellow-500/30'}`}>
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
                          onClick={() => handleResolveOrphan(orphan.tradeId, 'mute')}
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
    </div>
  );
}
