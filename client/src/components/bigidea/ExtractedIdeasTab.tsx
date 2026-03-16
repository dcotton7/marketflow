import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Loader2, Sparkles, CheckCircle2, Edit3, Trash2, Play,
  ArrowRight, Brain, AlertCircle, ThumbsUp, ThumbsDown, Rocket, Eye, MessageSquare, Send
} from "lucide-react";
import { ValidationMode } from "./ValidationMode";
import { IdeaRefineDialog } from "./IdeaRefineDialog";
import { DocumentAnalysisDialog } from "./DocumentAnalysisDialog";

interface ExtractedThought {
  id: string;
  name: string;
  description?: string;
  indicators: Array<{
    id: string;
    name: string;
    params: Record<string, any>;
  }>;
}

interface ExtractedIdea {
  id: number;
  setupId: number;
  name: string;
  description?: string;
  thoughts: ExtractedThought[];
  confidence?: number;
  status: "draft" | "validating" | "approved" | "pushed" | "rejected";
  validationStats?: {
    totalRated: number;
    thumbsUp: number;
    thumbsDown: number;
    hitRate: number;
  };
  pushedToIdeaId?: number;
  createdAt: string;
}

interface ExtractedIdeasTabProps {
  setupId: number;
  setupName: string;
}

export function ExtractedIdeasTab({ setupId, setupName }: ExtractedIdeasTabProps) {
  const { toast } = useToast();
  const [editingIdea, setEditingIdea] = useState<ExtractedIdea | null>(null);
  const [validatingIdea, setValidatingIdea] = useState<ExtractedIdea | null>(null);
  const [refiningIdea, setRefiningIdea] = useState<ExtractedIdea | null>(null);
  const [showAnalysisDialog, setShowAnalysisDialog] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", description: "" });

  const { data: ideas = [], isLoading } = useQuery<ExtractedIdea[]>({
    queryKey: [`/api/bigidea/setups/${setupId}/extracted-ideas`],
    enabled: setupId > 0,
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/bigidea/setups/${setupId}/analyze`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/bigidea/setups/${setupId}/extracted-ideas`] });
      toast({
        title: "Analysis Complete",
        description: data.message || `Extracted ${data.ideas?.length || 0} Ideas`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateIdeaMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; name?: string; description?: string; status?: string }) => {
      const res = await apiRequest("PUT", `/api/bigidea/extracted-ideas/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/bigidea/setups/${setupId}/extracted-ideas`] });
      setEditingIdea(null);
      toast({ title: "Idea updated" });
    },
    onError: (error: any) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteIdeaMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/bigidea/extracted-ideas/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/bigidea/setups/${setupId}/extracted-ideas`] });
      toast({ title: "Idea deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const startValidationMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/bigidea/extracted-ideas/${id}/start-validation`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/bigidea/setups/${setupId}/extracted-ideas`] });
      toast({ title: "Validation started", description: "Run the idea as a scan and rate results" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to start validation", description: error.message, variant: "destructive" });
    },
  });

  const approveIdeaMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/bigidea/extracted-ideas/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/bigidea/setups/${setupId}/extracted-ideas`] });
      toast({ title: "Idea approved" });
    },
    onError: (error: any) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
    },
  });

  const pushToScannerMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/bigidea/extracted-ideas/${id}/push-to-scanner`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/bigidea/setups/${setupId}/extracted-ideas`] });
      toast({
        title: "Pushed to Scanner!",
        description: data.message || `Created scanner idea #${data.scannerIdeaId}`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Push failed", description: error.message, variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string, validationStats?: ExtractedIdea["validationStats"]) => {
    const variants: Record<string, { bg: string; icon: React.ReactNode; label: string }> = {
      draft: { bg: "bg-gray-600", icon: <Edit3 className="h-3 w-3" />, label: "Draft" },
      validating: { bg: "bg-yellow-600", icon: <Play className="h-3 w-3" />, label: "Validating" },
      approved: { bg: "bg-green-600", icon: <CheckCircle2 className="h-3 w-3" />, label: "Approved" },
      pushed: { bg: "bg-blue-600", icon: <Rocket className="h-3 w-3" />, label: "Pushed" },
      rejected: { bg: "bg-red-600", icon: <AlertCircle className="h-3 w-3" />, label: "Rejected" },
    };
    const v = variants[status] || variants.draft;

    return (
      <div className="flex items-center gap-2">
        <Badge className={`${v.bg} flex items-center gap-1`}>
          {v.icon}
          {v.label}
        </Badge>
        {status === "validating" && validationStats && validationStats.totalRated > 0 && (
          <Badge variant="outline" className="text-xs">
            {validationStats.hitRate.toFixed(0)}% hit ({validationStats.totalRated} rated)
          </Badge>
        )}
      </div>
    );
  };

  const openEditDialog = (idea: ExtractedIdea) => {
    setEditingIdea(idea);
    setEditForm({ name: idea.name, description: idea.description || "" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">
            AI-extracted scannable Ideas from your uploaded documents
          </p>
          {ideas.length > 0 && (
            <p className="text-xs text-yellow-500 mt-1">
              {ideas.length} existing Ideas - analyze again to review/replace
            </p>
          )}
        </div>
        <Button
          onClick={() => setShowAnalysisDialog(true)}
          className="bg-purple-600 hover:bg-purple-700"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Analyze Documents
        </Button>
      </div>

      {ideas.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No Ideas extracted yet</p>
          <p className="text-sm mt-2">
            Upload documents describing trading setups, then click "Analyze Documents"
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {ideas.map((idea) => (
            <Card key={idea.id} className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg text-white flex items-center gap-2">
                      {idea.name}
                      {idea.confidence !== undefined && idea.confidence !== null && (
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge variant="outline" className="text-xs">
                              {idea.confidence}% conf
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>AI confidence score</TooltipContent>
                        </Tooltip>
                      )}
                    </CardTitle>
                    {idea.description && (
                      <p className="text-sm text-gray-400 mt-1">{idea.description}</p>
                    )}
                  </div>
                  {getStatusBadge(idea.status, idea.validationStats)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-gray-500 uppercase tracking-wide">
                      Thoughts ({idea.thoughts.length})
                    </Label>
                    <div className="mt-2 space-y-2">
                      {idea.thoughts.map((thought, idx) => (
                        <div
                          key={thought.id}
                          className="bg-slate-900 rounded-lg p-3 border border-slate-700"
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {idx + 1}
                            </Badge>
                            <span className="text-sm font-medium text-white">
                              {thought.name}
                            </span>
                          </div>
                          {thought.description && (
                            <p className="text-xs text-gray-500 mt-1">{thought.description}</p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {thought.indicators.map((ind) => (
                              <Tooltip key={ind.id}>
                                <TooltipTrigger>
                                  <Badge className="bg-slate-700 text-xs">
                                    {ind.name}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-xs">
                                    <div className="font-medium">{ind.id}</div>
                                    {Object.keys(ind.params || {}).length > 0 && (
                                      <div className="text-gray-400 mt-1">
                                        {Object.entries(ind.params).map(([k, v]) => (
                                          <div key={k}>
                                            {k}: {JSON.stringify(v)}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-700">
                    <div className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRefiningIdea(idea)}
                            disabled={idea.status === "pushed"}
                            className="text-purple-400 hover:text-purple-300"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Refine with AI</TooltipContent>
                      </Tooltip>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditDialog(idea)}
                        disabled={idea.status === "pushed"}
                      >
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Delete this idea?")) {
                            deleteIdeaMutation.mutate(idea.id);
                          }
                        }}
                        disabled={deleteIdeaMutation.isPending || idea.status === "pushed"}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-2">
                      {idea.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startValidationMutation.mutate(idea.id)}
                          disabled={startValidationMutation.isPending}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          Start Validation
                        </Button>
                      )}

                      {idea.status === "validating" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setValidatingIdea(idea)}
                            className="bg-yellow-600/20 border-yellow-600 text-yellow-400"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Rate Results
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateIdeaMutation.mutate({ id: idea.id, status: "rejected" })
                            }
                            className="text-red-400"
                          >
                            <ThumbsDown className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => approveIdeaMutation.mutate(idea.id)}
                            disabled={approveIdeaMutation.isPending}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                        </>
                      )}

                      {idea.status === "approved" && (
                        <Button
                          size="sm"
                          onClick={() => pushToScannerMutation.mutate(idea.id)}
                          disabled={pushToScannerMutation.isPending}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          {pushToScannerMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Rocket className="h-4 w-4 mr-1" />
                          )}
                          Push to Scanner
                        </Button>
                      )}

                      {idea.status === "pushed" && idea.pushedToIdeaId && (
                        <Badge className="bg-green-600/20 text-green-400 border-green-600">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Scanner Idea #{idea.pushedToIdeaId}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editingIdea} onOpenChange={(open) => !open && setEditingIdea(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Idea</DialogTitle>
            <DialogDescription>
              Modify the idea name and description before validation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="bg-slate-800 border-slate-700"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                className="bg-slate-800 border-slate-700"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingIdea(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingIdea) {
                  updateIdeaMutation.mutate({
                    id: editingIdea.id,
                    name: editForm.name,
                    description: editForm.description,
                  });
                }
              }}
              disabled={updateIdeaMutation.isPending}
            >
              {updateIdeaMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {validatingIdea && (
        <ValidationMode
          idea={validatingIdea}
          open={!!validatingIdea}
          onClose={() => setValidatingIdea(null)}
        />
      )}

      {refiningIdea && (
        <IdeaRefineDialog
          idea={refiningIdea}
          open={!!refiningIdea}
          onClose={() => setRefiningIdea(null)}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: [`/api/bigidea/setups/${setupId}/extracted-ideas`] });
          }}
        />
      )}

      <DocumentAnalysisDialog
        setupId={setupId}
        setupName={setupName}
        existingIdeasCount={ideas.length}
        open={showAnalysisDialog}
        onClose={() => setShowAnalysisDialog(false)}
        onIdeasCreated={() => {
          queryClient.invalidateQueries({ queryKey: [`/api/bigidea/setups/${setupId}/extracted-ideas`] });
        }}
      />
    </div>
  );
}
