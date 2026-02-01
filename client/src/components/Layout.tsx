import { Link, useLocation } from "wouter";
import { LayoutDashboard, LineChart, Search, Menu, Star } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { WatchlistWidget } from "./WatchlistWidget";
import { SavedScansWidget } from "./SavedScansWidget";
import { MarketIndicators } from "./MarketIndicators";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Scanner", icon: Search },
    { href: "/watchlist", label: "Watchlist", icon: Star },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row font-sans">
      {/* Mobile Header */}
      <header className="md:hidden border-b bg-card p-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2 font-bold text-xl text-primary">
          <LineChart className="w-6 h-6" />
          <span>AI Swing Scanner</span>
        </div>
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="w-6 h-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="bg-card border-r-border w-72 p-0">
            <div className="p-6">
              <div className="flex items-center gap-2 font-bold text-2xl text-primary mb-8">
                <LineChart className="w-8 h-8" />
                <span>AI Swing Scanner</span>
              </div>
              <nav className="flex flex-col gap-2">
                {navItems.map((item) => (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                        location === item.href
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      }`}
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.label}
                    </div>
                  </Link>
                ))}
              </nav>
              <div className="mt-8">
                <WatchlistWidget />
              </div>
              <div className="mt-6 pt-4 border-t border-border/50">
                <SavedScansWidget />
              </div>
              <div className="mt-6 pt-4 border-t border-border/50">
                <MarketIndicators />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card/50 backdrop-blur-sm h-screen sticky top-0">
        <div className="p-6 border-b border-border/50">
          <div className="flex items-center gap-2 font-bold text-2xl text-primary tracking-tight">
            <LineChart className="w-7 h-7" />
            <span>AI Swing Scanner</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <div
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 cursor-pointer ${
                  location === item.href
                    ? "bg-primary/10 text-primary font-medium shadow-[0_0_20px_rgba(59,130,246,0.1)]"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </div>
            </Link>
          ))}

          <div className="pt-8">
            <WatchlistWidget />
          </div>
          <div className="pt-4">
            <SavedScansWidget />
          </div>
        </nav>

        <div className="p-4 border-t border-border/50">
          <MarketIndicators />
        </div>
        <div className="p-2 border-t border-border/50 text-xs text-muted-foreground text-center">
          Data Delayed 15m
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
          {children}
        </div>
      </main>
    </div>
  );
}
