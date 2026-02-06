const STORAGE_KEY = 'proofOfSource.state.v2';

const state = {
  contractName: '',
  files: [],
  verifyResults: [],
  loadStatus: { type: 'info', message: '' },
  verifyStatus: { type: 'info', message: '' },
  hasServerEtherscanKey: false
};

const elements = {
  step1Panel: document.getElementById('step-1-panel'),
  contractAddress: document.getElementById('contract-address'),
  chainId: document.getElementById('chain-id'),
  etherscanKeyGroup: document.getElementById('etherscan-key-group'),
  etherscanApiKey: document.getElementById('etherscan-api-key'),
  loadFilesBtn: document.getElementById('load-files-btn'),
  loadStatus: document.getElementById('load-status'),
  filesPanel: document.getElementById('files-panel'),
  filesList: document.getElementById('files-list'),
  fileMeta: document.getElementById('file-meta'),
  checkAllBtn: document.getElementById('check-all-btn'),
  uncheckAllBtn: document.getElementById('uncheck-all-btn'),
  uncheckLibBtn: document.getElementById('uncheck-lib-btn'),
  uncheckLibsBtn: document.getElementById('uncheck-libs-btn'),
  verifyPanel: document.getElementById('verify-panel'),
  repoUrl: document.getElementById('repo-url'),
  commitHash: document.getElementById('commit-hash'),
  verifyBtn: document.getElementById('verify-btn'),
  verifyStatus: document.getElementById('verify-status'),
  verifyResults: document.getElementById('verify-results')
};

function setStatus(target, type, message) {
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

function persistState() {
  try {
    const snapshot = {
      inputs: {
        contractAddress: elements.contractAddress.value,
        chainId: elements.chainId.value,
        etherscanApiKey: elements.etherscanApiKey.value,
        repoUrl: elements.repoUrl.value,
        commitHash: elements.commitHash.value
      },
      contractName: state.contractName,
      files: state.files,
      verifyResults: state.verifyResults,
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

function normalizeStoredFiles(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .filter((file) => file && typeof file.path === 'string' && typeof file.content === 'string')
    .map((file) => {
      const isKnownLib = Boolean(file.isKnownLib);
      const selected = typeof file.selected === 'boolean' ? file.selected : !isKnownLib;

      return {
        path: file.path,
        content: file.content,
        isKnownLib,
        selected
      };
    });
}

function updateFileMeta() {
  const selectedCount = state.files.filter((file) => file.selected).length;
  const total = state.files.length;
  elements.fileMeta.textContent = `${state.contractName}: ${selectedCount}/${total} files selected.`;
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

    const checked = typeof file.selected === 'boolean' ? file.selected : !file.isKnownLib;
    file.selected = checked;
    checkbox.checked = checked;

    const pathNode = document.createElement('span');
    pathNode.className = 'file-path';
    pathNode.textContent = file.path;

    row.appendChild(checkbox);
    row.appendChild(pathNode);

    if (file.isKnownLib) {
      const tag = document.createElement('span');
      tag.className = 'file-tag';
      tag.textContent = 'OpenZeppelin';
      row.appendChild(tag);
    } else {
      const filler = document.createElement('span');
      row.appendChild(filler);
    }

    elements.filesList.appendChild(row);
  }

  updateFileMeta();
}

function gatherSelectedFiles() {
  return state.files
    .filter((file) => file.selected)
    .map((file) => ({
      path: file.path,
      content: file.content
    }));
}

function clearVerifyOutput() {
  state.verifyResults = [];
  elements.verifyResults.innerHTML = '';
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

function renderVerifyResults(fileResults) {
  elements.verifyResults.innerHTML = '';

  for (const result of fileResults) {
    const card = document.createElement('article');
    card.className = 'result-card';

    const head = document.createElement('div');
    head.className = 'result-head';

    const filePath = document.createElement('div');
    filePath.className = 'result-path';
    filePath.textContent = result.path;

    const badge = document.createElement('span');
    badge.className = `badge ${result.status === 'match' ? 'match' : 'mismatch'}`;
    badge.textContent = result.status;

    head.appendChild(filePath);
    head.appendChild(badge);
    card.appendChild(head);

    if (result.reason) {
      const reason = document.createElement('p');
      reason.className = 'reason';
      reason.textContent = result.reason;
      card.appendChild(reason);
    }

    if (result.matchedPath) {
      const matchedPath = document.createElement('p');
      matchedPath.className = 'matched-path';
      matchedPath.textContent = `Matched path: ${result.matchedPath}`;
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

  if (state.hasServerEtherscanKey && !state.loadStatus.message) {
    setLoadStatus('info', 'Server Etherscan key detected. Personal key is optional.');
  }
}

function restoreState() {
  const stored = readPersistedState();
  if (!stored || typeof stored !== 'object') {
    return;
  }

  const inputs = stored.inputs && typeof stored.inputs === 'object' ? stored.inputs : {};

  elements.contractAddress.value = typeof inputs.contractAddress === 'string' ? inputs.contractAddress : '';
  elements.chainId.value = typeof inputs.chainId === 'string' && inputs.chainId ? inputs.chainId : '1';
  elements.etherscanApiKey.value = typeof inputs.etherscanApiKey === 'string' ? inputs.etherscanApiKey : '';
  elements.repoUrl.value = typeof inputs.repoUrl === 'string' ? inputs.repoUrl : '';
  elements.commitHash.value = typeof inputs.commitHash === 'string' ? inputs.commitHash : '';

  state.contractName = typeof stored.contractName === 'string' ? stored.contractName : '';
  state.files = normalizeStoredFiles(stored.files);
  state.verifyResults = Array.isArray(stored.verifyResults) ? stored.verifyResults : [];
  state.loadStatus = normalizeStoredStatus(stored.loadStatus);
  state.verifyStatus = normalizeStoredStatus(stored.verifyStatus);

  setStatus(elements.loadStatus, state.loadStatus.type, state.loadStatus.message);
  setStatus(elements.verifyStatus, state.verifyStatus.type, state.verifyStatus.message);

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

  const address = elements.contractAddress.value.trim();
  const chainId = elements.chainId.value.trim() || '1';
  const apiKey = elements.etherscanApiKey.value.trim();

  if (!address) {
    setLoadStatus('error', 'Enter a contract address to start the proof.');
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
  setLoadStatus('info', 'Pulling verified source from Etherscan...');
  elements.loadFilesBtn.disabled = true;

  try {
    const response = await fetch('/api/etherscan/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ address, chainId, apiKey })
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'Failed to fetch files from Etherscan.');
    }

    state.contractName = body.contractName || 'Contract';
    state.files = Array.isArray(body.files)
      ? body.files.map((file) => ({
          ...file,
          selected: !file.isKnownLib
        }))
      : [];
    state.verifyResults = [];

    renderFileList();
    revealPanel(elements.filesPanel);
    setTimeout(() => revealPanel(elements.verifyPanel), 60);

    const knownLibCount = state.files.filter((file) => file.isKnownLib).length;
    setLoadStatus(
      'success',
      `Source loaded: ${state.files.length} files from ${state.contractName}. ${knownLibCount} OpenZeppelin files were unselected by default.`
    );

    persistState();
  } catch (error) {
    state.files = [];
    state.contractName = '';
    state.verifyResults = [];
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
  persistState();
}

function uncheckOpenZeppelinFiles() {
  const boxes = elements.filesList.querySelectorAll('input[type="checkbox"]');
  for (const box of boxes) {
    const index = Number(box.dataset.index);
    const file = state.files[index];
    if (!file) {
      continue;
    }

    const shouldCheck = !file.isKnownLib;
    box.checked = shouldCheck;
    file.selected = shouldCheck;
  }

  updateFileMeta();
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
  persistState();
}

async function verifySelection() {
  bumpButton(elements.verifyBtn);
  runImpact(elements.verifyPanel);
  syncSelectionsFromDom({ persist: false });

  const repoUrl = elements.repoUrl.value.trim();
  const commitHash = elements.commitHash.value.trim();
  const selectedFiles = gatherSelectedFiles();

  if (!repoUrl) {
    setVerifyStatus('error', 'Add a GitHub repository URL to run proof.');
    return;
  }

  if (selectedFiles.length === 0) {
    setVerifyStatus('error', 'Select at least one file to compare.');
    return;
  }

  elements.verifyBtn.disabled = true;
  setVerifyStatus('info', 'Running source proof against GitHub...');
  state.verifyResults = [];
  elements.verifyResults.innerHTML = '';
  persistState();

  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ repoUrl, commitHash, selectedFiles })
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'Verification failed.');
    }

    if (body.ok) {
      setVerifyStatus(
        'success',
        `Proof complete: all ${body.totalCompared} selected files match commit ${body.commitSha.slice(0, 12)}.`
      );
    } else {
      setVerifyStatus(
        'error',
        `Proof failed: ${body.mismatchCount} of ${body.totalCompared} files differ from commit ${body.commitSha.slice(0, 12)}.`
      );
    }

    state.verifyResults = Array.isArray(body.fileResults) ? body.fileResults : [];
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
  for (const input of [
    elements.contractAddress,
    elements.chainId,
    elements.etherscanApiKey,
    elements.repoUrl,
    elements.commitHash
  ]) {
    input.addEventListener('input', persistState);
  }

  elements.loadFilesBtn.addEventListener('click', loadFiles);
  elements.verifyBtn.addEventListener('click', verifySelection);
  elements.checkAllBtn.addEventListener('click', () => checkAllFiles(true));
  elements.uncheckAllBtn.addEventListener('click', () => checkAllFiles(false));
  elements.uncheckLibBtn.addEventListener('click', uncheckLibDirectoryFiles);
  elements.uncheckLibsBtn.addEventListener('click', uncheckOpenZeppelinFiles);
  elements.filesList.addEventListener('change', () => syncSelectionsFromDom());
}

function initialize() {
  restoreState();
  bindEvents();
  void fetchRuntimeConfig();
}

initialize();
