import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TimeframeProvider } from "@/context/TimeframeContext";
import { SentinelAuthProvider } from "@/context/SentinelAuthContext";
import { SentinelProtectedRoute } from "@/components/SentinelProtectedRoute";
import { SystemSettingsProvider } from "@/context/SystemSettingsContext";
import NotFound from "@/pages/not-found";
import SentinelLoginPage from "@/pages/SentinelLoginPage";
import SentinelDashboardPage from "@/pages/SentinelDashboardPage";
import SentinelEvaluatePage from "@/pages/SentinelEvaluatePage";
import SentinelTradePage from "@/pages/SentinelTradePage";
import SentinelRulesPage from "@/pages/SentinelRulesPage";
import SentinelAdminPage from "@/pages/SentinelAdminPage";
import SentinelImportPage from "@/pages/SentinelImportPage";
import PatternLearningPage from "@/pages/PatternLearningPage";
import PatternTrainingPage from "@/pages/PatternTrainingPage";
import BigIdeaPage from "@/pages/BigIdeaPage";
import SentinelChartsPage from "@/pages/SentinelChartsPage";
import SymbolPage from "@/pages/SymbolPage";

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
      <Route path="/sentinel/patterns">
        <SentinelProtectedRoute>
          <PatternLearningPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/pattern-training">
        <SentinelProtectedRoute>
          <PatternTrainingPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/bigidea">
        <SentinelProtectedRoute>
          <BigIdeaPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel/charts">
        <SentinelProtectedRoute>
          <SentinelChartsPage />
        </SentinelProtectedRoute>
      </Route>
      <Route path="/sentinel">
        <SentinelProtectedRoute>
          <SentinelDashboardPage />
        </SentinelProtectedRoute>
      </Route>

      {/* Symbol/Chart page (accessible from Industry Comps, BigIdea, etc.) */}
      <Route path="/symbol/:symbol">
        <SentinelProtectedRoute>
          <SymbolPage />
        </SentinelProtectedRoute>
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
          <SystemSettingsProvider>
            <TimeframeProvider>
              <Toaster />
              <Router />
            </TimeframeProvider>
          </SystemSettingsProvider>
        </SentinelAuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
