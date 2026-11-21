import { registerFileDrop } from '/desktop-drop.mjs';
import { analyze } from '/analyze.mjs';
import { setMediaActive, setMusicTab } from '/island-media.mjs';

const shapes = {
  pin: '<path d="m15 3 6 6-3 1-3 5v3l-4-4-6 6-1-1 6-6-4-4h3l5-3z"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14m-7-7v14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  calendar: '<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3v6m8-6v6M4 11h16"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/>',
  doc: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 16 5-4 4 3 4-5 5 5"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16m-16 5h16m-10-5v10"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4 10-10"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
const categories = {
  doc: ['文档', 'doc', '#dce5f4', '#262c36'],
  image: ['照片', 'image', '#ead7e2', '#322831'],
  sheet: ['表格', 'sheet', '#c8e1d2', '#23312d'],
  other: ['其他', 'folder', '#eadcc5', '#312c24'],
};
const kinds = ['工作', '学习', '生活', '其他'];
const formatDay = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const $ = id => document.getElementById(id);
const detail = $('detail');
const icon = name => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + shapes[name] + '</svg>';
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const fileRoute = id => '/api/files/' + encodeURIComponent(id);
const taskRoute = id => '/api/tasks' + (id ? '/' + encodeURIComponent(id) : '');

function dayKey(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((number, index) => index ? String(number).padStart(2, '0') : number).join('-');
}

const state = { expanded: false, tab: 'files', day: dayKey(), category: 'all', query: '', files: [], archives: [], folder: null, tasks: [], results: null, busy: false };
let picking = false;
let workspaceToken = 0;
let searchToken = 0;
let searchTimer;
let statusTimer;
let indexing = false;

async function api(url, method = 'GET', body) {
  const options = { method };
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers = { 'content-type': 'application/json' };
  }
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作未完成，请重试。');
  return data;
}

function status(message, sticky = false) {
  clearTimeout(statusTimer);
  $('status').textContent = message;
  if (!sticky) {
    statusTimer = setTimeout(() => {
      $('status').innerHTML = '<span class="local-dot"></span>本机资料库';
    }, 4800);
  }
}

function sizeLabel(size) {
  if (size >= 1024 ** 2) return (size / 1024 ** 2).toFixed(1) + ' MB';
  if (size >= 1024) return (size / 1024).toFixed(1) + ' KB';
  return size + ' B';
}

function empty(title, hint = '') {
  return '<div class="empty"><b>' + escape(title) + '</b><span>' + escape(hint) + '</span></div>';
}

function foldersById() {
  const groups = new Map(state.archives.map(archive => [archive.id, { ...archive, members: [] }]));
  for (const file of state.files) {
    let group = groups.get(file.archiveId);
    if (!group && !file.archiveId && file.sourcePath?.includes('/')) {
      const name = file.sourcePath.split('/')[0];
      const id = 'legacy:' + name;
      if (!groups.has(id)) groups.set(id, { id, name, members: [], directories: [] });
      group = groups.get(id);
    }
    group?.members.push(file);
  }
  return groups;
}

const relativeInFolder = file => file.archiveRelative || file.sourcePath.split('/').slice(1).join('/');

function folderRow(label, description, attributes) {
  return '<div class="row folder-row"><button class="open-row" ' + attributes + '><span class="item-icon">' +
    icon('folder') + '</span><span class="row-text"><b>' + escape(label) + '</b><small>' + escape(description) +
    '</small></span><span class="chevron">' + icon('right') + '</span></button></div>';
}

function renderFiles() {
  const groups = foldersById();
  const group = groups.get(state.folder?.id);
  const folderNav = $('folder-nav');
  folderNav.hidden = !group;
  $('filters').hidden = !!group;
  if (group && !state.query) {
    const prefix = state.folder.path ? state.folder.path + '/' : '';
    const relativeFiles = new Map(group.members.map(file => [relativeInFolder(file), file]));
    const children = new Set();
    for (const path of [...group.directories, ...relativeFiles.keys()]) {
      if (!path.startsWith(prefix) || path === prefix) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes('/') || group.directories.includes(path)) children.add(rest.split('/')[0]);
    }
    const localFiles = [...relativeFiles.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
    $('list-title').textContent = state.folder.path ? state.folder.path.split('/').at(-1) : group.name;
    $('file-count').textContent = (children.size + localFiles.length) + ' 项';
    folderNav.innerHTML = '<button class="quiet" data-parent-folder>返回上一级</button>' +
      (group.path ? '<button class="quiet" data-open-archive="' + escape(group.id) + '">在资源管理器中打开</button>' : '');
    $('files').innerHTML = [...children].sort((a,b) => a.localeCompare(b,'zh-CN')).map(name =>
      folderRow(name,'子文件夹','data-subfolder="' + escape(prefix + name) + '"')).join('') +
      localFiles.map(([,file]) => renderFileRow(file)).join('') || empty('此文件夹为空');
    return;
  }
  folderNav.hidden = true;
  $('filters').hidden = false;
  const filters = [['all', '全部'], ...Object.entries(categories).map(([key, value]) => [key, value[0]]), ['favorites', '收藏']];
  $('filters').innerHTML = filters.map(([key, label]) => {
    const active = key === state.category;
    return '<button class="chip ' + (active ? 'active' : '') + '" data-category="' + key +
      '" aria-pressed="' + active + '">' + label + '</button>';
  }).join('');
  $('list-title').textContent = state.query ? '搜索结果' : state.category === 'all' ? '最近资料' : filters.find(([key]) => key === state.category)[1];
  if (state.query && !state.results) {
    $('file-count').textContent = '';
    $('files').innerHTML = empty('正在搜索…');
    return;
  }
  const groupMatches = state.category === 'all' ? [...groups.values()].filter(folder =>
    !state.query || folder.name.normalize('NFKC').toLowerCase().includes(state.query.normalize('NFKC').toLowerCase())) : [];
  const groupedFiles = new Set(groupMatches.flatMap(folder => folder.members.map(file => file.id)));
  const files = state.files.filter(file => {
    if (groupedFiles.has(file.id)) return false;
    if (state.query && !state.results.has(file.id)) return false;
    if (state.category === 'favorites') return file.favorite;
    return state.category === 'all' || state.category === file.category;
  });
  $('file-count').textContent = (files.length + groupMatches.length) + ' 项';
  if (!files.length && !groupMatches.length) {
    $('files').innerHTML = state.query ? empty('没有匹配的资料', '试试更短的关键词，或切回「全部」。') :
      empty(state.category === 'favorites' ? '还没有收藏' : '这里还没有资料', '把文件或文件夹从桌面或资源管理器拖进来。');
    return;
  }
  $('files').innerHTML = groupMatches.map(group => folderRow(group.name,
    new Set(group.members.map(relativeInFolder)).size + ' 个文件 · ' + (group.path ? '原样归档' : '待移动'),
    'data-folder="' + escape(group.id) + '"')).join('') + files.map(renderFileRow).join('');
}

function renderFileRow(file) {
    const [label, glyph, tone, tint] = categories[file.category] || categories.other;
    const id = escape(file.id);
    const sourceFolder = file.sourcePath?.split('/').slice(0, -1).join('/');
    const metadata = [label, file.sample ? '示例' : sizeLabel(file.size), sourceFolder].filter(Boolean).join(' · ');
    return '<div class="row"><button class="open-row" data-file="' + id + '">' +
      '<span class="item-icon" style="--tone:' + tone + ';--tint:' + tint + '">' + icon(glyph) + '</span>' +
      '<span class="row-text"><b title="' + escape(file.name) + '">' + escape(file.name) + '</b><small>' +
      escape(metadata) + '</small></span></button>' +
      '<button class="icon-button ' + (file.favorite ? 'starred' : '') + '" aria-pressed="' + file.favorite +
      '" aria-label="收藏" title="收藏" data-favorite="' + id + '">' + icon('star') + '</button></div>';
}

function renderTasks() {
  const date = new Date(state.day + 'T12:00:00');
  $('day').value = state.day;
  $('day-display').textContent = formatDay.format(date) + (state.day === dayKey() ? ' · 今天' : '');
  const tasks = state.tasks.filter(task => task.day === state.day);
  const done = tasks.filter(task => task.done).length;
  $('plan-count').textContent = done + ' / ' + tasks.length;
  $('progress').value = tasks.length ? 100 * done / tasks.length : 0;
  $('tasks').innerHTML = tasks.length ? tasks.map(task => {
    const id = escape(task.id);
    return '<div class="row ' + (task.done ? 'done' : '') + '"><button class="plan-check" role="checkbox" aria-checked="' +
      task.done + '" aria-label="' + escape(task.title) + '" data-check="' + id + '">' +
      (task.done ? icon('check') : '') + '</button><button class="open-row" data-task="' + id +
      '"><span class="row-text"><b>' + escape(task.title) + '</b><small>' + escape(task.time || '全天') +
      '</small></span></button><span class="kind">' + escape(task.kind) + '</span></div>';
  }).join('') : empty('这天还没有安排', '点下方按钮添加一条计划。');
}

async function refresh() {
  const token = ++workspaceToken;
  const day = state.day;
  try {
    const data = await api('/api/workspace?day=' + encodeURIComponent(day));
    if (token !== workspaceToken) return;
    state.files = data.files;
    state.archives = data.archives;
    state.tasks = data.tasks;
    renderFiles();
    renderTasks();
    void indexPending();
  } catch (error) {
    if (token === workspaceToken) status(error.message);
  }
}

async function indexPending() {
  if (indexing) return;
  const pending = state.files.filter(file => file.method === 'pending');
  if (!pending.length) return;
  indexing = true;
  try {
    for (const file of pending) {
      try {
        const response = await fetch(fileRoute(file.id) + '/content');
        if (!response.ok) continue;
        const indexed = await analyze(new File([await response.blob()], file.name));
        await api(fileRoute(file.id) + '/index', 'POST', indexed);
        for (const record of state.files) if (record.id === file.id) record.method = indexed.method;
      } catch { /* A missing file can be indexed again after it is available. */ }
    }
  } finally {
    indexing = false;
    if (state.query) queueSearch();
  }
}

function switchTab(tab) {
  state.tab = tab;
  $('library').hidden = tab !== 'files';
  $('planner').hidden = tab !== 'plan';
  for (const [id, active] of [['files-tab', tab === 'files'], ['plan-tab', tab === 'plan'], ['music-tab', tab === 'music']]) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-pressed', String(active));
  }
  if (tab === 'plan') renderTasks();
  setMusicTab(tab === 'music');
}

function queueSearch() {
  const token = ++searchToken;
  clearTimeout(searchTimer);
  state.query = $('query').value.trim().slice(0, 150);
  state.results = null;
  renderFiles();
  if (!state.query) return;
  searchTimer = setTimeout(async () => {
    try {
      const result = await api('/api/search?q=' + encodeURIComponent(state.query));
      if (token !== searchToken) return;
      state.results = new Set(result.ids);
      renderFiles();
    } catch (error) {
      if (token !== searchToken) return;
      $('files').innerHTML = empty('搜索暂时不可用', error.message);
    }
  }, 170);
}

function openDialog(title, body) {
  detail.innerHTML = '<div class="detail-header"><h2 id="detail-title">' + escape(title) +
    '</h2><button type="button" class="icon-button" data-dismiss aria-label="关闭">' + icon('close') + '</button></div>' + body;
  if (!detail.open) detail.showModal();
}

function form(body, controls, saveLabel = '保存') {
  return '<form class="detail-content">' + body + '<p class="error" role="alert" hidden></p><div class="form-actions">' +
    controls + '<button class="primary" type="submit">' + saveLabel + '</button></div></form>';
}

function onSubmit(save) {
  const editor = detail.querySelector('form');
  editor.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = editor.querySelector('[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      await save(Object.fromEntries(new FormData(editor)));
      if (detail.contains(editor)) detail.close();
    } catch (error) {
      const feedback = editor.querySelector('.error');
      feedback.hidden = false;
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function setFile(file) {
  state.files = state.files.map(item => item.id === file.id ? file : item);
  if (state.query) queueSearch();
  else renderFiles();
}

async function fileDetail(id) {
  const { file } = await api(fileRoute(id));
  const url = fileRoute(id) + '/content';
  const image = /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name) || file.sample && /\.svg$/i.test(file.name);
  const preview = image ? '<img src="' + url + '?preview=1" alt="' + escape(file.name) + '">' : '';
  const excerpt = file.body ? '<pre aria-label="正文摘录">' + escape(file.body.slice(0, 850)) + '</pre>' : '';
  const source = file.sourcePath ? '<p>来源：' + escape(file.sourcePath) + '</p>' : '';
  const options = Object.entries(categories).map(([value, [label]]) =>
    '<option value="' + value + '"' + (file.category === value ? ' selected' : '') + '>' + label + '</option>').join('');
  openDialog(file.name, form(
    source + '<p>' + escape(file.summary) + '</p>' + preview + excerpt +
    '<label>文件名<input name="name" value="' + escape(file.name) + '" maxlength="255" required></label>' +
    '<div class="two"><label>分类<select aria-label="分类" name="category">' + options + '</select></label>' +
    '<label>标签<input name="tags" placeholder="用逗号分隔" maxlength="290" value="' + escape(file.tags.join('，')) + '"></label></div>',
    (file.archiveId ? '<button type="button" class="secondary" data-open-archive="' + escape(file.archiveId) +
      '">打开存储位置</button>' : '<button type="button" class="danger" data-remove>删除</button>') +
    '<a class="secondary" download href="' + url + '">下载原件</a>',
  ));
  const remove = detail.querySelector('[data-remove]');
  if (remove) remove.onclick = () => confirmRemoval('删除这个文件？', async () => {
    await api(fileRoute(id), 'DELETE');
    state.files = state.files.filter(item => item.id !== id);
    renderFiles();
    status('文件已删除');
  });
  onSubmit(async input => {
    input.tags = input.tags.split(/[,，]/).map(value => value.trim()).filter(Boolean);
    const { file: updated } = await api(fileRoute(id), 'PATCH', input);
    setFile(updated);
    status('文件信息已保存');
  });
}

function confirmRemoval(title, remove) {
  openDialog(title, form('<p>删除后将从归序资料库移除。</p>',
    '<button type="button" class="secondary" data-dismiss>取消</button>', '确认删除'));
  onSubmit(remove);
}

function taskEditor(id) {
  const task = state.tasks.find(item => item.id === id);
  const options = kinds.map(kind => '<option' + ((task?.kind || '工作') === kind ? ' selected' : '') + '>' + kind + '</option>').join('');
  openDialog(task ? '编辑计划' : '添加计划', form(
    '<label>计划名称<input name="title" required autofocus maxlength="130" value="' + escape(task?.title) + '"></label>' +
    '<div class="two"><label>日期<input name="day" type="date" value="' + escape(task?.day || state.day) +
    '" required></label><label>时间<input name="time" type="time" value="' + escape(task?.time) + '"></label></div>' +
    '<label>类别<select aria-label="类别" name="kind">' + options + '</select></label>',
    task ? '<button type="button" class="danger" data-remove>删除</button>' :
      '<button type="button" class="secondary" data-dismiss>取消</button>', task ? '保存' : '添加计划',
  ));
  if (task) detail.querySelector('[data-remove]').onclick = () => confirmRemoval('删除这项计划？', async () => {
    await api(taskRoute(id), 'DELETE');
    await refresh();
    status('计划已删除');
  });
  onSubmit(async input => {
    await api(taskRoute(id), task ? 'PATCH' : 'POST', input);
    state.day = input.day;
    await refresh();
    status(task ? '计划已更新' : '计划已添加');
  });
}

function importProgress(current, total) {
  switchTab('files');
  state.busy = true;
  $('pick').disabled = true;
  $('pick-folder').disabled = true;
  const progress = total ? '正在移动并核对 ' + current + ' / ' + total : '正在检查归档盘…';
  $('drop-heading').textContent = progress;
  $('capsule-label').textContent = progress;
}

async function importResult(completed, errors, errorCount = errors.length, archive = {}) {
  state.busy = false;
  $('pick').disabled = false;
  $('pick-folder').disabled = false;
  $('drop-heading').textContent = '拖入文件或文件夹';
  $('capsule-label').textContent = '桌面资料库';
  state.category = 'all';
  state.folder = null;
  $('query').value = '';
  queueSearch();
  await refresh();
  if (errorCount) {
    const remaining = errorCount - errors.length;
    openDialog('归档结果', '<div class="detail-content"><p>已移动 ' + completed + ' 项，' + errorCount +
      ' 项未完成。</p>' + errors.map(error => '<p class="error">' + escape(error) + '</p>').join('') +
      (remaining > 0 ? '<p>还有 ' + remaining + ' 项未显示。</p>' : '') + '</div>');
  } else status('已移动到 ' + (archive.root?.slice(0, 2) ?? '归档盘') + ' · ' +
    (archive.folders ? archive.folders + ' 个文件夹，' : '') + (archive.files ?? completed) + ' 个文件');
}

function changeDate(day) {
  if (!day || day === state.day) return;
  state.day = day;
  renderTasks();
  void refresh();
}

function offsetDate(days) {
  const date = new Date(state.day + 'T12:00:00');
  date.setDate(date.getDate() + days);
  changeDate(dayKey(date));
}

function onWindowState({ expanded, preview, suspended, pinned, shortcutAvailable }) {
  const wasExpanded = state.expanded;
  state.expanded = expanded;
  $('island').classList.toggle('preview', preview);
  $('panel').hidden = !expanded;
  $('shortcut').hidden = !shortcutAvailable;
  $('pin').setAttribute('aria-pressed', String(pinned));
  if (!state.busy) {
    $('capsule-label').textContent = preview ? '松开文件即可归档' : '桌面资料库';
    $('drop-heading').textContent = preview ? '松开文件，自动归档' : '拖入文件或文件夹';
  }
  if (expanded && !wasExpanded) void refresh();
  if (!expanded && !suspended && detail.open) detail.close();
  setMediaActive({ expanded, preview });
}

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
$('pin').onclick = () => window.island?.action('pin');
$('hide').onclick = () => window.island?.action('collapse');
document.querySelector('.capsule').addEventListener('dblclick', event => {
  if (state.expanded && !event.target.closest('button')) window.island?.action('collapse');
});
$('files-tab').onclick = () => switchTab('files');
$('plan-tab').onclick = () => switchTab('plan');
$('music-tab').onclick = () => switchTab('music');
$('query').addEventListener('input', queueSearch);
function bindPicker(button, kind) {
  button.onclick = async () => {
    picking = true;
    try { await window.island.pickArchive(kind); }
    catch { status('无法打开选择窗口。'); }
    finally { picking = false; }
  };
}
bindPicker($('pick'), 'file');
bindPicker($('pick-folder'), 'folder');
$('prev').onclick = () => offsetDate(-1);
$('next').onclick = () => offsetDate(1);
$('today').onclick = () => changeDate(dayKey());
$('day').onchange = event => changeDate(event.target.value);
$('add-task').onclick = () => taskEditor();

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-dismiss],[data-category],[data-file],[data-favorite],[data-task],[data-check],[data-folder],[data-subfolder],[data-parent-folder],[data-open-archive]');
  if (!button || button.disabled) return;
  if (button.hasAttribute('data-dismiss')) { detail.close(); return; }
  const { category, file, favorite, task, check } = button.dataset;
  try {
    if (button.dataset.openArchive) {
      const failure = await window.island.openArchive(button.dataset.openArchive);
      if (failure) status(failure);
      return;
    }
    if (button.dataset.folder) {
      state.folder = { id: button.dataset.folder, path: '' };
      $('query').value = '';
      queueSearch();
    }
    if (button.dataset.subfolder) { state.folder.path = button.dataset.subfolder; renderFiles(); }
    if (button.hasAttribute('data-parent-folder')) {
      if (state.folder.path) state.folder.path = state.folder.path.split('/').slice(0, -1).join('/');
      else state.folder = null;
      renderFiles();
    }
    if (category) { state.folder = null; state.category = category; renderFiles(); }
    if (file) { button.disabled = true; await fileDetail(file); }
    if (favorite) {
      button.disabled = true;
      const item = state.files.find(record => record.id === favorite);
      const { file: updated } = await api(fileRoute(favorite), 'PATCH', { favorite: !item.favorite });
      setFile(updated);
    }
    if (task) taskEditor(task);
    if (check) {
      button.disabled = true;
      const item = state.tasks.find(record => record.id === check);
      try {
        const { task: updated } = await api(taskRoute(check), 'PATCH', { done: !item.done });
        state.tasks = state.tasks.map(record => record.id === check ? updated : record);
        renderTasks();
      } finally { button.disabled = false; }
    }
  } catch (error) { status(error.message); }
  finally { button.disabled = false; }
});

registerFileDrop({ indicator: active => $('island').classList.toggle('dragging', active) });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !detail.open && state.expanded) window.island?.action('collapse');
});
window.addEventListener('focus', () => { if (state.expanded) void refresh(); });
window.island?.onState(onWindowState);
window.island?.onBlur(() => {
  if (!detail.open && !state.busy && !picking) window.island.action('idle');
});
window.island?.onImportProgress(importProgress);
window.island?.onImportResult(importResult);
window.island?.onImportBusy(() => status('上一批文件正在导入', true));
window.island?.action('state');
