"""Loopback-only TLS fixture. All keys are ephemeral and live in the test's tempdir."""
import http.server
import json
from pathlib import Path
import socketserver
import ssl
import subprocess
import sys
import threading

root = Path(sys.argv[1])
def openssl(*args):
    subprocess.run(["openssl", *args], cwd=root, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key",
        "-out", "ca.pem", "-days", "2", "-subj", "/CN=Puppyone fixture CA")
openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key",
        "-out", "server.csr", "-subj", "/CN=registry.npmjs.org")
(root / "extensions").write_text("subjectAltName=DNS:registry.npmjs.org\nbasicConstraints=critical,CA:FALSE\n")
openssl("x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key",
        "-CAcreateserial", "-out", "server.pem", "-days", "2", "-extfile", "extensions")
lock = threading.Lock()
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_GET(self):
        with lock, (root / "requests.jsonl").open("a") as output:
            output.write(json.dumps({"path": self.path, "cookie": self.headers.get("Cookie"),
                                     "authorization": self.headers.get("Authorization")}) + "\n")
        self.send_response(302 if self.path == "/redirect" else 200)
        if self.path == "/redirect":
            self.send_header("Location", "/landing")
            self.send_header("Set-Cookie", "fixture=must-not-be-retained; Path=/; Secure")
        self.send_header("Content-Length", "0")
        self.end_headers()
    def log_message(self, *_):
        pass
class LoopbackServer(http.server.ThreadingHTTPServer):
    def server_bind(self):
        # Skip HTTPServer.server_bind's socket.getfqdn("127.0.0.1"), which can
        # stall for 10-30s on macOS CI runners when reverse DNS/mDNS is slow.
        socketserver.TCPServer.server_bind(self)
        self.server_name = "127.0.0.1"
        self.server_port = self.server_address[1]


server = LoopbackServer(("127.0.0.1", 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(root / "server.pem", root / "server.key")
server.socket = context.wrap_socket(server.socket, server_side=True)
(root / "port").write_text(str(server.server_port))
server.serve_forever()
