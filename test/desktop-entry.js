/**
 * Installs the `.desktop` file required by recent portals (xdg-desktop-portal 1.21+, GNOME 50+)
 * to resolve the app ID of unsandboxed apps. Without it, `BindShortcuts` fails with "An app id is required".
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APPLICATIONS_DIR = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications');

/**
 * Creates or updates `<appId>.desktop` in the user applications directory.
 * @param {string} appId Reverse-DNS app ID.
 * @param {string} script Script launched by the entry.
 * @returns {Promise<void>} Resolves once the portal is likely to see the file.
 */
async function installDesktopEntry(appId, script) {
  const file = path.join(APPLICATIONS_DIR, `${appId}.desktop`);
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Wayland Global Shortcut Sample',
    `Exec="${process.execPath}" --ozone-platform=x11 "${script}"`,
    'NoDisplay=true',
    '',
  ].join('\n');

  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) { return; }

  fs.mkdirSync(APPLICATIONS_DIR, { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`Desktop entry installed: ${file}`);

  // The portal watches the applications directory, give it time to pick up the new file.
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

module.exports = { installDesktopEntry };
