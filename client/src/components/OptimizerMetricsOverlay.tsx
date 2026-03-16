import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useSentinelAuth } from "@/context/SentinelAuthContext";

interface OptimizerStats {
  totalScans: number;
  totalEvaluations: number;
  avgConfidence: number;
  overallImprovement: number;
  weeklyImprovement: number;
  topImprovedIndicator: {
    id: string;
    name: string;
    selectivity: number;
  } | null;
  indicators: Array<{
    id: string;
    name: string;
    category: string;
    avgTimeMs: number;
    passRate: number;
    selectivity: number;
    evaluations: number;
    confidence: number;
  }>;
}

interface DisplaySettings {
  showOverlay: boolean;
  metrics: {
    overallImprovement: boolean;
    weeklyImprovement: boolean;
    confidenceLevel: boolean;
    scanStats: boolean;
    liveOptimization: boolean;
    achievementBadges: boolean;
    debugInfo: boolean;
  };
  position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  style: 'minimal' | 'compact' | 'detailed';
  theme: 'matrix' | 'cyberpunk' | 'minimal';
  isAdmin: boolean;
}

export function OptimizerMetricsOverlay() {
  const { user } = useSentinelAuth();
  
  const { data: settings } = useQuery<DisplaySettings>({
    queryKey: ['/api/bigidea/optimizer-display-settings'],
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: stats } = useQuery<OptimizerStats>({
    queryKey: ['/api/bigidea/optimizer-stats'],
    refetchInterval: 60000, // Refresh every minute
    enabled: settings?.showOverlay || false,
  });

  // Don't render if disabled or no data yet
  if (!settings?.showOverlay || !stats) return null;

  const themeClasses = {
    matrix: {
      container: 'bg-black/60 border border-green-500/40 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]',
      title: 'text-green-300 drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]',
      value: 'text-green-400 font-semibold drop-shadow-[0_0_6px_rgba(34,197,94,0.4)]',
      label: 'text-green-400/60',
      separator: 'border-green-500/20',
    },
    cyberpunk: {
      container: 'bg-black/60 border border-cyan-500/40 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]',
      title: 'text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]',
      value: 'text-cyan-400 font-semibold drop-shadow-[0_0_6px_rgba(6,182,212,0.4)]',
      label: 'text-cyan-400/60',
      separator: 'border-cyan-500/20',
    },
    minimal: {
      container: 'bg-white/5 border border-gray-500/20 text-gray-300 shadow-lg',
      title: 'text-gray-200',
      value: 'text-white font-semibold',
      label: 'text-gray-400',
      separator: 'border-gray-500/10',
    },
  };

  const theme = themeClasses[settings.theme] || themeClasses.cyberpunk;

  const positionClasses = {
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
  };

  const getConfidenceLabel = (confidence: number): string => {
    if (confidence >= 85) return 'Very High';
    if (confidence >= 70) return 'High';
    if (confidence >= 50) return 'Medium';
    if (confidence >= 30) return 'Low';
    return 'Building...';
  };

  // Minimal style - single line
  if (settings.style === 'minimal') {
    return (
      <div
        className={cn(
          'absolute z-10 backdrop-blur-sm rounded-lg px-3 py-2 font-mono text-xs',
          theme.container,
          positionClasses[settings.position]
        )}
      >
        <div className={theme.value}>
          🧠 Optimizer: <span className="text-emerald-400">+{stats.overallImprovement}%</span>
          {settings.metrics.scanStats && (
            <span className={cn(theme.label, "ml-3")}>
              {stats.totalScans} scans · {Math.round(stats.avgConfidence)}% confidence
            </span>
          )}
        </div>
      </div>
    );
  }

  // Compact style - 3-4 lines
  if (settings.style === 'compact') {
    return (
      <div
        className={cn(
          'absolute z-10 backdrop-blur-sm rounded-lg px-4 py-3 font-mono text-xs',
          theme.container,
          positionClasses[settings.position]
        )}
      >
        <div className={cn(theme.title, "font-semibold mb-2")}>
          🧠 AGENTIC OPTIMIZER
        </div>
        <div className="space-y-1">
          {settings.metrics.overallImprovement && (
            <div>
              Efficiency: <span className={cn(theme.value, "text-emerald-400")}>+{stats.overallImprovement}%</span>
            </div>
          )}
          {settings.metrics.weeklyImprovement && (
            <div className="flex items-center gap-2">
              <span className={theme.label}>This week:</span>
              <span className={cn(theme.value, stats.weeklyImprovement >= 0 ? "text-emerald-400" : "text-amber-400")}>
                {stats.weeklyImprovement >= 0 ? '+' : ''}{stats.weeklyImprovement}%
              </span>
            </div>
          )}
          {settings.metrics.confidenceLevel && (
            <div>
              Confidence: <span className={theme.value}>{stats.avgConfidence}%</span> 
              <span className={cn(theme.label, "ml-2")}>({getConfidenceLabel(stats.avgConfidence)})</span>
            </div>
          )}
          {settings.metrics.scanStats && (
            <div className={cn(theme.label, "text-[10px] pt-2 mt-2", theme.separator, "border-t")}>
              {stats.totalScans} scans · {stats.totalEvaluations.toLocaleString()} evaluations
            </div>
          )}
        </div>
      </div>
    );
  }

  // Detailed style - full stats
  return (
    <div
      className={cn(
        'absolute z-10 backdrop-blur-sm rounded-lg px-4 py-3 font-mono text-xs max-w-xs',
        theme.container,
        positionClasses[settings.position]
      )}
    >
      <div className={cn(theme.title, "font-semibold mb-3 text-sm flex items-center justify-between")}>
        <span>🧠 AGENTIC OPTIMIZER</span>
        <span className={cn(theme.label, "text-[9px]")}>v2.0</span>
      </div>
      
      <div className="space-y-2">
        {settings.metrics.overallImprovement && (
          <div className={cn("pb-2", theme.separator, "border-b")}>
            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: theme.label }}>
              Since Inception
            </div>
            <div className={cn(theme.value, "text-lg text-emerald-400")}>
              +{stats.overallImprovement}%
            </div>
          </div>
        )}
        
        {settings.metrics.weeklyImprovement && (
          <div>
            <div className="flex items-center justify-between">
              <span className={theme.label}>This week:</span>
              <span className={cn(theme.value, stats.weeklyImprovement >= 0 ? "text-emerald-400" : "text-amber-400")}>
                {stats.weeklyImprovement >= 0 ? '+' : ''}{stats.weeklyImprovement}%
              </span>
            </div>
          </div>
        )}
        
        {settings.metrics.confidenceLevel && (
          <div>
            <div className="flex items-center justify-between">
              <span className={theme.label}>Confidence:</span>
              <span className={theme.value}>
                {stats.avgConfidence}% <span className="text-[9px]">({getConfidenceLabel(stats.avgConfidence)})</span>
              </span>
            </div>
            <div className="w-full bg-black/40 rounded-full h-1.5 mt-1">
              <div
                className={cn(
                  "h-1.5 rounded-full transition-all duration-500",
                  stats.avgConfidence >= 85 && "bg-emerald-500",
                  stats.avgConfidence >= 70 && stats.avgConfidence < 85 && "bg-cyan-500",
                  stats.avgConfidence >= 50 && stats.avgConfidence < 70 && "bg-blue-500",
                  stats.avgConfidence < 50 && "bg-amber-500"
                )}
                style={{ width: `${stats.avgConfidence}%` }}
              />
            </div>
          </div>
        )}
        
        {settings.metrics.scanStats && (
          <div className={cn("pt-2 mt-2 text-[10px]", theme.separator, "border-t")}>
            <div className={theme.label}>
              {stats.totalScans.toLocaleString()} scans analyzed
            </div>
            <div className={theme.label}>
              {stats.totalEvaluations.toLocaleString()} evaluations tracked
            </div>
          </div>
        )}
        
        {settings.metrics.achievementBadges && stats.totalScans >= 100 && (
          <div className={cn("pt-2 mt-2 text-[10px]", theme.separator, "border-t")}>
            <div className="flex items-center gap-2">
              <span>🏆</span>
              <span className={theme.value}>100+ Scans Milestone</span>
            </div>
          </div>
        )}
        
        {settings.metrics.debugInfo && settings.isAdmin && stats.topImprovedIndicator && (
          <div className={cn("pt-2 mt-2 text-[9px]", theme.separator, "border-t")}>
            <div className={theme.label}>Top Performer:</div>
            <div className={theme.value}>{stats.topImprovedIndicator.name}</div>
            <div className={theme.label}>Selectivity: {stats.topImprovedIndicator.selectivity}%</div>
          </div>
        )}
      </div>
    </div>
  );
}
