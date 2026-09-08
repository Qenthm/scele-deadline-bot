import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runCheck } from "../src/run.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      res.status(401).send("Unauthorized");
      return;
    }
  }

  try {
    const result = await runCheck();
    res.status(200).json({
      ok: true,
      matchedCourses: result.matchedCourses.map((c) => c.fullname),
      unmatchedNames: result.unmatchedNames,
      eventCount: result.events.length,
      events: result.events.map((e) => ({
        course: e.course.fullname,
        name: e.name,
        type: e.modulename,
        due: new Date(e.timesort * 1000).toISOString(),
        url: e.actionUrl,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
}
