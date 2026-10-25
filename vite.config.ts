import { defineConfig } from "vite";

export default defineConfig({
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
  // Tests run in Node; a test that needs a DOM starts with `// @vitest-environment happy-dom`.
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: { provider: "v8", include: ["src/**"], reporter: ["text", "html"] },
  },
} as never);
