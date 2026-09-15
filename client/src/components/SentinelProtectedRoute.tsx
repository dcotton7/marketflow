import { useEffect } from "react";
import { useLocation } from "wouter";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { loginPathWithReturn } from "@/lib/auth-return";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function SentinelProtectedRoute({ children }: ProtectedRouteProps) {
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

  return <>{children}</>;
}
