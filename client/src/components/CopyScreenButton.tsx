import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ClipboardCopy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import html2canvas from "html2canvas";

interface CopyScreenButtonProps {
  targetRef?: React.RefObject<HTMLElement>;
  className?: string;
}

export function CopyScreenButton({ targetRef, className }: CopyScreenButtonProps) {
  const { toast } = useToast();

  const handleCopyScreen = async () => {
    try {
      const element = targetRef?.current || document.body;
      
      const canvas = await html2canvas(element, {
        backgroundColor: null,
        scale: 2,
        logging: false,
      });

      // Convert canvas to blob and copy to clipboard
      canvas.toBlob(async (blob) => {
        if (!blob) {
          toast({ title: "Failed to create image", variant: "destructive" });
          return;
        }

        try {
          // Modern ClipboardItem API (Chrome 76+, Edge 79+, Safari 13.1+)
          if (navigator.clipboard && window.ClipboardItem) {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({ "image/png": blob }),
              ]);
              toast({ title: "Screen copied to clipboard" });
              return;
            } catch (clipboardError) {
              // ClipboardItem might fail if clipboard is busy or permissions denied
              console.warn("ClipboardItem API failed, trying fallback:", clipboardError);
            }
          }
          
          // Fallback: Use canvas directly with execCommand (works in older browsers)
          // Create a temporary image element from canvas
          const img = new Image();
          img.src = canvas.toDataURL("image/png");
          
          // Wait for image to load
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            // If already loaded (cached), resolve immediately
            if (img.complete) resolve(undefined);
          });
          
          // Create a temporary container and select the image
          const container = document.createElement("div");
          container.style.position = "fixed";
          container.style.left = "-9999px";
          container.appendChild(img);
          document.body.appendChild(container);
          
          // Select the image
          const range = document.createRange();
          range.selectNodeContents(container);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
            
            // Copy using execCommand
            const success = document.execCommand("copy");
            selection.removeAllRanges();
            
            document.body.removeChild(container);
            
            if (success) {
              toast({ title: "Screen copied to clipboard" });
            } else {
              throw new Error("execCommand('copy') returned false");
            }
          } else {
            document.body.removeChild(container);
            throw new Error("No selection API available");
          }
        } catch (error) {
          console.error("Clipboard copy failed:", error);
          toast({ 
            title: "Failed to copy to clipboard", 
            description: "Please ensure clipboard permissions are granted and try again",
            variant: "destructive" 
          });
        }
      }, "image/png");
    } catch (error) {
      console.error("Failed to copy screen:", error);
      toast({ title: "Failed to copy screen", variant: "destructive" });
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleCopyScreen}
          className={className}
          data-testid="button-copy-screen"
        >
          <ClipboardCopy className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>Copy screen to clipboard</p>
      </TooltipContent>
    </Tooltip>
  );
}
