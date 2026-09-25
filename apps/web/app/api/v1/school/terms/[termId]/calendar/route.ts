import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = routeHandler("school-academics.calendar");
export const PUT = routeHandler("school-academics.calendar-set");
