import type { VercelConfig } from "@vercel/config/v1";

// No `crons` here on purpose: scheduling lives in .github/workflows/check-deadlines.yml
// (3x/day, no frequency cap, and it can persist diff state by committing to the repo).
// This deployment stays around only so /api/check-deadlines can be hit manually for an
// on-demand full report — see README.
export const config: VercelConfig = {};
