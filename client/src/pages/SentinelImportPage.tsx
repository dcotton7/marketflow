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
  ChevronDown, ChevronUp, Building2, Calendar, DollarSign
} from "lucide-react";
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
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [tickerFilter, setTickerFilter] = useState("");
  
  const { data: batches, isLoading: batchesLoading } = useQuery<ImportBatch[]>({
    queryKey: ['/api/sentinel/import/batches'],
  });

  const { data: allTrades, isLoading: tradesLoading } = useQuery<ImportedTrade[]>({
    queryKey: ['/api/sentinel/import/trades'],
  });

  const previewMutation = useMutation({
    mutationFn: async (data: { csvContent: string; fileName: string; brokerId: string }) => {
      const response = await apiRequest('POST', '/api/sentinel/import/preview', data);
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
    mutationFn: async (data: { csvContent: string; fileName: string; brokerId: string }) => {
      const response = await apiRequest('POST', '/api/sentinel/import/confirm', data);
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
      setActiveTab("history");
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import trades",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const response = await apiRequest('DELETE', `/api/sentinel/import/batches/${batchId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Batch Deleted" });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/batches'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sentinel/import/trades'] });
    },
    onError: () => {
      toast({ title: "Delete Failed", variant: "destructive" });
    },
  });

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
      confirmMutation.mutate({ csvContent, fileName, brokerId: selectedBrokerId });
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
              <CardHeader>
                <CardTitle>Import History</CardTitle>
                <CardDescription>Previous CSV imports and their status</CardDescription>
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
                              <Badge variant={batch.status === "COMPLETE" ? "default" : "destructive"}>
                                {batch.status}
                              </Badge>
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
    </div>
  );
}
