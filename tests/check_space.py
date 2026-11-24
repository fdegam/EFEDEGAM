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

    def load(self, query=''):
        # Shader compilation can block the page for minutes here: no short navigation timeout.
        self.page.goto(self.url + '/' + query, wait_until='domcontentloaded', timeout=180000)
        expect(self.page.locator('#sceneViewport')).to_have_class(re.compile('is-ready'), timeout=420000)
        self.enter()

    def enter(self):
        # With motion allowed, the loader waits for «Mantener pulsado para abrir».
        if self.page.locator('#enterRoom').is_visible():
            self.hold_sphere(3.4)

    def hold_sphere(self, seconds):
        box = self.page.locator('#enterRoom').bounding_box()
        self.page.mouse.move(box['x'] + box['width'] / 2, box['y'] + 60)
        self.page.mouse.down()
        self.page.wait_for_timeout(int(seconds * 1000))
        self.page.mouse.up()

    def state(self):
        return self.page.evaluate("async () => (await import('./scripts/space/app.js')).getRoomState()")

    def wait_state(self, expression):
        # Software WebGL draws about one frame per second at this size; the
        # drawer and its folders need ~20 frames to settle.
        deadline = time.monotonic() + 45
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
        # Named drawers carry stickers and name cards in 3D; the HTML shortcut
        # stays for the keyboard and appears only when focused.
        self.assertEqual(current['labels'], 6)
        expect(self.page.locator('#projectHotspot')).to_have_css('opacity', '0')
        self.page.locator('#projectHotspot').focus()
        self.page.keyboard.press('Tab')
        self.page.keyboard.press('Shift+Tab')
        expect(self.page.locator('#projectHotspot')).to_have_css('opacity', '1')
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
        self.page.locator('#projectHotspot').focus()
        self.page.keyboard.press('Enter')
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
        # No on-screen arrows: on a phone you walk by touching the floor.
        expect(self.page.locator('[data-move]')).to_have_count(0)
        before = self.state()['camera']['position']
        self.page.touchscreen.tap(195, 690)
        self.wait_state('s.camera.position[2] !== ' + str(before[2]) + ' || s.camera.position[0] !== ' + str(before[0]))
        self.assertNotEqual(self.state()['camera']['position'], before)
        self.page.locator('#focusProjects').tap()
        self.page.locator('#toggleDrawer').tap()
        self.page.locator('#projectChoices button').last.tap()
        expect(self.page.locator('#projectTitle')).to_have_text('Sin clasificar')
        self.page.locator('#closeProjectDialog').tap()
        self.page.locator('#backToExplore').tap()
        expect(self.page.locator('#movementHelp')).to_be_visible()

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
        self.page.goto(self.url + '/', wait_until='domcontentloaded', timeout=180000)
        expect(self.page.locator('#sceneViewport')).to_have_class(re.compile('is-ready'), timeout=420000)
        expect(self.page.locator('#enterRoom')).to_be_visible()
        self.assertTrue(self.state()['awaitingEnter'])
        self.hold_sphere(3.4)
        self.wait_state('s.intro')
        self.assertTrue(self.state()['sound']['created'], 'Holding unlocks the sound')
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
        self.assertAlmostEqual(final['camera']['position'][2], 2.95, places=3)
        # The construction is over: whole room drawn, fully lit, no lines left.
        self.assertFalse(final['building'])
        self.assertGreaterEqual(final['reveal']['radius'], 1000)
        self.assertEqual(final['reveal']['power'], 1)
        self.assertEqual(final['reveal']['lines'], 0)
        self.assertTrue(final['figure']['inScene'])
        self.assertGreater(final['figure']['points'], 20000)
        self.assertFalse(final['wallTitle']['visible'])
        self.assertGreater(start, 6, 'The entrance starts far from the archive')
        self.assertEqual(final['openDrawers'], [])
        expect(self.page.locator('#introTitle')).to_be_hidden()
        expect(self.page.locator('#lightSwitch')).to_be_visible()

    def test_skip_entrance(self):
        self.page.emulate_media(reduced_motion='no-preference')
        self.page.goto(self.url + '/', wait_until='domcontentloaded', timeout=180000)
        expect(self.page.locator('#sceneViewport')).to_have_class(re.compile('is-ready'), timeout=420000)
        expect(self.page.locator('#enterRoom')).to_be_visible()
        self.assertTrue(self.state()['awaitingEnter'])
        self.hold_sphere(3.4)
        self.wait_state('s.intro')
        self.assertTrue(self.state()['sound']['created'], 'Holding unlocks the sound')
        # Software WebGL is slow: press the button as soon as it appears.
        self.page.wait_for_function("() => { const b = document.querySelector('#skipIntro'); if (b && !b.hidden) { b.click(); return true; } return false; }", polling=20, timeout=45000)
        state = self.state()
        self.assertFalse(state['intro'])
        self.assertAlmostEqual(state['camera']['position'][2], 2.95, places=4)
        self.assertFalse(state['building'], 'Skipping must leave the room built')
        self.assertGreaterEqual(state['reveal']['radius'], 1000)
        self.assertEqual(state['reveal']['power'], 1)

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

    def test_ctrl_key_switches_the_lights(self):
        self.load()
        key = self.page.locator('#lightSwitch')
        expect(key).to_be_visible()
        self.assertTrue(self.state()['lights']['on'])
        key.click()
        self.wait_state('!s.lights.on && s.lights.power <= 0.05')
        expect(key).to_have_attribute('aria-pressed', 'true')
        # Ctrl combined with another key is not a light switch.
        self.page.keyboard.press('Control+c')
        self.assertFalse(self.state()['lights']['on'])
        # The physical Ctrl key, pressed alone, switches them back on.
        self.page.keyboard.press('Control')
        self.wait_state('s.lights.on && s.lights.power === 1')
        expect(key).to_have_attribute('aria-pressed', 'false')

    def test_sphere_opens_only_after_three_seconds(self):
        self.page.emulate_media(reduced_motion='no-preference')
        self.page.goto(self.url + '/', wait_until='domcontentloaded', timeout=180000)
        expect(self.page.locator('#enterRoom')).to_be_visible(timeout=420000)
        expect(self.page.locator('#enterRoom')).to_contain_text('Mantener pulsado para abrir')
        # Released after one second: nothing opens, the sphere calms down.
        self.hold_sphere(1.0)
        self.page.wait_for_timeout(600)
        state = self.state()
        self.assertTrue(state['awaitingEnter'])
        self.assertFalse(state['entrance']['opened'])
        # Held with the keyboard for three seconds: it bursts and the room builds.
        self.page.locator('#enterRoom').focus()
        self.page.keyboard.down('Space')
        self.page.wait_for_timeout(3400)
        self.page.keyboard.up('Space')
        self.wait_state('s.entrance.opened && s.intro && !s.awaitingEnter')
        expect(self.page.locator('#loadingState')).to_be_hidden()

    def test_person_of_light_opens_about(self):
        self.load('?sinparpadeo')
        # The figure is on screen from the reference view: press it.
        box = self.page.evaluate('''async () => {
          const m = await import('./scripts/space/app.js');
          return m.getRoomState().camera;
        }''')
        self.assertIsNotNone(box)
        self.page.locator('#aboutHotspot').focus()
        self.page.keyboard.press('Enter')
        self.wait_state('s.about')
        expect(self.page.locator('#aboutPanel')).to_be_visible()
        expect(self.page.locator('#aboutTitle')).to_contain_text('Sobre mí')
        self.wait_state('Math.abs(s.camera.position[1] - 1.58) < 0.01')
        self.page.keyboard.press('Escape')
        self.wait_state('!s.about')
        expect(self.page.locator('#aboutPanel')).to_be_hidden()

    def test_sound_key_mutes_and_remembers(self):
        self.load()
        key = self.page.locator('#soundSwitch')
        expect(key).to_be_visible()
        expect(key).to_have_attribute('aria-pressed', 'false')
        self.assertFalse(self.state()['sound']['muted'])
        key.click()
        expect(key).to_have_attribute('aria-pressed', 'true')
        self.assertTrue(self.state()['sound']['muted'])
        # The choice survives a reload; «M» switches it back on.
        self.load()
        expect(self.page.locator('#soundSwitch')).to_have_attribute('aria-pressed', 'true')
        self.page.locator('#roomCanvas').focus()
        self.page.keyboard.press('m')
        expect(self.page.locator('#soundSwitch')).to_have_attribute('aria-pressed', 'false')
        self.assertFalse(self.state()['sound']['muted'])

    def test_a_tube_flickers_and_the_room_settles(self):
        self.page.emulate_media(reduced_motion='no-preference')
        self.load('?debug&sinintro&sinparpadeo')
        panels = self.page.evaluate('window.__efedegam.flicker([3])')
        self.assertEqual(panels, [3])
        self.assertTrue(self.state()['lights']['flickering'])
        self.wait_state('!s.lights.flickering && s.lights.power === 1')
        self.assertTrue(self.state()['lights']['on'])

    def test_plantimania_ivy_takes_the_room(self):
        self.page.goto(self.url + '/?sinsalida', wait_until='domcontentloaded', timeout=180000)
        expect(self.page.locator('#sceneViewport')).to_have_class(re.compile('is-ready'), timeout=420000)
        tag = self.page.locator('.drawer-tag', has_text='PLANTIMANÍA')
        tag.focus()
        self.page.keyboard.press('Enter')
        expect(self.page.locator('#drawerTitle')).to_have_text('Plantimanía')
        self.page.locator('#toggleDrawer').click()
        state = self.state()
        self.assertEqual(state['ivy']['stage'], 1)
        self.assertGreater(state['ivy']['leaves'], 20000)
        # Pressing the open drawer again lets the ivy take the room.
        point = self.page.evaluate("async () => (await import('./scripts/space/app.js')).getRoomState().drawerScreen('C04_F09')")
        self.page.mouse.click(point['x'] - 40, point['y'] + 10)
        self.wait_state('s.ivy.stage >= 2')
        # With reduced motion it reaches the green at once; ?sinsalida keeps
        # the test here instead of opening the Plantimanía site.
        self.wait_state('s.ivy.left')
        expect(self.page.locator('.ivy-veil')).to_have_css('opacity', '1')

    def test_named_drawers_keep_their_names(self):
        self.load()
        tags = self.page.locator('.drawer-tag')
        expect(tags).to_have_count(5)
        names = [t.lower() for t in tags.all_inner_texts()]
        for name in ['el vacío', 'plantimanía', 'película analógica', 'teléfono', 'ticket']:
            self.assertTrue(any(name in t for t in names), name)
        self.page.locator('.drawer-tag', has_text='EL VACÍO').focus()
        self.page.keyboard.press('Enter')
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
