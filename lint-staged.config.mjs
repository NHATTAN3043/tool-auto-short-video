// On Windows the tools run through .cmd shims, and cmd.exe refuses command lines over 8191 characters.
// Passing files in small groups keeps a large commit (the first one, a big merge) under that limit.
const GROUP = 30;

function inGroups(command, files) {
  const commands = [];
  for (let i = 0; i < files.length; i += GROUP) {
    const group = files.slice(i, i + GROUP).map((file) => JSON.stringify(file));
    commands.push(`${command} ${group.join(" ")}`);
  }
  return commands;
}

export default {
  "*.{ts,tsx}": (files) => [...inGroups("eslint --fix", files), ...inGroups("prettier --write", files)],
  "*.{json,md,yml}": (files) => inGroups("prettier --write", files),
};
