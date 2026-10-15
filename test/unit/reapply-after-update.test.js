const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SETTING_ID, CLAIMS_DIR, isAutoReapplyOffered, shouldReapplyAutomatically,
  buildKey, claimBuild, promptFor, withoutAutoReapply,
} = require('../../extension/reapply-after-update');

const manifest = require('../../package.json');

/** The manifest as it would be with the automatic re-apply setting removed. */
const manifestWithoutSetting = () => {
  const copy = structuredClone(manifest);
  delete copy.contributes.configuration.properties[SETTING_ID];
  return copy;
};

describe('isAutoReapplyOffered', () => {
  it('is on while package.json contributes the setting', () => {
    expect(isAutoReapplyOffered(manifest)).toBe(true);
  });

  it('is off once the setting is dropped from the manifest', () => {
    expect(isAutoReapplyOffered(manifestWithoutSetting())).toBe(false);
  });

  it('finds the setting when configuration is an array of sections', () => {
    const properties = { [SETTING_ID]: { type: 'boolean', default: false } };
    expect(isAutoReapplyOffered({ contributes: { configuration: [{ properties: {} }, { properties }] } })).toBe(true);
  });

  it('is off for a manifest with no configuration at all', () => {
    expect(isAutoReapplyOffered({})).toBe(false);
  });
});

describe('shouldReapplyAutomatically', () => {
  it('needs the setting turned on', () => {
    expect(shouldReapplyAutomatically(manifest, true)).toBe(true);
    expect(shouldReapplyAutomatically(manifest, false)).toBe(false);
    expect(shouldReapplyAutomatically(manifest, undefined)).toBe(false);
  });

  it('ignores a value left in settings.json once the manifest stops offering it', () => {
    expect(shouldReapplyAutomatically(manifestWithoutSetting(), true)).toBe(false);
  });
});

describe('buildKey', () => {
  it('changes with the file content, so a fork\'s own release is a new build', () => {
    // Forks report the VSCode version they are based on, which stays the same
    // across their releases, so the version alone can't tell builds apart.
    expect(buildKey('/opt/code/out/main.js', 'one')).not.toBe(buildKey('/opt/code/out/main.js', 'two'));
  });

  it('changes with the path, so two editors with identical files stay apart', () => {
    expect(buildKey('/opt/code/out/main.js', 'same')).not.toBe(buildKey('/opt/insiders/out/main.js', 'same'));
  });

  it('is stable for the same build', () => {
    expect(buildKey('/opt/code/out/main.js', 'same')).toBe(buildKey('/opt/code/out/main.js', 'same'));
  });
});

describe('claimBuild', () => {
  let configDir;
  const CODE = '/home/u/.vscode/extensions';
  const INSIDERS = '/home/u/.vscode-insiders/extensions';
  const claims = () => fs.readdirSync(path.join(configDir, CLAIMS_DIR));

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-claims-'));
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('goes to exactly one caller per build', () => {
    // Every window activates the extension in its own extension host.
    expect(claimBuild(configDir, CODE, 'build-a')).toBe(true);
    expect(claimBuild(configDir, CODE, 'build-a')).toBe(false);
  });

  it('is available again for the next build, and drops the old claim', () => {
    claimBuild(configDir, CODE, 'build-a');

    expect(claimBuild(configDir, CODE, 'build-b')).toBe(true);
    expect(claims()).toHaveLength(1);
  });

  it('leaves another editor\'s claim alone', () => {
    // Removing it would have that editor ask again about a build it already
    // asked about.
    claimBuild(configDir, INSIDERS, 'build-x');
    claimBuild(configDir, CODE, 'build-a');
    claimBuild(configDir, CODE, 'build-b');

    expect(claimBuild(configDir, INSIDERS, 'build-x')).toBe(false);
    expect(claims()).toHaveLength(2);
  });
});

describe('promptFor', () => {
  // Echoes the key, so the assertions read as which sentences are present.
  const localize = (key) => `<${key}:%1>`;
  const prompt = (options) => promptFor({ appName: 'Code', localize, ...options });

  it('offers both buttons while the setting is offered', () => {
    const { reapply, always } = prompt({ offered: true, needsElevation: false });

    expect(reapply.title).toContain('messages.reapply:');
    expect(always.title).toContain('messages.reapplyAlways');
  });

  it('offers only Re-apply once the setting is dropped', () => {
    expect(prompt({ offered: false, needsElevation: false }).always).toBeUndefined();
  });

  it('names the editor', () => {
    expect(prompt({ offered: true, needsElevation: false }).message).toBe('<messages.reapplyAfterUpdate:Code>');
  });

  it('says a system-wide install needs administrator permission, and that automatic means a prompt each update', () => {
    const { message } = prompt({ offered: true, needsElevation: true });

    expect(message).toContain('messages.reapplyNeedsAdmin:Code');
    expect(message).toContain('messages.reapplyAutoAdminNote');
  });

  it('leaves the note about automatic re-apply out when there is no such button', () => {
    const { message } = prompt({ offered: false, needsElevation: true });

    expect(message).toContain('messages.reapplyNeedsAdmin');
    expect(message).not.toContain('messages.reapplyAutoAdminNote');
  });

  it('says nothing about permission when the install is writable', () => {
    const { message } = prompt({ offered: true, needsElevation: false });

    expect(message).not.toContain('messages.reapplyNeedsAdmin');
    expect(message).not.toContain('messages.reapplyAutoAdminNote');
  });
});

describe('withoutAutoReapply', () => {
  it('drops only the automatic re-apply setting', () => {
    expect(withoutAutoReapply({ opacity: 0.5, autoReapplyAfterUpdate: true })).toEqual({ opacity: 0.5 });
  });

  it('makes two configurations that differ only in it compare equal', () => {
    const { deepEqual } = require('../../extension/file-transforms');
    const before = { opacity: 0.5, autoReapplyAfterUpdate: false };
    const after = { opacity: 0.5, autoReapplyAfterUpdate: true };

    expect(deepEqual(withoutAutoReapply(before), withoutAutoReapply(after))).toBe(true);
    expect(deepEqual(withoutAutoReapply(before), withoutAutoReapply({ ...after, opacity: 0.6 }))).toBe(false);
  });
});
