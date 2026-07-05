import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = routeHandler("people.org-rename");
export const DELETE = routeHandler("people.org-delete");
