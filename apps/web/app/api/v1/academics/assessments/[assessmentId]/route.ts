import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = routeHandler("academics.assessment-get");
export const DELETE = routeHandler("academics.assessment-delete");
