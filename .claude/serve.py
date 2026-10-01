"""Tiny local file server for developing EduResourcer. It turns caching off so edited files always reload."""
import http.server


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    http.server.test(HandlerClass=NoCache, port=8766, bind='127.0.0.1')
