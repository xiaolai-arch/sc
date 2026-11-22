import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { DEFAULT_DISPLAY_NAME } from '../src/main/settings/defaults';
import { launchStudyCoach, type LaunchedStudyCoach } from './support/launch';

/**
 * P3 acceptance: at the two common laptop sizes the shell must render one
 * navigation sidebar plus the content column — never a squeezed body, never a
 * third column. This is real rendering: jsdom cannot compute layout, so the
 * assertions run against the live Electron window resized to the exact target
 * content size (setContentSize, so the OS title bar does not skew the numbers).
 */
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 }
] as const;

/** Same range the sidebar itself clamps to (NavigationSidebar.tsx). */
const SIDEBAR_MIN_WIDTH = 264;
const SIDEBAR_MAX_WIDTH = 420;
const PX = 1;
/**
 * Windows rounds the frame around the requested content size, so the window
 * can land one pixel off the target. Everything inside the page uses the
 * measured viewport, and the geometry assertions run against it, so a 1px
 * frame rounding does not change what is under test.
 */
const FRAME_ROUNDING_PX = 1;

type Box = { left: number; right: number; width: number };

type LayoutProbe = {
  viewport: { width: number; height: number };
  overflow: { documentElement: boolean; body: boolean; window: boolean };
  scrollWidths: {
    documentScrollWidth: number;
    documentClientWidth: number;
    bodyScrollWidth: number;
    bodyClientWidth: number;
  };
  asideCount: number;
  complementaryCount: number;
  sidebarVisible: boolean;
  sidebar: Box;
  rowColumns: Box[];
  contentPaneCount: number;
};

/** Greeting of the conversation home, as in desktop.spec.ts. */
const HOME_GREETING = new RegExp(
  `^(早上好|中午好|下午好|晚上好|夜深了)，${DEFAULT_DISPLAY_NAME}。$`
);

function closeTo(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/**
 * Resizes the main window's web contents to width x height CSS pixels and
 * waits until the renderer reports that viewport. Content size, not outer
 * size, is what the page lays out in. Windows frame rounding lands the
 * content a pixel off, so the second call re-requests the observed
 * difference; the renderer side only needs to be within one pixel.
 */
async function setContentPaneSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      if (!win) throw new Error('main window not found');
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(size.width, size.height);
      const [actualWidth, actualHeight] = win.getContentSize();
      win.setContentSize(
        size.width - (actualWidth - size.width),
        size.height - (actualHeight - size.height)
      );
    },
    { width, height }
  );
  await expect
    .poll(
      async () => {
        const [actualWidth, actualHeight] = await page.evaluate(() => [
          window.innerWidth,
          window.innerHeight
        ]);
        return Math.max(Math.abs(actualWidth - width), Math.abs(actualHeight - height));
      },
      { timeout: 15_000, message: 'window content size never reached the target viewport' }
    )
    .toBeLessThanOrEqual(FRAME_ROUNDING_PX);
}

async function probeLayout(page: Page): Promise<LayoutProbe> {
  return page.evaluate(() => {
    const isVisible = (element: Element): boolean => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const box = (element: Element): { left: number; right: number; width: number } => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    };

    const documentElement = document.documentElement;
    const body = document.body;
    const asides = Array.from(document.querySelectorAll<HTMLElement>('aside[aria-label="导航"]'));
    const aside = asides[0];
    // The shell row that owns the sidebar and the content column.
    const row = aside?.parentElement;
    const columns = row ? Array.from(row.children).filter(isVisible) : [];
    const contentColumn = columns.find((element) => element !== aside);
    const contentPanes = contentColumn ? Array.from(contentColumn.children).filter(isVisible) : [];

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflow: {
        documentElement: documentElement.scrollWidth > documentElement.clientWidth,
        body: body.scrollWidth > body.clientWidth,
        window: documentElement.scrollWidth > window.innerWidth
      },
      scrollWidths: {
        documentScrollWidth: documentElement.scrollWidth,
        documentClientWidth: documentElement.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth
      },
      asideCount: asides.length,
      complementaryCount: document.querySelectorAll('aside, [role="complementary"]').length,
      sidebarVisible: aside ? isVisible(aside) : false,
      sidebar: aside ? box(aside) : { left: NaN, right: NaN, width: 0 },
      rowColumns: columns.map(box),
      contentPaneCount: contentPanes.length
    };
  });
}

test.describe('ASAKI viewport layout (P3)', () => {
  for (const { width, height } of VIEWPORTS) {
    test(`conversation home lays out at ${width}x${height}`, async () => {
      const launched: LaunchedStudyCoach = await launchStudyCoach();
      const { app, page } = launched;
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      try {
        await test.step('opens the conversation home', async () => {
          await expect(page.getByText(HOME_GREETING)).toBeVisible();
        });

        await test.step(`resizes the window content to ${width}x${height}`, async () => {
          await setContentPaneSize(app, page, width, height);
        });

        const layout = await test.step('probes the rendered layout', async () => {
          const probe = await probeLayout(page);
          // The measured viewport must be the target up to frame rounding.
          expect(
            Math.abs(probe.viewport.width - width),
            `viewport width ${probe.viewport.width} should be ${width}±${FRAME_ROUNDING_PX}`
          ).toBeLessThanOrEqual(FRAME_ROUNDING_PX);
          expect(
            Math.abs(probe.viewport.height - height),
            `viewport height ${probe.viewport.height} should be ${height}±${FRAME_ROUNDING_PX}`
          ).toBeLessThanOrEqual(FRAME_ROUNDING_PX);
          return probe;
        });

        await test.step('no horizontal overflow', () => {
          expect(layout.overflow.documentElement, 'documentElement must not overflow horizontally').toBe(false);
          expect(layout.overflow.body, 'body must not overflow horizontally').toBe(false);
          expect(layout.overflow.window, 'page content must not exceed the viewport width').toBe(false);
        });

        await test.step('one sidebar plus one content column, no third column', () => {
          // Exactly one navigation sidebar exists, is visible, sits at the left
          // edge, and stays inside its designed width range.
          expect(layout.asideCount, 'exactly one nav sidebar').toBe(1);
          expect(layout.complementaryCount, 'no second complementary pane').toBe(1);
          expect(layout.sidebarVisible, 'the nav sidebar is visible').toBe(true);
          expect(layout.sidebar.left, 'the nav sidebar starts at the left edge').toBe(0);
          expect(
            layout.sidebar.width,
            `sidebar width ${layout.sidebar.width} inside [${SIDEBAR_MIN_WIDTH}, ${SIDEBAR_MAX_WIDTH}]`
          ).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
          expect(layout.sidebar.width).toBeLessThanOrEqual(SIDEBAR_MAX_WIDTH);

          // The shell row is exactly two columns: sidebar + content.
          expect(layout.rowColumns.length, 'shell row renders exactly two columns').toBe(2);
          expect(layout.rowColumns[0].width, 'first column is the sidebar').toBeCloseTo(layout.sidebar.width, 0);

          const [sidebarColumn, contentColumn] = layout.rowColumns;
          expect(
            closeTo(contentColumn.left, sidebarColumn.right, PX),
            'content column starts where the sidebar ends'
          ).toBe(true);
          expect(
            closeTo(contentColumn.right, layout.viewport.width, PX),
            'content column reaches the right viewport edge'
          ).toBe(true);
          expect(
            closeTo(contentColumn.width, layout.viewport.width - sidebarColumn.width, PX),
            'content column keeps the full width left of the sidebar'
          ).toBe(true);

          // The conversation page itself is a single pane (sidebar + chat, not
          // sidebar + two panes).
          expect(layout.contentPaneCount, 'content column holds a single pane').toBe(1);
        });

        await test.step('the notification center opens over the chat without squeezing it', async () => {
          const before = await probeLayout(page);
          await page.getByRole('button', { name: '打开通知中心' }).click();
          const dialog = page.getByRole('dialog', { name: '通知中心' });
          await expect(dialog).toBeVisible();

          // An overlay, not a third column: the shell row still has two
          // columns and the content column keeps its width.
          const after = await probeLayout(page);
          expect(after.rowColumns.length, 'shell row still renders two columns').toBe(2);
          expect(after.contentPaneCount, 'content column still holds one pane').toBe(1);
          expect(
            closeTo(after.rowColumns[1].width, before.rowColumns[1].width, PX),
            'the chat column keeps its width while the panel is open'
          ).toBe(true);

          // The panel itself fits inside the viewport (the shell is 768px tall
          // at the smallest target, so a 70vh cap must stay usable).
          const box = await dialog.boundingBox();
          expect(box, 'the panel has a measured box').not.toBeNull();
          expect(box!.width, 'panel fits the viewport width').toBeLessThanOrEqual(
            after.viewport.width
          );
          expect(box!.height, 'panel fits the viewport height').toBeLessThanOrEqual(
            after.viewport.height
          );
          expect(box!.x, 'panel starts inside the viewport').toBeGreaterThanOrEqual(0);
          expect(box!.y, 'panel starts inside the viewport').toBeGreaterThanOrEqual(0);

          // No new horizontal overflow while the panel is open.
          expect(after.overflow.documentElement).toBe(false);
          expect(after.overflow.body).toBe(false);

          await page.getByRole('button', { name: '关闭通知中心' }).click();
          await expect(dialog).toBeHidden();
        });

        expect(pageErrors).toEqual([]);
      } finally {
        await launched.close();
      }
    });
  }
});
