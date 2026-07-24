import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: resolve(
      import.meta.dirname,
      "../../../ob/internal/server/workbench/dist",
    ),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/workbench.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: asset =>
          asset.name?.endsWith(".css")
            ? "assets/workbench.css"
            : "assets/[name][extname]",
      },
    },
  },
});
