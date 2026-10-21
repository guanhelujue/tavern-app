const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Force Android release/debug APK base name (Gradle 9+: base.archivesName).
 */
function withApkName(config, { name = 'guanhelujue' } = {}) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      return config;
    }

    let contents = config.modResults.contents;
    const marker = `archivesName = "${name}"`;
    const legacyMarkers = [
      `setProperty("archivesBaseName", "${name}")`,
      `archivesBaseName = "${name}"`,
      `archivesBaseName = '${name}'`,
    ];

    // Remove legacy injections that break on Gradle 9 / new AGP.
    for (const legacy of legacyMarkers) {
      contents = contents.split(legacy).join('');
    }

    // Clean empty leftover blank lines inside defaultConfig from removals.
    contents = contents.replace(/defaultConfig\s*\{\n(?:[ \t]*\n)+/g, 'defaultConfig {\n');

    if (contents.includes(marker) || contents.includes(`archivesName = '${name}'`)) {
      config.modResults.contents = contents;
      return config;
    }

    const baseBlock = `
base {
    archivesName = "${name}"
}
`;

    if (/^\s*base\s*\{/m.test(contents)) {
      contents = contents.replace(
        /base\s*\{[^}]*\}/m,
        `base {\n    archivesName = "${name}"\n}`,
      );
    } else {
      contents = `${contents.trimEnd()}\n${baseBlock}`;
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withApkName;
