import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, AlertCircle, Sparkles } from "lucide-react";

interface NoIndicatorFoundDialogProps {
  open: boolean;
  onClose: () => void;
  requestDescription: string;
  suggestedIndicatorName: string;
  category: string;
  reason: string;
  originalRequest: string;
  onIndicatorCreated: (indicator: any) => void;
}

export function NoIndicatorFoundDialog({
  open,
  onClose,
  requestDescription,
  suggestedIndicatorName,
  category,
  reason,
  originalRequest,
  onIndicatorCreated,
}: NoIndicatorFoundDialogProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const generateIndicatorMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/bigidea/custom-indicators/generate",
        {
          requestText: originalRequest,
          existingIndicators: [],
        }
      );
      return await response.json();
    },
    onSuccess: (data) => {
      if (data.indicator) {
        onIndicatorCreated(data.indicator);
        toast({
          title: "Custom Indicator Ready",
          description: `Generated "${data.indicator.name}" - you can now preview and save it.`,
        });
        onClose();
      }
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error?.message || "Failed to generate custom indicator",
        variant: "destructive",
      });
      setIsGenerating(false);
    },
  });

  const handleGenerate = async () => {
    setIsGenerating(true);
    generateIndicatorMutation.mutate();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-500" />
            <DialogTitle>No Matching Indicator Found</DialogTitle>
          </div>
          <DialogDescription>
            The AI couldn't find an existing indicator in the library that matches your request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg space-y-2">
            <div className="text-sm font-medium text-zinc-400">Your Request:</div>
            <div className="text-sm text-zinc-300">{requestDescription}</div>
          </div>

          <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg space-y-2">
            <div className="text-sm font-medium text-zinc-400">Why No Match:</div>
            <div className="text-sm text-zinc-300">{reason}</div>
          </div>

          <div className="p-4 bg-blue-950/20 border border-blue-800/50 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-400">
              <Sparkles className="h-4 w-4" />
              <span>Suggested Solution</span>
            </div>
            <div className="text-sm text-zinc-300">
              Create a custom indicator: <span className="font-semibold text-white">"{suggestedIndicatorName}"</span>
            </div>
            <div className="text-xs text-zinc-500">
              Category: {category} • Private to your account • Can be promoted to system library by admin after usage
            </div>
          </div>

          <div className="p-3 bg-yellow-950/20 border border-yellow-800/30 rounded text-xs text-yellow-200">
            <strong>Note:</strong> Custom indicators are:
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>Private to your account (not visible to others)</li>
              <li>Automatically submitted for admin review after 5 uses</li>
              <li>Safe to use (rule-based logic, no code execution)</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isGenerating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Create Custom Indicator
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
