import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { pdfjs } from "react-pdf";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installGlobalErrorHandlers } from "./lib/errorLog";
import { installPwaUpdater } from "./lib/pwaUpdate";
import {
  enforceRuntimeCompatibility,
  installRuntimeCompatibilityMonitor,
} from "./lib/runtimeCompatibility";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "./styles.css";

// Capture async / rAF / event-handler errors that React boundaries can't see.
installGlobalErrorHandlers();

// Keep the PWA's cached code up to date (poll for new service worker versions).
async function bootstrap(): Promise<void> {
  try {
    if (!(await enforceRuntimeCompatibility())) return;
  } catch {
    // Offline clients retain their already-cached compatible runtime.
  }

  installPwaUpdater();
  installRuntimeCompatibilityMonitor();

  // Configure the PDF.js worker (bundled with pdfjs-dist via Vite).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <I18nProvider>
            <App />
          </I18nProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

void bootstrap();
