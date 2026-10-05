import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { loginPathWithReturn } from "@/lib/auth-return";
import { Loader2, Lock } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Page shows vendor market data; non-owner accounts get the "not on your plan" state instead. */
  requiresData?: boolean;
}

export function DataNotAvailable() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6" data-testid="data-not-available">
      <div className="max-w-md text-center space-y-3">
        <Lock className="w-8 h-8 mx-auto text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Not available on your plan</h1>
        <p className="text-sm text-muted-foreground">
          Market data (charts, prices, news and signals) isn't included with your account.
          Your journal, rules and settings are still available.
        </p>
        <Link href="/sentinel/trade-journal" className="inline-block text-sm underline text-foreground">
          Go to Trade Journal
        </Link>
      </div>
    </div>
  );
}

export function SentinelProtectedRoute({ children, requiresData = false }: ProtectedRouteProps) {
  const { user, isLoading } = useSentinelAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation(loginPathWithReturn());
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (requiresData && user.isOwner !== true) {
    return <DataNotAvailable />;
  }

  return <>{children}</>;
}
