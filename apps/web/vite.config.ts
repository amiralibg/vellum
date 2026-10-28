import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// changeOrigin must be off (Vite 8's string shorthand turns it on) so the API sees APP_URL's host.
const api = { target: "http://localhost:8000", changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": api,
      "/p/": api,
      "/assets/reader": api,
      "/assets/fonts": api,
      "/health": api,
      "/robots.txt": api,
    },
  },
});
