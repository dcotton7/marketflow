import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { SentinelHeader } from "@/components/SentinelHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  BookOpen, Plus, Edit3, Trash2, Archive, CheckCircle2, Clock, 
  FileText, Zap, Settings2, ChevronRight, Loader2, Search,
  AlertCircle, Eye, Upload, Sparkles, Brain
} from "lucide-react";
import { IVY_ENTRY_STRATEGIES, IVY_STOP_STRATEGIES, IVY_TARGET_STRATEGIES } from "@shared/schema";
import { FileUploader, UploadedFile } from "@/components/uploads/FileUploader";
import { ExtractedIdeasTab } from "@/components/bigidea/ExtractedIdeasTab";

interface SetupIndicator {
  id?: number;
  indicatorId: string;
  params?: Record<string, any>;
  required: boolean;
  weight: number;
  notes?: string;
}

interface Setup {
  id: number;
  name: string;
  slug: string;
  version: number;
  status: "draft" | "active" | "archived";
  description?: string;
  exampleCharts?: Array<{ url: string; ticker: string; caption: string }>;
  extractedRules?: Record<string, any>;
  indicators?: SetupIndicator[];
  // Ivy AI Integration
  ivyEntryStrategy?: string | null;
  ivyStopStrategy?: string | null;
  ivyTargetStrategy?: string | null;
  ivyContextNotes?: string | null;
  ivyApproved?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface IndicatorOption {
  id: string;
  name: string;
  category: string;
  defaultParams: Record<string, any>;
}

export default function SetupLibraryPage() {
  const { toast } = useToast();
  const [selectedSetup, setSelectedSetup] = useState<Setup | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Fetch all setups
  const { data: setups = [], isLoading } = useQuery<Setup[]>({
    queryKey: ["/api/bigidea/setups"],
  });

  // Fetch indicator library
  const { data: indicatorLibrary = [] } = useQuery<IndicatorOption[]>({
    queryKey: ["/api/bigidea/setup-indicators"],
  });

  // Create setup mutation
  const createSetup = useMutation({
    mutationFn: async (data: Partial<Setup>) => {
      const res = await apiRequest("POST", "/api/bigidea/setups", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/setups"] });
      setIsCreateDialogOpen(false);
      toast({ title: "Setup created", description: "New setup has been saved as draft." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update setup mutation
  const updateSetup = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Setup> & { id: number }) => {
      const res = await apiRequest("PATCH", `/api/bigidea/setups/${id}`, data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/setups"] });
      setSelectedSetup(data as Setup);
      toast({ title: "Setup updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Delete setup mutation
  const deleteSetup = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/bigidea/setups/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/setups"] });
      setSelectedSetup(null);
      toast({ title: "Setup deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Activate/Archive mutations
  const activateSetup = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/bigidea/setups/${id}/activate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/setups"] });
      toast({ title: "Setup activated" });
    },
  });

  const archiveSetup = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/bigidea/setups/${id}/archive`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/setups"] });
      toast({ title: "Setup archived" });
    },
  });

  // Filter setups
  const filteredSetups = setups.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500/10 text-green-500">Active</Badge>;
      case "draft":
        return <Badge className="bg-yellow-500/10 text-yellow-500">Draft</Badge>;
      case "archived":
        return <Badge className="bg-gray-500/10 text-gray-400">Archived</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <SentinelHeader />
      
      <div className="container mx-auto p-6 max-w-7xl">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BookOpen className="h-8 w-8 text-blue-500" />
            <div>
              <h1 className="text-2xl font-bold text-white">Setup Library</h1>
              <p className="text-gray-400 text-sm">AI Training System - Define and manage trading setups</p>
            </div>
          </div>
          
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                New Setup
              </Button>
            </DialogTrigger>
            <CreateSetupDialog 
              onSubmit={(data) => createSetup.mutate(data)} 
              isLoading={createSetup.isPending}
              indicatorLibrary={indicatorLibrary}
            />
          </Dialog>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-12 gap-6">
          {/* Setup List */}
          <div className="col-span-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-3">
                  <Search className="h-4 w-4 text-gray-500" />
                  <Input
                    placeholder="Search setups..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 bg-slate-800 border-slate-700"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 bg-slate-800 border-slate-700 text-sm">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[600px]">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                    </div>
                  ) : filteredSetups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                      <FileText className="h-10 w-10 mb-3 opacity-50" />
                      <p>No setups found</p>
                      <p className="text-sm">Create your first setup to get started</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800">
                      {filteredSetups.map((setup) => (
                        <button
                          key={setup.id}
                          onClick={() => setSelectedSetup(setup)}
                          className={`w-full text-left px-4 py-3 hover:bg-slate-800/50 transition-colors ${
                            selectedSetup?.id === setup.id ? "bg-slate-800" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-white">{setup.name}</span>
                            {getStatusBadge(setup.status)}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>v{setup.version}</span>
                            <span>•</span>
                            <span>{setup.indicators?.length || 0} indicators</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Setup Details */}
          <div className="col-span-8">
            {selectedSetup ? (
              <SetupDetailView
                setup={selectedSetup}
                indicatorLibrary={indicatorLibrary}
                onUpdate={(data) => updateSetup.mutate({ id: selectedSetup.id, ...data })}
                onDelete={() => deleteSetup.mutate(selectedSetup.id)}
                onActivate={() => activateSetup.mutate(selectedSetup.id)}
                onArchive={() => archiveSetup.mutate(selectedSetup.id)}
                isUpdating={updateSetup.isPending}
              />
            ) : (
              <Card className="bg-slate-900 border-slate-800 h-[660px] flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Select a setup to view details</p>
                  <p className="text-sm mt-1">Or create a new one to get started</p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Create Setup Dialog Component
function CreateSetupDialog({ 
  onSubmit, 
  isLoading,
  indicatorLibrary 
}: { 
  onSubmit: (data: Partial<Setup>) => void;
  isLoading: boolean;
  indicatorLibrary: IndicatorOption[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSubmit({ name, description });
  };

  return (
    <DialogContent className="bg-slate-900 border-slate-800 max-w-lg">
      <DialogHeader>
        <DialogTitle className="text-white">Create New Setup</DialogTitle>
        <DialogDescription>
          Define a new trading setup for the AI Training System
        </DialogDescription>
      </DialogHeader>
      
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="name">Setup Name</Label>
          <Input
            id="name"
            placeholder="e.g., Qullamaggie Breakout"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-slate-800 border-slate-700"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            placeholder="Describe the setup methodology, entry criteria, and key characteristics..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="bg-slate-800 border-slate-700 min-h-[120px]"
          />
        </div>
      </div>
      
      <DialogFooter>
        <Button 
          onClick={handleSubmit} 
          disabled={!name.trim() || isLoading}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isLoading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
          ) : (
            <>Create Setup</>
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// Setup Detail View Component
function SetupDetailView({
  setup,
  indicatorLibrary,
  onUpdate,
  onDelete,
  onActivate,
  onArchive,
  isUpdating,
}: {
  setup: Setup;
  indicatorLibrary: IndicatorOption[];
  onUpdate: (data: Partial<Setup>) => void;
  onDelete: () => void;
  onActivate: () => void;
  onArchive: () => void;
  isUpdating: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedDescription, setEditedDescription] = useState(setup.description || "");
  const [editedRules, setEditedRules] = useState<Record<string, string>>(
    (setup.extractedRules as Record<string, string>) || {}
  );
  const [selectedIndicators, setSelectedIndicators] = useState<SetupIndicator[]>(
    setup.indicators || []
  );
  const [showAllUploads, setShowAllUploads] = useState(false);
  const [viewingFile, setViewingFile] = useState<{ filename: string; content: string } | null>(null);
  
  // Ivy AI Integration state
  const [ivyEntryStrategy, setIvyEntryStrategy] = useState<string | null>(setup.ivyEntryStrategy || null);
  const [ivyStopStrategy, setIvyStopStrategy] = useState<string | null>(setup.ivyStopStrategy || null);
  const [ivyTargetStrategy, setIvyTargetStrategy] = useState<string | null>(setup.ivyTargetStrategy || null);
  const [ivyContextNotes, setIvyContextNotes] = useState(setup.ivyContextNotes || "");
  const [ivyApproved, setIvyApproved] = useState(setup.ivyApproved || false);

  // Reset state when setup changes
  useEffect(() => {
    setEditedDescription(setup.description || "");
    setEditedRules((setup.extractedRules as Record<string, string>) || {});
    setSelectedIndicators(setup.indicators || []);
    setIvyEntryStrategy(setup.ivyEntryStrategy || null);
    setIvyStopStrategy(setup.ivyStopStrategy || null);
    setIvyTargetStrategy(setup.ivyTargetStrategy || null);
    setIvyContextNotes(setup.ivyContextNotes || "");
    setIvyApproved(setup.ivyApproved || false);
    setIsEditing(false);
  }, [setup.id]);

  const handleSave = () => {
    onUpdate({
      description: editedDescription,
      extractedRules: editedRules,
      indicators: selectedIndicators,
      ivyEntryStrategy,
      ivyStopStrategy,
      ivyTargetStrategy,
      ivyContextNotes,
      ivyApproved,
    });
    setIsEditing(false);
  };

  const addIndicator = (indicatorId: string) => {
    const ind = indicatorLibrary.find((i) => i.id === indicatorId);
    if (!ind) return;
    setSelectedIndicators([
      ...selectedIndicators,
      {
        indicatorId,
        params: ind.defaultParams,
        required: true,
        weight: 1.0,
      },
    ]);
  };

  const removeIndicator = (index: number) => {
    setSelectedIndicators(selectedIndicators.filter((_, i) => i !== index));
  };

  const getIndicatorName = (id: string) => {
    return indicatorLibrary.find((i) => i.id === id)?.name || id;
  };

  return (
    <>
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-white">{setup.name}</CardTitle>
            {setup.status === "active" && (
              <Badge className="bg-green-500/10 text-green-500">Active</Badge>
            )}
            {setup.status === "draft" && (
              <Badge className="bg-yellow-500/10 text-yellow-500">Draft</Badge>
            )}
            {setup.status === "archived" && (
              <Badge className="bg-gray-500/10 text-gray-400">Archived</Badge>
            )}
            <span className="text-sm text-gray-500">v{setup.version}</span>
          </div>
          
          <div className="flex items-center gap-2">
            {setup.status === "draft" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={onActivate}
                    className="border-green-500/30 text-green-500 hover:bg-green-500/10"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Activate
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Make this setup available for training</TooltipContent>
              </Tooltip>
            )}
            {setup.status === "active" && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={onArchive}
                className="border-gray-500/30 text-gray-400 hover:bg-gray-500/10"
              >
                <Archive className="h-4 w-4 mr-1" />
                Archive
              </Button>
            )}
            {isEditing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button 
                  size="sm" 
                  onClick={handleSave}
                  disabled={isUpdating}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)}>
                <Edit3 className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={onDelete}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <Tabs defaultValue="description" className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b border-slate-800 bg-transparent h-auto p-0">
            <TabsTrigger 
              value="description"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent py-3 px-4"
            >
              <FileText className="h-4 w-4 mr-2" />
              Description
            </TabsTrigger>
            <TabsTrigger 
              value="rules"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent py-3 px-4"
            >
              <Settings2 className="h-4 w-4 mr-2" />
              Extracted Rules
            </TabsTrigger>
            <TabsTrigger 
              value="indicators"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent py-3 px-4"
            >
              <Zap className="h-4 w-4 mr-2" />
              Indicators
            </TabsTrigger>
            <TabsTrigger 
              value="documents"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent py-3 px-4"
            >
              <Upload className="h-4 w-4 mr-2" />
              Documents
            </TabsTrigger>
            <TabsTrigger 
              value="ai-ideas"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500 data-[state=active]:bg-transparent py-3 px-4"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              AI Ideas
            </TabsTrigger>
            <TabsTrigger 
              value="ivy"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent py-3 px-4"
            >
              <Brain className="h-4 w-4 mr-2" />
              Ivy Trade Plan
              {ivyApproved && <Badge className="ml-2 bg-emerald-500/20 text-emerald-400 text-[10px] px-1.5">Active</Badge>}
            </TabsTrigger>
          </TabsList>
          
          <ScrollArea className="h-[520px]">
            <TabsContent value="description" className="m-0 p-6">
              {isEditing ? (
                <Textarea
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  placeholder="Describe the setup methodology..."
                  className="bg-slate-800 border-slate-700 min-h-[300px]"
                />
              ) : (
                <div className="prose prose-invert max-w-none">
                  {setup.description ? (
                    <p className="text-gray-300 whitespace-pre-wrap">{setup.description}</p>
                  ) : (
                    <p className="text-gray-500 italic">No description provided</p>
                  )}
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="rules" className="m-0 p-6">
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  AI-extracted rules from the setup description. Edit to refine.
                </p>
                
                {Object.keys(editedRules).length === 0 && !isEditing ? (
                  <div className="text-center py-8 text-gray-500">
                    <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>No rules extracted yet</p>
                    <p className="text-sm">Add a description first, then use AI to extract rules</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(editedRules).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-3">
                        <Label className="w-40 text-gray-400 text-sm">{key}:</Label>
                        {isEditing ? (
                          <Input
                            value={value}
                            onChange={(e) => setEditedRules({ ...editedRules, [key]: e.target.value })}
                            className="bg-slate-800 border-slate-700 flex-1"
                          />
                        ) : (
                          <span className="text-white">{value}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                {isEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const key = prompt("Enter rule name:");
                      if (key) setEditedRules({ ...editedRules, [key]: "" });
                    }}
                    className="mt-4"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Rule
                  </Button>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="indicators" className="m-0 p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-400">
                    Configure which indicators to use when scanning for this setup
                  </p>
                  {isEditing && (
                    <Select onValueChange={addIndicator}>
                      <SelectTrigger className="w-48 bg-slate-800 border-slate-700">
                        <SelectValue placeholder="Add indicator..." />
                      </SelectTrigger>
                      <SelectContent>
                        {indicatorLibrary
                          .filter((i) => !selectedIndicators.some((s) => s.indicatorId === i.id))
                          .map((ind) => (
                            <SelectItem key={ind.id} value={ind.id}>
                              {ind.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                
                {selectedIndicators.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Zap className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>No indicators configured</p>
                    <p className="text-sm">Add indicators to define scan criteria</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedIndicators.map((ind, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between p-3 bg-slate-800 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox 
                            checked={ind.required} 
                            disabled={!isEditing}
                            onCheckedChange={(checked) => {
                              const updated = [...selectedIndicators];
                              updated[idx].required = !!checked;
                              setSelectedIndicators(updated);
                            }}
                          />
                          <div>
                            <span className="text-white font-medium">
                              {getIndicatorName(ind.indicatorId)}
                            </span>
                            <span className="text-gray-500 text-sm ml-2">
                              ({ind.indicatorId})
                            </span>
                          </div>
                        </div>
                        {isEditing && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeIndicator(idx)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="documents" className="m-0 p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-400">
                    Upload PDFs, images, or documents describing this setup. Text will be extracted for AI processing.
                  </p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="show-all" className="text-xs text-gray-500">Show all my uploads</Label>
                    <Checkbox
                      id="show-all"
                      checked={showAllUploads}
                      onCheckedChange={(checked) => setShowAllUploads(!!checked)}
                    />
                  </div>
                </div>
                <FileUploader
                  linkedSetupId={setup.id}
                  showLinkedOnly={!showAllUploads}
                  onUploadComplete={(upload) => {
                    console.log("Upload complete:", upload);
                  }}
                  onFileSelect={(upload) => {
                    if (upload.extractedText) {
                      setViewingFile({ filename: upload.filename, content: upload.extractedText });
                    }
                  }}
                />
              </div>
            </TabsContent>

            <TabsContent value="ai-ideas" className="m-0 p-6">
              <ExtractedIdeasTab setupId={setup.id} setupName={setup.name} />
            </TabsContent>

            <TabsContent value="ivy" className="m-0 p-6">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-white">Ivy Trade Plan Integration</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      Configure how Ivy should suggest entries, stops, and targets for this setup type.
                      When approved, Ivy will use this guidance when users view scan results.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="ivy-approved" className={ivyApproved ? "text-emerald-400" : "text-gray-400"}>
                      {ivyApproved ? "Active" : "Not Active"}
                    </Label>
                    <Checkbox
                      id="ivy-approved"
                      checked={ivyApproved}
                      disabled={!isEditing}
                      onCheckedChange={(checked) => setIvyApproved(!!checked)}
                      className="data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {/* Entry Strategy */}
                  <div className="space-y-2">
                    <Label className="text-gray-300">Entry Strategy</Label>
                    <Select 
                      value={ivyEntryStrategy || ""} 
                      onValueChange={(v) => setIvyEntryStrategy(v || null)}
                      disabled={!isEditing}
                    >
                      <SelectTrigger className="bg-slate-800 border-slate-700">
                        <SelectValue placeholder="Select entry type..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {IVY_ENTRY_STRATEGIES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            <div className="flex flex-col">
                              <span>{s.label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {ivyEntryStrategy && (
                      <p className="text-xs text-gray-500">
                        {IVY_ENTRY_STRATEGIES.find(s => s.value === ivyEntryStrategy)?.description}
                      </p>
                    )}
                  </div>

                  {/* Stop Strategy */}
                  <div className="space-y-2">
                    <Label className="text-gray-300">Stop Strategy</Label>
                    <Select 
                      value={ivyStopStrategy || ""} 
                      onValueChange={(v) => setIvyStopStrategy(v || null)}
                      disabled={!isEditing}
                    >
                      <SelectTrigger className="bg-slate-800 border-slate-700">
                        <SelectValue placeholder="Select stop type..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {IVY_STOP_STRATEGIES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            <div className="flex flex-col">
                              <span>{s.label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {ivyStopStrategy && (
                      <p className="text-xs text-gray-500">
                        {IVY_STOP_STRATEGIES.find(s => s.value === ivyStopStrategy)?.description}
                      </p>
                    )}
                  </div>

                  {/* Target Strategy */}
                  <div className="space-y-2">
                    <Label className="text-gray-300">Target Strategy</Label>
                    <Select 
                      value={ivyTargetStrategy || ""} 
                      onValueChange={(v) => setIvyTargetStrategy(v || null)}
                      disabled={!isEditing}
                    >
                      <SelectTrigger className="bg-slate-800 border-slate-700">
                        <SelectValue placeholder="Select target type..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {IVY_TARGET_STRATEGIES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            <div className="flex flex-col">
                              <span>{s.label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {ivyTargetStrategy && (
                      <p className="text-xs text-gray-500">
                        {IVY_TARGET_STRATEGIES.find(s => s.value === ivyTargetStrategy)?.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Context Notes */}
                <div className="space-y-2">
                  <Label className="text-gray-300">Context Notes for Ivy</Label>
                  <Textarea
                    value={ivyContextNotes}
                    onChange={(e) => setIvyContextNotes(e.target.value)}
                    disabled={!isEditing}
                    placeholder="e.g., 'Wait for pullback under the 21 EMA for an undercut and rally entry. Stop below the undercut low. This is a mean-reversion play, not a breakout.'"
                    className="bg-slate-800 border-slate-700 min-h-[100px]"
                  />
                  <p className="text-xs text-gray-500">
                    Free-form guidance that Ivy will include in her trade plan suggestions. Be specific about entry triggers, risk management, and the nature of the setup.
                  </p>
                </div>

                {/* Preview Box */}
                {(ivyEntryStrategy || ivyStopStrategy || ivyTargetStrategy || ivyContextNotes) && (
                  <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                      <Brain className="h-4 w-4" />
                      Ivy will suggest:
                    </div>
                    <ul className="text-sm text-gray-300 space-y-1 ml-6 list-disc">
                      {ivyEntryStrategy && (
                        <li><span className="text-emerald-400">Entry:</span> {IVY_ENTRY_STRATEGIES.find(s => s.value === ivyEntryStrategy)?.description}</li>
                      )}
                      {ivyStopStrategy && (
                        <li><span className="text-red-400">Stop:</span> {IVY_STOP_STRATEGIES.find(s => s.value === ivyStopStrategy)?.description}</li>
                      )}
                      {ivyTargetStrategy && (
                        <li><span className="text-blue-400">Target:</span> {IVY_TARGET_STRATEGIES.find(s => s.value === ivyTargetStrategy)?.description}</li>
                      )}
                    </ul>
                    {ivyContextNotes && (
                      <div className="mt-3 pt-3 border-t border-slate-700">
                        <p className="text-sm text-gray-400 italic">"{ivyContextNotes}"</p>
                      </div>
                    )}
                  </div>
                )}

                {!ivyApproved && (ivyEntryStrategy || ivyStopStrategy || ivyTargetStrategy) && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-400">
                    <AlertCircle className="h-4 w-4 inline mr-2" />
                    This configuration is not active. Enable the "Active" toggle to have Ivy use these suggestions for scan results.
                  </div>
                )}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </CardContent>

      {/* Extracted Content Viewer Dialog */}
      <Dialog open={!!viewingFile} onOpenChange={(open) => !open && setViewingFile(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Extracted Content
            </DialogTitle>
            <DialogDescription className="truncate">
              {viewingFile?.filename}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh] border rounded-lg p-4 bg-slate-900">
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
              {viewingFile?.content}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Card>
    </>
  );
}
