"""Browser regression checks. Run: python3 tests/check_site.py"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import shutil
import re
import unittest

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class WebsiteChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(
            ('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT))
        )
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'
        cls.playwright = sync_playwright().start()
        executable = shutil.which('chromium') or shutil.which('google-chrome')
        cls.browser = cls.playwright.chromium.launch(
            executable_path=executable, args=['--no-sandbox']
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={'width': 1440, 'height': 900}, reduced_motion='reduce'
        )
        self.page = self.context.new_page()
        self.page.set_default_timeout(8000)
        self.errors, self.failures, self.external = [], [], []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('response', lambda r: self.failures.append(r.url) if r.status >= 400 else None)
        self.page.on('requestfailed', lambda r: self.failures.append(r.url))
        self.page.on('request', lambda r: self.external.append(r.url) if not r.url.startswith(self.url) else None)
        self.page.goto(self.url + '/#archivo', wait_until='networkidle')

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'JavaScript errors')
        self.assertEqual(self.failures, [], 'Failed resources')
        self.assertEqual(self.external, [], 'Unexpected third-party requests')

    def open_drawer(self):
        button = self.page.locator('#cabinet .is-hero .drawer-click')
        button.click()
        expect(button).to_have_attribute('aria-expanded', 'true')

    def test_resources_and_layout(self):
        expect(self.page).to_have_title('EFEDEGAM — Archivo personal')
        expect(self.page.locator('#cabinetCells .drawer-unit')).to_have_count(135)
        self.assertEqual(self.page.locator('link[rel=stylesheet]').count(), 1)
        self.assertTrue(self.page.evaluate("document.fonts.check('16px \"DM Sans\"')"))
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))

    def test_navigation_and_history(self):
        self.page.locator('.nav [data-view=about]').click()
        expect(self.page.locator('#aboutView')).to_be_visible()
        self.page.locator('#aboutView [data-view=archive]').click()
        expect(self.page.locator('#homeView')).to_be_visible()
        self.page.go_back()
        expect(self.page.locator('#aboutView')).to_be_visible()

    def test_six_projects_focus_and_close(self):
        self.open_drawer()
        cards = self.page.locator('#fileStack .file-tab')
        self.assertEqual(cards.count(), 6)
        for i in range(6):
            title = cards.nth(i).locator('.file-name').inner_text()
            cards.nth(i).focus()
            self.page.keyboard.press('Enter')
            expect(self.page.locator('#projectTitle')).to_have_text(title)
            expect(self.page.locator("#projectModal")).to_be_visible()
            self.assertTrue(self.page.locator('main').evaluate('(e) => e.inert'))
            self.page.locator('#nextProject').click()
            self.page.keyboard.press('Escape')
            expect(self.page.locator('#projectModal')).to_be_hidden()
            expect(cards.nth(i)).to_be_focused()
            self.assertFalse(self.page.locator('main').evaluate('(e) => e.inert'))
        self.page.keyboard.press('Escape')
        expect(self.page.locator('.is-hero .drawer-click')).to_have_attribute('aria-expanded', 'false')

    def test_dialog_focus_trap(self):
        self.open_drawer()
        self.page.locator('#fileStack .file-tab').first.focus()
        self.page.keyboard.press('Enter')
        expect(self.page.locator('#projectModal')).to_be_visible()
        self.page.keyboard.press('Shift+Tab')
        expect(self.page.locator('#nextProject')).to_be_focused()
        self.page.keyboard.press('Tab')
        expect(self.page.locator('#closeProject')).to_be_focused()

    def test_special_drawers(self):
        for kind in ['film', 'phone', 'ticket', 'plant']:
            button = self.page.locator(f'#cabinet [data-drawer={kind}] .drawer-click')
            # Reduced-motion intro opens the objects; first close then reopen.
            if button.get_attribute('aria-expanded') == 'true':
                button.focus()
                self.page.keyboard.press("Enter")
            expect(button).to_have_attribute('aria-expanded', 'false')
            button.focus()
            self.page.keyboard.press("Enter")
            expect(button).to_have_attribute('aria-expanded', 'true')
            button.focus()
            self.page.keyboard.press("Enter")
            expect(button).to_have_attribute('aria-expanded', 'false')

    def test_mobile_and_resize(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        expect(self.page.locator('#cabinetCells .drawer-unit')).to_have_count(90)
        self.open_drawer()
        button = self.page.locator('#touchFileButtons button').first
        expect(button).to_be_visible()
        button.click()
        expect(self.page.locator('#projectTitle')).to_have_text('Espacios imaginados')
        self.page.keyboard.press('Escape')
        self.page.set_viewport_size({'width': 1440, 'height': 900})
        expect(self.page.locator('#cabinetCells .drawer-unit')).to_have_count(135)
        self.open_drawer()

    def test_void_and_escape(self):
        self.page.locator('.is-void-drawer .drawer-click').click()
        expect(self.page.locator('#voidView')).to_be_visible()
        expect(self.page.locator('#voidTransition')).to_be_hidden()
        self.page.keyboard.press('Escape')
        expect(self.page.locator('#homeView')).to_be_visible()
        expect(self.page).to_have_url(self.url + '/#archivo')

    def test_intro_and_skip(self):
        self.page.emulate_media(reduced_motion='no-preference')
        self.page.goto(self.url, wait_until='networkidle')
        expect(self.page.locator('#skipRoomIntro')).to_be_visible()
        self.page.locator('#skipRoomIntro').click()
        expect(self.page.locator('#roomScene')).to_have_class(re.compile('is-arrived'))
        expect(self.page).to_have_url(self.url + '/#archivo')
        self.page.goto(self.url, wait_until='networkidle')
        expect(self.page).to_have_url(self.url + '/#archivo', timeout=6000)

    def test_lens_unique_ids_and_preferences(self):
        self.page.emulate_media(reduced_motion='no-preference')
        self.page.mouse.move(500, 300)
        expect(self.page.locator('#cursorReplica > [data-lens-id=siteFrame]')).to_have_count(1)
        duplicates = self.page.evaluate('''() => {
          const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
          return ids.filter((id, i) => ids.indexOf(id) !== i);
        }''')
        self.assertEqual(duplicates, [])
        self.page.emulate_media(reduced_motion='reduce')
        expect(self.page.locator('#cursorReplica')).to_be_empty()
        self.assertFalse(self.page.locator('body').evaluate("e => e.classList.contains('lens-active')"))


if __name__ == '__main__':
    unittest.main(verbosity=2)
