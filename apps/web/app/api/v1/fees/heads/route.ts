import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = routeHandler("fees.head-create");
export const GET = routeHandler("fees.head-list");
