"""Entry-point and native fallback checks: python3 tests/check_site.py."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import shutil
import unittest

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class WebsiteChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=shutil.which('chromium') or shutil.which('google-chrome'),
            args=['--no-sandbox'],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        # The complete native project fallback must work without running JS.
        self.context = self.browser.new_context(java_script_enabled=False)
        self.page = self.context.new_page()
        self.failures, self.external = [], []
        self.page.on('response', lambda r: self.failures.append(r.url) if r.status >= 400 else None)
        self.page.on('request', lambda r: self.external.append(r.url) if not r.url.startswith(self.url) else None)
        self.page.goto(self.url + '/', wait_until='networkidle')

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.failures, [], 'Missing resources')
        self.assertEqual(self.external, [], 'Unexpected external requests')

    def test_root_is_the_room(self):
        expect(self.page).to_have_title('EFEDEGAM — Archivo personal')
        expect(self.page.locator('#sceneViewport')).to_have_count(1)
        expect(self.page.locator('script[type=module]')).to_have_attribute('src', 'scripts/space/app.js')
        self.assertEqual(self.page.locator('.portfolio-link, .nav, #homeView, #aboutView').count(), 0)
        self.assertEqual(self.page.locator('a[href="espacio.html"]').count(), 0)

    def test_projects_readable_without_javascript(self):
        expect(self.page.locator('#sceneError')).to_be_visible()
        expect(self.page.locator('#sceneViewport')).to_have_attribute('aria-busy', 'false')
        expect(self.page.locator('#scenePoster')).to_be_visible()
        choices = self.page.locator('#fallbackProjects details')
        expect(choices).to_have_count(6)
        choices.first.locator('summary').click()
        expect(choices.first.locator('p').last).to_be_visible()
        expect(self.page.locator('#retryScene')).not_to_be_visible()
        expect(self.page.locator('#loadingState')).not_to_be_visible()

    def test_mobile_native_fallback_fits(self):
        self.page.set_viewport_size({'width':390,'height':844})
        expect(self.page.locator('#sceneError')).to_be_visible()
        last = self.page.locator('#fallbackProjects details').last
        last.locator('summary').click()
        expect(last.locator('p').last).to_be_visible()
        rect = self.page.locator('#sceneError').bounding_box()
        self.assertGreaterEqual(rect['x'], 0)
        self.assertLessEqual(rect['x'] + rect['width'], 390)
        self.assertLessEqual(rect['height'], 844)

    def test_old_room_address_redirects_home(self):
        self.page.goto(self.url + '/espacio.html', wait_until='networkidle')
        expect(self.page).to_have_url(self.url + '/')
        expect(self.page.locator('#sceneViewport')).to_have_count(1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
