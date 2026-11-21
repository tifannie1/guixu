import { registerFileDrop } from '/desktop-drop.mjs';

const arrow = document.getElementById('arrow');
window.island.onState(({ tab, edge, edgeSize }) => {
  if (tab) document.body.dataset.tab = '';
  else delete document.body.dataset.tab;
  document.body.dataset.edge = edge;
  document.body.style.width = edgeSize.width + 'px';
  document.body.style.height = edgeSize.height + 'px';
  arrow.hidden = !tab;
});
arrow.addEventListener('click', () => window.island.action('expand'));
registerFileDrop({ indicator: active => document.body.classList.toggle('dragging', active) });
window.island.action('state');
