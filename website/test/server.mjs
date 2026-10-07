// node server.mjs [port] [--artifact]: serves ../site on :8765. --artifact wraps the page in a second document
// skeleton the way the claude.ai artifact host does, to check that publishing index.html as is still works.
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../site/', import.meta.url))
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css' }
const port = +process.argv.find(a => /^\d+$/.test(a)) || 8765
const artifact = process.argv.includes('--artifact')
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (url === '/' || url === '/index.html') {
    const page = readFileSync(join(root, 'index.html'), 'utf8')
    res.writeHead(200, { 'content-type': types['.html'] })
    return res.end(artifact ? `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${page}</body></html>` : page)
  }
  const f = join(root, url)
  if (!f.startsWith(root) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end('not found') }
  const data = readFileSync(f)
  const range = req.headers.range
  if (range && extname(f) in { '.mp4': 1, '.webm': 1 }) {
    const [a, b] = range.replace('bytes=', '').split('-')
    const start = +a, end = b ? +b : data.length - 1
    res.writeHead(206, { 'content-type': types[extname(f)], 'content-range': `bytes ${start}-${end}/${data.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
    return res.end(data.subarray(start, end + 1))
  }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream', 'content-length': data.length })
  res.end(data)
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}${artifact ? ' (as an artifact)' : ''}`))
