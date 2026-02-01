import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScannerProvider } from "@/context/ScannerContext";
import { TimeframeProvider } from "@/context/TimeframeContext";
import NotFound from "@/pages/not-found";
import ScannerPage from "@/pages/ScannerPage";
import SymbolPage from "@/pages/SymbolPage";
import WatchlistPage from "@/pages/WatchlistPage";

function Router() {
  return (
    <Switch>
      <Route path="/" component={ScannerPage} />
      <Route path="/symbol/:symbol" component={SymbolPage} />
      <Route path="/watchlist" component={WatchlistPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TimeframeProvider>
          <ScannerProvider>
            <Toaster />
            <Router />
          </ScannerProvider>
        </TimeframeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
