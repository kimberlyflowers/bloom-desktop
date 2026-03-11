const { chromium } = require('playwright-core');

class BrowserControl {
  constructor() {
    this.browser = null;
    this.page = null;
    this.elements = new Map();
    console.log('BrowserControl initialized');
  }

  async connect(cdpUrl = 'http://localhost:9222') {
    try {
      console.log('🌐 Connecting to Chrome CDP at:', cdpUrl);
      this.browser = await chromium.connectOverCDP(cdpUrl);
      const contexts = this.browser.contexts();
      if (contexts.length > 0 && contexts[0].pages().length > 0) {
        this.page = contexts[0].pages()[0];
        console.log('✅ Connected to Chrome, current page:', this.page.url());
      }
      return { success: true, connected: !!this.page };
    } catch (err) {
      console.error('❌ Chrome CDP connection failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async disconnect() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      console.log('🔌 Disconnected from Chrome');
    }
    return { success: true };
  }

  async getPages() {
    if (!this.browser) return { success: false, error: 'Not connected' };
    const contexts = this.browser.contexts();
    const pages = [];
    contexts.forEach((ctx, ci) => {
      ctx.pages().forEach((page, pi) => {
        pages.push({ context: ci, page: pi, url: page.url(), title: page.title() });
      });
    });
    return { success: true, pages };
  }

  async focusPage(contextIndex = 0, pageIndex = 0) {
    if (!this.browser) return { success: false, error: 'Not connected' };
    const contexts = this.browser.contexts();
    if (contexts[contextIndex]?.pages()[pageIndex]) {
      this.page = contexts[contextIndex].pages()[pageIndex];
      await this.page.bringToFront();
      console.log('🎯 Focused on page:', this.page.url());
      return { success: true, url: this.page.url() };
    }
    return { success: false, error: 'Page not found' };
  }

  async goto(url) {
    if (!this.page) return { success: false, error: 'No page connected' };
    try {
      console.log('🔄 Navigating to:', url);
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { success: true, url: this.page.url() };
    } catch (err) {
      console.error('❌ Navigation failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async snapshot() {
    if (!this.page) return { success: false, error: 'No page connected' };

    try {
      console.log('📸 Taking DOM snapshot...');
      const elements = await this.page.evaluate(() => {
        const interactiveSelectors = [
          'button', 'a[href]', 'input', 'select', 'textarea',
          '[role="button"]', '[role="link"]', '[role="menuitem"]',
          '[onclick]', '[tabindex]:not([tabindex="-1"])'
        ];

        const seen = new Set();
        const results = [];
        let index = 1;

        function generateSelector(el) {
          if (el.id) return '#' + CSS.escape(el.id);
          if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';

          let path = [];
          let current = el;
          while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
              selector = '#' + CSS.escape(current.id);
              path.unshift(selector);
              break;
            } else {
              let sibling = current;
              let nth = 1;
              while (sibling.previousElementSibling) {
                sibling = sibling.previousElementSibling;
                if (sibling.tagName === current.tagName) nth++;
              }
              selector += ':nth-of-type(' + nth + ')';
            }
            path.unshift(selector);
            current = current.parentElement;
          }
          return path.join(' > ');
        }

        function getLabel(el) {
          return (
            el.innerText?.trim().slice(0, 60) ||
            el.value?.slice(0, 60) ||
            el.placeholder ||
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.name ||
            el.id ||
            ''
          );
        }

        interactiveSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            if (seen.has(el)) return;
            seen.add(el);

            const rect = el.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0 &&
              rect.top < window.innerHeight && rect.bottom > 0 &&
              rect.left < window.innerWidth && rect.right > 0;

            if (!isVisible) return;

            const label = getLabel(el);
            const cssSelector = generateSelector(el);

            results.push({
              index: index++,
              tag: el.tagName.toLowerCase(),
              type: el.type || null,
              label: label,
              selector: cssSelector
            });
          });
        });

        return results;
      });

      // Store selectors for clicking
      this.elements.clear();
      elements.forEach(el => this.elements.set(el.index, el.selector));

      // Format for AI
      const formatted = elements.map(e => {
        let desc = `[${e.index}] ${e.label || '(no label)'}`;
        desc += ` <${e.tag}`;
        if (e.type) desc += ` type="${e.type}"`;
        desc += '>';
        return desc;
      }).join('\n');

      console.log(`📋 Found ${elements.length} interactive elements`);
      return {
        success: true,
        count: elements.length,
        elements: elements,
        formatted: formatted
      };
    } catch (err) {
      console.error('❌ Snapshot failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async clickElement(number) {
    const selector = this.elements.get(number);
    if (!selector) return { success: false, error: `Element [${number}] not found. Take a new snapshot.` };

    try {
      console.log(`🖱️ Clicking element [${number}] with selector: ${selector}`);
      await this.page.click(selector, { timeout: 5000 });
      return { success: true, clicked: number };
    } catch (err) {
      console.error(`❌ Click failed on element [${number}]:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async typeInElement(number, text, clear = true) {
    const selector = this.elements.get(number);
    if (!selector) return { success: false, error: `Element [${number}] not found. Take a new snapshot.` };

    try {
      console.log(`⌨️ Typing in element [${number}]:`, text.slice(0, 20) + (text.length > 20 ? '...' : ''));
      if (clear) {
        await this.page.fill(selector, text);
      } else {
        await this.page.type(selector, text);
      }
      return { success: true, typed: text.slice(0, 20) + (text.length > 20 ? '...' : '') };
    } catch (err) {
      console.error(`❌ Type failed on element [${number}]:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async pressKey(key) {
    if (!this.page) return { success: false, error: 'No page connected' };
    try {
      console.log('🎹 Pressing key:', key);
      await this.page.keyboard.press(key);
      return { success: true, key: key };
    } catch (err) {
      console.error('❌ Key press failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async screenshot() {
    if (!this.page) return { success: false, error: 'No page connected' };
    try {
      console.log('📷 Taking browser screenshot...');
      const buffer = await this.page.screenshot({ type: 'png' });
      return { success: true, image: buffer.toString('base64') };
    } catch (err) {
      console.error('❌ Screenshot failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async waitForSelector(selector, timeout = 5000) {
    if (!this.page) return { success: false, error: 'No page connected' };
    try {
      await this.page.waitForSelector(selector, { timeout });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getCurrentUrl() {
    if (!this.page) return { success: false, error: 'No page connected' };
    return { success: true, url: this.page.url() };
  }

  getStatus() {
    return {
      connected: !!this.browser,
      pageActive: !!this.page,
      currentUrl: this.page?.url() || null,
      elementsCount: this.elements.size
    };
  }
}

module.exports = BrowserControl;