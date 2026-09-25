import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Fails when axe finds a WCAG 2.x A/AA violation on the current page. Call it once the page
 * shows real content: an empty state hides most of what can go wrong (repo rule: pages must
 * pass AXE and meet WCAG AA).
 */
export async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(
    violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    })),
    'accessibility violations',
  ).toEqual([]);
}
