let _robot = null;
function getRobot() {
  if (!_robot) {
    try { _robot = require('robotjs'); }
    catch (e) { console.warn('[InputControl] robotjs not available:', e.message); return null; }
  }
  return _robot;
}

class InputControl {
  constructor() {
    this.isEnabled = false;
    this.commandQueue = [];
    this.isProcessing = false;
    const r = getRobot();
    if (r) {
      if (process.platform === 'linux') {
        r.setXDisplayName(process.env.DISPLAY || ':0.0');
      }
      r.setKeyboardDelay(2);
      r.setMouseDelay(2);
    }
    console.log('InputControl initialized', r ? '(robotjs loaded)' : '(robotjs unavailable)');
  }
  enable() { this.isEnabled = true; }
  disable() { this.isEnabled = false; this.commandQueue = []; }
  async execute(command) {
    if (!this.isEnabled) return { success: false, error: 'Input control disabled' };
    this.commandQueue.push(command);
    if (!this.isProcessing) this.processQueue();
    return { success: true };
  }
  async processQueue() {
    this.isProcessing = true;
    while (this.commandQueue.length > 0 && this.isEnabled) {
      const command = this.commandQueue.shift();
      try { await this.executeCommand(command); await this.sleep(10); }
      catch (error) { console.error('Command error:', error); }
    }
    this.isProcessing = false;
  }
  async executeCommand(cmd) {
    const r = getRobot();
    if (!r) return { success: false, error: 'robotjs unavailable' };
    switch (cmd.type) {
      case 'mouse_move': r.moveMouse(Math.round(cmd.x), Math.round(cmd.y)); break;
      case 'mouse_click': r.moveMouse(Math.round(cmd.x), Math.round(cmd.y)); for(let i=0;i<(cmd.clickCount||1);i++){r.mouseClick(cmd.button||'left');} break;
      case 'mouse_drag': r.moveMouse(Math.round(cmd.fromX),Math.round(cmd.fromY)); r.mouseToggle('down','left'); r.dragMouse(Math.round(cmd.toX),Math.round(cmd.toY)); r.mouseToggle('up','left'); break;
      case 'mouse_scroll': r.moveMouse(Math.round(cmd.x),Math.round(cmd.y)); for(let i=0;i<(cmd.clicks||1);i++){r.scrollMouse(1,cmd.direction==='up'?'up':'down');} break;
      case 'key_press': cmd.modifiers?.length ? r.keyTap(cmd.key,cmd.modifiers) : r.keyTap(cmd.key); break;
      case 'key_type': r.typeString(cmd.text); break;
      case 'key_combination': cmd.keys.length===1 ? r.keyTap(cmd.keys[0]) : r.keyTap(cmd.keys[cmd.keys.length-1],cmd.keys.slice(0,-1)); break;
      case 'screenshot': return this.takeScreenshot();
      case 'wait': await this.sleep(cmd.duration||100); break;
      default: throw new Error('Unknown command: '+cmd.type);
    }
    return { success: true };
  }
  takeScreenshot() { const r=getRobot(); if(!r) return {success:false}; const s=r.screen(); const ss=r.screen.capture(0,0,s.width,s.height); return {success:true,screenshot:Buffer.from(ss.image).toString('base64'),width:s.width,height:s.height}; }
  sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  getMousePosition() { const r=getRobot(); if(!r) return {x:0,y:0}; const p=r.getMousePos(); return {x:p.x,y:p.y}; }
  getScreenSize() { const r=getRobot(); if(!r) return {width:1920,height:1080}; const s=r.screen(); return {width:s.width,height:s.height}; }
  emergencyStop() { this.isEnabled=false; this.commandQueue=[]; this.isProcessing=false; }
  getStatus() { return {isEnabled:this.isEnabled,queueLength:this.commandQueue.length,isProcessing:this.isProcessing}; }
}
module.exports = InputControl;
