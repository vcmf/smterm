import ReactDOM from "react-dom/client"
import App from "./app"
import "./fonts.css" // bundled FiraCode Nerd Font Mono (text + ligatures + icons)
import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/700.css"
// Geist Mono — app chrome (top bar, sidebar, status bar, palette).
import "@fontsource/geist-mono/400.css"
import "@fontsource/geist-mono/500.css"
import "@fontsource/geist-mono/600.css"

// Note: no <React.StrictMode> — it double-invokes effects in dev, which would
// spawn (and immediately kill) a second PTY. Re-enable once effects are idempotent.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />)
