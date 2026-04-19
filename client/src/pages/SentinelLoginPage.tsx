import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useSystemSettings } from "@/context/SystemSettingsContext";

export default function SentinelLoginPage() {
  const [, setLocation] = useLocation();
  const { login, register, user, isLoading: authLoading } = useSentinelAuth();
  const { toast } = useToast();
  const { cssVariables } = useSystemSettings();
  
  // Redirect if already logged in - handles the case where login succeeds but navigation didn't work
  useEffect(() => {
    if (!authLoading && user) {
      setLocation("/sentinel/market-condition");
    }
  }, [user, authLoading, setLocation]);

  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isRegistering) {
        if (password !== confirmPassword) {
          toast({ title: "Passwords do not match", variant: "destructive" });
          setIsLoading(false);
          return;
        }
        await register(username, email, password);
        toast({ title: "Account created", description: "Welcome to StructureMap" });
      } else {
        await login(username, password);
        toast({ title: "Welcome back", description: "Signed in successfully" });
      }
      setLocation("/sentinel/market-condition");
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
    <div className="min-h-screen sentinel-page flex items-center justify-center p-4" style={{ backgroundColor: cssVariables.backgroundColor, '--logo-opacity': cssVariables.logoOpacity, '--overlay-bg': cssVariables.overlayBg } as React.CSSProperties}>
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
              {isRegistering ? "Create Account" : "Sign In"}
            </CardTitle>
            <CardDescription style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
              {isRegistering
                ? "Create an account (password at least 8 characters)"
                : "Sign in with your username and password"}
            </CardDescription>
          </CardHeader>
          <CardContent>
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

              {isRegistering && (
                <div className="space-y-2">
                  <Label htmlFor="email" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>Email</Label>
                  <Input
                    id="email"
                    type="email"
                    data-testid="input-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter email"
                    required
                  />
                </div>
              )}

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
                  minLength={isRegistering ? 8 : 1}
                  autoComplete={isRegistering ? "new-password" : "current-password"}
                />
              </div>

              {isRegistering && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
                    Confirm password
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    data-testid="input-confirm-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
                data-testid="button-submit"
              >
                {isLoading
                  ? "Loading..."
                  : isRegistering
                  ? "Create Account"
                  : "Sign In"}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                className="hover:text-foreground underline"
                style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}
                onClick={() => {
                  setIsRegistering(!isRegistering);
                  setConfirmPassword("");
                }}
                data-testid="button-toggle-auth"
              >
                {isRegistering
                  ? "Already have an account? Sign in"
                  : "Don't have an account? Register"}
              </button>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
