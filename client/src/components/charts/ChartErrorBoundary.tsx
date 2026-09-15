import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  onClose?: () => void;
  label?: string;
};

type State = { error: Error | null };

/** Contains lightweight-charts / DualChartGrid crashes so Flow does not white-screen. */
export class ChartErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ChartErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-destructive">{this.props.label ?? "Chart failed to load"}</p>
          <p className="max-w-md text-center text-xs text-muted-foreground">{this.state.error.message}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </Button>
            {this.props.onClose ? (
              <Button variant="outline" size="sm" onClick={this.props.onClose}>
                Close
              </Button>
            ) : null}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
