import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',workers:1,timeout:60000,expect:{timeout:15000},
  use:{baseURL:'http://127.0.0.1:4173',viewport:{width:390,height:740}},
  webServer:{command:'npm run test:build-sdk && node tests/server.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:false}});
