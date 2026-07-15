/* HomeOS Home — Tweaks panel (React). State is applied to the vanilla page via window.HomeOS.apply(). */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "mode": "glance",
  "atmo": "golden",
  "memory": "captioned",
  "idle": false
}/*EDITMODE-END*/;

function TweaksApp() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  React.useEffect(() => {
    if (window.HomeOS) window.HomeOS.apply(t);
  }, [t]);

  // Let the page (keyboard, mode chip) drive the same state.
  React.useEffect(() => {
    window.__setTweak = setTweak;
    return () => { delete window.__setTweak; };
  }, [setTweak]);

  return (
    <TweaksPanel>
      <TweakSection label="Presence" />
      <TweakSelect
        label="Mode"
        value={t.mode}
        options={['ambient', 'glance', 'lean-in', 'voice']}
        onChange={(v) => setTweak('mode', v)}
      />
      <TweakSection label="Atmosphere" />
      <TweakSelect
        label="Weather"
        value={t.atmo}
        options={['golden', 'clear', 'cloudy', 'rain', 'storm', 'fog', 'night']}
        onChange={(v) => setTweak('atmo', v)}
      />
      <TweakSelect
        label="Memory"
        value={t.memory === true ? 'captioned' : (t.memory === false ? 'off' : t.memory)}
        options={['off', 'captioned', 'tender']}
        onChange={(v) => setTweak('memory', v)}
      />
      <TweakSection label="Attention" />
      <TweakToggle
        label="Quiet house (concierge idle)"
        value={t.idle}
        onChange={(v) => setTweak('idle', v)}
      />
      <TweakSection label="Events" />
      <TweakButton
        label="Trigger arrival"
        onClick={() => window.HomeOS && window.HomeOS.arrive()}
      />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('tweaks-root')).render(<TweaksApp />);
