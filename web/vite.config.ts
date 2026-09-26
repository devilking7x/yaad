import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base '/yaad/' so the build works on GitHub Pages project sites.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/yaad/",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
});
