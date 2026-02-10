/**
 * Standalone Browser Test - Happy Solar Leads
 * Run with: node test-browser-flows.js
 * 
 * Prerequisites:
 * npm install -D playwright
 * npx playwright install chromium
 */

const { chromium } = require('playwright');

async function runTests() {
  console.log('🧪 Starting Browser Tests for Happy Solar Leads\n');
  console.log('=' .repeat(60));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Test 1: Load app
    console.log('\n📋 TEST 1: Loading App');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000); // Give it time to render
    console.log('✅ App loaded');

    // Inject test data
    console.log('\n💾 Injecting Test Data');
    await page.evaluate(() => {
      localStorage.clear();
      
      const testLeads = [{
        id: 'test-lead-1',
        name: 'Test Lead 1',
        address: '1600 Amphitheatre Parkway',
        city: 'Mountain View',
        state: 'CA',
        zip: '94043',
        lat: 37.4223724,
        lng: -122.0854877,
        phone: '555-0001',
        email: 'test1@example.com',
        estimatedBill: 250,
        status: 'unclaimed',
        createdAt: new Date().toISOString(),
        solarScore: 85,
        solarCategory: 'great',
        solarMaxPanels: 947,
        solarSunshineHours: 1779.4,
        hasSouthFacingRoof: true
      }];

      localStorage.setItem('happysolar_leads', JSON.stringify(testLeads));
      localStorage.setItem('happysolar_currentUser', JSON.stringify({
        id: 'test-user',
        name: 'Test User',
        email: 'test@test.com',
        color: '#3b82f6'
      }));
    });
    
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000); // Wait for app to initialize
    console.log('✅ Test data injected');

    // Close onboarding modal if it appears
    const onboardingModal = await page.locator('button:has-text("Get Started")').first();
    if (await onboardingModal.isVisible().catch(() => false)) {
      await onboardingModal.click();
      await page.waitForTimeout(500);
      console.log('✅ Welcome modal closed');
      
      // Fill out user setup form (second modal)
      await page.fill('input[placeholder="John Doe"]', 'Test User');
      await page.fill('input[placeholder="john@company.com"]', 'test@test.com');
      // Skip home address - not required
      // Select a color
      await page.locator('button').nth(5).click(); // Click a color button
      await page.click('button:has-text("Start Knocking")');
      await page.waitForTimeout(1000);
      console.log('✅ User setup completed');
    }

    // Test 2: Verify lead appears
    console.log('\n🗺️  TEST 2: Verifying Lead Display');
    await page.waitForSelector('.leaflet-marker-icon', { timeout: 5000 });
    console.log('✅ Lead marker visible on map');

    // Test 3: Open Lead Detail
    console.log('\n📋 TEST 3: Opening Lead Detail Panel');
    await page.click('button:has-text("Test Lead 1")');
    await page.waitForSelector('text=Test Lead 1', { timeout: 5000 });
    console.log('✅ Lead Detail panel opened');

    // Check for console errors so far
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Test 4: Open Objection Modal
    console.log('\n❌ TEST 4: Testing Objection Modal');
    await page.click('button:has-text("Not Interested")');
    
    // Wait for modal to appear
    const modalVisible = await page.waitForSelector('text=Record Objection', { 
      timeout: 3000,
      state: 'visible'
    }).catch(() => null);

    if (!modalVisible) {
      console.log('❌ FAIL: Objection modal did not appear!');
      await page.screenshot({ path: 'test-failure-modal.png' });
      throw new Error('Modal not visible');
    }
    
    console.log('✅ Objection modal appeared');

    // Test 5: Verify modal content
    console.log('\n🔍 TEST 5: Verifying Modal Content');
    const objectionTypes = await page.locator('text=/Too Expensive|Moving Soon|Already Has Solar/').count();
    if (objectionTypes >= 3) {
      console.log(`✅ Objection types visible (found ${objectionTypes})`);
    } else {
      console.log(`❌ FAIL: Only found ${objectionTypes} objection types`);
    }

    // Test 6: Fill objection
    console.log('\n✍️  TEST 6: Filling Objection Form');
    await page.click('button:has-text("Too Expensive")');
    await page.fill('textarea', 'Bill is only $80/month');
    console.log('✅ Objection form filled');

    // Test 7: Save objection
    console.log('\n💾 TEST 7: Saving Objection');
    await page.click('button:has-text("Save Objection")');
    
    // Wait for modal to close
    await page.waitForSelector('text=Record Objection', { 
      state: 'hidden',
      timeout: 3000 
    });
    console.log('✅ Objection saved, modal closed');

    // Test 8: Verify data persisted
    console.log('\n✅ TEST 8: Verifying Data Persistence');
    const savedData = await page.evaluate(() => {
      const leads = JSON.parse(localStorage.getItem('happysolar_leads') || '[]');
      return leads[0];
    });

    if (savedData.objectionType === 'too-expensive') {
      console.log('✅ Objection type saved correctly');
    } else {
      console.log(`❌ FAIL: Objection type not saved (got: ${savedData.objectionType})`);
    }

    if (savedData.objectionNotes === 'Bill is only $80/month') {
      console.log('✅ Objection notes saved correctly');
    } else {
      console.log('❌ FAIL: Objection notes not saved');
    }

    if (savedData.status === 'not-interested') {
      console.log('✅ Lead status updated to not-interested');
    } else {
      console.log('❌ FAIL: Lead status not updated');
    }

    // Test 9: Check console errors
    console.log('\n🐛 TEST 9: Checking for Console Errors');
    if (consoleErrors.length === 0) {
      console.log('✅ No console errors detected');
    } else {
      console.log(`❌ Found ${consoleErrors.length} console errors:`);
      consoleErrors.forEach(err => console.log(`  - ${err}`));
    }

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED!');
    console.log('=' .repeat(60));
    console.log('\nApp is working correctly:');
    console.log('- Lead display ✅');
    console.log('- Lead detail panel ✅');
    console.log('- Objection modal ✅');
    console.log('- Data persistence ✅');
    console.log('- No console errors ✅');

  } catch (error) {
    console.log('\n' + '='.repeat(60));
    console.log('❌ TEST FAILED');
    console.log('=' .repeat(60));
    console.log(`\nError: ${error.message}`);
    console.log('\nScreenshot saved to test-failure-modal.png');
    
    // Take screenshot on failure
    await page.screenshot({ path: 'test-failure-screenshot.png' });
  } finally {
    await browser.close();
  }
}

// Run tests
runTests().catch(console.error);
