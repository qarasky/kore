import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // kore-ui is linked from the parent folder (file:..), which has its own node_modules for
  // its tests. Make sure everything uses one copy of React. A consumer installing the
  // tarball doesn't need this.
  resolve: { dedupe: ["react", "react-dom", "radix-ui", "lucide-react"] },
});
