import https from 'https';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const get = (url) => new Promise((res, rej) => {
  https.get(url, { headers: { 'user-agent': 'Mozilla/5.0' } }, (r) => {
    let d = '';
    r.on('data', (c) => (d += c));
    r.on('end', () => res(d));
  }).on('error', rej);
});
(async () => {
  // GitHub API：拿文件内容（base64）
  const urls = [
    'https://api.github.com/repos/Almamu/linux-wallpaperengine/contents/src/WallpaperEngine/Render/Objects/CImage.cpp',
    'https://api.github.com/repos/Almamu/linux-wallpaperengine/contents/src/WallpaperEngine/Render/Objects/CRenderable.cpp',
    'https://api.github.com/repos/Almamu/linux-wallpaperengine/contents/src/WallpaperEngine/Render/Objects/CParticle.cpp',
  ];
  for (const u of urls) {
    try {
      const t = await get(u);
      const j = JSON.parse(t);
      if (j && j.content) {
        const txt = Buffer.from(j.content, 'base64').toString('utf8');
        console.log('===== ' + u.split('/contents/')[1] + ' =====');
        console.log(txt.slice(0, 5000));
        console.log('');
      } else {
        console.log('===== ' + u + ' =====');
        console.log(t.slice(0, 300));
      }
    } catch (e) {
      console.log('ERR', u, e.message);
    }
  }
})();
