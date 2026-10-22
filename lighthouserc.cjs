// TEST-06 (#140): Lighthouse CI against each Vercel preview, run by the lighthouse job in
// .github/workflows/preview-smoke.yml. It checks the signed-out pages, since Lighthouse
// can't sign in. Locally: LIGHTHOUSE_BASE_URL=http://localhost:3000 npx -y @lhci/cli@0.15.1 autorun
const baseUrl = process.env.LIGHTHOUSE_BASE_URL;
if (!baseUrl) throw new Error("Set LIGHTHOUSE_BASE_URL to the site to check.");

// Previews sit behind Vercel Deployment Protection. The workflow scrubs this secret from
// the reports before uploading them, because a report records the headers it was sent.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

module.exports = {
  ci: {
    collect: {
      url: ["/", "/login", "/signup"].map((path) => new URL(path, baseUrl).toString()),
      numberOfRuns: 1,
      settings: {
        preset: "desktop",
        ...(bypassSecret ? { extraHeaders: JSON.stringify({ "x-vercel-protection-bypass": bypassSecret }) } : {}),
      },
    },
    assert: {
      assertions: {
        // Every page already passes axe in Playwright, so accessibility must stay high.
        "categories:accessibility": ["error", { minScore: 0.95 }],
        // Previews run on cold serverless functions, so speed only warns.
        "categories:performance": ["warn", { minScore: 0.8 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        // No SEO check: Vercel marks every preview noindex, which that score counts against.
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci/reports",
    },
  },
};
