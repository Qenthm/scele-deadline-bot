import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    // Once daily at 00:00 UTC = 07:00 WIB. Vercel Hobby plans only allow one cron
    // run/day; schedules run in UTC. Edit and `vercel deploy --prod` again to change.
    { path: "/api/check-deadlines", schedule: "0 0 * * *" },
  ],
};
