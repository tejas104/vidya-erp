import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = routeHandler("syllabus.topic-update");
export const DELETE = routeHandler("syllabus.topic-delete");
