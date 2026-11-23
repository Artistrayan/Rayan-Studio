import type { RayanAsset } from '../types/studio';

export type SynthSoundId = 'jump' | 'throw' | 'coin' | 'hit' | 'click' | 'win' | 'laser';
export type SynthBgmId = 'none' | 'adventure' | 'space' | 'action';

class RayanAudioEngine {
  private ctx: AudioContext | null = null;
  private bgmTimer: number | null = null;
  private bgmAudioEl: HTMLAudioElement | null = null;
  private muted = false;
  private volume = 0.65;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.ctx = new Ctx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.stopBgm();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.bgmAudioEl) {
      this.bgmAudioEl.volume = this.volume * 0.45;
    }
  }

  playSound(idOrName: string, assets: RayanAsset[] = []) {
    if (this.muted || !idOrName || idOrName === 'none') return;

    const customAsset = assets.find(
      (a) => a.kind === 'audio' && (a.id === idOrName || a.name === idOrName)
    );
    if (customAsset && customAsset.dataUrl) {
      try {
        const audio = new Audio(customAsset.dataUrl);
        audio.volume = this.volume;
        void audio.play();
        return;
      } catch {
        // fallback to synth if playback blocked
      }
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.connect(gain);

    switch (idOrName as SynthSoundId) {
      case 'jump': {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(560, now + 0.16);
        gain.gain.setValueAtTime(0.24 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
        break;
      }
      case 'throw':
      case 'laser': {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.14);
        gain.gain.setValueAtTime(0.18 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.16);
        break;
      }
      case 'coin': {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1174.66, now + 0.07);
        gain.gain.setValueAtTime(0.22 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.start(now);
        osc.stop(now + 0.25);
        break;
      }
      case 'hit': {
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(48, now + 0.2);
        gain.gain.setValueAtTime(0.28 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
        break;
      }
      case 'win': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'triangle';
          o.frequency.setValueAtTime(freq, now + i * 0.09);
          g.gain.setValueAtTime(0.2 * this.volume, now + i * 0.09);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.22);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(now + i * 0.09);
          o.stop(now + i * 0.09 + 0.24);
        });
        osc.disconnect();
        gain.disconnect();
        break;
      }
      case 'click':
      default: {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.05);
        gain.gain.setValueAtTime(0.16 * this.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.07);
        break;
      }
    }
  }

  startBgm(bgmId: string, assets: RayanAsset[] = []) {
    this.stopBgm();
    if (this.muted || !bgmId || bgmId === 'none') return;

    const customAsset = assets.find(
      (a) => a.kind === 'audio' && (a.id === bgmId || a.name === bgmId)
    );
    if (customAsset && customAsset.dataUrl) {
      const audio = new Audio(customAsset.dataUrl);
      audio.loop = true;
      audio.volume = this.volume * 0.45;
      void audio.play().catch(() => {});
      this.bgmAudioEl = audio;
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    const patterns: Record<string, number[]> = {
      adventure: [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23],
      space: [196.0, 246.94, 293.66, 369.99, 293.66, 246.94, 220.0, 261.63],
      action: [146.83, 146.83, 220.0, 174.61, 196.0, 146.83, 261.63, 220.0],
    };
    const seq = patterns[bgmId] || patterns.adventure;
    let step = 0;

    const tickNote = () => {
      if (this.muted) return;
      const now = ctx.currentTime;
      const freq = seq[step % seq.length];
      step++;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = bgmId === 'action' ? 'sawtooth' : bgmId === 'space' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.065 * this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    };

    tickNote();
    this.bgmTimer = window.setInterval(tickNote, bgmId === 'space' ? 420 : 280);
  }

  stopBgm() {
    if (this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (this.bgmAudioEl) {
      this.bgmAudioEl.pause();
      this.bgmAudioEl.currentTime = 0;
      this.bgmAudioEl = null;
    }
  }
}

export const audioEngine = new RayanAudioEngine();
