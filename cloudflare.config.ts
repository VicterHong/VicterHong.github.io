import { defineConfig } from "cloudflare";

export default defineConfig({
  name: "portfolio-victer",
  compatibility_date: "2025-10-01",
  compatibility_flags: ["nodejs_compat"],
  
  // Build configuration
  build: {
    command: "npm run build",
    outputDirectory: "./dist",
  },
  
  // Workers & Pages
  workers: {
    // API backend — token service
    api: {
      main: "./backend/src/index.mjs",
      routes: [
        { pattern: "api.victerhong.github.io/*", zone_name: "victerhong.github.io" }
      ],
      vars: {
        NODE_ENV: "production",
        SERVICE_SECRET: process.env.SERVICE_SECRET,
        ADMIN_KEY: process.env.ADMIN_KEY,
      },
      secrets: [
        "SERVICE_SECRET",
        "ADMIN_KEY", 
        "TURNSTILE_SECRET_KEY",
      ],
    },
    
    // Static site — portfolio frontend
    site: {
      main: "./workers/site.ts",
      assets: "./",
      routes: [
        { pattern: "victerhong.github.io/*", zone_name: "victerhong.github.io" }
      ],
    },
  },
  
  // D1 Database — token & leads
  d1_databases: [
    {
      binding: "DB",
      database_name: "portfolio-db",
      database_id: process.env.D1_DATABASE_ID,
    },
  ],
  
  // KV — session cache
  kv_namespaces: [
    {
      binding: "SESSIONS",
      id: process.env.KV_NAMESPACE_ID,
    },
  ],
  
  // R2 — asset storage
  r2_buckets: [
    {
      binding: "ASSETS",
      bucket_name: "portfolio-assets",
    },
  ],
  
  // Analytics
  analytics_engine_datasets: [
    {
      binding: "ANALYTICS",
      dataset: "portfolio-analytics",
    },
  ],
});
