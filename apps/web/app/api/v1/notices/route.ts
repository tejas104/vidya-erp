import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = routeHandler("notices.create");
export const GET = routeHandler("notices.list");
