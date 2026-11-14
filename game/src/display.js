// EMBERLINE — the display: every DOM write the game makes, in one place.
// The simulation never touches the DOM; it calls these setters, and each setter skips
// the write when the value has not changed, so the HUD costs nothing on a quiet frame.
const COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'Ashworks Yard. Plant the charge at Furnace or Depot, or eliminate the Ember squad. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  round: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function makeDisplay() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const healthNum = el('health-num');
  const healthFill = el('health-fill');
  const armorNum = el('armor-num');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const money = el('money');
  const timer = el('timer');
  const roundLabel = el('round-label');
  const scoreV = el('score-v');
  const scoreE = el('score-e');
  const aliveV = el('alive-v');
  const aliveE = el('alive-e');
  const bombStatus = el('bomb-status');
  const banner = el('banner');
  const killfeed = el('killfeed');
  const buy = el('buy');
  const buyMoney = el('buy-money');
  const buyItems = el('buy-items');
  const plantBar = el('plant-bar');
  const plantFill = el('plant-fill');
  const plantLabel = el('plant-label');

  const last = {};
  let playCallback = null;
  let hitTimer = 0;

  function setText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  play.addEventListener('click', () => {
    if (playCallback) playCallback();
  });

  return {
    onPlay(callback) {
      playCallback = callback;
    },
    setHealth(hp) {
      setText(healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      const pct = Math.max(0, Math.min(100, hp));
      if (last.hpPct !== pct) {
        last.hpPct = pct;
        healthFill.style.width = `${pct}%`;
      }
    },
    setArmor(value) {
      setText(armorNum, 'armor', value > 0 ? `+${Math.ceil(value)}` : '');
    },
    setAmmo(mag, reserve) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
    },
    setWeapon(name) {
      setText(weaponName, 'gun', name);
    },
    setMoney(value) {
      setText(money, 'money', `$${value}`);
    },
    setTimer(seconds) {
      const total = Math.max(0, Math.ceil(seconds));
      setText(timer, 'timer', `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`);
    },
    setRound(round, max) {
      setText(roundLabel, 'round', `ROUND ${round}/${max}`);
    },
    setScore(v, e) {
      setText(scoreV, 'sv', String(v));
      setText(scoreE, 'se', String(e));
    },
    setAlive(v, e) {
      setText(aliveV, 'av', '●'.repeat(v) + '○'.repeat(Math.max(0, 3 - v)));
      setText(aliveE, 'ae', '●'.repeat(e) + '○'.repeat(Math.max(0, 4 - e)));
    },
    setBomb(text) {
      setText(bombStatus, 'bomb', text);
    },
    setCrosshairGap(px) {
      const value = `${px.toFixed(1)}px`;
      if (last.gap !== value) {
        last.gap = value;
        crosshair.style.setProperty('--gap', value);
      }
    },
    hitMarker(killed) {
      hitmarker.classList.toggle('kill', killed);
      hitmarker.classList.add('on');
      hitTimer = killed ? 220 : 120;
      window.setTimeout(() => hitmarker.classList.remove('on'), hitTimer);
    },
    banner(text) {
      setText(banner, 'banner', text);
      banner.classList.toggle('show', text.length > 0);
    },
    feed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      window.setTimeout(() => {
        if (line.parentNode) line.parentNode.removeChild(line);
      }, 6000);
    },
    showOverlay(kind, detail) {
      const row = COPY[kind];
      title.textContent = row.title;
      copy.textContent = detail ?? row.copy;
      play.textContent = row.action;
      overlay.hidden = false;
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(open, moneyValue, owned, grenades, kevlar) {
      buy.hidden = !open;
      if (!open) return;
      setText(buyMoney, 'bmoney', `$${moneyValue}`);
      buyItems.querySelectorAll('[data-item]').forEach((node) => {
        const id = node.getAttribute('data-item');
        const ownedGun = id !== 'spark' && id !== 'kevlar' && owned[id];
        const ownedNades = id === 'spark' && grenades >= 2;
        const ownedVest = id === 'kevlar' && kevlar >= 50;
        node.classList.toggle('owned', Boolean(ownedGun || ownedNades || ownedVest));
        node.classList.toggle('poor', moneyValue < Number(node.getAttribute('data-cost')));
      });
    },
    setPlant(label, fraction) {
      if (fraction <= 0) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      setText(plantLabel, 'plabel', label);
      plantFill.style.width = `${Math.round(fraction * 100)}%`;
    },
  };
}
