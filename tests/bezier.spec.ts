import { test, expect, Page } from '@playwright/test'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Navigate to the app and clear any existing path state. */
async function setup(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('svg-canvas')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('clear-btn').click()
  await expect(page.locator('[data-testid^="anchor-"]')).toHaveCount(0, {
    timeout: 10_000,
  })
}

/** Click the SVG canvas at the given canvas-space coordinates. */
async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId('svg-canvas').click({ position: { x, y } })
}

/**
 * Drag a named element to a target position expressed in canvas-space
 * coordinates (relative to the top-left of the svg-canvas element).
 */
async function dragToCanvas(
  page: Page,
  fromTestId: string,
  toCanvasX: number,
  toCanvasY: number,
): Promise<void> {
  const canvas = page.getByTestId('svg-canvas')
  const canvasBB = await canvas.boundingBox()
  if (!canvasBB) throw new Error('svg-canvas bounding box not found')

  const el = page.getByTestId(fromTestId)
  const elBB = await el.boundingBox()
  if (!elBB) throw new Error(`${fromTestId} bounding box not found`)

  const fromX = elBB.x + elBB.width / 2
  const fromY = elBB.y + elBB.height / 2
  const toX = canvasBB.x + toCanvasX
  const toY = canvasBB.y + toCanvasY

  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps: 15 })
  await page.mouse.up()
}

/** Call window.__getAnchor(id) and return the result. */
async function getAnchor(
  page: Page,
  id: number,
): Promise<{
  ax: number
  ay: number
  inHx: number
  inHy: number
  outHx: number
  outHy: number
  type: string
}> {
  return page.evaluate((anchorId) => (window as any).__getAnchor(anchorId), id)
}

/**
 * Return a "visual fingerprint" of a toolbar button that changes whenever the
 * button's active/inactive appearance changes (background, text colour, border,
 * aria-pressed, CSS classes …).  Two buttons with the same fingerprint look
 * identical; different fingerprints mean they look different.
 */
async function buttonFingerprint(page: Page, testId: string): Promise<string> {
  return page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement
    if (!el) return 'absent'
    const s = window.getComputedStyle(el)
    return [
      el.getAttribute('aria-pressed') ?? '',
      el.className,
      s.backgroundColor,
      s.color,
      s.borderColor,
      s.fontWeight,
      s.boxShadow,
      s.opacity,
    ].join('|')
  }, testId)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('SVG Bezier Path Editor', () => {
  // TC-1 ─────────────────────────────────────────────────────────────────────
  test('TC-1: path d attribute has correct command sequence', async ({ page }) => {
    await setup(page)
    await page.getByTestId('draw-mode-btn').click()

    await clickCanvas(page, 100, 300)
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 400, 100)
    await expect(page.getByTestId('anchor-2')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 700, 300)
    await expect(page.getByTestId('anchor-3')).toBeVisible({ timeout: 10_000 })

    // Poll until the path element is present and has content
    let d = ''
    await expect(async () => {
      d = (await page.getByTestId('svg-path').getAttribute('d')) ?? ''
      expect(d.length).toBeGreaterThan(0)
    }).toPass({ timeout: 10_000, intervals: [300] })

    // Starts with M 100 300
    expect(d).toMatch(/^M\s+100\s+300\b/)

    // Exactly two C commands
    const cMatches = d.match(/\bC\b/gi) ?? []
    expect(cMatches).toHaveLength(2)

    // First cubic segment ends at the second anchor (400 100)
    // Second cubic segment ends at the third anchor (700 300)
    // The d format per instructions: C <ctrl1x> <ctrl1y> <ctrl2x> <ctrl2y> <endx> <endy>
    // So we verify the endpoint coordinates appear after C tokens in order.
    const stripped = d.replace(/\s+/g, ' ')
    const firstC = stripped.indexOf(' C ')
    const secondC = stripped.indexOf(' C ', firstC + 1)
    expect(firstC).toBeGreaterThan(-1)
    expect(secondC).toBeGreaterThan(-1)

    // The last three numbers before the next command (or end) of each C segment
    // are the endpoint: extract the number triplets after each 'C'
    const firstSegment = stripped.slice(firstC, secondC)
    const secondSegment = stripped.slice(secondC)

    const nums = (s: string) => s.match(/[\d.]+/g)?.map(Number) ?? []
    const firstNums = nums(firstSegment)
    const secondNums = nums(secondSegment)

    // Last two numbers of the C triplet are the endpoint
    expect(firstNums[firstNums.length - 2]).toBeCloseTo(400, 0)
    expect(firstNums[firstNums.length - 1]).toBeCloseTo(100, 0)
    expect(secondNums[secondNums.length - 2]).toBeCloseTo(700, 0)
    expect(secondNums[secondNums.length - 1]).toBeCloseTo(300, 0)

    // No Z present (open path)
    expect(d.toUpperCase()).not.toContain('Z')
  })

  // TC-2 ─────────────────────────────────────────────────────────────────────
  test('TC-2: smooth handle mirroring', async ({ page }) => {
    await setup(page)
    await page.getByTestId('draw-mode-btn').click()

    await clickCanvas(page, 100, 300)
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 500, 300)
    await expect(page.getByTestId('anchor-2')).toBeVisible({ timeout: 10_000 })

    await page.getByTestId('select-mode-btn').click()

    // Wait for handle to be visible before dragging
    await expect(page.getByTestId('handle-2-out')).toBeVisible({ timeout: 10_000 })

    // Record the out-handle position before the drag
    const before = await getAnchor(page, 2)

    // Drag handle-2-out to canvas position (620, 200)
    await dragToCanvas(page, 'handle-2-out', 620, 200)

    // Poll until the out-handle has actually moved
    await expect(async () => {
      const d = await getAnchor(page, 2)
      expect(d.outHx).not.toBeCloseTo(before.outHx, 0)
    }).toPass({ timeout: 10_000, intervals: [300] })

    // Read the settled state
    const data = await getAnchor(page, 2)

    // anchor-2 must be smooth
    await expect(page.getByTestId('anchor-2')).toHaveAttribute(
      'data-node-type',
      'smooth',
    )

    // Mirror constraint: inH = 2·anchor − outH  (±1 px)
    expect(data.inHx).toBeCloseTo(2 * data.ax - data.outHx, 0)
    expect(data.inHy).toBeCloseTo(2 * data.ay - data.outHy, 0)

    // DOM data-attributes on handle-2-in must reflect the mirrored values
    await expect(async () => {
      const hx = parseFloat(
        (await page.getByTestId('handle-2-in').getAttribute('data-hx')) ?? 'NaN',
      )
      const hy = parseFloat(
        (await page.getByTestId('handle-2-in').getAttribute('data-hy')) ?? 'NaN',
      )
      expect(hx).toBeCloseTo(2 * data.ax - data.outHx, 0)
      expect(hy).toBeCloseTo(2 * data.ay - data.outHy, 0)
    }).toPass({ timeout: 10_000, intervals: [300] })
  })

  // TC-3 ─────────────────────────────────────────────────────────────────────
  test('TC-3: cusp node handle independence', async ({ page }) => {
    await setup(page)
    await page.getByTestId('draw-mode-btn').click()

    await clickCanvas(page, 100, 300)
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 500, 300)
    await expect(page.getByTestId('anchor-2')).toBeVisible({ timeout: 10_000 })

    // Double-click anchor-2 to toggle it to cusp
    await page.getByTestId('anchor-2').dblclick()
    await expect(page.getByTestId('anchor-2')).toHaveAttribute(
      'data-node-type',
      'cusp',
      { timeout: 10_000 },
    )

    // Record baseline in-handle position
    const baseline = await getAnchor(page, 2)

    await page.getByTestId('select-mode-btn').click()

    await expect(page.getByTestId('handle-2-out')).toBeVisible({ timeout: 10_000 })

    // Drag handle-2-out to a clearly different canvas position
    await dragToCanvas(page, 'handle-2-out', 650, 150)

    // Poll until out-handle has moved
    await expect(async () => {
      const d = await getAnchor(page, 2)
      expect(d.outHx).not.toBeCloseTo(baseline.outHx, 0)
    }).toPass({ timeout: 10_000, intervals: [300] })

    const updated = await getAnchor(page, 2)

    // Still cusp
    await expect(page.getByTestId('anchor-2')).toHaveAttribute(
      'data-node-type',
      'cusp',
    )

    // In-handle must be unchanged (±1 px)
    expect(updated.inHx).toBeCloseTo(baseline.inHx, 0)
    expect(updated.inHy).toBeCloseTo(baseline.inHy, 0)

    // Out-handle must have changed
    expect(updated.outHx).not.toBeCloseTo(baseline.outHx, 0)
  })

  // TC-4 ─────────────────────────────────────────────────────────────────────
  test('TC-4: closing the path appends Z and has correct C count', async ({
    page,
  }) => {
    await setup(page)
    await page.getByTestId('draw-mode-btn').click()

    await clickCanvas(page, 200, 400)
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 400, 150)
    await expect(page.getByTestId('anchor-2')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 600, 400)
    await expect(page.getByTestId('anchor-3')).toBeVisible({ timeout: 10_000 })

    // Click anchor-1 to close the path
    await page.getByTestId('anchor-1').click()

    // Wait for Z to appear in the d attribute
    await expect(async () => {
      const d = (await page.getByTestId('svg-path').getAttribute('d')) ?? ''
      expect(d.toUpperCase()).toContain('Z')
    }).toPass({ timeout: 10_000, intervals: [300] })

    const d = (await page.getByTestId('svg-path').getAttribute('d')) ?? ''

    // Z present
    expect(d.toUpperCase()).toContain('Z')

    // Exactly 3 C commands (one per segment including the closing one)
    const cMatches = d.match(/\bC\b/gi) ?? []
    expect(cMatches).toHaveLength(3)

    // Still exactly 3 anchors — no extra anchor was added
    await expect(page.locator('[data-testid^="anchor-"]')).toHaveCount(3)
  })

  // TC-5 ─────────────────────────────────────────────────────────────────────
  test('TC-5: export copies valid d string to clipboard', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await setup(page)
    await page.getByTestId('draw-mode-btn').click()

    await clickCanvas(page, 150, 300)
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 400, 120)
    await expect(page.getByTestId('anchor-2')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 650, 300)
    await expect(page.getByTestId('anchor-3')).toBeVisible({ timeout: 10_000 })

    // Capture the current d attribute before export
    const pathD = (await page.getByTestId('svg-path').getAttribute('d')) ?? ''
    expect(pathD.length).toBeGreaterThan(0)

    await page.getByTestId('export-btn').click()

    // Poll until clipboard contains the expected content
    let clipText = ''
    await expect(async () => {
      clipText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipText).toMatch(/^M\s+/)
    }).toPass({ timeout: 10_000, intervals: [300] })

    // Starts with "M "
    expect(clipText).toMatch(/^M\s+/)

    // Exactly 2 C commands (for 3 anchors open path)
    const cCount = (clipText.match(/\bC\b/gi) ?? []).length
    expect(cCount).toBe(2)

    // Anchor endpoints present in the string
    expect(clipText).toMatch(/\b150\s+300\b/)
    expect(clipText).toMatch(/\b400\s+120\b/)
    expect(clipText).toMatch(/\b650\s+300\b/)

    // Clipboard value is identical to the live svg-path d attribute
    expect(clipText).toBe(pathD)
  })

  // TC-6 ─────────────────────────────────────────────────────────────────────
  test('TC-6: persistence across page reload', async ({ page }) => {
    await setup(page)
    await page.getByTestId('draw-mode-btn').click()

    await clickCanvas(page, 100, 200)
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 400, 100)
    await expect(page.getByTestId('anchor-2')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 700, 200)
    await expect(page.getByTestId('anchor-3')).toBeVisible({ timeout: 10_000 })

    // Toggle anchor-2 to cusp
    await page.getByTestId('anchor-2').dblclick()
    await expect(page.getByTestId('anchor-2')).toHaveAttribute(
      'data-node-type',
      'cusp',
      { timeout: 10_000 },
    )

    // Record pre-reload state
    const pre1 = await getAnchor(page, 1)
    const pre2 = await getAnchor(page, 2)
    const pre3 = await getAnchor(page, 3)
    const preD = await page.getByTestId('svg-path').getAttribute('d')

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('svg-canvas')).toBeVisible({ timeout: 15_000 })

    // Wait for all three anchors to be restored
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('anchor-2')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('anchor-3')).toBeVisible({ timeout: 15_000 })

    const post1 = await getAnchor(page, 1)
    const post2 = await getAnchor(page, 2)
    const post3 = await getAnchor(page, 3)

    // Anchor coordinates restored (±1 px)
    expect(post1.ax).toBeCloseTo(pre1.ax, 0)
    expect(post1.ay).toBeCloseTo(pre1.ay, 0)
    expect(post2.ax).toBeCloseTo(pre2.ax, 0)
    expect(post2.ay).toBeCloseTo(pre2.ay, 0)
    expect(post3.ax).toBeCloseTo(pre3.ax, 0)
    expect(post3.ay).toBeCloseTo(pre3.ay, 0)

    // anchor-2 is still cusp after reload
    await expect(page.getByTestId('anchor-2')).toHaveAttribute(
      'data-node-type',
      'cusp',
    )

    // Handle positions restored (±1 px)
    expect(post1.inHx).toBeCloseTo(pre1.inHx, 0)
    expect(post1.inHy).toBeCloseTo(pre1.inHy, 0)
    expect(post1.outHx).toBeCloseTo(pre1.outHx, 0)
    expect(post1.outHy).toBeCloseTo(pre1.outHy, 0)
    expect(post2.inHx).toBeCloseTo(pre2.inHx, 0)
    expect(post2.inHy).toBeCloseTo(pre2.inHy, 0)
    expect(post2.outHx).toBeCloseTo(pre2.outHx, 0)
    expect(post2.outHy).toBeCloseTo(pre2.outHy, 0)
    expect(post3.inHx).toBeCloseTo(pre3.inHx, 0)
    expect(post3.inHy).toBeCloseTo(pre3.inHy, 0)

    // d attribute identical to pre-reload
    const postD = await page.getByTestId('svg-path').getAttribute('d')
    expect(postD).toBe(preD)
  })

  // TC-7 ─────────────────────────────────────────────────────────────────────
  test('TC-7: clear path resets to empty state', async ({ page }) => {
    // Navigate fresh — do NOT call setup() since we test clear-btn itself
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('svg-canvas')).toBeVisible({ timeout: 15_000 })

    // Start from a known empty state via clear
    await page.getByTestId('clear-btn').click()
    await expect(page.locator('[data-testid^="anchor-"]')).toHaveCount(0, {
      timeout: 10_000,
    })

    await page.getByTestId('draw-mode-btn').click()

    await clickCanvas(page, 200, 200)
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 10_000 })
    await clickCanvas(page, 400, 300)
    await expect(page.getByTestId('anchor-2')).toBeVisible({ timeout: 10_000 })
    await clickCanvas(page, 600, 200)
    await expect(page.getByTestId('anchor-3')).toBeVisible({ timeout: 10_000 })

    // Confirm the path has non-empty d attribute
    await expect(async () => {
      const d = (await page.getByTestId('svg-path').getAttribute('d')) ?? ''
      expect(d.length).toBeGreaterThan(0)
    }).toPass({ timeout: 10_000, intervals: [300] })

    // Clear the path
    await page.getByTestId('clear-btn').click()

    // No anchor elements
    await expect(page.locator('[data-testid^="anchor-"]')).toHaveCount(0, {
      timeout: 10_000,
    })

    // No handle elements
    await expect(page.locator('[data-testid^="handle-"]')).toHaveCount(0, {
      timeout: 10_000,
    })

    // svg-path d attribute is empty or element is absent
    await expect(async () => {
      const pathEl = page.getByTestId('svg-path')
      const count = await pathEl.count()
      if (count === 0) return // element absent is acceptable
      const d = (await pathEl.getAttribute('d')) ?? ''
      expect(d).toBe('')
    }).toPass({ timeout: 10_000, intervals: [300] })

    // Reload — still empty (localStorage was cleared)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('svg-canvas')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-testid^="anchor-"]')).toHaveCount(0, {
      timeout: 10_000,
    })
  })

  // TC-8 ─────────────────────────────────────────────────────────────────────
  test('TC-8: dragging an anchor moves it and its handles by the same delta', async ({
    page,
  }) => {
    await setup(page)
    await page.getByTestId('draw-mode-btn').click()

    await clickCanvas(page, 100, 300)
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 10_000 })

    await clickCanvas(page, 500, 300)
    await expect(page.getByTestId('anchor-2')).toBeVisible({ timeout: 10_000 })

    // Record baseline handle offsets relative to anchor
    const baseline = await getAnchor(page, 2)
    const inOffX = baseline.inHx - baseline.ax
    const inOffY = baseline.inHy - baseline.ay
    const outOffX = baseline.outHx - baseline.ax
    const outOffY = baseline.outHy - baseline.ay

    await page.getByTestId('select-mode-btn').click()

    // Drag anchor-2 to canvas position (500, 400) — delta (0, +100)
    await dragToCanvas(page, 'anchor-2', 500, 400)

    // Poll until anchor has moved to approximately (500, 400)
    await expect(async () => {
      const d = await getAnchor(page, 2)
      expect(d.ay).toBeCloseTo(baseline.ay + 100, 0)
    }).toPass({ timeout: 10_000, intervals: [300] })

    const updated = await getAnchor(page, 2)

    // Anchor moved by (0, +100)
    expect(updated.ax).toBeCloseTo(baseline.ax, 0)
    expect(updated.ay).toBeCloseTo(baseline.ay + 100, 0)

    // Both handles moved by the same delta — relative offsets preserved
    expect(updated.inHx - updated.ax).toBeCloseTo(inOffX, 0)
    expect(updated.inHy - updated.ay).toBeCloseTo(inOffY, 0)
    expect(updated.outHx - updated.ax).toBeCloseTo(outOffX, 0)
    expect(updated.outHy - updated.ay).toBeCloseTo(outOffY, 0)

    // Absolute handle positions
    expect(updated.inHx).toBeCloseTo(baseline.inHx, 0)
    expect(updated.inHy).toBeCloseTo(baseline.inHy + 100, 0)
    expect(updated.outHx).toBeCloseTo(baseline.outHx, 0)
    expect(updated.outHy).toBeCloseTo(baseline.outHy + 100, 0)

    // Path d attribute was updated
    await expect(async () => {
      const d = (await page.getByTestId('svg-path').getAttribute('d')) ?? ''
      expect(d.length).toBeGreaterThan(0)
    }).toPass({ timeout: 10_000, intervals: [300] })
  })

  // TC-9 ─────────────────────────────────────────────────────────────────────
  test('TC-9: mode switching updates active button state', async ({ page }) => {
    await setup(page)

    // ── Step 1: switch to Draw mode ─────────────────────────────────────────
    await page.getByTestId('draw-mode-btn').click()

    // Capture fingerprints after Draw mode is activated
    let drawFP: string
    let selectFP: string
    await expect(async () => {
      drawFP = await buttonFingerprint(page, 'draw-mode-btn')
      selectFP = await buttonFingerprint(page, 'select-mode-btn')
      // The two buttons must look different from each other
      expect(drawFP).not.toBe(selectFP)
    }).toPass({ timeout: 10_000, intervals: [300] })

    const drawFPInDrawMode = await buttonFingerprint(page, 'draw-mode-btn')
    const selectFPInDrawMode = await buttonFingerprint(page, 'select-mode-btn')

    // ── Step 2: switch to Select mode ──────────────────────────────────────
    await page.getByTestId('select-mode-btn').click()

    await expect(async () => {
      const newDrawFP = await buttonFingerprint(page, 'draw-mode-btn')
      const newSelectFP = await buttonFingerprint(page, 'select-mode-btn')
      // draw-mode-btn should look different from when Draw was active
      expect(newDrawFP).not.toBe(drawFPInDrawMode)
      // select-mode-btn should look different from when Draw was active
      expect(newSelectFP).not.toBe(selectFPInDrawMode)
      // The two buttons still look different from each other
      expect(newDrawFP).not.toBe(newSelectFP)
    }).toPass({ timeout: 10_000, intervals: [300] })

    // ── Step 3: switch back to Draw mode ──────────────────────────────────
    await page.getByTestId('draw-mode-btn').click()

    await expect(async () => {
      const fp = await buttonFingerprint(page, 'draw-mode-btn')
      // Should match the Draw-active fingerprint recorded earlier
      expect(fp).toBe(drawFPInDrawMode)
    }).toPass({ timeout: 10_000, intervals: [300] })

    // ── Step 4: placing an anchor after re-activating Draw mode works ──────
    await clickCanvas(page, 300, 300)
    await expect(page.getByTestId('anchor-1')).toBeVisible({ timeout: 10_000 })
  })
})
