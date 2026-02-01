import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useScannerContext } from "@/context/ScannerContext";
import { Bookmark, Trash2, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SavedScan {
  id: number;
  name: string;
  criteria: Record<string, unknown>;
  userId: string | null;
  createdAt: string;
}

export function SavedScansWidget() {
  const [, setLocation] = useLocation();
  const { setFilters } = useScannerContext();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: savedScans, isLoading } = useQuery<SavedScan[]>({
    queryKey: ['/api/saved-scans'],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/saved-scans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-scans'] });
      toast({ title: 'Scan deleted' });
    },
  });

  const handleLoadScan = (scan: SavedScan) => {
    setFilters(scan.criteria as any);
    setLocation('/');
    toast({ title: 'Scan loaded', description: `"${scan.name}" filters applied.` });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs">Loading scans...</span>
      </div>
    );
  }

  if (!savedScans || savedScans.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <Bookmark className="w-3 h-3" />
        <span>Saved Scans</span>
      </div>
      <div className="space-y-1">
        {savedScans.slice(0, 5).map((scan) => (
          <div
            key={scan.id}
            className="group flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => handleLoadScan(scan)}
            data-testid={`saved-scan-${scan.id}`}
          >
            <span className="text-sm text-foreground truncate max-w-[140px]" title={scan.name}>
              {scan.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteMutation.mutate(scan.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
              data-testid={`delete-scan-${scan.id}`}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        {savedScans.length > 5 && (
          <p className="text-xs text-muted-foreground px-2">
            +{savedScans.length - 5} more
          </p>
        )}
      </div>
    </div>
  );
}
