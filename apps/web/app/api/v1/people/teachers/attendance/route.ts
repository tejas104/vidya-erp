import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("people.teacher-attendance-list");
export const PUT = routeHandler("people.teacher-attendance-save");
