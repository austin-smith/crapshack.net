import { initRainyDay } from '../lib/weather/rain';
import { initSnowyDay } from '../lib/weather/snow';

type Cleanup = () => void;
type EffectName = 'off' | 'rain' | 'snow';

const STORAGE_KEY = 'crapshack:sky';

class EffectsController {
  private container: HTMLElement | null = null;
  private cleanup: Cleanup | null = null;
  private current: EffectName = 'rain'; // default to rain

  constructor() {
    this.container = document.getElementById('weather-container');
    if (!this.container) return;

    this.current = this.readPreference();
    this.applyStateToDom();
    this.startEffect(this.current);
    this.attachToggleHandlers();
  }

  private readPreference(): EffectName {
    const v = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
    if (v === 'off' || v === 'rain' || v === 'snow') return v;
    return 'rain';
  }

  private writePreference(v: EffectName) {
    localStorage.setItem(STORAGE_KEY, v);
  }

  private applyStateToDom() {
    document.documentElement.setAttribute('data-effect', this.current);
    const radios = Array.from(document.querySelectorAll('[data-effect-option]'));
    for (const r of radios) {
      const name = r.getAttribute('data-effect-option');
      if (!name) continue;
      const checked = name === this.current;
      r.setAttribute('aria-checked', String(checked));
      if (checked) r.setAttribute('data-checked', ''); else r.removeAttribute('data-checked');
      r.setAttribute('tabindex', checked ? '0' : '-1');
    }
  }

  private stopEffect() {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  }

  private startEffect(name: EffectName) {
    if (!this.container) return;
    this.stopEffect();
    if (name === 'rain') {
      this.cleanup = initRainyDay(this.container);
    } else if (name === 'snow') {
      this.cleanup = initSnowyDay(this.container);
    } else {
      this.cleanup = null;
    }
  }

  private select(name: EffectName) {
    if (name === this.current) return;
    this.current = name;
    this.startEffect(this.current);
    this.writePreference(this.current);
    this.applyStateToDom();
  }

  private attachToggleHandlers() {
    // Click support
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const option = target.closest('[data-effect-option]');
      if (!(option instanceof HTMLElement)) return;
      const name = option.getAttribute('data-effect-option');
      if (name === 'off' || name === 'rain' || name === 'snow') {
        e.preventDefault();
        this.select(name);
      }
    });

    // Keyboard navigation within radiogroup
    document.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const radio = target.closest('[data-effect-option]');
      const group = target.closest('[role="radiogroup"]');
      if (!(radio instanceof HTMLElement) || !(group instanceof HTMLElement)) return;

      const options = Array.from(group.querySelectorAll<HTMLElement>('[data-effect-option]'));
      const currentIndex = options.indexOf(radio);
      if (currentIndex === -1) return;

      const prev = () => options[(currentIndex - 1 + options.length) % options.length];
      const next = () => options[(currentIndex + 1) % options.length];

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const el = prev();
        el.focus();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const el = next();
        el.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        const el = options[0];
        if (el) el.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        const el = options[options.length - 1];
        if (el) el.focus();
      } else if (e.key === ' ' || e.key === 'Enter') {
        const name = radio.getAttribute('data-effect-option');
        if (name === 'off' || name === 'rain' || name === 'snow') {
          e.preventDefault();
          this.select(name);
        }
      }
    });
  }
}

function init() {
  new EffectsController();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

export {};
