import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("identity.user-get");
export const PATCH = routeHandler("identity.user-update");
