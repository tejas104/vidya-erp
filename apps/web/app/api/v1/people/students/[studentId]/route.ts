import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("people.student-get");
export const PATCH = routeHandler("people.student-update");
