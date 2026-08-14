/** Health probe for the platform's load balancer / Railway healthcheck. */
export function GET() {
  return Response.json({ status: "ok" });
}
