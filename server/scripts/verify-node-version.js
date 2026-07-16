const requiredMajor = 24;
const activeMajor = Number(process.versions.node.split(".")[0]);

if (activeMajor !== requiredMajor) {
  console.error(
    `BandScroll server requires Node ${requiredMajor}.x (found ${process.versions.node}). Run 'nvm use' and rebuild better-sqlite3.`
  );
  process.exit(1);
}
