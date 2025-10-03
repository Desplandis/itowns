import { test as base, Page } from '@playwright/test';
import { ITownsTestHelper, InitialPosition } from '../utils/test-helpers';

// Extend the base test with our custom fixtures
export const test = base.extend<{
  itownsHelper: ITownsTestHelper;
  initialPosition: InitialPosition;
}>({
  itownsHelper: async ({ page }, use) => {
    const helper = new ITownsTestHelper(page);
    await use(helper);
  },

  initialPosition: async ({ page }, use) => {
    // This will be set by individual tests
    const position: InitialPosition = {};
    await use(position);
  },
});

export { expect } from '@playwright/test';
