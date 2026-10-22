#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण टूल सर्वर (Local Web Server)
=====================================================================
लेखक: सदस्य:विक्रम प्रताप
लाइसेंस: MIT / CC BY-SA 4.0

यह एक शून्य-निर्भरता (Zero-dependency) स्थानीय वेब सर्वर है जो Python की
मानक लाइब्रेरी का उपयोग करके टूल वेबसाइट को होस्ट करता है।

उपयोग:
  python3 server.py
  python3 server.py --port 8080 --open
"""

import sys
import os
import argparse
import webbrowser
import http.server
import socketserver

DEFAULT_PORT = 8080

class WikiToolHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """कस्टम HTTP रिक्वेस्ट हैंडलर जो CORS और सही MIME प्रकार सुनिश्चित करता है।"""

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, format, *args):
        # स्वच्छ कंसोल लॉग
        sys.stdout.write(f"[{self.log_date_time_string()}] {format % args}\n")


def start_server(port: int = DEFAULT_PORT, auto_open: bool = True):
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)

    handler = WikiToolHTTPRequestHandler

    # पोर्ट पुनरुपयोग की अनुमति
    socketserver.TCPServer.allow_reuse_address = True

    try:
        with socketserver.TCPServer(("", port), handler) as httpd:
            url = f"http://localhost:{port}/index.html"
            print("=" * 70)
            print("  हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण टूल वेबसाइट (v1.0)")
            print("=" * 70)
            print(f"  🌐 सर्वर सक्रिय है: {url}")
            print(f"  📂 रूट डायरेक्टरी: {web_dir}")
            print("  🛑 सर्वर बंद करने हेतु Ctrl+C दबाएँ।")
            print("=" * 70)

            if auto_open:
                print("  🚀 आपके डिफ़ॉल्ट वेब ब्राउज़र में टूल खोला जा रहा है...")
                webbrowser.open(url)

            httpd.serve_forever()

    except OSError as e:
        if e.errno == 98:  # Address already in use
            print(f"त्रुटि: पोर्ट {port} पहले से व्यस्त है। कृपया भिन्न पोर्ट का प्रयास करें (उदा: --port 8081)")
        else:
            print(f"सर्वर आरंभ करने में त्रुटि: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n\nसर्वर सफलतापूर्वक बंद कर दिया गया। सादर!")
        sys.exit(0)


def main():
    parser = argparse.ArgumentParser(
        description="हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण टूल वेब सर्वर",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--port", "-p", type=int, default=DEFAULT_PORT, help=f"सर्वर पोर्ट (डिफ़ॉल्ट: {DEFAULT_PORT})")
    parser.add_argument("--open", "-o", action="store_true", default=True, help="ब्राउज़र में स्वतः खोलें")
    parser.add_argument("--no-open", dest="open", action="store_false", help="ब्राउज़र में स्वतः न खोलें")

    args = parser.parse_args()
    start_server(port=args.port, auto_open=args.open)


if __name__ == "__main__":
    main()
