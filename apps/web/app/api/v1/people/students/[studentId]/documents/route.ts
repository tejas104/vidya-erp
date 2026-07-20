import { routeHandler } from "@/composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = routeHandler("people.document-upload");
export const GET = routeHandler("people.document-list");
