import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PUT = routeHandler("academics.marks-enter");
export const GET = routeHandler("academics.assessment-marks");
