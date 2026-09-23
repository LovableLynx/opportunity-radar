import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx http-server . -p 4173 -s',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Chromium probes Windows' WPAD (proxy auto-discovery) before every
        // navigation by default, even to 127.0.0.1. That probe can stall
        // for tens of seconds on this network (confirmed directly: a bare
        // page.goto to a server that curl reached in 41ms hung until
        // Playwright's own timeout, while adding --no-proxy-server made
        // the same navigation succeed in ~1.4s). All tests never talk to
        // anything but localhost, so there's no proxy to lose by disabling
        // this outright.
        launchOptions: { args: ['--no-proxy-server'] },
      },
    },
  ],
});
