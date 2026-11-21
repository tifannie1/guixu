const desktop = window.island;
const byId = id => document.getElementById(id);
const card = byId('media-card');
const title = byId('media-title');
const source = byId('media-source');
const previous = byId('media-previous');
const play = byId('media-play');
const next = byId('media-next');
const seek = byId('media-seek');
const volume = byId('media-volume');
const mute = byId('media-mute');
const feedback = byId('media-feedback');

const paths = {
  note: '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
  previous: '<path d="M6 5v14m12-14L9 12l9 7z" fill="currentColor"/>',
  next: '<path d="M18 5v14M6 5l9 7-9 7z" fill="currentColor"/>',
  play: '<path d="m9 5 11 7-11 7z" fill="currentColor"/>',
  pause: '<path d="M9 5v14m6-14v14" stroke-width="2.8"/>',
  mute: '<path d="M3 9h4l5-4v14l-5-4H3zM16 10l5 5m0-5-5 5"/>',
  sound: '<path d="M3 9h4l5-4v14l-5-4H3zM16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>',
};

function glyph(target, name) {
  if (target.dataset.glyph === name) return;
  target.dataset.glyph = name;
  target.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    paths[name] + '</svg>';
}

function sourceName(appId) {
  const players = [
    [/cloudmusic|netease/i, '网易云音乐'], [/qqmusic/i, 'QQ 音乐'],
    [/kugou/i, '酷狗音乐'], [/kuwo/i, '酷我音乐'], [/spotify/i, 'Spotify'],
    [/zunemusic/i, 'Windows 媒体播放器'], [/msedge/i, 'Microsoft Edge'],
    [/chrome/i, 'Google Chrome'], [/firefox/i, 'Firefox'],
  ];
  return players.find(([pattern]) => pattern.test(appId))?.[1] || '系统媒体';
}

function clock(seconds) {
  const whole = Math.floor(Math.max(0, seconds));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

function describe(button, label) {
  button.title = label;
  button.setAttribute('aria-label', label);
}

let active = false;
let musicTab = false;
let state;
let reading = false;
let commandInFlight = false;
let revision = 0;
let pollTimer;
let feedbackTimer;
const adjusting = new Set();

function render() {
  const media = state?.hasSession ? state : null;
  card.hidden = !active || (!musicTab && !media);
  if (card.hidden) return;
  const heading = media ? media.title || '当前媒体' : '音乐控制';
  title.textContent = heading;
  title.title = heading;
  const description = media ? [media.artist, sourceName(media.source)].filter(Boolean).join(' · ') :
    state ? '未检测到曲目' : state === undefined ? '正在读取播放状态…' : '暂时无法读取播放状态';
  source.textContent = description;
  source.title = description;
  previous.disabled = commandInFlight || !media?.canPrevious;
  play.disabled = commandInFlight || !(media?.playing ? media.canPause : media?.canPlay);
  next.disabled = commandInFlight || !media?.canNext;
  glyph(play, media?.playing ? 'pause' : 'play');
  describe(play, media?.playing ? '暂停' : '播放');

  const timeline = media?.timeline;
  byId('media-timeline').hidden = !timeline;
  if (timeline && !adjusting.has(seek)) {
    seek.max = Math.ceil(timeline.duration);
    seek.value = timeline.position;
    seek.disabled = commandInFlight || !timeline.canSeek;
    byId('media-position').textContent = clock(Number(seek.value));
    byId('media-duration').textContent = clock(timeline.duration);
  }
  const output = state?.volume;
  byId('media-volume-row').hidden = !output;
  if (output) {
    glyph(mute, output.muted ? 'mute' : 'sound');
    describe(mute, output.muted ? '取消系统静音' : '系统静音');
    mute.setAttribute('aria-pressed', String(output.muted));
    mute.disabled = commandInFlight;
    if (!adjusting.has(volume)) {
      volume.value = output.level;
      byId('media-level').textContent = output.level + '%';
    }
  }
  byId('media-empty').hidden = !!media;
}

function showFeedback(message) {
  clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedback.hidden = false;
  feedbackTimer = setTimeout(() => { feedback.hidden = true; }, 3000);
}

async function poll() {
  if (!active || reading || commandInFlight) return;
  reading = true;
  const atStart = revision;
  try {
    const current = await desktop.mediaState();
    if (!active || atStart !== revision) return;
    if (current?.source !== state?.source || current?.title !== state?.title) {
      adjusting.clear();
      feedback.hidden = true;
    }
    state = current;
    render();
  } catch {
    if (active && atStart === revision) {
      state = null;
      render();
    }
  } finally { reading = false; }
}

async function control(action, value) {
  if (!active || !state || commandInFlight) return;
  commandInFlight = true;
  revision++;
  // Keep a completed slider drag in place until Windows has returned the new value.
  render();
  try {
    if (!await desktop.mediaControl({ action, value, source: state.source ?? '' })) {
      showFeedback('当前播放器或设备不支持这项操作');
    } else if (action === 'volume') state.volume.level = value;
    else if (action === 'mute') state.volume.muted = value;
    else if (action === 'seek') state.timeline.position = value;
  } catch {
    showFeedback('暂时无法控制播放，请重试');
  } finally {
    commandInFlight = false;
    if (action === 'seek') adjusting.delete(seek);
    if (action === 'volume') adjusting.delete(volume);
    render();
    void poll();
  }
}

function bindRange(input, action, showValue) {
  input.addEventListener('input', () => {
    adjusting.add(input);
    showValue(Number(input.value));
  });
  input.addEventListener('change', () => {
    if (commandInFlight) { adjusting.delete(input); return; }
    void control(action, Number(input.value));
  });
  input.addEventListener('pointercancel', () => { adjusting.delete(input); render(); });
  input.addEventListener('blur', () => { if (!commandInFlight) adjusting.delete(input); });
}

glyph(byId('media-icon'), 'note');
glyph(byId('music-tab-icon'), 'note');
glyph(previous, 'previous');
glyph(next, 'next');
previous.onclick = () => void control('previous');
play.onclick = () => void control(state?.playing ? 'pause' : 'play');
next.onclick = () => void control('next');
mute.onclick = () => void control('mute', !state?.volume?.muted);
bindRange(seek, 'seek', value => { byId('media-position').textContent = clock(value); });
bindRange(volume, 'volume', value => { byId('media-level').textContent = value + '%'; });

export function setMediaActive({ expanded, preview }) {
  const nextActive = expanded && !preview;
  if (nextActive === active) return;
  active = nextActive;
  revision++;
  if (active) {
    render();
    void poll();
    pollTimer = setInterval(poll, 1200);
  } else {
    clearInterval(pollTimer);
    adjusting.clear();
    render();
  }
}

export function setMusicTab(selected) {
  musicTab = selected;
  render();
}
