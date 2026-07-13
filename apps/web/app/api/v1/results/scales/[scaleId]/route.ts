import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PUT = routeHandler("results.scale-update");
export const DELETE = routeHandler("results.scale-delete");
