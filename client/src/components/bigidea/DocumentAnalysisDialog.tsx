import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Send, Bot, User, Sparkles, FileText, Check, AlertCircle } from "lucide-react";

interface ProposedIdea {
  name: string;
  description: string;
  thoughts: Array<{
    name: string;
    description: string;
    indicators: Array<{ id: string; name: string; params: Record<string, any> }>;
  }>;
  confidence: number;
}

interface AnalysisPreview {
  summary: string;
  proposedIdeas: ProposedIdea[];
  documentContext: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  preview?: AnalysisPreview;
}

interface DocumentAnalysisDialogProps {
  setupId: number;
  setupName: string;
  existingIdeasCount: number;
  open: boolean;
  onClose: () => void;
  onIdeasCreated: () => void;
}

export function DocumentAnalysisDialog({
  setupId,
  setupName,
  existingIdeasCount,
  open,
  onClose,
  onIdeasCreated,
}: DocumentAnalysisDialogProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [currentPreview, setCurrentPreview] = useState<AnalysisPreview | null>(null);
  const [clearExisting, setClearExisting] = useState(existingIdeasCount > 0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      startAnalysis();
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const startAnalysis = async () => {
    setIsAnalyzing(true);
    setMessages([{
      role: "assistant",
      content: "Analyzing your documents... I'll summarize what I find and you can guide me before creating any Ideas."
    }]);

    try {
      const res = await apiRequest("POST", `/api/bigidea/setups/${setupId}/preview-analysis`);
      const data = await res.json();
      
      setCurrentPreview(data);
      setMessages([{
        role: "assistant",
        content: data.summary,
        preview: data,
      }]);
    } catch (error: any) {
      setMessages([{
        role: "assistant",
        content: `Error analyzing documents: ${error.message}. Make sure you have uploaded documents with extracted text.`
      }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const refineMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const res = await apiRequest("POST", `/api/bigidea/setups/${setupId}/refine-analysis`, {
        message: userMessage,
        currentPreview,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.updatedPreview) {
        setCurrentPreview(data.updatedPreview);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response,
            preview: data.updatedPreview,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.response },
        ]);
      }
    },
    onError: (error: any) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${error.message}` },
      ]);
    },
  });

  const createIdeasMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/bigidea/setups/${setupId}/create-from-preview`, {
        preview: currentPreview,
        clearExisting,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Ideas Created",
        description: `Created ${data.created} Ideas${clearExisting ? " (cleared existing)" : ""}`,
      });
      onIdeasCreated();
      onClose();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSend = () => {
    if (!input.trim() || refineMutation.isPending) return;
    
    const userMessage = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");
    refineMutation.mutate(userMessage);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-500" />
            Document Analysis: {setupName}
          </DialogTitle>
          <DialogDescription>
            Review and guide the AI's understanding before creating Ideas
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 flex-1 min-h-0">
          {/* Chat Section */}
          <div className="flex-1 flex flex-col min-h-0">
            <ScrollArea className="flex-1 border rounded-lg p-4 bg-slate-900 h-[400px]" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                    )}
                    <div
                      className={`rounded-lg p-3 max-w-[85%] ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-slate-800 text-gray-200"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    {msg.role === "user" && (
                      <div className="h-8 w-8 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-white" />
                      </div>
                    )}
                  </div>
                ))}
                {(isAnalyzing || refineMutation.isPending) && (
                  <div className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                    <div className="bg-slate-800 rounded-lg p-3">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="flex gap-2 mt-3">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g., 'This is actually one pattern, not three' or 'Add a volume condition'..."
                className="bg-slate-800 border-slate-700"
                disabled={isAnalyzing || refineMutation.isPending || !currentPreview}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isAnalyzing || refineMutation.isPending || !currentPreview}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>

            <p className="text-xs text-gray-500 mt-2">
              Guide the AI: "combine these into one idea", "this needs a base pattern check", "the EMA should be 10 not 21"
            </p>
          </div>

          {/* Proposed Ideas Preview */}
          <div className="w-80 flex flex-col min-h-0">
            <Label className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Proposed Ideas ({currentPreview?.proposedIdeas.length || 0})
            </Label>
            <ScrollArea className="flex-1 border rounded-lg p-3 bg-slate-900 h-[400px]">
              {!currentPreview ? (
                <div className="text-center py-8 text-gray-500">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                  <p className="text-sm">Analyzing...</p>
                </div>
              ) : currentPreview.proposedIdeas.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <AlertCircle className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No Ideas proposed yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {currentPreview.proposedIdeas.map((idea, idx) => (
                    <div key={idx} className="border border-slate-700 rounded-lg p-3 bg-slate-800">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-sm font-medium text-white">{idea.name}</span>
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {idea.confidence}%
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-400 mb-2">{idea.description}</p>
                      <div className="space-y-1">
                        {idea.thoughts.map((thought, tIdx) => (
                          <div key={tIdx} className="text-xs">
                            <span className="text-gray-500">Thought {tIdx + 1}:</span>{" "}
                            <span className="text-gray-300">{thought.name}</span>
                            <div className="ml-3 flex flex-wrap gap-1 mt-1">
                              {thought.indicators.map((ind, iIdx) => (
                                <Badge key={iIdx} className="bg-slate-700 text-xs py-0">
                                  {ind.name}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="mt-3 space-y-3">
              {existingIdeasCount > 0 && (
                <div className="flex items-center gap-2 p-2 bg-yellow-900/20 border border-yellow-700 rounded">
                  <Checkbox
                    id="clear-existing"
                    checked={clearExisting}
                    onCheckedChange={(checked) => setClearExisting(!!checked)}
                  />
                  <Label htmlFor="clear-existing" className="text-xs text-yellow-400">
                    Clear {existingIdeasCount} existing Ideas first
                  </Label>
                </div>
              )}

              <Button
                onClick={() => createIdeasMutation.mutate()}
                disabled={!currentPreview || currentPreview.proposedIdeas.length === 0 || createIdeasMutation.isPending}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                {createIdeasMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Create {currentPreview?.proposedIdeas.length || 0} Ideas
              </Button>

              <Button
                variant="outline"
                onClick={onClose}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
