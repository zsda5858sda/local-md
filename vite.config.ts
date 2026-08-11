import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: ["es2021", "chrome100", "safari13"],
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@tiptap") || id.includes("prosemirror") || id.includes("lowlight")) return "editor";
          if (id.includes("remark") || id.includes("mdast") || id.includes("unified")) return "markdown";
          if (id.includes("node_modules/react") || id.includes("react-dom")) return "react";
        },
      },
    },
  },
});
