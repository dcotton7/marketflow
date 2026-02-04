import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScannerProvider } from "@/context/ScannerContext";
import { TimeframeProvider } from "@/context/TimeframeContext";
import { SentinelAuthProvider } from "@/context/SentinelAuthContext";
import { SentinelProtectedRoute } from "@/components/SentinelProtectedRoute";
import NotFound from "@/pages/not-found";
import ScannerPage from "@/pages/ScannerPage";
import SymbolPage from "@/pages/SymbolPage";
import WatchlistPage from "@/pages/WatchlistPage";
import SentinelLoginPage from "@/pages/SentinelLoginPage";
import SentinelDashboardPage from "@/pages/SentinelDashboardPage";
import SentinelEvaluatePage from "@/pages/SentinelEvaluatePage";
import SentinelTradePage from "@/pages/SentinelTradePage";
import SentinelRulesPage from "@/pages/SentinelRulesPage";
import SentinelAdminPage from "@/pages/SentinelAdminPage";
import SentinelImportPage from "@/pages/SentinelImportPage";
import PatternLearningPage from "@/pages/PatternLearningPage";

function Router() {
  return (
    <Switch>
      {/* Scanner Routes */}
      <Route path="/" component={ScannerPage} />
      <Route path="/symbol/:symbol" component={SymbolPage} />
      <Route path="/watchlist" component={WatchlistPage} />
      
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
      <Route path="/sentinel">
        <SentinelProtectedRoute>
          <SentinelDashboardPage />
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
          <TimeframeProvider>
            <ScannerProvider>
              <Toaster />
              <Router />
            </ScannerProvider>
          </TimeframeProvider>
        </SentinelAuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
