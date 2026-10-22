#!/usr/bin/env python3
"""SurfinLive static server with clean Short ID routing.

Serves the project as static files (like `python3 -m http.server`), but also
rewrites clean URLs of the form

    /JQJKJ1            ->  /dyn.html?shortId=JQJKJ1
    /jqjkj1/           ->  /dyn.html?shortId=JQJKJ1

so tournament broadcasts can be shared as SurfinLive/JQJKJ1. Anything that is a
real file path (or not a valid Short ID code) falls through to the normal static
handler. A Short ID is exactly 5 uppercase letters followed by 1 digit.
"""
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
SHORT_ID_RE = re.compile(r'^[A-Z]{5}[0-9]$')

VALID = {
    'GET', 'HEAD', 'POST', 'OPTIONS',
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if path != '/' and not path.endswith('/'):
            name = path.rsplit('/', 1)[-1]
            if SHORT_ID_RE.match(name):
                self.send_response(302)
                self.send_header('Location', '/dyn.html?shortId=' + name)
                self.end_headers()
                return
        return super().do_GET()

    def log_message(self, fmt, *args):
        pass  # keep stdout quiet


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--bind', default='0.0.0.0')
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.bind, args.port), Handler)
    print('SurfinLive serving %s on http://%s:%d (clean /SHORTID urls enabled)'
          % (ROOT, args.bind, args.port))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
