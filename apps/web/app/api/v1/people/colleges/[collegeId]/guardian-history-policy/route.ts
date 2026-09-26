import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("people.guardian-history-policy-get");
export const PATCH = routeHandler("people.guardian-history-policy-update");
