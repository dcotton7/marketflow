import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Node,
  Edge,
  Handle,
  Position,
  NodeProps,
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SentinelHeader } from "@/components/SentinelHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp,
  BarChart3,
  Crosshair,
  Zap,
  Activity,
  Plus,
  Play,
  Save,
  Loader2,
  Sparkles,
  GripVertical,
  Ban,
  ArrowDown,
  ChevronDown,
  SlidersHorizontal,
  Target,
  X,
} from "lucide-react";
import type {
  ScannerThought,
  ScannerIdea,
  ScannerCriterion,
  ScannerCriterionParam,
  IdeaNode,
  IdeaEdge,
} from "@shared/schema";

const CATEGORY_ICONS: Record<string, typeof TrendingUp> = {
  "Moving Averages": TrendingUp,
  "Volume": BarChart3,
  "Price Action": Crosshair,
  "Relative Strength": Zap,
  "Volatility": Activity,
  "Momentum": Zap,
  "Value": Target,
  "Trend": TrendingUp,
  "Custom": SlidersHorizontal,
};

const CATEGORY_ORDER = ["Moving Averages", "Volume", "Price Action", "Relative Strength", "Volatility", "Momentum", "Value", "Trend", "Custom"];

const UNIVERSE_OPTIONS = [
  { value: "sp500", label: "S&P 500" },
  { value: "nasdaq100", label: "Nasdaq 100" },
  { value: "dow30", label: "Dow 30" },
  { value: "russell2000", label: "Russell 2000" },
];

interface ScanResultItem {
  symbol: string;
  name: string;
  price: number;
  passedPaths: string[];
}

interface ScanResponse {
  results: ScanResultItem[];
  thoughtCounts: Record<string, number>;
  totalScanned: number;
}

function getCategoryIcon(category: string) {
  const Icon = CATEGORY_ICONS[category] || SlidersHorizontal;
  return <Icon className="h-4 w-4" />;
}

function ThoughtNodeComponent({ data, selected }: NodeProps) {
  const isNot = data.isNot as boolean;
  const passCount = data.passCount as number | undefined;
  const category = data.category as string;
  const criteriaCount = (data.criteria as ScannerCriterion[])?.length || 0;

  return (
    <div
      className={`rounded-md border-2 px-3 py-2 min-w-[180px] ${
        isNot
          ? "border-red-500 bg-red-950/20"
          : selected
          ? "border-primary bg-card"
          : "border-border bg-card"
      }`}
      data-testid={`node-thought-${data.nodeId}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2 mb-1">
        {getCategoryIcon(category)}
        <span className="text-sm font-medium truncate">{data.label as string}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-xs">
          {criteriaCount} criteria
        </Badge>
        {passCount !== undefined && (
          <Badge
            variant="outline"
            className={`text-xs ${passCount > 0 ? "bg-green-500/20 text-green-400 border-green-500/30" : "text-muted-foreground"}`}
          >
            {passCount} pass
          </Badge>
        )}
        {isNot && (
          <Badge variant="outline" className="text-xs bg-red-500/20 text-red-400 border-red-500/30">
            NOT
          </Badge>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

function ResultsNodeComponent({ data }: NodeProps) {
  const totalCount = data.totalCount as number | undefined;

  const countColor =
    totalCount === undefined
      ? "text-muted-foreground"
      : totalCount === 0
      ? "text-red-400"
      : totalCount <= 50
      ? "text-green-400"
      : "text-yellow-400";

  return (
    <div
      className="rounded-md border-2 border-primary bg-primary/10 px-4 py-3 min-w-[140px] text-center"
      data-testid="node-results"
    >
      <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
      <div className="flex items-center justify-center gap-2 mb-1">
        <Target className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Results</span>
      </div>
      <span className={`text-2xl font-bold ${countColor}`}>
        {totalCount !== undefined ? totalCount : "--"}
      </span>
    </div>
  );
}

function LogicEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
}: EdgeProps) {
  const logicType = (data?.logicType as string) || "AND";
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isAnd = logicType === "AND";

  return (
    <>
      <path
        id={id}
        style={style}
        className={`react-flow__edge-path ${isAnd ? "stroke-blue-400" : "stroke-amber-400"}`}
        d={edgePath}
        strokeWidth={2}
        fill="none"
      />
      <EdgeLabelRenderer>
        <div
          className={`absolute text-xs font-bold px-2 py-0.5 rounded-md border cursor-pointer select-none ${
            isAnd
              ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
              : "bg-amber-500/20 text-amber-400 border-amber-500/30"
          }`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          data-testid={`edge-label-${id}`}
          onClick={(e) => {
            e.stopPropagation();
            if (data?.onToggle) {
              (data.onToggle as () => void)();
            }
          }}
        >
          {logicType}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = {
  thought: ThoughtNodeComponent,
  results: ResultsNodeComponent,
};

const edgeTypes = {
  logic: LogicEdge,
};

const INITIAL_RESULTS_NODE: Node = {
  id: "results-node",
  type: "results",
  position: { x: 600, y: 200 },
  data: { totalCount: undefined },
  deletable: false,
};

export default function BigIdeaPage() {
  const { toast } = useToast();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([INITIAL_RESULTS_NODE]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [ideaName, setIdeaName] = useState("Untitled Idea");
  const [universe, setUniverse] = useState("sp500");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [currentIdeaId, setCurrentIdeaId] = useState<number | null>(null);

  const [scanResults, setScanResults] = useState<ScanResultItem[] | null>(null);
  const [scanTotalScanned, setScanTotalScanned] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [resultSort, setResultSort] = useState<"ticker" | "price">("ticker");
  const [resultSortDir, setResultSortDir] = useState<"asc" | "desc">("asc");

  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiProposal, setAiProposal] = useState<any>(null);

  const { data: thoughts = [], isLoading: thoughtsLoading } = useQuery<ScannerThought[]>({
    queryKey: ["/api/bigidea/thoughts"],
  });

  const { data: ideas = [] } = useQuery<ScannerIdea[]>({
    queryKey: ["/api/bigidea/ideas"],
  });

  const createThoughtMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/bigidea/thoughts", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/thoughts"] });
      setAiDialogOpen(false);
      setAiProposal(null);
      setAiDescription("");
      toast({ title: "Thought saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save thought", description: err.message, variant: "destructive" });
    },
  });

  const aiCreateMutation = useMutation({
    mutationFn: async (description: string) => {
      const res = await apiRequest("POST", "/api/bigidea/ai/create-thought", { description });
      return res.json();
    },
    onSuccess: (data) => {
      setAiProposal(data);
    },
    onError: (err: Error) => {
      toast({ title: "AI generation failed", description: err.message, variant: "destructive" });
    },
  });

  const saveIdeaMutation = useMutation({
    mutationFn: async () => {
      const ideaNodes: IdeaNode[] = nodes.map((n) => ({
        id: n.id,
        type: n.type as "thought" | "results",
        thoughtId: n.data.thoughtId as number | undefined,
        thoughtName: n.data.label as string | undefined,
        thoughtCategory: n.data.category as string | undefined,
        thoughtDescription: n.data.description as string | undefined,
        thoughtCriteria: n.data.criteria as ScannerCriterion[] | undefined,
        isNot: n.data.isNot as boolean | undefined,
        position: n.position,
        passCount: n.data.passCount as number | undefined,
      }));
      const ideaEdges: IdeaEdge[] = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        logicType: (e.data?.logicType as "AND" | "OR") || "AND",
      }));
      const body = { name: ideaName, universe, nodes: ideaNodes, edges: ideaEdges };
      if (currentIdeaId) {
        const res = await apiRequest("PATCH", `/api/bigidea/ideas/${currentIdeaId}`, body);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/bigidea/ideas", body);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigidea/ideas"] });
      if (!currentIdeaId && data.id) setCurrentIdeaId(data.id);
      toast({ title: "Idea saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save idea", description: err.message, variant: "destructive" });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const scanNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type,
        thoughtCriteria: n.data.criteria,
        thoughtName: n.data.label,
        isNot: n.data.isNot,
      }));
      const scanEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        logicType: e.data?.logicType || "AND",
      }));
      const res = await apiRequest("POST", "/api/bigidea/scan", {
        nodes: scanNodes,
        edges: scanEdges,
        universe,
      });
      return res.json() as Promise<ScanResponse>;
    },
    onSuccess: (data) => {
      setScanResults(data.results);
      setScanTotalScanned(data.totalScanned);
      setShowResults(true);
      setSelectedNodeId(null);
      setNodes((nds) =>
        nds.map((n) => {
          if (n.type === "results") {
            return { ...n, data: { ...n.data, totalCount: data.results.length } };
          }
          if (n.type === "thought" && data.thoughtCounts) {
            return {
              ...n,
              data: { ...n.data, passCount: data.thoughtCounts[n.id] ?? 0 },
            };
          }
          return n;
        })
      );
      toast({ title: `Scan complete: ${data.results.length} matches` });
    },
    onError: (err: Error) => {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    },
  });

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge: Edge = {
        ...params,
        id: `e-${params.source}-${params.target}`,
        type: "logic",
        data: {
          logicType: "AND",
          onToggle: () => {
            setEdges((eds) =>
              eds.map((e) => {
                if (e.id === `e-${params.source}-${params.target}`) {
                  const current = e.data?.logicType === "AND" ? "OR" : "AND";
                  return { ...e, data: { ...e.data, logicType: current, onToggle: e.data?.onToggle } };
                }
                return e;
              })
            );
          },
        },
      } as Edge;
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges]
  );

  const onNodeClick = useCallback((_: any, node: Node) => {
    if (node.type === "thought") {
      setSelectedNodeId(node.id);
      setShowResults(false);
    }
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const thoughtData = event.dataTransfer.getData("application/bigidea-thought");
      if (!thoughtData || !reactFlowInstance) return;

      const thought: ScannerThought = JSON.parse(thoughtData);
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `thought-${thought.id}-${Date.now()}`,
        type: "thought",
        position,
        data: {
          nodeId: thought.id,
          label: thought.name,
          category: thought.category,
          description: thought.description,
          criteria: thought.criteria,
          thoughtId: thought.id,
          isNot: false,
          passCount: undefined,
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes]
  );

  const toggleNotOnNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return { ...n, data: { ...n.data, isNot: !n.data.isNot } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const updateNodeCriterionParam = useCallback(
    (nodeId: string, criterionIdx: number, paramName: string, value: any) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const criteria = [...(n.data.criteria as ScannerCriterion[])];
            const criterion = { ...criteria[criterionIdx] };
            criterion.params = criterion.params.map((p) =>
              p.name === paramName ? { ...p, value } : p
            );
            criteria[criterionIdx] = criterion;
            return { ...n, data: { ...n.data, criteria } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const toggleCriterionInvert = useCallback(
    (nodeId: string, criterionIdx: number) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const criteria = [...(n.data.criteria as ScannerCriterion[])];
            const criterion = { ...criteria[criterionIdx] };
            criterion.inverted = !criterion.inverted;
            criteria[criterionIdx] = criterion;
            return { ...n, data: { ...n.data, criteria } };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const loadIdea = useCallback(
    (idea: ScannerIdea) => {
      setCurrentIdeaId(idea.id);
      setIdeaName(idea.name);
      setUniverse(idea.universe);

      const loadedNodes: Node[] = (idea.nodes as IdeaNode[]).map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data:
          n.type === "results"
            ? { totalCount: undefined }
            : {
                nodeId: n.thoughtId,
                label: n.thoughtName,
                category: n.thoughtCategory,
                description: n.thoughtDescription,
                criteria: n.thoughtCriteria,
                thoughtId: n.thoughtId,
                isNot: n.isNot || false,
                passCount: undefined,
              },
        deletable: n.type !== "results",
      }));

      setNodes(loadedNodes);

      const loadedEdges: Edge[] = (idea.edges as IdeaEdge[]).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "logic",
        data: {
          logicType: e.logicType,
          onToggle: () => {
            setEdges((eds) =>
              eds.map((ed) => {
                if (ed.id === e.id) {
                  const current = ed.data?.logicType === "AND" ? "OR" : "AND";
                  return { ...ed, data: { ...ed.data, logicType: current, onToggle: ed.data?.onToggle } };
                }
                return ed;
              })
            );
          },
        },
      }));

      setEdges(loadedEdges);
      setScanResults(null);
      setShowResults(false);
      setSelectedNodeId(null);
    },
    [setNodes, setEdges]
  );

  const thoughtsByCategory = useMemo(() => {
    const grouped: Record<string, ScannerThought[]> = {};
    for (const t of thoughts) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    }
    return grouped;
  }, [thoughts]);

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

  const sortedResults = useMemo(() => {
    if (!scanResults) return [];
    const sorted = [...scanResults];
    sorted.sort((a, b) => {
      if (resultSort === "ticker") {
        return resultSortDir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      }
      return resultSortDir === "asc" ? a.price - b.price : b.price - a.price;
    });
    return sorted;
  }, [scanResults, resultSort, resultSortDir]);

  const handleSortToggle = (field: "ticker" | "price") => {
    if (resultSort === field) {
      setResultSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setResultSort(field);
      setResultSortDir("asc");
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <SentinelHeader showSentiment={false} />

      <div className="flex items-center gap-3 px-4 py-2 border-b bg-card flex-wrap">
        <Input
          value={ideaName}
          onChange={(e) => setIdeaName(e.target.value)}
          className="w-48 text-sm font-medium"
          data-testid="input-idea-name"
        />
        <Select value={universe} onValueChange={setUniverse}>
          <SelectTrigger className="w-40" data-testid="select-universe">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNIVERSE_OPTIONS.map((u) => (
              <SelectItem key={u.value} value={u.value} data-testid={`option-universe-${u.value}`}>
                {u.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="gap-2"
          data-testid="button-run-scan"
        >
          {scanMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Scan
        </Button>

        <Button
          variant="outline"
          onClick={() => saveIdeaMutation.mutate()}
          disabled={saveIdeaMutation.isPending}
          className="gap-2"
          data-testid="button-save-idea"
        >
          {saveIdeaMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Idea
        </Button>

        {ideas.length > 0 && (
          <Select
            value=""
            onValueChange={(val) => {
              const idea = ideas.find((i) => String(i.id) === val);
              if (idea) loadIdea(idea);
            }}
          >
            <SelectTrigger className="w-40" data-testid="select-load-idea">
              <SelectValue placeholder="Load Idea..." />
            </SelectTrigger>
            <SelectContent>
              {ideas.map((idea) => (
                <SelectItem key={idea.id} value={String(idea.id)} data-testid={`option-idea-${idea.id}`}>
                  {idea.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[280px] border-r flex flex-col bg-card/50">
          <div className="p-3 border-b flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Thought Library</span>
            <Button
              size="sm"
              onClick={() => setAiDialogOpen(true)}
              className="gap-1"
              data-testid="button-new-thought"
            >
              <Plus className="h-3 w-3" />
              New Thought
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-3">
              {thoughtsLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : thoughts.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No thoughts yet. Create one with AI!
                </div>
              ) : (
                CATEGORY_ORDER.filter((cat) => thoughtsByCategory[cat]?.length).map((cat) => (
                  <div key={cat}>
                    <div className="flex items-center gap-1.5 px-1 mb-1.5">
                      {getCategoryIcon(cat)}
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{cat}</span>
                    </div>
                    <div className="space-y-1">
                      {thoughtsByCategory[cat].map((thought) => (
                        <div
                          key={thought.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/bigidea-thought", JSON.stringify(thought));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className="rounded-md border px-2.5 py-2 cursor-grab active:cursor-grabbing hover-elevate"
                          data-testid={`thought-card-${thought.id}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <GripVertical className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm font-medium truncate">{thought.name}</span>
                          </div>
                          {thought.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 ml-[18px]">
                              {thought.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onInit={setReactFlowInstance}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "logic" }}
            fitView
            className="bg-background"
            data-testid="canvas-react-flow"
          >
            <Background gap={16} size={1} />
            <Controls data-testid="canvas-controls" />
            <MiniMap
              nodeColor={(n) => {
                if (n.type === "results") return "hsl(var(--primary))";
                if (n.data?.isNot) return "hsl(0, 80%, 50%)";
                return "hsl(var(--muted-foreground))";
              }}
              data-testid="canvas-minimap"
            />
          </ReactFlow>
        </div>

        {(showResults || selectedNode) && (
          <div className="w-[320px] border-l flex flex-col bg-card/50">
            <div className="p-3 border-b flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {showResults ? "Scan Results" : "Thought Details"}
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setShowResults(false);
                  setSelectedNodeId(null);
                }}
                data-testid="button-close-panel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1">
              {showResults && scanResults && (
                <div className="p-3 space-y-3">
                  <div className="text-center">
                    <span
                      className={`text-3xl font-bold ${
                        scanResults.length === 0
                          ? "text-red-400"
                          : scanResults.length <= 50
                          ? "text-green-400"
                          : "text-yellow-400"
                      }`}
                      data-testid="text-scan-count"
                    >
                      {scanResults.length}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      matches from {scanTotalScanned} scanned
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSortToggle("ticker")}
                      className="gap-1 text-xs"
                      data-testid="button-sort-ticker"
                    >
                      Ticker
                      {resultSort === "ticker" && <ArrowDown className={`h-3 w-3 ${resultSortDir === "desc" ? "rotate-180" : ""}`} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSortToggle("price")}
                      className="gap-1 text-xs"
                      data-testid="button-sort-price"
                    >
                      Price
                      {resultSort === "price" && <ArrowDown className={`h-3 w-3 ${resultSortDir === "desc" ? "rotate-180" : ""}`} />}
                    </Button>
                  </div>

                  <div className="space-y-1">
                    {sortedResults.map((r) => (
                      <div
                        key={r.symbol}
                        className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
                        data-testid={`result-stock-${r.symbol}`}
                      >
                        <div>
                          <span className="text-sm font-medium">{r.symbol}</span>
                          <div className="flex items-center gap-1 flex-wrap mt-0.5">
                            {r.passedPaths.map((p) => (
                              <Badge key={p} variant="outline" className="text-[10px] px-1 py-0">
                                {p}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <span className="text-sm font-mono text-muted-foreground">
                          ${r.price.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!showResults && selectedNode && selectedNode.type === "thought" && (
                <div className="p-3 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">{selectedNode.data.label as string}</h3>
                    {selectedNode.data.description ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        {String(selectedNode.data.description)}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant={selectedNode.data.isNot ? "destructive" : "outline"}
                      size="sm"
                      onClick={() => toggleNotOnNode(selectedNode.id)}
                      className="gap-1"
                      data-testid="button-toggle-not"
                    >
                      <Ban className="h-3 w-3" />
                      NOT {selectedNode.data.isNot ? "ON" : "OFF"}
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Criteria
                    </Label>
                    {(selectedNode.data.criteria as ScannerCriterion[])?.map((criterion, idx) => (
                      <Card key={idx} className="overflow-visible">
                        <CardHeader className="p-2.5 pb-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="text-xs">{criterion.label}</CardTitle>
                            <Button
                              variant={criterion.inverted ? "destructive" : "ghost"}
                              size="sm"
                              onClick={() => toggleCriterionInvert(selectedNode.id, idx)}
                              className="h-6 text-[10px] px-1.5"
                              data-testid={`button-invert-criterion-${idx}`}
                            >
                              {criterion.inverted ? "Inverted" : "Normal"}
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="p-2.5 pt-0 space-y-2">
                          {criterion.params.map((param) => (
                            <div key={param.name}>
                              <Label className="text-[11px] text-muted-foreground">{param.label}</Label>
                              {param.type === "number" && (
                                <div className="flex items-center gap-2 mt-1">
                                  <Slider
                                    value={[Number(param.value)]}
                                    min={param.min ?? 0}
                                    max={param.max ?? 100}
                                    step={param.step ?? 1}
                                    onValueChange={([v]) =>
                                      updateNodeCriterionParam(selectedNode.id, idx, param.name, v)
                                    }
                                    className="flex-1"
                                    data-testid={`slider-${param.name}-${idx}`}
                                  />
                                  <span className="text-xs font-mono w-10 text-right">{param.value}</span>
                                </div>
                              )}
                              {param.type === "select" && param.options && (
                                <Select
                                  value={String(param.value)}
                                  onValueChange={(v) =>
                                    updateNodeCriterionParam(selectedNode.id, idx, param.name, v)
                                  }
                                >
                                  <SelectTrigger className="h-7 text-xs mt-1" data-testid={`select-${param.name}-${idx}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {param.options.map((opt) => (
                                      <SelectItem key={opt} value={opt}>
                                        {opt}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              {param.type === "boolean" && (
                                <Button
                                  variant={param.value ? "default" : "outline"}
                                  size="sm"
                                  className="mt-1 text-xs"
                                  onClick={() =>
                                    updateNodeCriterionParam(selectedNode.id, idx, param.name, !param.value)
                                  }
                                  data-testid={`toggle-${param.name}-${idx}`}
                                >
                                  {param.value ? "Yes" : "No"}
                                </Button>
                              )}
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>

      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Create Thought with AI
            </DialogTitle>
            <DialogDescription>
              Describe your screening idea in plain English and AI will generate the criteria.
            </DialogDescription>
          </DialogHeader>

          {!aiProposal ? (
            <div className="space-y-4">
              <Textarea
                placeholder='e.g., "Find stocks trading above their 50-day SMA with increasing volume and RSI between 50 and 70"'
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                rows={4}
                data-testid="textarea-ai-description"
              />
              <DialogFooter>
                <Button
                  onClick={() => aiCreateMutation.mutate(aiDescription)}
                  disabled={!aiDescription.trim() || aiCreateMutation.isPending}
                  className="gap-2"
                  data-testid="button-ai-generate"
                >
                  {aiCreateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Name</Label>
                <p className="text-sm font-medium">{aiProposal.name}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Category</Label>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {getCategoryIcon(aiProposal.category)}
                  <span className="text-sm">{aiProposal.category}</span>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <p className="text-sm">{aiProposal.description}</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Criteria ({aiProposal.criteria?.length || 0})
                </Label>
                {aiProposal.criteria?.map((criterion: any, idx: number) => (
                  <Card key={idx} className="overflow-visible">
                    <CardContent className="p-2.5 space-y-2">
                      <span className="text-xs font-medium">{criterion.label}</span>
                      {criterion.params?.map((param: ScannerCriterionParam) => (
                        <div key={param.name}>
                          <Label className="text-[11px] text-muted-foreground">{param.label}</Label>
                          {param.type === "number" && (
                            <div className="flex items-center gap-2 mt-1">
                              <Slider
                                value={[Number(param.value)]}
                                min={param.min ?? 0}
                                max={param.max ?? 100}
                                step={param.step ?? 1}
                                onValueChange={([v]) => {
                                  const updated = { ...aiProposal };
                                  updated.criteria[idx].params = updated.criteria[idx].params.map(
                                    (p: any) => (p.name === param.name ? { ...p, value: v } : p)
                                  );
                                  setAiProposal({ ...updated });
                                }}
                                className="flex-1"
                                data-testid={`ai-slider-${param.name}-${idx}`}
                              />
                              <span className="text-xs font-mono w-10 text-right">{param.value}</span>
                            </div>
                          )}
                          {param.type === "select" && param.options && (
                            <Select
                              value={String(param.value)}
                              onValueChange={(v) => {
                                const updated = { ...aiProposal };
                                updated.criteria[idx].params = updated.criteria[idx].params.map(
                                  (p: any) => (p.name === param.name ? { ...p, value: v } : p)
                                );
                                setAiProposal({ ...updated });
                              }}
                            >
                              <SelectTrigger className="h-7 text-xs mt-1" data-testid={`ai-select-${param.name}-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {param.options.map((opt) => (
                                  <SelectItem key={opt} value={opt}>
                                    {opt}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setAiProposal(null)}
                  data-testid="button-ai-back"
                >
                  Back
                </Button>
                <Button
                  onClick={() =>
                    createThoughtMutation.mutate({
                      name: aiProposal.name,
                      category: aiProposal.category,
                      description: aiProposal.description,
                      criteria: aiProposal.criteria,
                    })
                  }
                  disabled={createThoughtMutation.isPending}
                  className="gap-2"
                  data-testid="button-save-thought"
                >
                  {createThoughtMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save Thought
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
