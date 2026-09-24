import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("people.teacher-list");
export const POST = routeHandler("people.teacher-create");
