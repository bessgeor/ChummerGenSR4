import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { styles } from "./styles.js";

const style = document.createElement("style");
style.textContent = styles;
document.head.append(style);
createRoot(document.getElementById("root")!).render(<App />);
