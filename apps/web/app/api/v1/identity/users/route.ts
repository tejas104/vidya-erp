import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = routeHandler("identity.user-create");
export const GET = routeHandler("identity.user-list");
