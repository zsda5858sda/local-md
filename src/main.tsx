import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { t } from "./i18n";
import "./styles.css";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Local MD UI error", error, info.componentStack);
  }
  render() {
    if (this.state.error) return <main className="crash-screen"><AlertTriangleIcon /><h1>{t("crash.title")}</h1><p>{this.state.error}</p><button onClick={() => window.location.reload()}>{t("crash.reload")}</button></main>;
    return this.props.children;
  }
}

function AlertTriangleIcon() {
  return <span aria-hidden="true">⚠</span>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
);
