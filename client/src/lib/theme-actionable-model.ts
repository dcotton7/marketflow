import type { ThemeRow } from "@/data/mockThemeData";

export interface ThemeAccDistStats {
  total: number;
  accumulation3Plus: number;
  distribution3Plus: number;
  accumulationPct: number;
  distributionPct: number;
}

export interface ThemeActionableModel {
  rotationScore: number;
  participationScore: number;
  leadershipScore: number;
  confirmationScore: number;
  durabilityScore: number;
  actionabilityScore: number;
  status: "Tradeable" | "Watch" | "Avoid";
  verdict: string;
  nextStep: string;
  positives: string[];
  risks: string[];
}

function clamp(v: number, low = 0, high = 100) {
  return Math.max(low, Math.min(high, v));
}

export function computeThemeActionableModel(
  theme: ThemeRow,
  accDistStats?: ThemeAccDistStats | null,
  totalThemes = 25
): ThemeActionableModel {
  const rotationScore = clamp(50 + theme.deltaRank * 10 + theme.acceleration * 4);
  const participationScore = clamp(theme.breadthPct);
  const leadershipScore = clamp(50 + theme.rsVsSpy * 10);
  const confirmationScore = clamp(
    40 +
      (theme.volExp - 1) * 22 +
      (accDistStats
        ? (accDistStats.accumulationPct - accDistStats.distributionPct) * 0.8
        : 0)
  );
  const concentrationRisk = clamp((theme.top3Contribution ?? 0) * 100);
  const durabilityScore = clamp(100 - concentrationRisk);

  const positives: string[] = [];
  const risks: string[] = [];

  if (theme.deltaRank > 0) positives.push(`rotation +${theme.deltaRank}`);
  else if (theme.deltaRank < 0) risks.push(`rotation ${theme.deltaRank}`);

  if (theme.breadthPct >= 60) positives.push(`breadth ${theme.breadthPct.toFixed(0)}%`);
  else if (theme.breadthPct < 45) risks.push(`breadth ${theme.breadthPct.toFixed(0)}%`);

  if (theme.rsVsSpy > 0) positives.push(`RS +${theme.rsVsSpy.toFixed(2)}`);
  else risks.push(`RS ${theme.rsVsSpy.toFixed(2)}`);

  if ((theme.top3Contribution ?? 0) > 0.5) {
    risks.push(`narrow ${Math.round((theme.top3Contribution ?? 0) * 100)}% top-3`);
  } else {
    positives.push("broad leadership");
  }

  if (theme.volExp >= 1.5) positives.push(`vol ${theme.volExp.toFixed(1)}x`);
  else if (theme.volExp < 1) risks.push(`vol dry ${theme.volExp.toFixed(1)}x`);

  if (accDistStats) {
    if (accDistStats.accumulationPct >= 35) {
      positives.push(`A/D acc ${accDistStats.accumulationPct.toFixed(0)}%`);
    }
    if (accDistStats.distributionPct >= 35) {
      risks.push(`A/D dist ${accDistStats.distributionPct.toFixed(0)}%`);
    }
  }

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
      ? "Leadership strong but rotation cooling — avoid chasing extension."
      : leadershipScore >= 60 && durabilityScore < 45
        ? "Strong theme, narrow leadership — follow-through less reliable."
        : improvingRotation && confirmationScore < 45
          ? "Rotation improving; confirmation incomplete."
          : actionabilityScore >= 55
            ? "Mixed but watchable — quality present, not fully aligned."
            : "Not a high-quality actionable setup right now.";

  const nextStep = tradeable
    ? "Focus on liquid leaders with clean entries."
    : strongLeadershipTape && rotationScore < 45
      ? "Use pullbacks or RS names instead of momentum chasing."
      : durabilityScore < 45
        ? "Wait for participation to broaden."
        : participationScore < 50
          ? "Wait for broader participation."
          : improvingRotation && confirmationScore < 45
            ? "Monitor volume and A/D before upgrading."
            : "Re-check when rotation and confirmation improve.";

  const status: ThemeActionableModel["status"] = tradeable
    ? "Tradeable"
    : actionabilityScore >= 55 || strongLeadershipTape
      ? "Watch"
      : "Avoid";

  void totalThemes;

  return {
    rotationScore,
    participationScore,
    leadershipScore,
    confirmationScore,
    durabilityScore,
    actionabilityScore,
    status,
    verdict,
    nextStep,
    positives: positives.slice(0, 3),
    risks: risks.slice(0, 3),
  };
}

export const ACTIONABLE_SEGMENT_LABELS = [
  "Rotation",
  "Participation",
  "Leadership",
  "Confirmation",
  "Durability",
] as const;

export function actionableSegmentScores(model: ThemeActionableModel): number[] {
  return [
    model.rotationScore,
    model.participationScore,
    model.leadershipScore,
    model.confirmationScore,
    model.durabilityScore,
  ];
}
