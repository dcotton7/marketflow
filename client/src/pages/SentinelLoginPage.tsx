import { useState } from "react";
import { useLocation } from "wouter";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export default function SentinelLoginPage() {
  const [, setLocation] = useLocation();
  const { login, register } = useSentinelAuth();
  const { toast } = useToast();

  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isRegistering) {
        await register(username, email, password);
        toast({ title: "Account created", description: "Welcome to Sentinel" });
      } else {
        await login(username, password);
        toast({ title: "Welcome back", description: "Logged in successfully" });
      }
      setLocation("/sentinel/dashboard");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Authentication failed",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2" data-testid="text-sentinel-logo">
            SENTINEL
          </h1>
          <p className="text-sm text-muted-foreground italic" data-testid="text-sentinel-tagline">
            Judgment before risk.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-auth-title">
              {isRegistering ? "Create Account" : "Sign In"}
            </CardTitle>
            <CardDescription>
              {isRegistering
                ? "Create an account to start evaluating trades"
                : "Sign in to access your trade evaluations"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
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
                  <Label htmlFor="email">Email</Label>
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
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  data-testid="input-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                />
              </div>

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
                className="text-sm text-muted-foreground hover:text-foreground underline"
                onClick={() => setIsRegistering(!isRegistering)}
                data-testid="button-toggle-auth"
              >
                {isRegistering
                  ? "Already have an account? Sign in"
                  : "Don't have an account? Register"}
              </button>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <a
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-scanner"
          >
            Go to AI Swing Scanner
          </a>
        </div>
      </div>
    </div>
  );
}
