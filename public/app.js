const STORAGE_KEY = 'proofOfSource.state.v3';
const REPO_FILE_DATALIST_ID = 'repo-file-options';
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const state = {
  files: [],
  repoFiles: [],
  verifyResults: [],
  loadStatus: { type: 'info', message: '' },
  verifyStatus: { type: 'info', message: '' },
  hasServerEtherscanKey: false,
  addressSummaries: [],
  verifiedRepos: [],
  step1ConfigOpen: false
};

const elements = {
  step1Panel: document.getElementById('step-1-panel'),
  addressList: document.getElementById('address-list'),
  addAddressBtn: document.getElementById('add-address-btn'),
  step1Config: document.getElementById('step1-config'),
  chainId: document.getElementById('chain-id'),
  etherscanKeyGroup: document.getElementById('etherscan-key-group'),
  etherscanApiKey: document.getElementById('etherscan-api-key'),
  loadFilesBtn: document.getElementById('load-files-btn'),
  configToggleBtn: document.getElementById('config-toggle-btn'),
  loadStatus: document.getElementById('load-status'),
  filesPanel: document.getElementById('files-panel'),
  filesList: document.getElementById('files-list'),
  fileMeta: document.getElementById('file-meta'),
  checkAllBtn: document.getElementById('check-all-btn'),
  uncheckAllBtn: document.getElementById('uncheck-all-btn'),
  uncheckLibBtn: document.getElementById('uncheck-lib-btn'),
  verifyPanel: document.getElementById('verify-panel'),
  repoList: document.getElementById('repo-list'),
  addRepoBtn: document.getElementById('add-repo-btn'),
  verifyBtn: document.getElementById('verify-btn'),
  verifyStatus: document.getElementById('verify-status'),
  verifyResults: document.getElementById('verify-results')
};

function normalizeClientPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.(\/|\\)/, '')
    .replace(/^\/+/, '')
    .trim();
}

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

function sourceFileKey(sourceAddress, sourcePath) {
  return `${normalizeAddress(sourceAddress)}::${normalizeClientPath(sourcePath)}`;
}

function isLibDirectoryPath(filePath) {
  if (typeof filePath !== 'string') {
    return false;
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  return /(^|\/)lib\//i.test(normalizedPath);
}

function setStatus(target, type, message) {
  if (!target) {
    return;
  }

  target.hidden = !message;
  target.className = `status ${type}`;
  target.textContent = message;
}

function setLoadStatus(type, message, options = {}) {
  state.loadStatus = { type, message };
  setStatus(elements.loadStatus, type, message);

  if (options.persist !== false) {
    persistState();
  }
}

function setVerifyStatus(type, message, options = {}) {
  state.verifyStatus = { type, message };
  setStatus(elements.verifyStatus, type, message);

  if (options.persist !== false) {
    persistState();
  }
}

function bumpButton(button) {
  if (!button) {
    return;
  }

  button.classList.remove('bump');
  void button.offsetWidth;
  button.classList.add('bump');
  setTimeout(() => button.classList.remove('bump'), 140);
}

function wireButtonPointerFX(button) {
  if (!button || button.dataset.fxBound === 'true') {
    return;
  }

  button.dataset.fxBound = 'true';

  button.addEventListener('pointermove', (event) => {
    const rect = button.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    button.style.setProperty('--mx', `${Math.max(0, Math.min(100, x))}%`);
    button.style.setProperty('--my', `${Math.max(0, Math.min(100, y))}%`);
  });

  const reset = () => {
    button.style.setProperty('--mx', '50%');
    button.style.setProperty('--my', '50%');
  };

  button.addEventListener('pointerleave', reset);
  button.addEventListener('blur', reset);
  button.addEventListener('click', () => bumpButton(button));
}

function refreshButtonFX() {
  const buttons = document.querySelectorAll('button');
  for (const button of buttons) {
    wireButtonPointerFX(button);
  }
}

function runImpact(panel) {
  if (!panel) {
    return;
  }

  panel.classList.remove('impact-next');
  void panel.offsetWidth;
  panel.classList.add('impact-next');
  setTimeout(() => panel.classList.remove('impact-next'), 280);
}

function revealPanel(panel) {
  if (!panel) {
    return;
  }

  if (panel.hidden) {
    panel.hidden = false;
  }

  runImpact(panel);
}

function setStep1ConfigOpen(open, options = {}) {
  state.step1ConfigOpen = Boolean(open);
  elements.step1Config.hidden = !state.step1ConfigOpen;
  elements.configToggleBtn.textContent = state.step1ConfigOpen ? 'Hide Config' : 'Config';
  elements.configToggleBtn.setAttribute('aria-expanded', state.step1ConfigOpen ? 'true' : 'false');

  if (options.persist !== false) {
    persistState();
  }
}

function createAddressRow(value = '') {
  const row = document.createElement('div');
  row.className = 'dynamic-row address-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'address-input';
  input.placeholder = '0x...';
  input.autocomplete = 'off';
  input.value = value;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn ghost mini-btn row-remove-btn remove-address-btn';
  removeButton.textContent = 'Remove';

  row.appendChild(input);
  row.appendChild(removeButton);
  return row;
}

function createRepoRow(repoUrl = '', commitHash = '') {
  const row = document.createElement('div');
  row.className = 'dynamic-row repo-row';

  const repoInput = document.createElement('input');
  repoInput.type = 'text';
  repoInput.className = 'repo-url-input';
  repoInput.placeholder = 'https://github.com/owner/repo';
  repoInput.autocomplete = 'off';
  repoInput.value = repoUrl;

  const commitInput = document.createElement('input');
  commitInput.type = 'text';
  commitInput.className = 'repo-commit-input';
  commitInput.placeholder = 'Optional commit hash';
  commitInput.autocomplete = 'off';
  commitInput.value = commitHash;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn ghost mini-btn row-remove-btn remove-repo-btn';
  removeButton.textContent = 'Remove';

  row.appendChild(repoInput);
  row.appendChild(commitInput);
  row.appendChild(removeButton);
  return row;
}

function getAddressRows() {
  return Array.from(elements.addressList.querySelectorAll('.address-row'));
}

function getRepoRows() {
  return Array.from(elements.repoList.querySelectorAll('.repo-row'));
}

function updateAddressRemoveButtons() {
  const rows = getAddressRows();
  const singleRow = rows.length <= 1;

  for (const row of rows) {
    const button = row.querySelector('.remove-address-btn');
    if (!button) {
      continue;
    }

    button.disabled = singleRow;
    button.classList.toggle('is-hidden', singleRow);
  }
}

function updateRepoRemoveButtons() {
  const rows = getRepoRows();
  const singleRow = rows.length <= 1;

  for (const row of rows) {
    const button = row.querySelector('.remove-repo-btn');
    if (!button) {
      continue;
    }

    button.disabled = singleRow;
    button.classList.toggle('is-hidden', singleRow);
  }
}

function renderAddressRows(values = []) {
  elements.addressList.innerHTML = '';

  const initialValues = Array.isArray(values) && values.length > 0 ? values : [''];
  for (const value of initialValues) {
    elements.addressList.appendChild(createAddressRow(typeof value === 'string' ? value : ''));
  }

  updateAddressRemoveButtons();
  refreshButtonFX();
}

function renderRepoRows(entries = []) {
  elements.repoList.innerHTML = '';

  const initialEntries = Array.isArray(entries) && entries.length > 0 ? entries : [{ repoUrl: '', commitHash: '' }];
  for (const entry of initialEntries) {
    const repoUrl = entry && typeof entry.repoUrl === 'string' ? entry.repoUrl : '';
    const commitHash = entry && typeof entry.commitHash === 'string' ? entry.commitHash : '';
    elements.repoList.appendChild(createRepoRow(repoUrl, commitHash));
  }

  updateRepoRemoveButtons();
  refreshButtonFX();
}

function addAddressRow(value = '') {
  elements.addressList.appendChild(createAddressRow(value));
  updateAddressRemoveButtons();
  refreshButtonFX();
}

function addRepoRow(entry = {}) {
  const repoUrl = entry && typeof entry.repoUrl === 'string' ? entry.repoUrl : '';
  const commitHash = entry && typeof entry.commitHash === 'string' ? entry.commitHash : '';
  elements.repoList.appendChild(createRepoRow(repoUrl, commitHash));
  updateRepoRemoveButtons();
  refreshButtonFX();
}

function removeAddressRow(button) {
  const row = button.closest('.address-row');
  if (!row) {
    return;
  }

  const rows = getAddressRows();
  if (rows.length <= 1) {
    return;
  }

  row.remove();
  updateAddressRemoveButtons();
  persistState();
}

function removeRepoRow(button) {
  const row = button.closest('.repo-row');
  if (!row) {
    return;
  }

  const rows = getRepoRows();
  if (rows.length <= 1) {
    return;
  }

  row.remove();
  updateRepoRemoveButtons();
  persistState();
}

function collectAddressInputValues() {
  return getAddressRows().map((row) => {
    const input = row.querySelector('.address-input');
    return input ? input.value : '';
  });
}

function collectAddressesForSubmit() {
  const seen = new Set();
  const output = [];

  for (const rawValue of collectAddressInputValues()) {
    const value = String(rawValue || '').trim();
    if (!value) {
      continue;
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(value);
  }

  return output;
}

function collectRepoInputValues() {
  return getRepoRows().map((row) => {
    const repoUrlInput = row.querySelector('.repo-url-input');
    const commitHashInput = row.querySelector('.repo-commit-input');

    return {
      repoUrl: repoUrlInput ? repoUrlInput.value : '',
      commitHash: commitHashInput ? commitHashInput.value : ''
    };
  });
}

function collectReposForSubmit() {
  const seen = new Set();
  const output = [];

  for (const item of collectRepoInputValues()) {
    const repoUrl = String(item?.repoUrl || '').trim();
    const commitHash = String(item?.commitHash || '').trim();
    if (!repoUrl) {
      continue;
    }

    const key = `${repoUrl.toLowerCase()}::${commitHash.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push({ repoUrl, commitHash });
  }

  return output;
}

function persistState() {
  try {
    const snapshot = {
      inputs: {
        addresses: collectAddressInputValues(),
        chainId: elements.chainId.value,
        etherscanApiKey: elements.etherscanApiKey.value,
        repos: collectRepoInputValues()
      },
      files: state.files,
      repoFiles: state.repoFiles,
      verifyResults: state.verifyResults,
      addressSummaries: state.addressSummaries,
      verifiedRepos: state.verifiedRepos,
      ui: {
        step1ConfigOpen: state.step1ConfigOpen
      },
      loadStatus: state.loadStatus,
      verifyStatus: state.verifyStatus
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('Failed to persist app state:', error);
  }
}

function readPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeStoredStatus(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return { type: 'info', message: '' };
  }

  const type = typeof candidate.type === 'string' ? candidate.type : 'info';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return { type, message };
}

function normalizeStoredAddresses(candidate) {
  if (!Array.isArray(candidate)) {
    return [''];
  }

  const values = candidate.map((value) => (typeof value === 'string' ? value : ''));
  return values.length > 0 ? values : [''];
}

function normalizeStoredRepos(candidate) {
  if (!Array.isArray(candidate)) {
    return [{ repoUrl: '', commitHash: '' }];
  }

  const normalized = candidate
    .map((entry) => {
      if (typeof entry === 'string') {
        return { repoUrl: entry, commitHash: '' };
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      return {
        repoUrl: typeof entry.repoUrl === 'string' ? entry.repoUrl : '',
        commitHash: typeof entry.commitHash === 'string' ? entry.commitHash : ''
      };
    })
    .filter(Boolean);

  return normalized.length > 0 ? normalized : [{ repoUrl: '', commitHash: '' }];
}

function normalizeStoredFiles(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .filter((file) => file && typeof file.path === 'string' && typeof file.content === 'string')
    .map((file) => {
      const isKnownLib = Boolean(file.isKnownLib);
      const selected = typeof file.selected === 'boolean' ? file.selected : !isLibDirectoryPath(file.path);

      return {
        path: normalizeClientPath(file.path),
        content: String(file.content),
        isKnownLib,
        selected,
        sourceAddress: typeof file.sourceAddress === 'string' ? file.sourceAddress : '',
        sourceContractName: typeof file.sourceContractName === 'string' ? file.sourceContractName : '',
        preferredRepoFileId: typeof file.preferredRepoFileId === 'string' ? file.preferredRepoFileId : '',
        preferredRepoPath:
          typeof file.preferredRepoPath === 'string' ? normalizeClientPath(file.preferredRepoPath) : ''
      };
    });
}

function normalizeStoredRepoFiles(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();

  for (const item of candidate) {
    if (typeof item === 'string') {
      const repoPath = normalizeClientPath(item);
      if (!repoPath) {
        continue;
      }

      const legacy = {
        id: `legacy::${repoPath}`,
        repoKey: 'legacy',
        repoLabel: 'Repository',
        path: repoPath,
        display: `[Repository] ${repoPath}`
      };

      if (seen.has(legacy.id)) {
        continue;
      }

      seen.add(legacy.id);
      normalized.push(legacy);
      continue;
    }

    if (!item || typeof item !== 'object') {
      continue;
    }

    const repoPath = normalizeClientPath(item.path);
    if (!repoPath) {
      continue;
    }

    const repoKey = typeof item.repoKey === 'string' && item.repoKey ? item.repoKey : 'repo';
    const repoLabel =
      typeof item.repoLabel === 'string' && item.repoLabel ? item.repoLabel : 'Repository';
    const id = typeof item.id === 'string' && item.id ? item.id : `${repoKey}::${repoPath}`;
    const display =
      typeof item.display === 'string' && item.display
        ? item.display
        : `[${repoLabel}] ${repoPath}`;

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({
      id,
      repoKey,
      repoLabel,
      path: repoPath,
      display
    });
  }

  return normalized;
}

function updateFileMeta() {
  elements.fileMeta.textContent = '';
  elements.fileMeta.hidden = true;
}

function refreshRowSelectionStyles() {
  const rows = elements.filesList.querySelectorAll('.file-row');
  for (const row of rows) {
    const checkbox = row.querySelector('input[type="checkbox"]');
    row.classList.toggle('is-selected', Boolean(checkbox?.checked));
  }
}

function syncSelectionsFromDom(options = {}) {
  const boxes = elements.filesList.querySelectorAll('input[type="checkbox"]');
  for (const box of boxes) {
    const index = Number(box.dataset.index);
    if (Number.isInteger(index) && state.files[index]) {
      state.files[index].selected = box.checked;
    }
  }

  updateFileMeta();
  refreshRowSelectionStyles();

  if (options.persist !== false) {
    persistState();
  }
}

function renderFileList() {
  elements.filesList.innerHTML = '';

  for (let i = 0; i < state.files.length; i += 1) {
    const file = state.files[i];

    const row = document.createElement('label');
    row.className = 'file-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.index = String(i);

    const checked = typeof file.selected === 'boolean' ? file.selected : !isLibDirectoryPath(file.path);
    file.selected = checked;
    checkbox.checked = checked;

    const pathWrap = document.createElement('span');
    pathWrap.className = 'file-path-wrap';

    const sourceNode = document.createElement('span');
    sourceNode.className = 'file-source';
    sourceNode.textContent = file.sourceAddress ? file.sourceAddress : 'unknown address';

    const pathNode = document.createElement('span');
    pathNode.className = 'file-path';
    pathNode.textContent = file.path;

    pathWrap.appendChild(sourceNode);
    pathWrap.appendChild(pathNode);

    const tags = document.createElement('span');
    tags.className = 'file-tags';

    if (file.sourceContractName) {
      const contractTag = document.createElement('span');
      contractTag.className = 'file-tag file-tag-contract';
      contractTag.textContent = file.sourceContractName;
      tags.appendChild(contractTag);
    }

    row.appendChild(checkbox);
    row.appendChild(pathWrap);
    row.appendChild(tags);

    elements.filesList.appendChild(row);
  }

  updateFileMeta();
  refreshRowSelectionStyles();
}

function gatherSelectedFiles() {
  return state.files
    .filter((file) => file.selected)
    .map((file) => {
      const payload = {
        path: file.path,
        content: file.content,
        sourceAddress: file.sourceAddress,
        sourceContractName: file.sourceContractName
      };

      const preferredRepoFileId = String(file.preferredRepoFileId || '').trim();
      if (preferredRepoFileId) {
        payload.preferredRepoFileId = preferredRepoFileId;
      }

      const preferredRepoPath = normalizeClientPath(file.preferredRepoPath || '');
      if (preferredRepoPath) {
        payload.preferredRepoPath = preferredRepoPath;
      }

      return payload;
    });
}

function clearVerifyOutput() {
  state.verifyResults = [];
  state.repoFiles = [];
  state.verifiedRepos = [];
  elements.verifyResults.innerHTML = '';
  renderRepoFileDatalist();
  setVerifyStatus('info', '', { persist: false });
  persistState();
}

function createDiffRow(type, oldNumber, newNumber, sign, content) {
  const row = document.createElement('div');
  row.className = `diff-row ${type}`;

  const oldCell = document.createElement('span');
  oldCell.className = `diff-line-num${Number.isInteger(oldNumber) ? '' : ' empty'}`;
  oldCell.textContent = Number.isInteger(oldNumber) ? String(oldNumber) : '';

  const newCell = document.createElement('span');
  newCell.className = `diff-line-num${Number.isInteger(newNumber) ? '' : ' empty'}`;
  newCell.textContent = Number.isInteger(newNumber) ? String(newNumber) : '';

  const signCell = document.createElement('span');
  signCell.className = 'diff-sign';
  signCell.textContent = sign;

  const contentCell = document.createElement('span');
  contentCell.className = 'diff-code';
  contentCell.textContent = content;

  row.appendChild(oldCell);
  row.appendChild(newCell);
  row.appendChild(signCell);
  row.appendChild(contentCell);

  return row;
}

function renderUnifiedDiff(diffText) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gh-diff';

  const legend = document.createElement('div');
  legend.className = 'diff-legend';
  legend.innerHTML = `
    <span class="legend-pill removed">- Deployed (Etherscan)</span>
    <span class="legend-pill added">+ GitHub Repo</span>
  `;
  wrapper.appendChild(legend);

  const board = document.createElement('div');
  board.className = 'diff-board';
  wrapper.appendChild(board);

  const lines = String(diffText || '').split('\n');
  let oldLine = null;
  let newLine = null;

  for (const rawLine of lines) {
    if (rawLine.startsWith('@@')) {
      const headerMatch = rawLine.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
      if (headerMatch) {
        oldLine = Number(headerMatch[1]);
        newLine = Number(headerMatch[2]);
      }
      board.appendChild(createDiffRow('hunk', null, null, '@@', rawLine));
      continue;
    }

    if (rawLine.startsWith('--- ') || rawLine.startsWith('+++ ')) {
      board.appendChild(createDiffRow('meta', null, null, ' ', rawLine));
      continue;
    }

    if (rawLine.startsWith('\\')) {
      board.appendChild(createDiffRow('note', null, null, ' ', rawLine));
      continue;
    }

    if (rawLine.startsWith('+')) {
      board.appendChild(createDiffRow('add', null, newLine, '+', rawLine.slice(1)));
      if (Number.isInteger(newLine)) {
        newLine += 1;
      }
      continue;
    }

    if (rawLine.startsWith('-')) {
      board.appendChild(createDiffRow('del', oldLine, null, '-', rawLine.slice(1)));
      if (Number.isInteger(oldLine)) {
        oldLine += 1;
      }
      continue;
    }

    const isPrefixedContext = rawLine.startsWith(' ');
    const contextContent = isPrefixedContext ? rawLine.slice(1) : rawLine;
    board.appendChild(createDiffRow('ctx', oldLine, newLine, ' ', contextContent));
    if (Number.isInteger(oldLine)) {
      oldLine += 1;
    }
    if (Number.isInteger(newLine)) {
      newLine += 1;
    }
  }

  return wrapper;
}

function renderRepoFileDatalist() {
  let datalist = document.getElementById(REPO_FILE_DATALIST_ID);
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = REPO_FILE_DATALIST_ID;
    document.body.appendChild(datalist);
  }

  datalist.innerHTML = '';

  for (const repoFile of state.repoFiles) {
    const option = document.createElement('option');
    option.value = repoFile.display;
    datalist.appendChild(option);
  }
}

function findRepoFileById(repoFileId) {
  const id = String(repoFileId || '').trim();
  if (!id) {
    return null;
  }

  return state.repoFiles.find((repoFile) => repoFile.id === id) || null;
}

function resolveRepoFileFromInput(inputValue) {
  const raw = String(inputValue || '').trim();
  if (!raw) {
    return null;
  }

  const lower = raw.toLowerCase();

  const byExactDisplay = state.repoFiles.find((repoFile) => repoFile.display === raw);
  if (byExactDisplay) {
    return byExactDisplay;
  }

  const byDisplayCaseInsensitive = state.repoFiles.find(
    (repoFile) => repoFile.display.toLowerCase() === lower
  );
  if (byDisplayCaseInsensitive) {
    return byDisplayCaseInsensitive;
  }

  const byId = state.repoFiles.find((repoFile) => repoFile.id === raw || repoFile.id.toLowerCase() === lower);
  if (byId) {
    return byId;
  }

  const normalizedPath = normalizeClientPath(raw);
  if (!normalizedPath) {
    return null;
  }

  const pathMatches = state.repoFiles.filter(
    (repoFile) => normalizeClientPath(repoFile.path) === normalizedPath
  );

  if (pathMatches.length === 1) {
    return pathMatches[0];
  }

  return null;
}

function getSourceFileState(sourceAddress, sourcePath) {
  const key = sourceFileKey(sourceAddress, sourcePath);
  return state.files.find((file) => sourceFileKey(file.sourceAddress, file.path) === key) || null;
}

function setPreferredRepoFileIdForSource(sourceAddress, sourcePath, preferredRepoFileId) {
  const file = getSourceFileState(sourceAddress, sourcePath);
  if (!file) {
    return false;
  }

  file.preferredRepoFileId = String(preferredRepoFileId || '').trim();
  if (!file.preferredRepoFileId) {
    file.preferredRepoPath = '';
  }
  persistState();
  return true;
}

function formatRepoFileLabel(repoFile) {
  if (!repoFile || typeof repoFile !== 'object') {
    return '';
  }

  const rawRepoLabel = String(repoFile.repoLabel || 'Repository').trim();
  const withoutSha = rawRepoLabel.split('@')[0];
  const repoName = withoutSha.includes('/') ? withoutSha.split('/').pop() : withoutSha;
  const normalizedPath = normalizeClientPath(repoFile.path || '');
  if (!normalizedPath) {
    return repoName;
  }

  return `${repoName}/${normalizedPath}`;
}

function createManualPathEditor(result) {
  const fileState = getSourceFileState(result.sourceAddress, result.path);
  const manualPreferredId = String(fileState?.preferredRepoFileId || '').trim();
  const activeRepoFile =
    findRepoFileById(manualPreferredId) ||
    findRepoFileById(result.matchedRepoFileId) ||
    null;

  const wrapper = document.createElement('div');
  wrapper.className = 'manual-path-wrap';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'matched-path-link';
  toggle.textContent = activeRepoFile
    ? `File: ${formatRepoFileLabel(activeRepoFile)}`
    : 'No repo file selected. Click to choose manually.';
  wrapper.appendChild(toggle);

  const panel = document.createElement('div');
  panel.className = 'manual-path-panel';
  panel.hidden = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'repo-path-input';
  input.setAttribute('list', REPO_FILE_DATALIST_ID);
  input.placeholder = 'Type or select: [owner/repo@sha] path/to/file.sol';
  input.value = activeRepoFile ? activeRepoFile.display : '';
  panel.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'manual-path-actions';

  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'btn ghost manual-btn';
  applyButton.textContent = 'Use This File';

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'btn ghost manual-btn';
  clearButton.textContent = 'Use Auto Match';

  actions.appendChild(applyButton);
  actions.appendChild(clearButton);
  panel.appendChild(actions);
  wrapper.appendChild(panel);

  const togglePanel = () => {
    panel.hidden = !panel.hidden;
  };

  toggle.addEventListener('click', togglePanel);

  applyButton.addEventListener('click', async () => {
    if (elements.verifyBtn.disabled) {
      return;
    }

    const repoFile = resolveRepoFileFromInput(input.value);
    if (!repoFile) {
      setVerifyStatus(
        'error',
        'Selected repo file was not found. Pick an option from the list in [repo] path format.'
      );
      return;
    }

    const updated = setPreferredRepoFileIdForSource(result.sourceAddress, result.path, repoFile.id);
    if (!updated) {
      setVerifyStatus('error', 'Could not update manual file override for this source file.');
      return;
    }

    setVerifyStatus('info', 'Manual file applied. Re-running proof...');
    await verifySelection();
  });

  clearButton.addEventListener('click', async () => {
    if (elements.verifyBtn.disabled) {
      return;
    }

    const updated = setPreferredRepoFileIdForSource(result.sourceAddress, result.path, '');
    if (!updated) {
      setVerifyStatus('error', 'Could not clear manual file override for this source file.');
      return;
    }

    setVerifyStatus('info', 'Manual file cleared. Re-running proof...');
    await verifySelection();
  });

  refreshButtonFX();
  return wrapper;
}

function renderVerifyResults(fileResults) {
  elements.verifyResults.innerHTML = '';

  for (const result of fileResults) {
    const card = document.createElement('article');
    card.className = 'result-card';
    card.classList.add(result.status === 'match' ? 'result-match' : 'result-mismatch');

    const head = document.createElement('div');
    head.className = 'result-head';

    const filePath = document.createElement('div');
    filePath.className = 'result-path';
    const sourceAddress = String(result.sourceAddress || '').trim();
    filePath.textContent = sourceAddress ? `${sourceAddress} / ${result.path}` : result.path;

    const badge = document.createElement('span');
    badge.className = `badge ${result.status === 'match' ? 'match' : 'mismatch'}`;
    badge.textContent = result.status;

    head.appendChild(filePath);
    head.appendChild(badge);
    card.appendChild(head);

    if (result.status === 'match') {
      const reason = document.createElement('p');
      reason.className = 'reason reason-manual-check';
      reason.textContent = '✓ Correct';
      card.appendChild(reason);
    } else if (result.reason) {
      const reason = document.createElement('p');
      reason.className = 'reason';
      reason.textContent = result.reason;
      card.appendChild(reason);
    }

    if (state.repoFiles.length > 0) {
      card.appendChild(createManualPathEditor(result));
    } else if (result.matchedPath) {
      const matchedPath = document.createElement('p');
      matchedPath.className = 'matched-path';
      matchedPath.textContent = result.matchedRepoLabel
        ? `Matched path: [${result.matchedRepoLabel}] ${result.matchedPath}`
        : `Matched path: ${result.matchedPath}`;
      card.appendChild(matchedPath);
    }

    if (result.status === 'mismatch' && result.diff) {
      const details = document.createElement('details');
      details.className = 'diff-details';
      details.open = true;

      const summary = document.createElement('summary');
      summary.className = 'diff-summary';
      summary.textContent = 'Inspect diff';

      details.appendChild(summary);
      details.appendChild(renderUnifiedDiff(result.diff));
      card.appendChild(details);
    }

    elements.verifyResults.appendChild(card);
  }
}

function applyRuntimeConfig() {
  elements.etherscanKeyGroup.hidden = state.hasServerEtherscanKey;
  if (state.hasServerEtherscanKey) {
    elements.etherscanApiKey.value = '';
  }

  persistState();
}

async function fetchRuntimeConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error('Config request failed');
    }

    const body = await response.json();
    state.hasServerEtherscanKey = Boolean(body?.hasServerEtherscanKey);
  } catch {
    state.hasServerEtherscanKey = false;
  }

  applyRuntimeConfig();
}

function restoreState() {
  const stored = readPersistedState();
  if (!stored || typeof stored !== 'object') {
    renderAddressRows(['']);
    renderRepoRows([{ repoUrl: '', commitHash: '' }]);
    return;
  }

  const inputs = stored.inputs && typeof stored.inputs === 'object' ? stored.inputs : {};
  const ui = stored.ui && typeof stored.ui === 'object' ? stored.ui : {};

  const addresses = normalizeStoredAddresses(inputs.addresses);
  renderAddressRows(addresses);

  const repos = normalizeStoredRepos(inputs.repos);
  renderRepoRows(repos);

  elements.chainId.value = typeof inputs.chainId === 'string' && inputs.chainId ? inputs.chainId : '1';
  elements.etherscanApiKey.value = typeof inputs.etherscanApiKey === 'string' ? inputs.etherscanApiKey : '';

  state.files = normalizeStoredFiles(stored.files);
  state.repoFiles = normalizeStoredRepoFiles(stored.repoFiles);
  state.verifyResults = Array.isArray(stored.verifyResults) ? stored.verifyResults : [];
  state.addressSummaries = Array.isArray(stored.addressSummaries) ? stored.addressSummaries : [];
  state.verifiedRepos = Array.isArray(stored.verifiedRepos) ? stored.verifiedRepos : [];
  state.step1ConfigOpen = Boolean(ui.step1ConfigOpen);
  state.loadStatus = normalizeStoredStatus(stored.loadStatus);
  state.verifyStatus = normalizeStoredStatus(stored.verifyStatus);

  if (state.loadStatus.type !== 'error') {
    state.loadStatus = { type: 'info', message: '' };
  }
  if (state.verifyStatus.type !== 'error') {
    state.verifyStatus = { type: 'info', message: '' };
  }

  setStatus(elements.loadStatus, state.loadStatus.type, state.loadStatus.message);
  setStatus(elements.verifyStatus, state.verifyStatus.type, state.verifyStatus.message);

  renderRepoFileDatalist();

  if (state.files.length > 0) {
    elements.filesPanel.hidden = false;
    elements.verifyPanel.hidden = false;
    renderFileList();
  } else {
    elements.filesPanel.hidden = true;
    elements.verifyPanel.hidden = true;
    elements.filesList.innerHTML = '';
    elements.fileMeta.textContent = '';
  }

  if (state.verifyResults.length > 0) {
    renderVerifyResults(state.verifyResults);
  } else {
    elements.verifyResults.innerHTML = '';
  }
}

async function loadFiles() {
  bumpButton(elements.loadFilesBtn);
  runImpact(elements.step1Panel);

  const addresses = collectAddressesForSubmit();
  const chainId = elements.chainId.value.trim() || '1';
  const apiKey = elements.etherscanApiKey.value.trim();

  if (addresses.length === 0) {
    setLoadStatus('error', 'Enter at least one contract address to start the proof.');
    return;
  }

  const invalidAddress = addresses.find((address) => !ETH_ADDRESS_REGEX.test(address));
  if (invalidAddress) {
    setLoadStatus('error', `Invalid Ethereum address: ${invalidAddress}`);
    return;
  }

  if (!/^\d+$/.test(chainId)) {
    setLoadStatus('error', 'Chain ID must be numeric, for example 1 for Ethereum mainnet.');
    return;
  }

  if (!state.hasServerEtherscanKey && !apiKey) {
    setLoadStatus('error', 'Add an Etherscan API key, or set ETHERSCAN_API_KEY on the server.');
    return;
  }

  clearVerifyOutput();
  setLoadStatus('info', '');
  elements.loadFilesBtn.disabled = true;

  try {
    const response = await fetch('/api/etherscan/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ addresses, chainId, apiKey })
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'Failed to fetch files from Etherscan.');
    }

    state.addressSummaries = Array.isArray(body.addresses) ? body.addresses : [];
    state.files = Array.isArray(body.files)
      ? body.files.map((file) => ({
          path: normalizeClientPath(file.path),
          content: String(file.content || ''),
          isKnownLib: Boolean(file.isKnownLib),
          selected: typeof file.selected === 'boolean' ? file.selected : !isLibDirectoryPath(file.path),
          sourceAddress: typeof file.sourceAddress === 'string' ? file.sourceAddress : '',
          sourceContractName: typeof file.sourceContractName === 'string' ? file.sourceContractName : '',
          preferredRepoFileId: '',
          preferredRepoPath: ''
        }))
      : [];

    state.verifyResults = [];
    state.repoFiles = [];
    state.verifiedRepos = [];

    renderRepoFileDatalist();
    renderFileList();
    revealPanel(elements.filesPanel);
    setTimeout(() => revealPanel(elements.verifyPanel), 60);

    setLoadStatus('success', '');
    persistState();
  } catch (error) {
    state.files = [];
    state.repoFiles = [];
    state.addressSummaries = [];
    state.verifiedRepos = [];
    state.verifyResults = [];

    renderRepoFileDatalist();
    elements.filesPanel.hidden = true;
    elements.verifyPanel.hidden = true;
    elements.filesList.innerHTML = '';
    elements.fileMeta.textContent = '';
    elements.verifyResults.innerHTML = '';

    setLoadStatus('error', error.message || 'Failed to load files.');
    setVerifyStatus('info', '', { persist: false });
    persistState();
  } finally {
    elements.loadFilesBtn.disabled = false;
  }
}

function checkAllFiles(checked) {
  const boxes = elements.filesList.querySelectorAll('input[type="checkbox"]');
  for (const box of boxes) {
    box.checked = checked;
    const index = Number(box.dataset.index);
    if (Number.isInteger(index) && state.files[index]) {
      state.files[index].selected = checked;
    }
  }

  updateFileMeta();
  refreshRowSelectionStyles();
  persistState();
}

function uncheckLibDirectoryFiles() {
  const libPathRegex = /(^|\/)lib\//i;
  const boxes = elements.filesList.querySelectorAll('input[type="checkbox"]');

  for (const box of boxes) {
    const index = Number(box.dataset.index);
    const file = state.files[index];
    if (!file || typeof file.path !== 'string') {
      continue;
    }

    const normalizedPath = file.path.replace(/\\/g, '/');
    if (libPathRegex.test(normalizedPath)) {
      box.checked = false;
      file.selected = false;
    }
  }

  updateFileMeta();
  refreshRowSelectionStyles();
  persistState();
}

async function verifySelection() {
  bumpButton(elements.verifyBtn);
  runImpact(elements.verifyPanel);
  syncSelectionsFromDom({ persist: false });

  const repos = collectReposForSubmit();
  const selectedFiles = gatherSelectedFiles();

  if (repos.length === 0) {
    setVerifyStatus('error', 'Add at least one GitHub repository URL to run proof.');
    return;
  }

  if (selectedFiles.length === 0) {
    setVerifyStatus('error', 'Select at least one file to compare.');
    return;
  }

  elements.verifyBtn.disabled = true;
  setVerifyStatus('info', 'Running source proof against GitHub snapshot(s)...');
  state.verifyResults = [];
  elements.verifyResults.innerHTML = '';
  persistState();

  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ repos, selectedFiles })
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'Verification failed.');
    }

    if (body.ok) {
      setVerifyStatus('success', '');
    } else {
      const repoCount = Array.isArray(body.repoSummaries) ? body.repoSummaries.length : repos.length;
      setVerifyStatus('error', `Proof failed: ${body.mismatchCount} of ${body.totalCompared} files differ across ${repoCount} repo snapshot(s).`);
    }

    state.repoFiles = normalizeStoredRepoFiles(body.repoFiles);
    state.verifiedRepos = Array.isArray(body.repoSummaries) ? body.repoSummaries : [];
    state.verifyResults = Array.isArray(body.fileResults) ? body.fileResults : [];

    renderRepoFileDatalist();
    renderVerifyResults(state.verifyResults);
    runImpact(elements.verifyPanel);
    persistState();
  } catch (error) {
    state.verifyResults = [];
    elements.verifyResults.innerHTML = '';
    setVerifyStatus('error', error.message || 'Verification failed.');
    persistState();
  } finally {
    elements.verifyBtn.disabled = false;
  }
}

function bindEvents() {
  elements.chainId.addEventListener('input', persistState);
  elements.etherscanApiKey.addEventListener('input', persistState);
  elements.configToggleBtn.addEventListener('click', () => {
    setStep1ConfigOpen(!state.step1ConfigOpen);
  });

  elements.addAddressBtn.addEventListener('click', () => {
    addAddressRow('');
    persistState();
  });

  elements.addressList.addEventListener('input', () => persistState());
  elements.addressList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.classList.contains('remove-address-btn')) {
      removeAddressRow(target);
    }
  });

  elements.addRepoBtn.addEventListener('click', () => {
    addRepoRow({ repoUrl: '', commitHash: '' });
    persistState();
  });

  elements.repoList.addEventListener('input', () => persistState());
  elements.repoList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.classList.contains('remove-repo-btn')) {
      removeRepoRow(target);
    }
  });

  elements.loadFilesBtn.addEventListener('click', loadFiles);
  elements.verifyBtn.addEventListener('click', verifySelection);
  elements.checkAllBtn.addEventListener('click', () => checkAllFiles(true));
  elements.uncheckAllBtn.addEventListener('click', () => checkAllFiles(false));
  elements.uncheckLibBtn.addEventListener('click', uncheckLibDirectoryFiles);
  elements.filesList.addEventListener('change', () => syncSelectionsFromDom());

  refreshButtonFX();
}

function initialize() {
  restoreState();
  setStep1ConfigOpen(state.step1ConfigOpen, { persist: false });
  renderRepoFileDatalist();
  bindEvents();
  void fetchRuntimeConfig();
}

initialize();
