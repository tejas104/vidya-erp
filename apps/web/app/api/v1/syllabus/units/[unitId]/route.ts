import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = routeHandler("syllabus.unit-update");
export const DELETE = routeHandler("syllabus.unit-delete");
