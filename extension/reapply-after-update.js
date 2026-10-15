/**
 * Putting Vibrancy back after an editor update removed it.
 *
 * An update replaces main.js, mainImpl.js and workbench.html with fresh
 * copies, so every update takes the patch out while Vibrancy is still enabled:
 * the install record survives, and so do the colour customizations, which
 * assume a translucent window the editor no longer has. Nothing noticed. The
 * startup check compared only the extension's own version, which an editor
 * update leaves alone, so the fix was remembering to run Reload Vibrancy.
 *
 * At startup index.js now looks for exactly that state, and either offers to
 * re-apply or, with `vscode_vibrancy.autoReapplyAfterUpdate`, re-applies
 * without asking.
 *
 * The automatic half is optional by construction: it is offered only while
 * package.json contributes the setting. Dropping the setting from the manifest
 * drops the feature, and the prompt's "Always" button with it, without
 * touching any code. A value left behind in someone's settings.json is then
 * ignored, which is why this reads the manifest rather than the setting.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SETTING_KEY = 'autoReapplyAfterUpdate';
const SETTING_ID = `vscode_vibrancy.${SETTING_KEY}`;
const CLAIMS_DIR = 'reapply-claims';

const shortHash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * Does this build of the extension offer automatic re-apply?
 * @param {object} packageJSON  the extension's own manifest
 */
function isAutoReapplyOffered(packageJSON) {
  const configuration = packageJSON?.contributes?.configuration;
  // `contributes.configuration` may be one object or an array of them.
  return [].concat(configuration ?? []).some((c) => c?.properties?.[SETTING_ID] !== undefined);
}

/**
 * Re-apply without asking: offered, and turned on.
 * @param {object} packageJSON
 * @param {unknown} setting  the setting's current value
 */
function shouldReapplyAutomatically(packageJSON, setting) {
  return setting === true && isAutoReapplyOffered(packageJSON);
}

/**
 * Identifies one build of an editor: the main.js it runs, by path and content.
 *
 * Content rather than vscode.version, because forks report the VSCode version
 * they are based on, and that stays put across their own releases. The path
 * keeps two editors with identical files apart.
 *
 * @param {string} jsFile
 * @param {string} content  main.js as it is on disk, unpatched
 */
function buildKey(jsFile, content) {
  return shortHash(`${path.resolve(jsFile)}\n${content}`);
}

/**
 * Take the one chance to act on this build, or learn that it was taken.
 *
 * Every window activates the extension, each in its own extension host, so
 * runExclusive can't stop two windows restored after an update from both
 * prompting, or, with automatic re-apply, from both patching the install at
 * once. Creating the claim with `wx` succeeds in exactly one of them, across
 * profiles too. The claim stays, which is what makes the prompt once per
 * build: dismissing it is an answer as well.
 *
 * Claims are kept per editor install, and this install's claims for older
 * builds are removed on the way. Another editor's are left alone, or it would
 * ask again about a build it already asked about.
 *
 * @param {string} configDir  Vibrancy's config directory
 * @param {string} extensionsDir  identifies the editor install (see install-records.js)
 * @param {string} build  from buildKey
 * @returns {boolean} true for the one caller that should act
 */
function claimBuild(configDir, extensionsDir, build) {
  const dir = path.join(configDir, CLAIMS_DIR);
  const prefix = `${shortHash(path.resolve(extensionsDir))}-`;
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, prefix + build), '', { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(prefix) && name !== prefix + build) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  }
  return true;
}

/**
 * The startup prompt's text and buttons.
 *
 * @param {object} options
 * @param {string} options.appName
 * @param {boolean} options.offered  from isAutoReapplyOffered
 * @param {boolean} options.needsElevation  the install is system-wide
 * @param {(key: string) => string} options.localize
 * @returns {{ message: string, reapply: { title: string }, always?: { title: string } }}
 */
function promptFor({ appName, offered, needsElevation, localize }) {
  const parts = [localize('messages.reapplyAfterUpdate').replace(/%1/g, appName)];
  if (needsElevation) {
    parts.push(localize('messages.reapplyNeedsAdmin').replace(/%1/g, appName));
    // The same note the setting's description carries, repeated here because
    // this is where the choice is made.
    if (offered) parts.push(localize('messages.reapplyAutoAdminNote'));
  }
  const prompt = {
    message: parts.join(' '),
    reapply: { title: localize('messages.reapply') },
  };
  if (offered) prompt.always = { title: localize('messages.reapplyAlways') };
  return prompt;
}

/**
 * A vscode_vibrancy configuration without the automatic re-apply setting, for
 * the "config changed, reload?" comparison. Turning it on or off changes
 * nothing that is installed, so it mustn't offer a reload, least of all when
 * the prompt's own "Always" button is what turned it on.
 * @param {object} config
 */
function withoutAutoReapply(config) {
  const { [SETTING_KEY]: _ignored, ...rest } = config;
  return rest;
}

module.exports = {
  SETTING_KEY,
  SETTING_ID,
  CLAIMS_DIR,
  isAutoReapplyOffered,
  shouldReapplyAutomatically,
  buildKey,
  claimBuild,
  promptFor,
  withoutAutoReapply,
};
