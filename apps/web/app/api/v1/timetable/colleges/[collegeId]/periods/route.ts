import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("timetable.periods-get");
export const PUT = routeHandler("timetable.periods-set");
