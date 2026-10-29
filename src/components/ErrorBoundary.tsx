import React from "react";
import { Button } from "@/components/ui/button";
import { trackError } from "@/lib/analytics";

type ErrorBoundaryProps = { children: React.ReactNode };
type ErrorBoundaryState = { hasError: boolean };

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private headingRef = React.createRef<HTMLHeadingElement>();

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("React Crash:", error, errorInfo);
    trackError("react_boundary_crash", error.message);
  }

  componentDidUpdate(_: ErrorBoundaryProps, prev: ErrorBoundaryState) {
    if (this.state.hasError && !prev.hasError) {
      this.headingRef.current?.focus();
    }
  }

  handleTryAgain = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center h-screen bg-background text-center p-4"
        >
          <h2
            ref={this.headingRef}
            tabIndex={-1}
            className="text-2xl font-bold text-destructive mb-4 outline-none"
          >
            Something went wrong.
          </h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            We&apos;ve logged the issue and will look into it. Please try again.
          </p>
          <Button onClick={this.handleTryAgain}>
            Try Again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
