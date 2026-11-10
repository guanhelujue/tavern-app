/**
 * Node-only sizing harness. It deliberately does not claim Android/iOS SQLite
 * performance; release-device runs must invoke the same operations against the
 * Expo SQLite database on real hardware.
 */
const sizes = [100_000, 300_000, 500_000, 1_000_000];
const now = () => Number(process.hrtime.bigint()) / 1e6;

function runBenchmark(characters: number) {
  const start = now();
  const chapterCount = Math.max(1, Math.ceil(characters / 1_000));
  const chapterBody = '字'.repeat(Math.min(1_000, characters));
  const chapters = Array.from({ length: chapterCount }, (_, index) => ({
    id: `chapter-${index}`,
    chapterIndex: index + 1,
    title: `Chapter ${index + 1}`,
    content: chapterBody,
  }));
  const coldStartMs = now() - start;
  const firstScreenStart = now();
  const firstScreen = chapters.slice(0, 20).map(({ id, chapterIndex, title }) => ({ id, chapterIndex, title }));
  const firstScreenMs = now() - firstScreenStart;
  const appendStart = now();
  chapters.push({ id: `chapter-${chapterCount}`, chapterIndex: chapterCount + 1, title: 'append', content: '追加'.repeat(50) });
  const appendMs = now() - appendStart;
  const exportStart = now();
  let exportedCharacters = 0;
  for (const chapter of chapters) exportedCharacters += chapter.content.length;
  const exportMs = now() - exportStart;
  return {
    characters,
    mode: 'simulated-node-only',
    chapterCount,
    coldStartMs: Number(coldStartMs.toFixed(2)),
    firstScreenMs: Number(firstScreenMs.toFixed(2)),
    firstScreenItems: firstScreen.length,
    appendMessageMs: Number(appendMs.toFixed(2)),
    exportMs: Number(exportMs.toFixed(2)),
    exportedCharacters,
    peakRssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
  };
}

console.log(JSON.stringify({ environment: 'Node.js 24; array harness; not device SQLite', results: sizes.map(runBenchmark) }, null, 2));
