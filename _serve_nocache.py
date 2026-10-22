#!/usr/bin/env python3
"""Dev server on :8000 that sends no-store headers (browsers can never cache
the HTML/JS/CSS). Binds 0.0.0.0 (all IPv4 interfaces) so http://localhost
(which resolves to IPv4 on this machine) and http://127.0.0.1 both reach a
live socket.
"""
import http.server
import os
import socketserver
import sys

PORT = 8000
HOST = "0.0.0.0"  # all IPv4 interfaces -> localhost (IPv4) and 127.0.0.1 work


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    here = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    os.chdir(here)
    srv = Server((HOST, PORT), NoStoreHandler)
    print("Serving %s on http://0.0.0.0:%d (all IPv4 interfaces, no-store)" % (here, PORT))
    print("  -> open http://localhost:8000/dashboard.html")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
