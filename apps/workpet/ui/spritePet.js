import { normalizePetState, PET_STATES } from './petConfig.js';

const BUNDLED_FALLBACK = 'skin.svg';

export function framesFromSkin(skin) {
  const frames = {};
  const idle = skin?.frames?.idle || BUNDLED_FALLBACK;
  for (const state of PET_STATES) {
    frames[state] = skin?.frames?.[state] || idle;
  }
  return frames;
}

export class SpritePet {
  constructor({ img }) {
    this.img = img;
    this.frames = framesFromSkin(null);
    this.state = 'idle';
  }

  init(skin) {
    this.frames = framesFromSkin(skin);
    this.setState(this.state || 'idle');
    return true;
  }

  setState(state) {
    const next = normalizePetState(state);
    this.state = next;
    if (!this.img) return false;
    const url = this.frames[next] || this.frames.idle || BUNDLED_FALLBACK;
    if (this.img.getAttribute('src') !== url) this.img.src = url;
    return true;
  }

  interact() {
    return this.setState('speaking');
  }
}
