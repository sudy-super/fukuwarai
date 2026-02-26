export async function onRequestGet(context: any): Promise<Response> {
  const id = context.params.id as string;
  const url = new URL(context.request.url);
  const origin = url.origin;

  const imgUrl  = `${origin}/img/${id}`;
  const pageUrl = `${origin}/s/${id}`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>そぽ笑い の結果</title>
  <meta property="og:title" content="そぽ笑い">
  <meta property="og:description" content="顔のパーツをドラッグして福笑いを楽しもう！">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${imgUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${imgUrl}">
  <meta http-equiv="refresh" content="0; url=/">
</head>
<body>
  <p><a href="/">そぽ笑いで遊ぶ</a></p>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
