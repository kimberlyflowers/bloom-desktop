// Quick test of browser control functionality
// This simulates what Jaden would send via WebSocket

const WebSocket = require('ws');

async function testBrowserControl() {
  console.log('🧪 Testing BLOOM Desktop Browser Control...\n');

  // For this test, we'll just test the browser control module directly
  const BrowserControl = require('./modules/browser-control');
  const browser = new BrowserControl();

  try {
    // Test 1: Connect to Chrome CDP
    console.log('1. Connecting to Chrome...');
    const connectResult = await browser.connect('http://localhost:9222');
    console.log('   Result:', connectResult);

    if (!connectResult.success) {
      console.log('❌ Failed to connect to Chrome. Make sure Chrome is running with --remote-debugging-port=9222');
      return;
    }

    // Test 2: Get current URL
    console.log('\n2. Getting current URL...');
    const urlResult = await browser.getCurrentUrl();
    console.log('   Result:', urlResult);

    // Test 3: Take DOM snapshot
    console.log('\n3. Taking DOM snapshot...');
    const snapshotResult = await browser.snapshot();
    console.log('   Found elements:', snapshotResult.count);
    if (snapshotResult.success && snapshotResult.formatted) {
      console.log('   Elements preview:');
      console.log(snapshotResult.formatted.split('\n').slice(0, 10).join('\n'));
      if (snapshotResult.count > 10) {
        console.log(`   ... and ${snapshotResult.count - 10} more elements`);
      }
    }

    // Test 4: Try clicking first element (if any)
    if (snapshotResult.success && snapshotResult.count > 0) {
      console.log('\n4. Testing element click (element [1])...');
      const clickResult = await browser.clickElement(1);
      console.log('   Result:', clickResult);
    }

    // Test 5: Find search input and test typing
    if (snapshotResult.success) {
      const elements = snapshotResult.elements;
      const searchInput = elements.find(el =>
        el.tag === 'input' && (el.type === 'search' || el.label.toLowerCase().includes('search'))
      );

      if (searchInput) {
        console.log(`\n5. Testing typing in search input [${searchInput.index}]...`);
        const typeResult = await browser.typeInElement(searchInput.index, 'BLOOM AI test');
        console.log('   Result:', typeResult);
      }
    }

    console.log('\n✅ Browser control test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.disconnect();
  }
}

testBrowserControl();