const robot = require('robotjs');

class InputControl {
  constructor() {
    this.isEnabled = false;
    this.commandQueue = [];
    this.isProcessing = false;

    // Configure robotjs settings
    if (process.platform === 'linux') {
      robot.setXDisplayName(process.env.DISPLAY || ':0.0');
    }
    robot.setKeyboardDelay(2);
    robot.setMouseDelay(2);

    console.log('InputControl initialized');
  }

  enable() {
    this.isEnabled = true;
    console.log('Input control enabled');
  }

  disable() {
    this.isEnabled = false;
    this.commandQueue = [];
    console.log('Input control disabled');
  }

  async execute(command) {
    if (!this.isEnabled) {
      console.log('Input control disabled, ignoring command:', command.type);
      return { success: false, error: 'Input control disabled' };
    }

    // Add command to queue
    this.commandQueue.push(command);

    // Process queue if not already processing
    if (!this.isProcessing) {
      this.processQueue();
    }

    return { success: true };
  }

  async processQueue() {
    this.isProcessing = true;

    while (this.commandQueue.length > 0 && this.isEnabled) {
      const command = this.commandQueue.shift();

      try {
        await this.executeCommand(command);

        // Small delay between commands to prevent overwhelming
        await this.sleep(10);
      } catch (error) {
        console.error('Error executing command:', error);
      }
    }

    this.isProcessing = false;
  }

  async executeCommand(command) {
    console.log('Executing command:', command.type, command);

    switch (command.type) {
      case 'mouse_move':
        this.mouseMove(command.x, command.y);
        break;

      case 'mouse_click':
        this.mouseClick(command.x, command.y, command.button || 'left', command.clickCount || 1);
        break;

      case 'mouse_drag':
        this.mouseDrag(command.fromX, command.fromY, command.toX, command.toY);
        break;

      case 'mouse_scroll':
        this.mouseScroll(command.x, command.y, command.direction, command.clicks || 1);
        break;

      case 'key_press':
        this.keyPress(command.key, command.modifiers);
        break;

      case 'key_type':
        this.keyType(command.text);
        break;

      case 'key_combination':
        this.keyCombination(command.keys);
        break;

      case 'screenshot':
        return this.takeScreenshot();

      case 'wait':
        await this.sleep(command.duration || 100);
        break;

      default:
        console.warn('Unknown command type:', command.type);
        throw new Error(`Unknown command type: ${command.type}`);
    }

    return { success: true };
  }

  mouseMove(x, y) {
    try {
      robot.moveMouse(Math.round(x), Math.round(y));
    } catch (error) {
      console.error('Mouse move error:', error);
      throw error;
    }
  }

  mouseClick(x, y, button = 'left', clickCount = 1) {
    try {
      // Move to position first
      robot.moveMouse(Math.round(x), Math.round(y));

      // Perform clicks
      for (let i = 0; i < clickCount; i++) {
        robot.mouseClick(button);
        if (clickCount > 1) {
          robot.sleep(50); // Delay between multi-clicks
        }
      }
    } catch (error) {
      console.error('Mouse click error:', error);
      throw error;
    }
  }

  mouseDrag(fromX, fromY, toX, toY) {
    try {
      robot.moveMouse(Math.round(fromX), Math.round(fromY));
      robot.mouseToggle('down', 'left');
      robot.dragMouse(Math.round(toX), Math.round(toY));
      robot.mouseToggle('up', 'left');
    } catch (error) {
      console.error('Mouse drag error:', error);
      throw error;
    }
  }

  mouseScroll(x, y, direction, clicks = 1) {
    try {
      robot.moveMouse(Math.round(x), Math.round(y));

      for (let i = 0; i < clicks; i++) {
        robot.scrollMouse(1, direction === 'up' ? 'up' : 'down');
        robot.sleep(50);
      }
    } catch (error) {
      console.error('Mouse scroll error:', error);
      throw error;
    }
  }

  keyPress(key, modifiers = []) {
    try {
      if (modifiers && modifiers.length > 0) {
        // Handle key combinations
        const keys = [...modifiers, key];
        robot.keyTap(key, modifiers);
      } else {
        robot.keyTap(key);
      }
    } catch (error) {
      console.error('Key press error:', error);
      throw error;
    }
  }

  keyType(text) {
    try {
      robot.typeString(text);
    } catch (error) {
      console.error('Key type error:', error);
      throw error;
    }
  }

  keyCombination(keys) {
    try {
      if (keys.length === 1) {
        robot.keyTap(keys[0]);
      } else {
        const modifiers = keys.slice(0, -1);
        const key = keys[keys.length - 1];
        robot.keyTap(key, modifiers);
      }
    } catch (error) {
      console.error('Key combination error:', error);
      throw error;
    }
  }

  takeScreenshot() {
    try {
      const screen = robot.screen();
      const screenshot = robot.screen.capture(0, 0, screen.width, screen.height);

      // Convert to base64
      const buffer = Buffer.from(screenshot.image);
      const base64 = buffer.toString('base64');

      return {
        success: true,
        screenshot: base64,
        width: screen.width,
        height: screen.height
      };
    } catch (error) {
      console.error('Screenshot error:', error);
      throw error;
    }
  }

  // Utility methods
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getMousePosition() {
    try {
      const pos = robot.getMousePos();
      return { x: pos.x, y: pos.y };
    } catch (error) {
      console.error('Get mouse position error:', error);
      return { x: 0, y: 0 };
    }
  }

  getScreenSize() {
    try {
      const screen = robot.screen();
      return {
        width: screen.width,
        height: screen.height
      };
    } catch (error) {
      console.error('Get screen size error:', error);
      return { width: 1920, height: 1080 };
    }
  }

  getPixelColor(x, y) {
    try {
      const color = robot.getPixelColor(x, y);
      return color;
    } catch (error) {
      console.error('Get pixel color error:', error);
      return '000000';
    }
  }

  // Emergency stop - immediately clear queue and disable
  emergencyStop() {
    console.log('EMERGENCY STOP - Disabling input control');
    this.isEnabled = false;
    this.commandQueue = [];
    this.isProcessing = false;
  }

  getStatus() {
    return {
      isEnabled: this.isEnabled,
      queueLength: this.commandQueue.length,
      isProcessing: this.isProcessing
    };
  }
}

module.exports = InputControl;