import * as PIXI from 'pixi.js';
import { normalizeLive2dConfig, normalizePetState } from './petConfig.js';

window.PIXI = PIXI;

export class Live2DPet {
  constructor({ canvas, container, onReady, onFallback }) {
    this.canvas = canvas;
    this.container = container;
    this.onReady = onReady;
    this.onFallback = onFallback;
    this.app = null;
    this.model = null;
    this.naturalModelSize = null;
    this.config = normalizeLive2dConfig();
    this.state = 'idle';
    this.resizeObserver = null;
  }

  async init(config) {
    this.destroy();
    this.config = normalizeLive2dConfig(config);
    try {
      if (!window.WebGLRenderingContext) throw new Error('当前 WebView 不支持 WebGL');
      if (!window.Live2DCubismCore) throw new Error('Cubism Core 未加载');

      const { Live2DModel } = await import('pixi-live2d-display/cubism4');
      this.app = new PIXI.Application({
        view: this.canvas,
        autoStart: true,
        resizeTo: this.container,
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });

      this.model = await Live2DModel.from(this.config.modelUrl, {
        autoInteract: false,
      });
      this.model.anchor.set(0, 0);
      this.model.interactive = false;
      this.naturalModelSize = { width: this.model.width, height: this.model.height };
      this.app.stage.addChild(this.model);
      this.layout();

      this.resizeObserver = new ResizeObserver(() => this.layout());
      this.resizeObserver.observe(this.container);
      this.container.addEventListener('pointermove', (event) => this.focus(event));
      this.onReady?.(this.config.modelUrl);
      this.playStateMotion('idle');
      return true;
    } catch (error) {
      this.destroy();
      this.onFallback?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  layout() {
    if (!this.model || !this.app) return;
    const width = this.app.renderer.width / this.app.renderer.resolution;
    const height = this.app.renderer.height / this.app.renderer.resolution;
    const naturalWidth = Math.max(this.naturalModelSize?.width || this.model.width, 1);
    const naturalHeight = Math.max(this.naturalModelSize?.height || this.model.height, 1);
    const fitScale = Math.min((width * 1.08) / naturalWidth, (height * 1.04) / naturalHeight);
    this.model.scale.set(fitScale * this.config.scale);
    this.model.position.set(
      (width - this.model.width) / 2 + this.config.offsetX,
      height - this.model.height + this.config.offsetY,
    );
  }

  focus(event) {
    if (!this.model) return;
    const rect = this.container.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const y = -(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
    this.model.focus(x, y, true);
  }

  setState(state) {
    const next = normalizePetState(state);
    if (next === this.state && next !== 'speaking') return;
    this.state = next;
    this.playStateMotion(next);
  }

  playStateMotion(state) {
    if (!this.model) return false;
    const group = this.config.motions[normalizePetState(state)] || this.config.motions.idle;
    try {
      return Boolean(this.model.motion(group));
    } catch (_) {
      if (group !== this.config.motions.idle) {
        try { return Boolean(this.model.motion(this.config.motions.idle)); } catch (_) { return false; }
      }
      return false;
    }
  }

  interact() {
    if (!this.model) return false;
    const group = this.config.motions.speaking || 'TapBody';
    try { return Boolean(this.model.motion(group)); } catch (_) { return false; }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.model) {
      this.model.destroy({ children: true });
      this.model = null;
      this.naturalModelSize = null;
    }
    if (this.app) {
      this.app.destroy(false, { children: true, texture: false, baseTexture: false });
      this.app = null;
    }
  }
}
