import { useMemo } from "react";
import { ThemeRow, TickerRow } from "@/data/mockThemeData";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, AlertTriangle, ArrowUpDown, Gauge, Layers, Target, TrendingUp, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPulseToneByBandId, getScoreBandIndex, PULSE_BAND_ORDER } from "@/lib/pulse-scale";

interface AccDistStats {
  total: number;
  accumulation3Plus: number;
  distribution3Plus: number;
  accumulationPct: number;
  distributionPct: number;
}

interface ThemeDetailPanelActionableProps {
  theme: ThemeRow | null;
  members?: TickerRow[];
  totalThemes?: number;
  accDistStats?: AccDistStats;
  timeSlice?: string;
}

function clamp(v: number, low = 0, high = 100) {
  return Math.max(low, Math.min(high, v));
}

function scoreToStatus(score: number) {
  if (score < 20) return "DEAD";
  if (score < 40) return "WEAK";
  if (score < 60) return "MIXED";
  if (score < 80) return "GOOD";
  return "HOT";
}

function SegmentBar({
  label,
  score,
  detail,
}: {
  label: string;
  score: number;
  detail: string;
}) {
  const segments = PULSE_BAND_ORDER.length;
  const lit = Math.max(0, Math.min(segments, getScoreBandIndex(score) + 1));
  const status = scoreToStatus(score);

  const segmentClass = (idx: number) => {
    if (idx >= lit) return "bg-slate-800 border-slate-700/50";
    return "border-slate-900/60";
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="rounded border border-slate-700/40 bg-slate-900/60 p-2">
          <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
            <span className="font-medium text-slate-200">{label}</span>
            <span className="font-mono text-slate-400">{status}</span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: segments }).map((_, idx) => {
              const tone = getPulseToneByBandId(PULSE_BAND_ORDER[idx], "bar");
              return (
                <div
                  key={idx}
                  className={cn("h-3 flex-1 rounded-sm border", segmentClass(idx))}
                  style={
                    idx >= lit
                      ? undefined
                      : {
                          backgroundColor: tone.bgHex,
                          boxShadow: `0 0 8px ${tone.bgHex}66`,
                        }
                  }
                />
              );
            })}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">{detail}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-xs">
        {detail}
      </TooltipContent>
    </Tooltip>
  );
}

export function ThemeDetailPanelActionable({
  theme,
  members = [],
  totalThemes = 17,
  accDistStats,
  timeSlice = "TODAY",
}: ThemeDetailPanelActionableProps) {
  const isHistorical = timeSlice !== "TODAY";

  const model = useMemo(() => {
    if (!theme) return null;

    const rotationScore = clamp(50 + theme.deltaRank * 10 + theme.acceleration * 4);
    const participationScore = clamp(theme.breadthPct);
    const leadershipScore = clamp(50 + theme.rsVsSpy * 10);
    const confirmationScore = clamp(
      40 +
      (theme.volExp - 1) * 22 +
      (accDistStats ? (accDistStats.accumulationPct - accDistStats.distributionPct) * 0.8 : 0)
    );
    const concentrationRisk = clamp((theme.top3Contribution ?? 0) * 100);
    const durabilityScore = clamp(100 - concentrationRisk);

    const positives: string[] = [];
    const risks: string[] = [];

    if (theme.deltaRank > 0) positives.push(`rotation improving (+${theme.deltaRank})`);
    else if (theme.deltaRank < 0) risks.push(`rotation fading (${theme.deltaRank})`);

    if (theme.breadthPct >= 60) positives.push(`breadth supportive (${theme.breadthPct.toFixed(1)}%)`);
    else if (theme.breadthPct < 45) risks.push(`breadth weak (${theme.breadthPct.toFixed(1)}%)`);

    if (theme.rsVsSpy > 0) positives.push(`RS positive (${theme.rsVsSpy.toFixed(2)})`);
    else risks.push(`RS negative (${theme.rsVsSpy.toFixed(2)})`);

    if ((theme.top3Contribution ?? 0) > 0.5) risks.push(`leadership narrow (${Math.round((theme.top3Contribution ?? 0) * 100)}% top-3 contribution)`);
    else positives.push("leadership broad enough");

    if (theme.volExp >= 1.5) positives.push(`volume confirms (${theme.volExp.toFixed(2)}x)`);
    else if (theme.volExp < 1) risks.push(`volume dry (${theme.volExp.toFixed(2)}x)`);

    if (accDistStats) {
      if (accDistStats.accumulationPct >= 35) positives.push(`A/D supportive (${accDistStats.accumulationPct.toFixed(1)}% 3d+ accumulation)`);
      if (accDistStats.distributionPct >= 35) risks.push(`distribution elevated (${accDistStats.distributionPct.toFixed(1)}%)`);
    }

    // More balanced "actionability" model:
    // avoid over-penalizing temporary rank fade when breadth/RS leadership are strong.
    const actionabilityScore = clamp(
      rotationScore * 0.2 +
      participationScore * 0.25 +
      leadershipScore * 0.25 +
      confirmationScore * 0.15 +
      durabilityScore * 0.15
    );
    const hardRisk = leadershipScore < 40 || participationScore < 40 || durabilityScore < 35;
    const strongLeadershipTape = leadershipScore >= 70 && participationScore >= 65;
    const improvingRotation = rotationScore >= 55;

    const tradeable =
      !hardRisk &&
      actionabilityScore >= 72 &&
      confirmationScore >= 45 &&
      (improvingRotation || strongLeadershipTape);

    const verdict = tradeable
      ? "Actionable long setup with strong participation and leadership support."
      : strongLeadershipTape && rotationScore < 45
        ? "Theme leadership is still strong, but rotation is cooling; avoid chasing fresh extension."
        : leadershipScore >= 60 && durabilityScore < 45
          ? "Strong theme, but fragile leadership concentration makes follow-through less reliable."
          : improvingRotation && confirmationScore < 45
            ? "Rotation is improving, but confirmation is incomplete."
            : actionabilityScore >= 55
              ? "Mixed but watchable setup; quality is present but not fully aligned."
              : "Theme is not offering a high-quality actionable setup right now.";

    const nextStep = tradeable
      ? "Focus on liquid leaders with clean entries and keep sizing normal only while breadth and confirmation hold."
      : strongLeadershipTape && rotationScore < 45
        ? "Treat it as a selective leadership tape: use pullbacks or relative-strength names instead of momentum chasing."
        : durabilityScore < 45
          ? "Watch top contributors and wait for participation to broaden before trusting continuation."
          : participationScore < 50
            ? "Wait for broader participation before treating this as durable rotation."
            : improvingRotation && confirmationScore < 45
              ? "Monitor volume and A/D confirmation before upgrading this to actionable."
              : "Keep it on watch and re-check when rotation and confirmation improve together.";

    const status = tradeable ? "Tradeable" : (actionabilityScore >= 55 || strongLeadershipTape) ? "Watch" : "Avoid";
    const percentile = Math.round(((totalThemes - theme.rank + 1) / totalThemes) * 100);

    return {
      rotationScore,
      participationScore,
      leadershipScore,
      confirmationScore,
      durabilityScore,
      concentrationRisk,
      verdict,
      nextStep,
      status,
      positives: positives.slice(0, 4),
      risks: risks.slice(0, 4),
      percentile,
      actionabilityScore,
    };
  }, [theme, accDistStats, totalThemes]);

  if (!theme || !model) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Target className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>Select a theme to view actionable details</p>
        </div>
      </div>
    );
  }

  const statusClass =
    model.status === "Tradeable"
      ? "bg-green-500/20 text-green-300 border-green-500/40"
      : model.status === "Watch"
        ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
        : "bg-red-500/20 text-red-300 border-red-500/40";

  return (
    <div className="h-full space-y-3 overflow-auto p-3">
      <div className="rounded border border-slate-700/40 bg-slate-900/70 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-foreground">{theme.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-slate-600 text-slate-200">
                {theme.tier}
              </Badge>
              <Badge variant="outline" className={statusClass}>
                {model.status}
              </Badge>
              {isHistorical && (
                <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
                  {timeSlice} context
                </Badge>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-foreground">#{theme.rank}</div>
            <div className="text-xs font-medium text-cyan-400">{model.percentile}th percentile</div>
          </div>
        </div>
        <div className="mt-3 rounded border border-cyan-500/30 bg-cyan-500/10 p-2 text-sm text-slate-100">
          {model.verdict}
        </div>
      </div>

      <div className="grid gap-2">
        <SegmentBar
          label="Rotation"
          score={model.rotationScore}
          detail={`Built from delta rank ${theme.deltaRank > 0 ? "+" : ""}${theme.deltaRank} and acceleration ${theme.acceleration > 0 ? "+" : ""}${theme.acceleration}.`}
        />
        <SegmentBar
          label="Participation"
          score={model.participationScore}
          detail={`Breadth ${theme.breadthPct.toFixed(1)}% of names participating.`}
        />
        <SegmentBar
          label="Leadership"
          score={model.leadershipScore}
          detail={`RS vs SPY ${theme.rsVsSpy > 0 ? "+" : ""}${theme.rsVsSpy.toFixed(2)}.`}
        />
        <SegmentBar
          label="Confirmation"
          score={model.confirmationScore}
          detail={`Volume ${theme.volExp.toFixed(2)}x${accDistStats ? `, A/D ${accDistStats.accumulationPct.toFixed(1)}% acc / ${accDistStats.distributionPct.toFixed(1)}% dist` : ""}.`}
        />
        <SegmentBar
          label="Durability"
          score={model.durabilityScore}
          detail={`Inverse concentration score. Top 3 contribution = ${Math.round((theme.top3Contribution ?? 0) * 100)}%.`}
        />
      </div>

      <Card className="border-slate-700/30 bg-slate-800/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Gauge className="h-4 w-4" />
            What To Do Next
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="rounded border border-slate-700/40 bg-slate-900/50 p-2 text-slate-100">
            {model.nextStep}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded border border-green-500/20 bg-green-500/5 p-2">
              <div className="mb-1 text-xs font-semibold text-green-300">Why It Passes</div>
              <ul className="space-y-1 text-xs text-slate-300">
                {model.positives.length ? model.positives.map((item) => <li key={item}>- {item}</li>) : <li>- No strong positives yet.</li>}
              </ul>
            </div>
            <div className="rounded border border-red-500/20 bg-red-500/5 p-2">
              <div className="mb-1 text-xs font-semibold text-red-300">What Blocks It</div>
              <ul className="space-y-1 text-xs text-slate-300">
                {model.risks.length ? model.risks.map((item) => <li key={item}>- {item}</li>) : <li>- No major blockers detected.</li>}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700/30 bg-slate-800/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Quick Decision Stats</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded border border-slate-700/40 bg-slate-900/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-slate-400"><ArrowUpDown className="h-3.5 w-3.5" /> Rotation</div>
            <div className={cn("text-sm font-semibold", theme.deltaRank > 0 ? "text-green-400" : theme.deltaRank < 0 ? "text-red-400" : "text-slate-300")}>
              {theme.deltaRank > 0 ? "+" : ""}{theme.deltaRank}
            </div>
          </div>
          <div className="rounded border border-slate-700/40 bg-slate-900/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-slate-400"><Activity className="h-3.5 w-3.5" /> Breadth</div>
            <div className="text-sm font-semibold text-slate-100">{theme.breadthPct.toFixed(1)}%</div>
          </div>
          <div className="rounded border border-slate-700/40 bg-slate-900/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-slate-400"><Target className="h-3.5 w-3.5" /> RS vs SPY</div>
            <div className={cn("text-sm font-semibold", theme.rsVsSpy >= 0 ? "text-green-400" : "text-red-400")}>
              {theme.rsVsSpy >= 0 ? "+" : ""}{theme.rsVsSpy.toFixed(2)}
            </div>
          </div>
          <div className="rounded border border-slate-700/40 bg-slate-900/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-slate-400"><Zap className="h-3.5 w-3.5" /> Volume</div>
            <div className="text-sm font-semibold text-slate-100">{theme.volExp.toFixed(2)}x</div>
          </div>
          <div className="rounded border border-slate-700/40 bg-slate-900/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-slate-400"><TrendingUp className="h-3.5 w-3.5" /> Acceleration</div>
            <div className={cn("text-sm font-semibold", theme.acceleration >= 0 ? "text-green-400" : "text-red-400")}>
              {theme.acceleration >= 0 ? "+" : ""}{theme.acceleration}
            </div>
          </div>
          <div className="rounded border border-slate-700/40 bg-slate-900/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-slate-400"><AlertTriangle className="h-3.5 w-3.5" /> Top 3</div>
            <div className={cn("text-sm font-semibold", (theme.top3Contribution ?? 0) > 0.5 ? "text-yellow-300" : "text-slate-100")}>
              {Math.round((theme.top3Contribution ?? 0) * 100)}%
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700/30 bg-slate-800/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Support Context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-slate-300">
          <div className="flex items-center justify-between rounded border border-slate-700/40 bg-slate-900/60 p-2">
            <span className="flex items-center gap-1 text-slate-400"><Users className="h-3.5 w-3.5" /> Members</span>
            <span>{theme.coreCount} core / {theme.leaderCount} leaders / {members.length} visible</span>
          </div>
          <div className="flex items-center justify-between rounded border border-slate-700/40 bg-slate-900/60 p-2">
            <span className="flex items-center gap-1 text-slate-400"><Layers className="h-3.5 w-3.5" /> ETF Proxies</span>
            <span>{theme.etfProxies?.length ?? 0}</span>
          </div>
          {theme.reasonCodes.length > 0 && (
            <div className="rounded border border-slate-700/40 bg-slate-900/60 p-2">
              <div className="mb-1 text-slate-400">Signals</div>
              <div className="flex flex-wrap gap-1">
                {theme.reasonCodes.map((code) => (
                  <Badge key={code} variant="outline" className="border-slate-600 text-slate-200">
                    {code}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
