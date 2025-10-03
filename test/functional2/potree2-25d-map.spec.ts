import { test, expect } from '@playwright/test';
import Potree2Page from './models/Potree2Page';

test.describe('potree2_25d_map', () => {
    test('should run', async ({ page }) => {
        const examplePage = new Potree2Page(page);
        await examplePage.goto();
        await examplePage.waitUntilReady();
        expect(examplePage.page.evaluate(() => window.view)).toBeTruthy();
    });
    test('should subdivise planar correctly', async ({ page }) => {
        const examplePage = new Potree2Page(page);
        await examplePage.goto();
        await examplePage.waitUntilReady();
    });
});
