import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("system.preference-get");
export const PUT = routeHandler("system.preference-set");
