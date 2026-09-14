import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = routeHandler("school-academics.types-list");
export const PUT = routeHandler("school-academics.types-set");
