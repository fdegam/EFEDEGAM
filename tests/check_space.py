"""3D integration checks: python3 tests/check_space.py.

Chromium uses software WebGL here. This checks behavior, not phone GPU speed.
"""
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
from pathlib import Path
import re
import time
import shutil
import unittest

from playwright.sync_api import sync_playwright, expect
from check_site import QuietHandler

ROOT = Path(__file__).resolve().parents[1]


class SpaceChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=shutil.which('chromium') or shutil.which('google-chrome'),
            args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 960, 'height': 540}, reduced_motion='reduce')
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.errors, self.external, self.failed = [], [], []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('request', lambda r: self.external.append(r.url) if not r.url.startswith((self.url, 'blob:', 'data:')) else None)
        self.page.on('response', lambda r: self.failed.append(r.url) if r.status >= 400 else None)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'JavaScript errors')
        self.assertEqual(self.external, [], 'Unexpected external requests')
        self.assertEqual(self.failed, [], 'Missing resources')

    def load(self):
        self.page.goto(self.url + '/', wait_until='networkidle')
        expect(self.page.locator('#sceneViewport')).to_have_class(re.compile('is-ready'), timeout=45000)

    def state(self):
        return self.page.evaluate("async () => (await import('./scripts/space/app.js')).getRoomState()")

    def wait_state(self, expression):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            result = self.page.evaluate(
                "async () => { const s=(await import('./scripts/space/app.js')).getRoomState(); return " + expression + "; }"
            )
            if result:
                return
            self.page.wait_for_timeout(50)
        self.fail('Scene did not reach expected state: ' + expression)

    def test_initial_camera_resources_and_instancing(self):
        self.load()
        expected = self.page.request.get(self.url + '/assets/models/room.json').json()['camera']
        current = self.state()
        for a, b in zip(current['camera']['position'], expected['position']):
            self.assertAlmostEqual(a, b, places=4)
        expect(self.page.locator('#projectHotspot')).to_be_visible()
        self.assertLess(current['render']['calls'], 50, 'Repeated drawers should be instanced')
        self.assertGreater(current['render']['triangles'], 10000, 'The actual model must render')
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))

    def test_keyboard_movement_wheel_limits_and_home(self):
        self.load()
        before = self.state()['camera']
        self.page.locator('#roomCanvas').focus()
        self.page.keyboard.down('w')
        self.wait_state('s.camera.position[2] < ' + str(before['position'][2] - .12))
        self.page.keyboard.up('w')
        self.assertLess(self.state()['camera']['position'][2], before['position'][2] - .1)
        for direction, edge in [(-1, 'minZ'), (1, 'maxZ')]:
            self.page.locator('#roomCanvas').evaluate('''(canvas, direction) => {
              for(let i=0; i<40; i++)canvas.dispatchEvent(new WheelEvent('wheel', {deltaY:direction*2000, cancelable:true}));
            }''', direction)
            state = self.state()
            self.assertAlmostEqual(state['camera']['position'][2], state['bounds'][edge], places=4)
        self.page.locator('#resetCamera').click()
        self.assertEqual(self.state()['camera'], before)

    def test_drag_rotates_without_opening_a_drawer(self):
        self.load()
        before = self.state()['camera']['quaternion']
        self.page.mouse.move(300, 300)
        self.page.mouse.down()
        self.page.mouse.move(500, 350, steps=8)
        self.page.mouse.up()
        current = self.state()
        self.assertNotEqual(current['camera']['quaternion'], before)
        self.assertFalse(current['selected'])
        self.page.locator('#resetCamera').click()

    def test_focus_open_projects_and_return(self):
        self.load()
        before = self.state()['camera']
        self.page.locator('#projectHotspot').click()
        expect(self.page.locator('#toggleDrawer')).to_be_focused()
        closed = self.state()
        self.assertTrue(closed['selected'])
        self.assertLess(closed['camera']['position'][2], before['position'][2])
        self.page.locator('#toggleDrawer').click()
        opened = self.state()
        self.assertTrue(opened['isOpen'])
        self.assertAlmostEqual(opened['drawerZ'] - closed['drawerZ'], .34, places=4)
        choices = self.page.locator('#projectChoices button')
        expect(choices).to_have_count(6)
        for index in range(6):
            expected = choices.nth(index).inner_text()
            choices.nth(index).click()
            expect(self.page.locator('#projectDialog')).to_be_visible()
            expect(self.page.locator('#projectTitle')).to_have_text(expected)
            self.page.keyboard.press('Escape')
            expect(self.page.locator('#projectDialog')).not_to_be_visible()
        self.page.locator('#backToExplore').click()
        self.assertEqual(self.state()['camera'], before)
        self.assertFalse(self.state()['selected'])
        self.page.locator('#resetCamera').click()
        self.assertFalse(self.state()['isOpen'])

    def test_mobile_touch_controls_and_dialog(self):
        self.context.close()
        self.context = self.browser.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True, reduced_motion='reduce')
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.load()
        before = self.state()['camera']['position'][2]
        button = self.page.locator('[data-move=forward]')
        box = button.bounding_box()
        session = self.context.new_cdp_session(self.page)
        session.send('Input.dispatchTouchEvent', {'type':'touchStart', 'touchPoints':[{'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}]})
        self.wait_state('s.camera.position[2] < ' + str(before - .05))
        session.send('Input.dispatchTouchEvent', {'type':'touchEnd', 'touchPoints':[]})
        self.assertLess(self.state()['camera']['position'][2], before)
        self.page.locator('#focusProjects').tap()
        self.page.locator('#toggleDrawer').tap()
        self.page.locator('#projectChoices button').last.tap()
        expect(self.page.locator('#projectTitle')).to_have_text('Sin clasificar')
        self.page.locator('#closeProjectDialog').tap()
        self.page.locator('#backToExplore').tap()
        expect(self.page.locator('#walkControls')).to_be_visible()

    def test_floor_destination_and_physical_drawer_click(self):
        self.load()
        initial = self.state()['camera']['position']
        self.page.mouse.click(750, 390)
        self.assertNotEqual(self.state()['camera']['position'], initial)
        self.page.locator('#resetCamera').click()
        # Walk closer before clicking a physical part of the drawer outside
        # its HTML label; this exercises the model raycast, not the shortcut.
        self.page.locator('#roomCanvas').evaluate("canvas => {for(let i=0;i<14;i++)canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-1000,cancelable:true}));}")
        target = self.state()['drawerTarget']
        self.page.mouse.click(target['x'], target['y'])
        self.assertTrue(self.state()['selected'])
        expect(self.page.locator('#drawerPanel')).to_be_visible()

    def test_entrance_sequence_brakes_in_front_of_archive(self):
        self.page.emulate_media(reduced_motion='no-preference')
        self.page.goto(self.url + '/', wait_until='networkidle')
        expect(self.page.locator('#sceneViewport')).to_have_class(re.compile('is-ready'), timeout=45000)
        self.assertTrue(self.state()['intro'])
        expect(self.page.locator('#skipIntro')).to_be_visible()
        start = self.state()['camera']['position'][2]
        samples = []
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            s = self.state()
            samples.append(s['camera']['position'][2])
            if not s['intro']:
                break
            self.page.wait_for_timeout(20)
        final = self.state()
        self.assertFalse(final['intro'], 'Entrance must end by itself')
        self.assertAlmostEqual(final['camera']['position'][2], 3.9, places=3)
        self.assertGreater(start, 6, 'The entrance starts far from the archive')
        self.assertEqual(final['openDrawers'], [])
        expect(self.page.locator('#introTitle')).to_be_hidden()
        expect(self.page.locator('#walkControls')).to_be_visible()

    def test_skip_entrance(self):
        self.page.emulate_media(reduced_motion='no-preference')
        self.page.goto(self.url + '/', wait_until='networkidle')
        expect(self.page.locator('#skipIntro')).to_be_visible(timeout=45000)
        self.page.locator('#skipIntro').click()
        state = self.state()
        self.assertFalse(state['intro'])
        self.assertAlmostEqual(state['camera']['position'][2], 3.9, places=4)

    def test_every_drawer_opens_independently(self):
        self.load()
        self.assertEqual(self.state()['drawerCount'], 156)
        self.page.locator('#roomCanvas').evaluate("canvas => {for(let i=0;i<14;i++)canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-1000,cancelable:true}));}")
        for drawer in ['C05_F07', 'C08_F10']:
            point = self.page.evaluate("async id => (await import('./scripts/space/app.js')).getRoomState().drawerScreen(id)", drawer)
            self.page.mouse.click(point['x'] - 30, point['y'] + 12)
        self.assertEqual(sorted(self.state()['openDrawers']), ['C05_F07', 'C08_F10'])
        self.assertFalse(self.state()['selected'], 'Plain drawers open in place')
        point = self.page.evaluate("async () => (await import('./scripts/space/app.js')).getRoomState().drawerScreen('C05_F07')")
        self.page.mouse.click(point['x'] - 30, point['y'] + 12)
        self.assertEqual(self.state()['openDrawers'], ['C08_F10'])
        self.page.locator('#resetCamera').click()
        self.assertEqual(self.state()['openDrawers'], [])

    def test_named_drawers_keep_their_names(self):
        self.load()
        tags = self.page.locator('.drawer-tag')
        expect(tags).to_have_count(5)
        names = [t.lower() for t in tags.all_inner_texts()]
        for name in ['el vacío', 'planta pixelada', 'película analógica', 'teléfono', 'ticket']:
            self.assertTrue(any(name in t for t in names), name)
        self.page.locator('.drawer-tag', has_text='EL VACÍO').click()
        self.assertEqual(self.state()['selected'], 'C11_F05')
        expect(self.page.locator('#drawerTitle')).to_have_text('El vacío')
        expect(self.page.locator('#drawerCode')).to_have_text('CAJÓN 099')
        self.page.locator('#toggleDrawer').click()
        self.assertIn('C11_F05', self.state()['openDrawers'])
        expect(self.page.locator('#projectChoices')).to_be_hidden()

    def test_context_loss_restores_static_poster(self):
        self.load()
        self.page.locator('#roomCanvas').dispatch_event('webglcontextlost', {'cancelable':True})
        expect(self.page.locator('#sceneError')).to_be_visible()
        expect(self.page.locator('#scenePoster')).to_be_visible()
        self.assertFalse(self.state()['ready'])

    def test_no_webgl_fallback(self):
        self.page.add_init_script('''(() => {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            if(type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')return null;
            return original.call(this, type, ...args);
          };
        })();''')
        self.page.goto(self.url + '/', wait_until='networkidle')
        expect(self.page.locator('#sceneError')).to_be_visible()
        expect(self.page.locator('#scenePoster')).to_be_visible()
        expect(self.page.locator('#fallbackProjects details')).to_have_count(6)
        first = self.page.locator('#fallbackProjects details').first
        first.locator('summary').click()
        expect(first.locator('p').last).to_be_visible()
        expect(self.page.locator('#sceneViewport')).to_have_attribute('aria-busy', 'false')

    def test_animated_focus_completes_and_idle_render_stops(self):
        self.page.emulate_media(reduced_motion='no-preference')
        self.load()
        self.page.locator('#focusProjects').click()
        self.wait_state('Math.abs(s.camera.position[2] - 1.25) < .0005')
        self.assertAlmostEqual(self.state()['camera']['position'][2], 1.25, places=3)
        self.page.locator('#toggleDrawer').click()
        self.wait_state('!s.framePending')
        self.assertFalse(self.state()['framePending'], 'Idle scene must stop scheduling frames')
        self.page.keyboard.press('Escape')
        self.wait_state('!s.framePending')
        self.assertFalse(self.state()['selected'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
