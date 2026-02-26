export async function onRequestGet(context: any): Promise<Response> {
  const id = context.params.id as string;
  const object = await context.env.BUCKET.get(id);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
