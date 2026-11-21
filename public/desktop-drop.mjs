export function registerFileDrop({ indicator = () => {} } = {}) {
  let dragging = false;
  let leaveTimer;
  function reset() {
    clearTimeout(leaveTimer);
    if (!dragging) return;
    dragging = false;
    indicator(false);
    window.island.fileDrag('leave');
  }
  function enter(event) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    // Keep Explorer from removing originals before the application verifies the archive.
    event.dataTransfer.dropEffect = 'copy';
    clearTimeout(leaveTimer);
    if (dragging) return;
    dragging = true;
    indicator(true);
    window.island.fileDrag('enter', { x: event.screenX, y: event.screenY });
  }
  document.addEventListener('dragenter', enter);
  document.addEventListener('dragover', event => {
    event.preventDefault();
    enter(event);
  });
  document.addEventListener('dragleave', () => {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(reset, 100);
  });
  document.addEventListener('drop', event => {
    event.preventDefault();
    reset();
  });
}
