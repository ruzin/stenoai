'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { registerFoldersIpc } = require('./folders-ipc');

// Minimal fakes: capture handlers by channel, record backend calls, and let
// each test drive one handler and assert its argv/seam usage. No electron.
function harness(overrides = {}) {
  const handlers = {};
  const calls = { py: [], setCache: [], dialog: [], validate: [] };
  const deps = {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    runPythonScript: async (script, args) => {
      calls.py.push({ script, args });
      return overrides.pyResult ?? '{"success": true}';
    },
    dialog: {
      showOpenDialog: async (win, opts) => {
        calls.dialog.push({ win, opts });
        return overrides.dialogResult ?? { canceled: false, filePaths: ['/picked/dir'] };
      },
    },
    getMainWindow: () => overrides.mainWindow ?? { id: 'win' },
    getUserDataDir: () => overrides.userDataDir ?? '/default/data',
    validateMeetingFilePath: async (p) => {
      calls.validate.push(p);
      return overrides.validate ?? { realPath: `/real/${p}` };
    },
    setCachedCustomStoragePath: (v) => { calls.setCache.push(v); },
  };
  registerFoldersIpc(deps);
  return { handlers, calls };
}

const CHANNELS = [
  'get-storage-path', 'set-storage-path', 'select-storage-folder',
  'list-folders', 'create-folder', 'rename-folder', 'update-folder-icon',
  'delete-folder', 'reorder-folders', 'add-meeting-to-folder',
  'remove-meeting-from-folder',
];

test('registers exactly the 11 folder + storage handlers', () => {
  const { handlers } = harness();
  assert.deepStrictEqual(Object.keys(handlers).sort(), [...CHANNELS].sort());
});

test('list-folders calls the backend silently and spreads the parsed result', async () => {
  const { handlers, calls } = harness({ pyResult: '{"folders": [{"id": "a"}]}' });
  const res = await handlers['list-folders']();
  assert.deepStrictEqual(calls.py[0], { script: 'simple_recorder.py', args: ['list-folders'] });
  assert.deepStrictEqual(res, { success: true, folders: [{ id: 'a' }] });
});

test('create-folder appends --color only when a color is given', async () => {
  const withColor = harness();
  await withColor.handlers['create-folder']({}, 'Work', '#fff');
  assert.deepStrictEqual(withColor.calls.py[0].args, ['create-folder', 'Work', '--color', '#fff']);

  const noColor = harness();
  await noColor.handlers['create-folder']({}, 'Work', undefined);
  assert.deepStrictEqual(noColor.calls.py[0].args, ['create-folder', 'Work']);
});

test('rename / update-icon / delete pass their ids through verbatim', async () => {
  const h = harness();
  await h.handlers['rename-folder']({}, 'id1', 'New');
  await h.handlers['update-folder-icon']({}, 'id1', '📁');
  await h.handlers['delete-folder']({}, 'id1');
  assert.deepStrictEqual(h.calls.py[0].args, ['rename-folder', 'id1', 'New']);
  assert.deepStrictEqual(h.calls.py[1].args, ['update-folder-icon', 'id1', '📁']);
  assert.deepStrictEqual(h.calls.py[2].args, ['delete-folder', 'id1']);
});

test('reorder-folders spreads the id list into the argv', async () => {
  const h = harness();
  await h.handlers['reorder-folders']({}, ['a', 'b', 'c']);
  assert.deepStrictEqual(h.calls.py[0].args, ['reorder-folders', 'a', 'b', 'c']);
});

test('add-meeting-to-folder validates the path and forwards the canonical realPath', async () => {
  const h = harness({ validate: { realPath: '/real/output/m.json' } });
  const res = await h.handlers['add-meeting-to-folder']({}, 'output/m.json', 'fid');
  assert.deepStrictEqual(h.calls.validate, ['output/m.json']);
  assert.deepStrictEqual(h.calls.py[0].args, ['add-meeting-to-folder', '/real/output/m.json', 'fid']);
  assert.strictEqual(res.success, true);
});

test('add-meeting-to-folder rejects a failed path validation without calling the backend', async () => {
  const h = harness({ validate: { error: 'outside allowed dirs' } });
  const res = await h.handlers['add-meeting-to-folder']({}, '../evil', 'fid');
  assert.deepStrictEqual(res, { success: false, error: 'outside allowed dirs' });
  assert.strictEqual(h.calls.py.length, 0);
});

test('remove-meeting-from-folder mirrors the validate-then-forward contract', async () => {
  const ok = harness({ validate: { realPath: '/real/output/m.json' } });
  await ok.handlers['remove-meeting-from-folder']({}, 'output/m.json', 'fid');
  assert.deepStrictEqual(ok.calls.py[0].args, ['remove-meeting-from-folder', '/real/output/m.json', 'fid']);

  const bad = harness({ validate: { error: 'nope' } });
  const res = await bad.handlers['remove-meeting-from-folder']({}, 'x', 'fid');
  assert.deepStrictEqual(res, { success: false, error: 'nope' });
  assert.strictEqual(bad.calls.py.length, 0);
});

test('get-storage-path augments the custom path with the injected default', async () => {
  const custom = harness({ pyResult: '{"storage_path": "/my/vault"}', userDataDir: '/default/data' });
  const res = await custom.handlers['get-storage-path']();
  assert.deepStrictEqual(custom.calls.py[0], { script: 'simple_recorder.py', args: ['get-storage-path'] });
  assert.deepStrictEqual(res, {
    success: true, storage_path: '/my/vault', custom_path: '/my/vault', default_path: '/default/data',
  });

  const none = harness({ pyResult: '{"storage_path": ""}', userDataDir: '/default/data' });
  const res2 = await none.handlers['get-storage-path']();
  assert.deepStrictEqual(res2, {
    success: true, storage_path: '/default/data', custom_path: null, default_path: '/default/data',
  });
});

test('set-storage-path updates the injected cache setter (set-path -> reader regression)', async () => {
  const h = harness({ pyResult: '{"success": true, "storage_path": "/vault"}' });
  await h.handlers['set-storage-path']({}, '/vault');
  assert.deepStrictEqual(h.calls.py[0].args, ['set-storage-path', '/vault']);
  assert.deepStrictEqual(h.calls.setCache, ['/vault']);

  // Clearing to default: empty path -> null cache, and the setter still fires.
  const cleared = harness({ pyResult: '{"success": true}' });
  await cleared.handlers['set-storage-path']({}, '');
  assert.deepStrictEqual(cleared.calls.py[0].args, ['set-storage-path']); // no path arg appended
  assert.deepStrictEqual(cleared.calls.setCache, [null]);
});

test('select-storage-folder opens the dialog parented to the injected window', async () => {
  const picked = harness({ mainWindow: { id: 'main' }, dialogResult: { canceled: false, filePaths: ['/chosen'] } });
  const res = await picked.handlers['select-storage-folder']();
  assert.deepStrictEqual(picked.calls.dialog[0].win, { id: 'main' });
  assert.deepStrictEqual(res, { success: true, folderPath: '/chosen' });

  const canceled = harness({ dialogResult: { canceled: true, filePaths: [] } });
  const res2 = await canceled.handlers['select-storage-folder']();
  assert.deepStrictEqual(res2, { success: false, error: 'No folder selected' });
});

test('backend failures surface as { success:false, error } (not a throw)', async () => {
  const h = harness();
  h.calls; // noop
  const throwing = {
    ipcMain: { handle: (ch, fn) => { throwing._h = throwing._h || {}; throwing._h[ch] = fn; } },
    runPythonScript: async () => { throw new Error('backend exploded'); },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getMainWindow: () => ({}),
    getUserDataDir: () => '/d',
    validateMeetingFilePath: async (p) => ({ realPath: p }),
    setCachedCustomStoragePath: () => {},
  };
  registerFoldersIpc(throwing);
  const res = await throwing._h['list-folders']();
  assert.deepStrictEqual(res, { success: false, error: 'backend exploded' });
});
