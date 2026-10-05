import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { safeReturnPath } from "@/lib/auth-return";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useSystemSettings } from "@/context/SystemSettingsContext";

export default function SentinelLoginPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { login, user, isLoading: authLoading } = useSentinelAuth();
  const { toast } = useToast();
  const { cssVariables, pageShellStyle } = useSystemSettings();
  const returnPath = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return safeReturnPath(params.get("next"));
  }, [searchString]);
  
  // Redirect if already logged in - handles the case where login succeeds but navigation didn't work
  useEffect(() => {
    if (!authLoading && user) {
      setLocation(returnPath);
    }
  }, [user, authLoading, setLocation, returnPath]);

  const [showSignUp, setShowSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await login(username, password);
      toast({ title: "Welcome back", description: "Signed in successfully" });
      setLocation(returnPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Authentication failed";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen sentinel-page flex items-center justify-center p-4" style={pageShellStyle as React.CSSProperties}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src="/structuremap-logo.png"
            alt="StructureMap"
            className="structuremap-wordmark-glow h-36 sm:h-44 max-w-full mx-auto mb-4 object-contain"
            data-testid="img-sentinel-logo"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-auth-title" style={{ color: cssVariables.textColorTitle, fontSize: cssVariables.fontSizeTitle }}>
              {showSignUp ? "Sign-up is closed" : "Sign In"}
            </CardTitle>
            <CardDescription style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
              {showSignUp
                ? "New accounts are created by the administrator by invitation only."
                : "Sign in with your username and password"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {showSignUp ? (
              <p
                data-testid="text-signup-closed"
                style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}
              >
                If you were invited, sign in with the username and password you were given.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Username</Label>
                  <Input
                    id="username"
                    data-testid="input-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Password</Label>
                  <Input
                    id="password"
                    type="password"
                    data-testid="input-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    minLength={1}
                    autoComplete="current-password"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                  data-testid="button-submit"
                >
                  {isLoading ? "Loading..." : "Sign In"}
                </Button>
              </form>
            )}

            <div className="mt-4 text-center">
              <button
                type="button"
                className="hover:text-foreground underline"
                style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}
                onClick={() => setShowSignUp(!showSignUp)}
                data-testid="button-toggle-auth"
              >
                {showSignUp ? "Back to sign in" : "Don't have an account?"}
              </button>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
