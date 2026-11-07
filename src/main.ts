import "./styles.css";
import "./ui/ui.css";
import { Game } from "./core/Game";

const game = new Game();
game.boot();

// installable / offline web app: only for the hosted multi-file build (the
// single-file and artifact builds strip the manifest link and ship no sw.js)
if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http") &&
  document.querySelector('link[rel="manifest"]')
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* not available (private mode, sandboxed frame): play online only */
    });
  });
}
