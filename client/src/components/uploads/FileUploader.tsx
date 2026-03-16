import { useState, useCallback, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  File,
  FileText,
  Image,
  X,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Trash2,
  Eye,
  Link2,
  RefreshCw,
} from "lucide-react";

export interface UploadedFile {
  id: number;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  extractedText?: string;
  processingStatus: "pending" | "processing" | "completed" | "failed";
  processingError?: string;
  createdAt: string;
  purpose?: string;
}

interface FileUploaderProps {
  onUploadComplete?: (upload: UploadedFile) => void;
  onFileSelect?: (upload: UploadedFile) => void;
  linkedSetupId?: number;
  showLinkedOnly?: boolean;
  maxFiles?: number;
  acceptedTypes?: string[];
  compact?: boolean;
}

export function FileUploader({
  onUploadComplete,
  onFileSelect,
  linkedSetupId,
  showLinkedOnly = false,
  maxFiles = 10,
  acceptedTypes = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".md"],
  compact = false,
}: FileUploaderProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  // Fetch uploads (either all user uploads or linked to setup)
  const { data: uploads = [], isLoading } = useQuery<UploadedFile[]>({
    queryKey: linkedSetupId && showLinkedOnly 
      ? [`/api/setups/${linkedSetupId}/uploads`]
      : ["/api/uploads"],
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const xhr = new XMLHttpRequest();
      
      return new Promise<UploadedFile>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(xhr.responseText || "Upload failed"));
          }
        });

        xhr.addEventListener("error", () => reject(new Error("Upload failed")));

        xhr.open("POST", "/api/uploads");
        xhr.withCredentials = true;
        xhr.send(formData);
      });
    },
    onSuccess: async (data) => {
      setUploadProgress(0);
      
      // Auto-link to setup if linkedSetupId is provided
      if (linkedSetupId) {
        try {
          await fetch(`/api/uploads/${data.id}/link-setup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ setupId: linkedSetupId, purpose: "documentation" }),
          });
        } catch (e) {
          console.error("Failed to link upload to setup:", e);
        }
        queryClient.invalidateQueries({ queryKey: [`/api/setups/${linkedSetupId}/uploads`] });
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
      toast({ title: "File uploaded", description: data.filename });
      onUploadComplete?.(data);
    },
    onError: (error: Error) => {
      setUploadProgress(0);
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/uploads/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
      if (linkedSetupId) {
        queryClient.invalidateQueries({ queryKey: [`/api/setups/${linkedSetupId}/uploads`] });
      }
      toast({ title: "File deleted" });
    },
  });

  // Link to setup mutation
  const linkMutation = useMutation({
    mutationFn: async ({ uploadId, purpose }: { uploadId: number; purpose?: string }) => {
      const res = await fetch(`/api/uploads/${uploadId}/link-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ setupId: linkedSetupId, purpose }),
      });
      if (!res.ok) throw new Error("Link failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/setups/${linkedSetupId}/uploads`] });
      toast({ title: "File linked to setup" });
    },
  });

  // Helper to invalidate upload queries
  const invalidateUploadQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
    if (linkedSetupId) {
      queryClient.invalidateQueries({ queryKey: [`/api/setups/${linkedSetupId}/uploads`] });
    }
  }, [linkedSetupId]);

  // Re-process mutation (re-extract text) with polling for completion
  const reprocessMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/uploads/${id}/reprocess`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Re-process failed");
      
      // Immediately refresh to show "processing" status
      invalidateUploadQueries();
      
      // Poll for completion (check every 3s for up to 2 minutes)
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const statusRes = await fetch(`/api/uploads/${id}`, { credentials: "include" });
        if (statusRes.ok) {
          const upload = await statusRes.json();
          
          // Refresh list to show current status
          invalidateUploadQueries();
          
          if (upload.processingStatus === "completed" || upload.processingStatus === "failed") {
            return upload;
          }
        }
      }
      throw new Error("Processing timed out");
    },
    onSuccess: (data) => {
      invalidateUploadQueries();
      if (data?.processingStatus === "completed") {
        toast({ title: "Processing complete", description: "Text extracted successfully" });
      } else {
        toast({ title: "Processing finished", description: data?.processingError || "Check results", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      invalidateUploadQueries();
      toast({ title: "Re-process failed", description: error.message, variant: "destructive" });
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      uploadMutation.mutate(files[0]);
    }
  }, [uploadMutation]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadMutation.mutate(files[0]);
    }
    e.target.value = "";
  }, [uploadMutation]);

  const getFileIcon = (mimeType: string) => {
    if (mimeType === "application/pdf") return <FileText className="h-4 w-4 text-red-400" />;
    if (mimeType.startsWith("image/")) return <Image className="h-4 w-4 text-blue-400" />;
    return <File className="h-4 w-4 text-gray-400" />;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500/10 text-green-500 text-[10px]">Ready</Badge>;
      case "processing":
        return <Badge className="bg-blue-500/10 text-blue-500 text-[10px]">Processing</Badge>;
      case "failed":
        return <Badge className="bg-red-500/10 text-red-500 text-[10px]">Failed</Badge>;
      default:
        return <Badge className="bg-yellow-500/10 text-yellow-500 text-[10px]">Pending</Badge>;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
          ${isDragging ? "border-blue-500 bg-blue-500/10" : "border-slate-700 hover:border-slate-600"}
          ${compact ? "p-4" : "p-6"}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedTypes.join(",")}
          onChange={handleFileSelect}
          className="hidden"
        />
        
        {uploadMutation.isPending ? (
          <div className="space-y-2">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-blue-500" />
            <p className="text-sm text-gray-400">Uploading... {uploadProgress}%</p>
            <Progress value={uploadProgress} className="w-48 mx-auto" />
          </div>
        ) : (
          <>
            <Upload className={`mx-auto text-gray-500 ${compact ? "h-6 w-6" : "h-10 w-10"}`} />
            <p className={`text-gray-400 mt-2 ${compact ? "text-xs" : "text-sm"}`}>
              Drop files here or click to upload
            </p>
            <p className="text-xs text-gray-600 mt-1">
              PDF, images, text files (max 50MB)
            </p>
          </>
        )}
      </div>

      {/* File List */}
      {uploads.length > 0 && (
        <ScrollArea className={compact ? "h-[200px]" : "h-[300px]"}>
          <div className="space-y-2">
            {uploads.map((upload) => (
              <Card
                key={upload.id}
                className="p-3 bg-slate-800 border-slate-700 hover:bg-slate-750 transition-colors overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-shrink-0">
                    {getFileIcon(upload.mimeType)}
                  </div>
                  
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p className="text-sm font-medium text-white truncate max-w-[200px]" title={upload.filename}>
                      {upload.filename}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{formatFileSize(upload.sizeBytes)}</span>
                      {getStatusBadge(upload.processingStatus)}
                      {upload.purpose && (
                        <Badge variant="outline" className="text-[10px]">
                          {upload.purpose}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {upload.processingStatus === "completed" && upload.extractedText && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              onFileSelect?.(upload);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View extracted content</TooltipContent>
                      </Tooltip>
                    )}

                    {linkedSetupId && !showLinkedOnly && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              linkMutation.mutate({ uploadId: upload.id, purpose: "reference" });
                            }}
                            disabled={linkMutation.isPending}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Link to setup</TooltipContent>
                      </Tooltip>
                    )}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-blue-400 hover:text-blue-300"
                          onClick={(e) => {
                            e.stopPropagation();
                            reprocessMutation.mutate(upload.id);
                          }}
                          disabled={reprocessMutation.isPending || upload.processingStatus === "processing"}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${reprocessMutation.isPending ? "animate-spin" : ""}`} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Re-process / Extract text</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-400 hover:text-red-300"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(upload.id);
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete file</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {upload.processingStatus === "failed" && upload.processingError && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                    <AlertCircle className="h-3 w-3" />
                    {upload.processingError}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
        </div>
      )}

      {!isLoading && uploads.length === 0 && (
        <p className="text-center text-sm text-gray-500 py-4">
          No files uploaded yet
        </p>
      )}
    </div>
  );
}

export default FileUploader;
