import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("people.teacher-get");
export const PATCH = routeHandler("people.teacher-update");
