// ---------------------------------------------------------------------------
// Catalyst module — public API
// ---------------------------------------------------------------------------

export {
  createCatalyst,
  resolveCatalyst,
  getActiveCatalystsForSubject,
  getActiveCatalystsForSubjects,
  getAllActiveCatalysts,
  getCatalystRules,
  getEnabledRules,
  getCatalystBoost,
  updateDecayWeights,
  updateCatalystRule,
  syncFromDb,
  ensureSynced,
} from "./engine";

export { evaluateForCatalysts, checkCatalystResolution } from "./auto-detector";
export { seedDefaultCatalystRules } from "./default-rules";
