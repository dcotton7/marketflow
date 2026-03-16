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
import { Loader2, Send, Bot, User, Sparkles, Check, X } from "lucide-react";

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
  status: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  updatedIdea?: ExtractedIdea;
}

interface IdeaRefineDialogProps {
  idea: ExtractedIdea;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function IdeaRefineDialog({ idea, open, onClose, onUpdate }: IdeaRefineDialogProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [currentIdea, setCurrentIdea] = useState<ExtractedIdea>(idea);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentIdea(idea);
    setMessages([{
      role: "assistant",
      content: `I'm ready to help refine "${idea.name}". You can ask me to:\n\n• Add indicators (e.g., "add a base pattern check")\n• Modify thresholds (e.g., "make the volume requirement higher")\n• Add new thoughts (e.g., "add an alternative entry using EMA crossover")\n• Remove conditions (e.g., "remove the ADR filter")\n\nWhat would you like to change?`
    }]);
  }, [idea]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const refineMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const res = await apiRequest("POST", `/api/bigidea/extracted-ideas/${idea.id}/refine`, {
        message: userMessage,
        currentIdea: currentIdea,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.updatedIdea) {
        setCurrentIdea(data.updatedIdea);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response,
            updatedIdea: data.updatedIdea,
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
        { role: "assistant", content: `Sorry, I encountered an error: ${error.message}` },
      ]);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/bigidea/extracted-ideas/${idea.id}`, {
        name: currentIdea.name,
        description: currentIdea.description,
        thoughts: currentIdea.thoughts,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Changes applied", description: "Idea has been updated" });
      onUpdate();
      onClose();
    },
    onError: (error: any) => {
      toast({ title: "Failed to apply changes", description: error.message, variant: "destructive" });
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

  const hasChanges = JSON.stringify(currentIdea.thoughts) !== JSON.stringify(idea.thoughts) ||
                     currentIdea.name !== idea.name ||
                     currentIdea.description !== idea.description;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Refine Idea: {currentIdea.name}
          </DialogTitle>
          <DialogDescription>
            Chat with AI to add, remove, or modify indicators and thoughts
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 flex-1 min-h-0">
          {/* Chat Section */}
          <div className="flex-1 flex flex-col min-h-0">
            <ScrollArea className="flex-1 border rounded-lg p-4 bg-slate-900" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="h-8 w-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                    )}
                    <div
                      className={`rounded-lg p-3 max-w-[80%] ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-slate-800 text-gray-200"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      {msg.updatedIdea && (
                        <Badge className="mt-2 bg-green-600/20 text-green-400">
                          <Check className="h-3 w-3 mr-1" />
                          Idea updated
                        </Badge>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-white" />
                      </div>
                    )}
                  </div>
                ))}
                {refineMutation.isPending && (
                  <div className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-purple-600 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                    <div className="bg-slate-800 rounded-lg p-3">
                      <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
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
                placeholder="e.g., Add a tight base indicator..."
                className="bg-slate-800 border-slate-700"
                disabled={refineMutation.isPending}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || refineMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Current Idea Preview */}
          <div className="w-72 flex flex-col min-h-0">
            <Label className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Current Definition
            </Label>
            <ScrollArea className="flex-1 border rounded-lg p-3 bg-slate-900">
              <div className="space-y-3">
                <div>
                  <span className="text-xs text-gray-500">Name</span>
                  <p className="text-sm text-white font-medium">{currentIdea.name}</p>
                </div>
                
                {currentIdea.thoughts.map((thought, idx) => (
                  <div key={thought.id} className="border-t border-slate-700 pt-2">
                    <div className="flex items-center gap-1 mb-1">
                      <Badge variant="outline" className="text-xs">{idx + 1}</Badge>
                      <span className="text-xs text-gray-300">{thought.name}</span>
                    </div>
                    <div className="space-y-1">
                      {thought.indicators.map((ind) => (
                        <div
                          key={ind.id}
                          className="text-xs bg-slate-800 rounded px-2 py-1 text-gray-400"
                        >
                          {ind.name}
                          {Object.keys(ind.params || {}).length > 0 && (
                            <span className="text-gray-600 ml-1">
                              ({Object.entries(ind.params).map(([k, v]) => `${k}:${v}`).join(", ")})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex gap-2 mt-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button
                onClick={() => applyMutation.mutate()}
                disabled={!hasChanges || applyMutation.isPending}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {applyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    Apply
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
