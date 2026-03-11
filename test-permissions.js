#!/usr/bin/env node

/**
 * Test script to verify macOS permissions work
 * Run with: node test-permissions.js
 */

const { app, systemPreferences } = require('electron');

app.whenReady().then(async () => {
  console.log('🧪 Testing macOS permissions...\n');

  if (process.platform !== 'darwin') {
    console.log('❌ Not running on macOS - permissions not applicable');
    app.quit();
    return;
  }

  try {
    // Test 1: Screen recording permission
    console.log('📺 Testing screen recording permission...');
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    console.log(`   Current status: ${screenStatus}`);

    if (screenStatus !== 'granted') {
      console.log('   Requesting permission...');
      const granted = await systemPreferences.askForMediaAccess('screen');
      console.log(`   Permission granted: ${granted}`);
    }

    // Test 2: Try to capture screen
    console.log('\n🖥️  Testing screen capture...');
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 100, height: 100 }
    });
    console.log(`   Found ${sources.length} screen sources`);

    if (sources.length > 0 && sources[0].thumbnail) {
      console.log(`   ✅ Screen capture working! Thumbnail size: ${sources[0].thumbnail.getSize().width}x${sources[0].thumbnail.getSize().height}`);
    } else {
      console.log('   ❌ Screen capture failed - no thumbnail data');
    }

    // Test 3: Accessibility permission
    console.log('\n♿ Testing accessibility permission...');
    const accessibilityStatus = systemPreferences.isTrustedAccessibilityClient(false);
    console.log(`   Accessibility trusted: ${accessibilityStatus}`);

    if (!accessibilityStatus) {
      console.log('   Opening System Preferences for accessibility...');
      systemPreferences.isTrustedAccessibilityClient(true);
    }

    console.log('\n✅ Permission tests complete!');
    console.log('\nIf screen recording permission was requested, check:');
    console.log('System Preferences > Security & Privacy > Privacy > Screen Recording');
    console.log('BLOOM Desktop should now appear in the list.\n');

  } catch (error) {
    console.error('❌ Permission test failed:', error);
  }

  // Keep app running for a moment to see results
  setTimeout(() => {
    app.quit();
  }, 2000);
});