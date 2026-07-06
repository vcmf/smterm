import ReactDOM from "react-dom/client";
import App from "./App";

// Note: no <React.StrictMode> — it double-invokes effects in dev, which would
// spawn (and immediately kill) a second PTY. Re-enable once effects are idempotent.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
