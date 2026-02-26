export async function onRequestPost(context: any): Promise<Response> {
  try {
    const body = await context.request.arrayBuffer();
    const id = crypto.randomUUID();
    await context.env.BUCKET.put(id, body, {
      httpMetadata: { contentType: 'image/png' },
    });
    return Response.json({ id });
  } catch {
    return new Response('Upload failed', { status: 500 });
  }
}
