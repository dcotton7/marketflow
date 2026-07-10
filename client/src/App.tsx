import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TimeframeProvider } from "@/context/TimeframeContext";
import { SentinelAuthProvider } from "@/context/SentinelAuthContext";
import { SentinelProtectedRoute } from "@/components/SentinelProtectedRoute";
import { SystemSettingsProvider } from "@/context/SystemSettingsContext";
import { ThemeEditorProvider } from "@/context/ThemeEditorContext";
import { WorkspacePaletteProvider } from "@/context/WorkspacePaletteContext";
import { ScannerProvider } from "@/context/ScannerContext";
import { DiscoveryFeedPanel } from "@/components/scanner/DiscoveryFeed";
import NotFound from "@/pages/not-found";
import SentinelLoginPage from "@/pages/SentinelLoginPage";
import SentinelDashboardPage from "@/pages/SentinelDashboardPage";
import SentinelEvaluatePage from "@/pages/SentinelEvaluatePage";
import SentinelTradePage from "@/pages/SentinelTradePage";
import SentinelRulesPage from "@/pages/SentinelRulesPage";
import SentinelAdminPage from "@/pages/SentinelAdminPage";
import SentinelImportPage from "@/pages/SentinelImportPage";
import SentinelTradeJournalPage from "@/pages/SentinelTradeJournalPage";
import PatternLearningPage from "@/pages/PatternLearningPage";
import BigIdeaPage from "@/pages/BigIdeaPage";
import SentinelChartsPage from "@/pages/SentinelChartsPage";
import BetaChartsPage from "@/pages/BetaChartsPage";
import AnalysisPopoutPage from "@/pages/AnalysisPopoutPage";
import LiveThemeChartsPopoutPage from "@/pages/LiveThemeChartsPopoutPage";
import SetupLibraryPage from "@/pages/SetupLibraryPage";
import SentinelSettingsPage from "@/pages/SentinelSettingsPage";
import SymbolPage from "@/pages/SymbolPage";
import StartHerePage from "@/pages/StartHerePage";
import { lazy, Suspense } from "react";
const MarketConditionPage = lazy(() => import("@/pages/MarketConditionPage"));
const ScannerPopoutPage = lazy(() => import("@/pages/ScannerPopoutPage"));
const SignalWorkbenchPage = lazy(() => import("@/pages/SignalWorkbenchPage"));

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/sentinel/login" />
      </Route>

      {/* Sentinel Routes */}
      <Route path="/sentinel/login" component={SentinelLoginPage} />
      <Route path="/sentinel/dashboard">
        <SentinelProtectedRoute>
          <SentinelDashboardPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/evaluate">
        <SentinelProtectedRoute>
          <SentinelEvaluatePage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/trade/:tradeId">
        {() => (
          <SentinelProtectedRoute>
            <SentinelTradePage />
          </SentinelProtectedRoute>
        )}
      </Route>
      <Route path="/sentinel/rules">
        <SentinelProtectedRoute>
          <SentinelRulesPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/admin">
        <SentinelProtectedRoute>
          <SentinelAdminPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/import">
        <SentinelProtectedRoute>
          <SentinelImportPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/trade-journal">
        <SentinelProtectedRoute>
          <SentinelTradeJournalPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/patterns">
        <SentinelProtectedRoute>
          <PatternLearningPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/bigidea">
        <SentinelProtectedRoute>
          <BigIdeaPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/setup-library">
        <SentinelProtectedRoute>
          <SetupLibraryPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/charts/:symbol?">
        <SentinelProtectedRoute>
          <SentinelChartsPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/beta-charts">
        <SentinelProtectedRoute>
          <BetaChartsPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/start-here">
        <SentinelProtectedRoute>
          <StartHerePage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/analysis">
        <SentinelProtectedRoute>
          <AnalysisPopoutPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/live-theme-charts">
        <SentinelProtectedRoute>
          <LiveThemeChartsPopoutPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/settings">
        <SentinelProtectedRoute>
          <SentinelSettingsPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/market-condition">
        <SentinelProtectedRoute>
          <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
            <MarketConditionPage />
          </Suspense>
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel">
        <SentinelProtectedRoute>
          <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
            <MarketConditionPage />
          </Suspense>
        </SentinelProtectedRoute>
      </Route>

      {/* Symbol/Chart page (accessible from Industry Comps, BigIdea, etc.) */}
      <Route path="/symbol/:symbol">
        <SentinelProtectedRoute>
          <SymbolPage />
        </SentinelProtectedRoute>
      </Route>

      {/* Scanner pop-out window */}
      <Route path="/scanner-popout">
        <Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-950 text-slate-400">Loading Scanner...</div>}>
          <ScannerPopoutPage />
        </Suspense>
      </Route>

      {/* Signal Workbench pop-out */}
      <Route path="/signal-workbench">
        <Suspense fallback={<div className="flex items-center justify-center h-screen bg-slate-950 text-slate-400">Loading Workbench...</div>}>
          <SignalWorkbenchPage />
        </Suspense>
      </Route>
      
      {/* Catch-all 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SentinelAuthProvider>
          <WorkspacePaletteProvider>
            <SystemSettingsProvider>
              <ScannerProvider>
                <ThemeEditorProvider>
                  <TimeframeProvider>
                    <Toaster />
                    <Router />
                    <DiscoveryFeedPanel />
                  </TimeframeProvider>
                </ThemeEditorProvider>
              </ScannerProvider>
            </SystemSettingsProvider>
          </WorkspacePaletteProvider>
        </SentinelAuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
