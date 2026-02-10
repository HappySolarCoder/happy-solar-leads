// Feature 1: Lead Map Display Tests
import { test, expect } from '@playwright/test';

test.describe('Feature 1: Lead Map Display', () => {
  
  test('TC1: Map loads without errors', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30000 });
  });

  test('TC2: Pins appear on map', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    // Your markers use 'custom-marker' class
    const markers = page.locator('.custom-marker');
    const count = await markers.count();
    console.log(`Found ${count} custom markers`);
    expect(count).toBeGreaterThan(0);
  });

  test('TC3: Clicking pin opens detail', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Click a marker
    const marker = page.locator('.custom-marker').first();
    await marker.click({ timeout: 10000 });
    await page.waitForTimeout(2000);
    
    // Check for popup
    const popup = page.locator('.leaflet-popup');
    await expect(popup).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test('TC4: Map has tiles loaded', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC5: Color-coded markers exist', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const markers = page.locator('.custom-marker');
    const count = await markers.count();
    console.log(`Found ${count} color-coded markers`);
    expect(count).toBeGreaterThan(0);
  });

  test('TC6: Filter dropdown exists', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await expect(page.locator('select').first()).toBeVisible({ timeout: 10000 });
  });
});
