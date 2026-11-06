// 许愿时的声音：全部用 WebAudio 现场合成，不需要音频文件
// - rumble：低沉的、几乎听不到的轰鸣（滤到 90Hz 以下的噪声 + 一个 38Hz 的正弦），音量跟着"压迫感"走
// - splash：许愿签落水的一声轻响
// - thump：龙停在许愿签下方时，水下传来的一声闷响
// - bite：龙合上嘴时一声低沉的"咔"
// 浏览器要求声音必须由用户的点击开启，所以在点"投入池中"时调用 unlock()

export function createWishAudio() {
  let ctx = null, master, rumbleGain, noiseBuf;

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = .9; master.connect(ctx.destination);

    // 两秒的白噪声，循环用
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0; rumbleGain.connect(master);
    const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90; lp.Q.value = .7;
    const ng = ctx.createGain(); ng.gain.value = .9;
    n.connect(lp).connect(ng).connect(rumbleGain); n.start();
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 38;
    const og = ctx.createGain(); og.gain.value = .35;
    // 轰鸣缓慢起伏，像深处有东西在呼吸
    const lfo = ctx.createOscillator(); lfo.frequency.value = .13;
    const lg = ctx.createGain(); lg.gain.value = .2;
    lfo.connect(lg).connect(og.gain); lfo.start();
    o.connect(og).connect(rumbleGain); o.start();
  }

  // 0～1：许愿过程中的"压迫感"
  function level(v) {
    if (!ctx) return;
    rumbleGain.gain.setTargetAtTime(v * .55, ctx.currentTime, .4);
  }

  function burst({ freq, q = 1, dur, gain, type = 'bandpass', sweepTo }) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + .05);
  }
  function tone(f0, f1, dur, gain) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .03); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + .05);
  }

  return {
    unlock, level,
    splash() { burst({ freq: 1800, q: .8, dur: .45, gain: .35, sweepTo: 500 }); burst({ freq: 400, q: 1, dur: .3, gain: .25 }); },
    thump() { tone(62, 28, 2.2, .9); burst({ freq: 120, q: .7, dur: 1.4, gain: .5, type: 'lowpass' }); },
    bite() { tone(140, 45, .35, .5); burst({ freq: 300, q: 2, dur: .2, gain: .35 }); },
  };
}
