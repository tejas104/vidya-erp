import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = routeHandler("exams.series-create");
export const GET = routeHandler("exams.series-list");
