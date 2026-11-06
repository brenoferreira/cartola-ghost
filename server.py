#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Cartola Ghost 1v1 - Local Dev Server & CORS Proxy
Serves static files and proxies Cartola Globo API JSON and images (PNG/SVG/JPG)
with full CORS headers to ensure WebGL textures load flawlessly.
"""

import argparse
import mimetypes
import os
import sys
import urllib.request
import urllib.error
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class handler(SimpleHTTPRequestHandler):
    """
    HTTP handler compatible with standard library HTTPServer and Vercel Python runtime.
    """
    def __init__(self, *args, **kwargs):
        if 'directory' not in kwargs and DIRECTORY:
            kwargs['directory'] = DIRECTORY
        super().__init__(*args, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        # Handle API & Image Proxy endpoint: /proxy?url=<encoded_url>
        if parsed.path in ('/proxy', '/server', '/api/proxy') or parsed.path.startswith('/proxy'):
            query = urllib.parse.parse_qs(parsed.query)
            target_url = query.get('url', [None])[0]

            if not target_url:
                self.send_response(400)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'Parametro url ausente')
                return

            # Allow cartola and glbimg asset domains
            allowed_domains = ['api.cartola.globo.com', 'cartola.globo.com', 'glbimg.com', 'globo.com']
            parsed_target = urllib.parse.urlparse(target_url)
            if not any(parsed_target.netloc.endswith(domain) for domain in allowed_domains):
                self.send_response(403)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'Dominio nao permitido pelo proxy')
                return

            try:
                req = urllib.request.Request(
                    target_url,
                    headers={
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': '*/*'
                    }
                )
                with urllib.request.urlopen(req, timeout=10) as response:
                    content = response.read()

                    # Determine real content type
                    content_type = response.headers.get('Content-Type')
                    if not content_type:
                        guessed, _ = mimetypes.guess_type(target_url)
                        content_type = guessed or 'application/octet-stream'

                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(content)))
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
                    self.send_header('Cache-Control', 'public, max-age=86400')
                    self.end_headers()
                    self.wfile.write(content)
            except urllib.error.HTTPError as e:
                self.send_response(e.code)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(e.read())
            except Exception as e:
                self.send_response(502)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
            return

        # Default static file serving
        return super().do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept')
        self.end_headers()


# Alias for backward compatibility
CartolaProxyHandler = handler


def run():
    parser = argparse.ArgumentParser(description="Cartola Ghost 1v1 - Local Server")
    parser.add_argument("--port", "-p", type=int, default=8000, help="Porta do servidor (padrão: 8000)")
    args = parser.parse_args()

    port = args.port
    server_address = ('', port)

    try:
        httpd = HTTPServer(server_address, handler)
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"⚠️  Porta {port} ocupada. Tentando porta {port + 1}...")
            port += 1
            server_address = ('', port)
            httpd = HTTPServer(server_address, handler)
        else:
            raise

    print("=" * 65)
    print("  🏁 CARTOLA GHOST 1v1 - SERVIDOR & PROXY DE IMAGENS ATIVO 🏁")
    print(f"  Abra no seu navegador: http://localhost:{port}")
    print("=" * 65)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
        sys.exit(0)


if __name__ == '__main__':
    run()
